"""Payer directory sampler: a seeded draw of NPD practitioners looked up in a
payer's public FHIR directory, with hard caps.

v1 payers: Humana and UnitedHealthcare through Optum FLEX. Cigna is out (it
rejects identifier search, and findability by name is not comparable); Molina
is out until registered.

Per lookup, against the same base URLs as h26_mco_exposure_va.py:

    1. Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|<npi>
       (h26's form, which is the one verified against these payers)
    2. PractitionerRole?practitioner=Practitioner/<id>
         &_include=PractitionerRole:location&_count=50

Both searches follow link[relation=next] through the same throttle, at most
MAX_PAGES_PER_SEARCH pages each and only to URLs under the payer's base. Every
Practitioner carrying the NPI is queried for roles, not a fixed few.

Outcomes are kept apart because they mean different things:

    listed         a Bundle whose Practitioner carries the NPI (checked through
                   fhir_identifiers, so a server that ignores the parameter and
                   returns someone else does not read as "listed"), and the
                   role query also answered
    not_listed     a parsed 200 Bundle with no total above zero and no entries
                   other than OperationOutcome ones, or a 404 whose body is
                   empty, an OperationOutcome or such an empty Bundle (h26's
                   rule: some FHIR servers answer an empty search with 404)
    lookup_failed  anything else: non-JSON (a WAF or error page, on a 404 too),
                   a non-Bundle, another status, a Bundle with total > 0 but no
                   Practitioner, a Practitioner without the NPI or a usable id,
                   or a failed role query

A listed result also carries two flags: `truncated` (paging stopped at a bound
before the server's last page) and `locations_missing` (a role referenced a
Location the server did not return, for instance because it ignored
_include). Location references are resolved from relative, versioned
(`Location/x/_history/2`) and absolute forms.

A run in which every completed lookup is not_listed, over at least
SUSPECT_MIN_LOOKUPS lookups, reports `suspect_all_not_listed: true` and warns on
stderr: that is the silent-zero shape, not a finding.

Caps (Global Constraints of the 2026-11-03 shared-core plan): 2 requests per
second, 1,500 requests per payer per run, 60-minute timeout covering the whole
run including the draw, target 300 found. The cap and limiter count every curl
call, not every lookup; a lookup cut off by the cap or the deadline is
discarded, never recorded as half an answer.

Suppressed NPIs are removed in `draw` before any request and skipped again in
`run`. Per-NPI results, including payer values, go only to the gitignored
analysis/data/payer-sample/<payer>/<date>-seed<seed>.parquet (a numeric suffix
is added rather than overwrite an earlier run), written even when the run
raises or is interrupted. Stdout carries counts and the seed, never an NPI, and
no URL is printed.

Usage (owner-run; this makes live requests):
    python3 analysis/payer_sample.py humana --release 2026-10-07 --state PA
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import sys
import time
import urllib.parse
from datetime import date
from pathlib import Path
from typing import Callable, TypedDict

import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fhir_identifiers import extract_npis  # noqa: E402
from h26_mco_exposure_va import MCOS, _fetch as curl_get  # noqa: E402
from xsource_facts import EL_ROLE_ADDR, EL_ROLE_TEL, scope_npis  # noqa: E402
from xsource_norm import phone10, zip5  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = REPO_ROOT / "analysis" / "data" / "payer-sample"

_BASES = {m["name"]: m["endpoint"].rstrip("/") for m in MCOS}
PAYERS = {"humana": _BASES["Humana"], "optum_flex": _BASES["UnitedHealthcare"]}

NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi"
# Pages followed per search. Every page is one request through the throttle,
# so the run-level cap still bounds the total; this only stops one looping or
# huge server from spending the run on a single NPI.
MAX_PAGES_PER_SEARCH = 10

Fetch = Callable[[str], "tuple[int, str]"]


class PayerResult(TypedDict):
    status: str  # 'listed' | 'not_listed' | 'lookup_failed'
    zips: set
    phones: set
    truncated: bool          # paging stopped before the server's last page
    locations_missing: bool  # a role referenced a Location the server did not return


class BudgetExhausted(Exception):
    """The per-run request cap was reached."""


class RunTimeout(Exception):
    """The run deadline passed."""


class Throttle:
    """Wraps a fetch: request cap, minimum spacing of 1/rps, and a deadline."""

    def __init__(self, fetch: Fetch, max_requests: int, rps: float,
                 clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep,
                 deadline: float | None = None):
        if rps <= 0:
            raise ValueError("rps must be positive")
        self.fetch, self.max_requests, self.interval = fetch, max_requests, 1.0 / rps
        self.clock, self.sleep, self.deadline = clock, sleep, deadline
        self.requests = 0
        self._last: float | None = None

    def get(self, url: str) -> tuple[int, str]:
        if self.requests >= self.max_requests:
            raise BudgetExhausted()
        if self.deadline is not None and self.clock() >= self.deadline:
            raise RunTimeout()
        if self._last is not None:
            wait = self._last + self.interval - self.clock()
            if wait > 0:
                self.sleep(wait)
        self._last = self.clock()
        self.requests += 1
        return self.fetch(url)


# --------------------------------------------------------------------------
# Lookups
# --------------------------------------------------------------------------

def _result(status: str, zips=(), phones=(), *, truncated: bool = False,
            locations_missing: bool = False) -> PayerResult:
    return {"status": status, "zips": set(zips), "phones": set(phones),
            "truncated": truncated, "locations_missing": locations_missing}


def _json(body) -> object:
    try:
        return json.loads(body)
    except (TypeError, ValueError):
        return None


def _bundle(status: int, body: str) -> dict | None:
    if status != 200:
        return None
    doc = _json(body)
    if not isinstance(doc, dict) or doc.get("resourceType") != "Bundle":
        return None
    return doc


def _entries(bundle: dict) -> list:
    e = bundle.get("entry")
    return e if isinstance(e, list) else []


def _resources(bundle: dict, rtype: str) -> list[dict]:
    out = []
    for e in _entries(bundle):
        r = e.get("resource") if isinstance(e, dict) else None
        if isinstance(r, dict) and r.get("resourceType") == rtype:
            out.append(r)
    return out


def _total(bundle: dict) -> int | None:
    t = bundle.get("total")
    return t if isinstance(t, int) and not isinstance(t, bool) else None


def _is_outcome_entry(e) -> bool:
    """An entry carrying an OperationOutcome (search.mode 'outcome')."""
    r = e.get("resource") if isinstance(e, dict) else None
    return isinstance(r, dict) and r.get("resourceType") == "OperationOutcome"


def _empty_search(bundle: dict) -> bool:
    """A searchset that positively says nothing matched: no total above zero,
    and no entries other than OperationOutcome ones (search.mode outcome)."""
    total = _total(bundle)
    if total is not None and total > 0:
        return False
    return all(_is_outcome_entry(e) for e in _entries(bundle))


def _empty_404(body) -> bool:
    """A 404 may mean "no match" only when the body says so in FHIR terms:
    empty, an OperationOutcome, or an empty Bundle. An HTML page or any other
    body is a gateway or routing error, not an answer."""
    if body is None or not str(body).strip():
        return True
    doc = _json(body)
    if not isinstance(doc, dict):
        return False
    if doc.get("resourceType") == "OperationOutcome":
        return True
    return doc.get("resourceType") == "Bundle" and _empty_search(doc)


def _ref_id(ref, rtype: str = "Location") -> str | None:
    """'Location/abc', 'Location/abc/_history/2' and absolute URLs -> 'abc'."""
    if not isinstance(ref, str):
        return None
    parts = [p for p in ref.strip().split("/") if p]
    if "_history" in parts:
        parts = parts[:parts.index("_history")]
    for i in range(len(parts) - 2, -1, -1):
        if parts[i] == rtype:
            return parts[i + 1]
    return None


def _next_link(bundle: dict) -> str | None:
    links = bundle.get("link")
    for link in links if isinstance(links, list) else []:
        if isinstance(link, dict) and link.get("relation") == "next":
            url = link.get("url")
            return url if isinstance(url, str) and url else None
    return None


def _search(base: str, first_url: str, get: Fetch,
            first: dict | None = None) -> tuple[list[dict] | None, bool]:
    """Every page of one search, following link[relation=next] through `get`
    (so the rate limiter and the request cap see every page). `first` is the
    first page when the caller already fetched it. Returns (bundles,
    truncated); bundles is None if any page failed. Paging stops, marked
    truncated, at MAX_PAGES_PER_SEARCH pages, at a next link outside `base`,
    or at a next link already fetched."""
    bundles: list[dict] = []
    seen = {first_url}
    url = first_url
    b = first
    while True:
        if b is None:
            b = _bundle(*get(url))
            if b is None:
                return None, False
        bundles.append(b)
        nxt = _next_link(b)
        if nxt is None:
            return bundles, False
        nxt = urllib.parse.urljoin(url, nxt)
        if (len(bundles) >= MAX_PAGES_PER_SEARCH or nxt in seen
                or not (nxt.startswith(base + "/") or nxt.startswith(base + "?"))):
            return bundles, True
        seen.add(nxt)
        url, b = nxt, None


def _role_locations(bundles: list[dict]) -> tuple[set, set, bool]:
    """ZIPs and phones of the Locations the roles reference, across all pages,
    and whether any referenced Location was not returned."""
    refs = set()
    for b in bundles:
        for role in _resources(b, "PractitionerRole"):
            locs = role.get("location")
            for loc in locs if isinstance(locs, list) else []:
                rid = _ref_id(loc.get("reference")) if isinstance(loc, dict) else None
                if rid:
                    refs.add(rid)
    zips, phones, found = set(), set(), set()
    for b in bundles:
        for loc in _resources(b, "Location"):
            lid = loc.get("id")
            if not isinstance(lid, str) or lid not in refs:
                continue
            found.add(lid)
            addr = loc.get("address")
            if isinstance(addr, list):
                addr = next((a for a in addr if isinstance(a, dict)), {})
            z = zip5(addr.get("postalCode")) if isinstance(addr, dict) else None
            if z:
                zips.add(z)
            tel = loc.get("telecom")
            for t in tel if isinstance(tel, list) else []:
                if isinstance(t, dict) and t.get("system") == "phone":
                    p = phone10(t.get("value"))
                    if p:
                        phones.add(p)
    return zips, phones, bool(refs - found)


def lookup(base: str, npi: str, get: Fetch) -> PayerResult:
    q = urllib.parse.urlencode({"identifier": f"{NPI_SYSTEM}|{npi}"})
    first = f"{base}/Practitioner?{q}"
    status, body = get(first)
    if status == 404:
        return _result("not_listed") if _empty_404(body) else _result("lookup_failed")
    bundle = _bundle(status, body)
    if bundle is None:
        return _result("lookup_failed")
    pages, truncated = _search(base, first, get, first=bundle)
    if pages is None:
        return _result("lookup_failed")
    practs = [p for b in pages for p in _resources(b, "Practitioner")]
    if not practs:
        return _result("not_listed") if _empty_search(bundle) else _result("lookup_failed")
    ids = []
    for p in practs:
        pid = p.get("id")
        if isinstance(pid, str) and pid and npi in extract_npis(p) and pid not in ids:
            ids.append(pid)
    if not ids:
        return _result("lookup_failed")
    zips, phones, missing = set(), set(), False
    for pid in ids:
        q = urllib.parse.urlencode({
            "practitioner": f"Practitioner/{pid}",
            "_include": "PractitionerRole:location",
            "_count": "50",
        })
        rbs, trunc = _search(base, f"{base}/PractitionerRole?{q}", get)
        if rbs is None:
            return _result("lookup_failed")
        truncated |= trunc
        z, p, m = _role_locations(rbs)
        zips |= z
        phones |= p
        missing |= m
    return _result("listed", zips, phones, truncated=truncated, locations_missing=missing)


def lookup_humana(npi: str, get: Fetch | None = None) -> PayerResult:
    return lookup(PAYERS["humana"], npi, get or curl_get)


def lookup_optum(npi: str, get: Fetch | None = None) -> PayerResult:
    return lookup(PAYERS["optum_flex"], npi, get or curl_get)


# --------------------------------------------------------------------------
# Draw and run
# --------------------------------------------------------------------------

def _order_key(seed: int, npi: str) -> str:
    return hashlib.sha256(f"{seed}:{npi}".encode()).hexdigest()


def draw(release: str, state: str, n: int, seed: int, suppressed: set[str], *,
         parquet_root: Path | None = None, stat: Callable = os.stat) -> list[str]:
    """Up to n active practitioners with an active NPD role in `state`, in
    sha256(seed:npi) order, with suppressed NPIs removed before returning."""
    pool = scope_npis(release, [state], parquet_root=parquet_root, stat=stat) - set(suppressed)
    return sorted(pool, key=lambda npi: _order_key(seed, npi))[:n]


def to_fact_rows(results: dict[str, PayerResult], payer: str, observed_at: str) -> list[dict]:
    """Payer values in the facts-table shape, for xsource_facts.compare."""
    rows = []
    for npi, r in results.items():
        if r["status"] != "listed":
            continue
        for z in sorted(r["zips"]):
            rows.append({"npi": npi, "source": payer, "fhir_element": EL_ROLE_ADDR,
                         "field": "zip5", "value_norm": z, "observed_at": observed_at})
        for p in sorted(r["phones"]):
            rows.append({"npi": npi, "source": payer, "fhir_element": EL_ROLE_TEL,
                         "field": "phone10", "value_norm": p, "observed_at": observed_at})
    return rows


_OUT_SCHEMA = pa.schema([
    ("npi", pa.string()), ("status", pa.string()),
    ("zips", pa.list_(pa.string())), ("phones", pa.list_(pa.string())),
    ("truncated", pa.bool_()), ("locations_missing", pa.bool_()),
    ("payer", pa.string()), ("release", pa.string()), ("state", pa.string()),
    ("seed", pa.int64()), ("observed_at", pa.string()),
])

# A run in which every completed lookup reads not_listed, over at least this
# many lookups, is the silent-zero shape (a changed search parameter, a WAF
# answering 404 in FHIR clothing): flagged, never read as a finding.
SUSPECT_MIN_LOOKUPS = 20


def _out_path(out_dir: Path, today: str, seed: int) -> Path:
    """<date>-seed<seed>.parquet, with -2, -3 ... so no earlier run is overwritten."""
    path = out_dir / f"{today}-seed{seed}.parquet"
    n = 2
    while path.exists():
        path = out_dir / f"{today}-seed{seed}-{n}.parquet"
        n += 1
    return path


def _write(path: Path, results: dict[str, PayerResult], payer: str, release: str,
           state: str, seed: int, today: str) -> None:
    rows = [{"npi": npi, "status": r["status"], "zips": sorted(r["zips"]),
             "phones": sorted(r["phones"]), "truncated": bool(r.get("truncated")),
             "locations_missing": bool(r.get("locations_missing")),
             "payer": payer, "release": release, "state": state, "seed": seed,
             "observed_at": today}
            for npi, r in results.items()]
    tmp = path.with_name(path.name + ".partial")
    pq.write_table(pa.Table.from_pylist(rows, schema=_OUT_SCHEMA), tmp)
    tmp.replace(path)


def run(payer: str, release: str, state: str, target_found: int = 300,
        max_requests: int = 1500, rps: float = 2.0, *,
        seed: int | None = None, suppressed: set[str] | None = None,
        fetch: Fetch | None = None, clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep, timeout_s: float = 3600.0,
        parquet_root: Path | None = None, out_root: Path | None = None,
        today: str | None = None, suspect_min: int = SUSPECT_MIN_LOOKUPS) -> dict:
    """Sample one payer. Returns counts only; per-NPI rows go to analysis/data/.

    The deadline starts here and covers the draw. Completed lookups are saved
    even if the run raises or is interrupted."""
    if payer not in PAYERS:
        raise ValueError(f"payer must be one of {sorted(PAYERS)}")
    deadline = clock() + timeout_s
    if suppressed is None:
        from suppression import load_suppressed
        suppressed = load_suppressed()
    if seed is None:
        seed = secrets.randbelow(2**31)
    today = today or date.today().isoformat()
    out_dir = Path(out_root or OUT_ROOT) / payer
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = _out_path(out_dir, today, seed)

    # No lookup can use fewer than one request, so max_requests bounds the draw.
    candidates = draw(release, state, max_requests, seed, suppressed, parquet_root=parquet_root)
    throttle = Throttle(fetch or curl_get, max_requests, rps, clock=clock, sleep=sleep,
                        deadline=deadline)
    results: dict[str, PayerResult] = {}
    stopped = "draw_exhausted"
    try:
        for npi in candidates:
            if npi in suppressed:  # draw already removed these; never request one
                continue
            if sum(r["status"] == "listed" for r in results.values()) >= target_found:
                stopped = "target_found"
                break
            if clock() >= deadline:
                stopped = "timeout"
                break
            try:
                results[npi] = lookup(PAYERS[payer], npi, throttle.get)
            except BudgetExhausted:
                stopped = "max_requests"
                break
            except RunTimeout:
                stopped = "timeout"
                break
            except (TypeError, ValueError, AttributeError, KeyError):
                # A payload shape the parser did not anticipate is a failed
                # lookup, counted, not a crash that loses the run.
                results[npi] = _result("lookup_failed")
        else:
            if sum(r["status"] == "listed" for r in results.values()) >= target_found:
                stopped = "target_found"
    finally:
        _write(out_path, results, payer, release, state, seed, today)

    statuses = [r["status"] for r in results.values()]
    suspect = (len(statuses) >= suspect_min
               and statuses.count("not_listed") == len(statuses))
    counts = {
        "payer": payer, "release": release, "state": state, "seed": seed,
        "drawn": len(candidates), "queried": len(results),
        "listed": statuses.count("listed"), "not_listed": statuses.count("not_listed"),
        "lookup_failed": statuses.count("lookup_failed"),
        "truncated": sum(bool(r.get("truncated")) for r in results.values()),
        "locations_missing": sum(bool(r.get("locations_missing")) for r in results.values()),
        "requests": throttle.requests, "stopped": stopped,
        "suspect_all_not_listed": suspect,
    }
    if suspect:
        print(f"WARNING: suspect run: all {len(statuses)} completed lookups read not_listed. "
              f"Check the search parameter and the payer's error pages before using it.",
              file=sys.stderr)
    print(json.dumps(counts))
    return counts


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Sample a payer FHIR directory (live requests).")
    ap.add_argument("payer", choices=sorted(PAYERS))
    ap.add_argument("--release", required=True)
    ap.add_argument("--state", required=True)
    ap.add_argument("--target-found", type=int, default=300)
    ap.add_argument("--max-requests", type=int, default=1500)
    ap.add_argument("--rps", type=float, default=2.0)
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args(argv)
    run(args.payer, args.release, args.state, args.target_found, args.max_requests,
        args.rps, seed=args.seed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
