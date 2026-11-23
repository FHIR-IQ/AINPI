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

Outcomes are kept apart because they mean different things:

    listed         a Bundle whose Practitioner carries the NPI (checked through
                   fhir_identifiers, so a server that ignores the parameter and
                   returns someone else does not read as "listed"), and the
                   role query also answered
    not_listed     a parsed 200 Bundle with no entries, or a 404 (h26's rule:
                   some FHIR servers answer an empty search with 404)
    lookup_failed  anything else: non-JSON (a WAF or error page), a non-Bundle,
                   another status, a Practitioner without the NPI, or a failed
                   role query

Caps (Global Constraints of the 2026-11-03 shared-core plan): 2 requests per
second, 1,500 requests per payer per run, 60-minute timeout, target 300 found.
The cap and limiter count every curl call, not every lookup; a lookup cut off
by the cap is discarded, never recorded as half an answer.

Suppressed NPIs are removed in `draw` before any request and skipped again in
`run`. Per-NPI results, including payer values, go only to the gitignored
analysis/data/payer-sample/<payer>/<date>.parquet. Stdout carries counts and
the seed, never an NPI, and no URL is printed.

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
MAX_PRACTITIONERS_PER_NPI = 3

Fetch = Callable[[str], "tuple[int, str]"]


class PayerResult(TypedDict):
    status: str  # 'listed' | 'not_listed' | 'lookup_failed'
    zips: set
    phones: set


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

def _result(status: str, zips=(), phones=()) -> PayerResult:
    return {"status": status, "zips": set(zips), "phones": set(phones)}


def _bundle(status: int, body: str) -> dict | None:
    if status != 200:
        return None
    try:
        doc = json.loads(body)
    except (TypeError, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get("resourceType") != "Bundle":
        return None
    return doc


def _resources(bundle: dict, rtype: str) -> list[dict]:
    out = []
    for e in bundle.get("entry") or []:
        r = e.get("resource") if isinstance(e, dict) else None
        if isinstance(r, dict) and r.get("resourceType") == rtype:
            out.append(r)
    return out


def _role_locations(bundle: dict) -> tuple[set, set]:
    refs = set()
    for role in _resources(bundle, "PractitionerRole"):
        for loc in role.get("location") or []:
            ref = loc.get("reference") if isinstance(loc, dict) else None
            if isinstance(ref, str) and ref:
                refs.add(ref.rstrip("/").rsplit("/", 1)[-1])
    zips, phones = set(), set()
    for loc in _resources(bundle, "Location"):
        if loc.get("id") not in refs:
            continue
        addr = loc.get("address")
        if isinstance(addr, list):
            addr = next((a for a in addr if isinstance(a, dict)), {})
        z = zip5(addr.get("postalCode")) if isinstance(addr, dict) else None
        if z:
            zips.add(z)
        for t in loc.get("telecom") or []:
            if isinstance(t, dict) and t.get("system") == "phone":
                p = phone10(t.get("value"))
                if p:
                    phones.add(p)
    return zips, phones


def lookup(base: str, npi: str, get: Fetch) -> PayerResult:
    q = urllib.parse.urlencode({"identifier": f"{NPI_SYSTEM}|{npi}"})
    status, body = get(f"{base}/Practitioner?{q}")
    if status == 404:
        return _result("not_listed")
    bundle = _bundle(status, body)
    if bundle is None:
        return _result("lookup_failed")
    practs = _resources(bundle, "Practitioner")
    if not practs:
        return _result("not_listed") if not bundle.get("entry") else _result("lookup_failed")
    ids = [p.get("id") for p in practs if npi in extract_npis(p) and p.get("id")]
    if not ids:
        return _result("lookup_failed")
    zips, phones = set(), set()
    for pid in ids[:MAX_PRACTITIONERS_PER_NPI]:
        q = urllib.parse.urlencode({
            "practitioner": f"Practitioner/{pid}",
            "_include": "PractitionerRole:location",
            "_count": "50",
        })
        rb = _bundle(*get(f"{base}/PractitionerRole?{q}"))
        if rb is None:
            return _result("lookup_failed")
        z, p = _role_locations(rb)
        zips |= z
        phones |= p
    return _result("listed", zips, phones)


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
    ("payer", pa.string()), ("release", pa.string()), ("state", pa.string()),
    ("seed", pa.int64()), ("observed_at", pa.string()),
])


def run(payer: str, release: str, state: str, target_found: int = 300,
        max_requests: int = 1500, rps: float = 2.0, *,
        seed: int | None = None, suppressed: set[str] | None = None,
        fetch: Fetch | None = None, clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep, timeout_s: float = 3600.0,
        parquet_root: Path | None = None, out_root: Path | None = None,
        today: str | None = None) -> dict:
    """Sample one payer. Returns counts only; per-NPI rows go to analysis/data/."""
    if payer not in PAYERS:
        raise ValueError(f"payer must be one of {sorted(PAYERS)}")
    if suppressed is None:
        from suppression import load_suppressed
        suppressed = load_suppressed()
    if seed is None:
        seed = secrets.randbelow(2**31)
    today = today or date.today().isoformat()

    # No lookup can use fewer than one request, so max_requests bounds the draw.
    candidates = draw(release, state, max_requests, seed, suppressed, parquet_root=parquet_root)
    throttle = Throttle(fetch or curl_get, max_requests, rps, clock=clock, sleep=sleep,
                        deadline=clock() + timeout_s)
    results: dict[str, PayerResult] = {}
    stopped = "draw_exhausted"
    for npi in candidates:
        if npi in suppressed:  # draw already removed these; never request one
            continue
        if sum(r["status"] == "listed" for r in results.values()) >= target_found:
            stopped = "target_found"
            break
        if clock() >= throttle.deadline:
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
    else:
        if sum(r["status"] == "listed" for r in results.values()) >= target_found:
            stopped = "target_found"

    out_dir = Path(out_root or OUT_ROOT) / payer
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = [{"npi": npi, "status": r["status"], "zips": sorted(r["zips"]),
             "phones": sorted(r["phones"]), "payer": payer, "release": release,
             "state": state, "seed": seed, "observed_at": today}
            for npi, r in results.items()]
    pq.write_table(pa.Table.from_pylist(rows, schema=_OUT_SCHEMA), out_dir / f"{today}.parquet")

    statuses = [r["status"] for r in results.values()]
    counts = {
        "payer": payer, "release": release, "state": state, "seed": seed,
        "drawn": len(candidates), "queried": len(results),
        "listed": statuses.count("listed"), "not_listed": statuses.count("not_listed"),
        "lookup_failed": statuses.count("lookup_failed"),
        "requests": throttle.requests, "stopped": stopped,
    }
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
