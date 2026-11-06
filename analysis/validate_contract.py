"""Validate the published /api/v1 contract before it ships.

Two passes.

SCHEMA. Every payload is checked against the JSON Schemas in
`contract_schemas.py`, which are also published under /api/v1/schemas/ so an
external consumer can run the same check.

INVARIANTS. The schema pass cannot catch a well-formed file that is wrong, and
every defect this project shipped in August was well-formed:

  - a scoreboard computing August numbers and stamping them 2026-05-08
  - stats.json reporting H13's pair counts as NPI validation counts
  - two findings publishing different totals for the same quantity
  - twelve findings pinned to a release the warehouse no longer held
  - a treemap layer that was 0.0 in every cell because it ANDed an empty field

None of those would fail a schema. They fail here.

Run:
    python analysis/validate_contract.py            # validate, exit 1 on error
    python analysis/validate_contract.py --write-schemas
    python analysis/validate_contract.py --json     # machine-readable report

Exit codes: 0 clean, 1 errors found. Warnings never fail the run: they are for
things that are explicable but worth a human look, such as a finding measured
against an older release on purpose.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from contract_schemas import SCHEMAS  # noqa: E402
from release import CURRENT_RELEASE, KNOWN_RELEASES  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = ROOT / "frontend" / "public" / "api" / "v1"
FINDINGS_TS = ROOT / "frontend" / "src" / "data" / "findings.ts"

# Payloads whose provenance is deliberately not an NDH release. Each entry is
# a reason, not just an exemption: an unexplained mismatch is a defect.
NON_NDH_PROVENANCE = {
    "endpoint-liveness": "crawler probe, runs on its own cadence",
    "network-adequacy-gauge": "joins crawler results, inherits its date",
    "state-medicaid-directory-coverage": "pinned commit of a CMS directory repo",
    "excluded-paid-by-medicaid": "T-MSIS claims year",
    "deactivated-still-billing": "claims year",
    "excluded-billing-medicare-partb": "claims year",
    "excluded-billing-medicare-partb-by-hcpcs": "claims year",
    "excluded-prescribing-medicare-partd": "claims year",
    "excluded-telehealth-dominant-post-exclusion": "claims year",
    "excluded-receiving-industry-payments": "Open Payments program year",
    "dmepos-excluded": "claims year",
    "nh-hospice-hh-ownership-flags": "CMS ownership file quarter",
    "pecos-taxonomy-disagreement": "PPEF extract date",
    "pecos-behavioral-health-taxonomy": "PPEF extract date",
    "pecos-multi-enrollment-state-mismatch": "PPEF extract date",
    "pecos-affiliation-coverage": "PPEF extract date",
    "pa-rural-hospital-connectivity": "CMS hospital file + USDA ERS",
    "rural-hospital-baseline": "CMS hospital file + USDA ERS",
    "payer-affiliation-gap": "payer directory harvest",
}


class Report:
    def __init__(self) -> None:
        self.errors: list[tuple[str, str]] = []
        self.warnings: list[tuple[str, str]] = []
        self.checked = 0

    def error(self, where: str, msg: str) -> None:
        self.errors.append((where, msg))

    def warn(self, where: str, msg: str) -> None:
        self.warnings.append((where, msg))

    @property
    def ok(self) -> bool:
        return not self.errors


# Keys of states/<state>-connectivity.json that the page, the MCP tool docs
# and external consumers read. Dotted paths into the payload.
CONNECTIVITY_KEYS = (
    "summary.reaches_endpoint",
    "summary.reaches_endpoint_pct",
    "summary.reaches_endpoint_pct_of_affiliated",
    "summary.reaches_endpoint_deterministic",
    "summary.reaches_endpoint_deterministic_pct",
    "summary.reaches_endpoint_via_vendor_npi_list",
    "summary.vendor_npi_list_threshold",
    "summary.organizations_with_endpoint",
    "summary.organizations_with_endpoint_via_vendor_npi_list",
    "corrections",
    "field_notes",
    "funnel",
    "confidence.yellow",
    "confidence.vendor_list",
    "confidence.resolved",
    "confidence.resolved_by_tier",
    "confidence.enrolled",
    "systems.rows",
    "systems.tiers.order",
    "systems.tiers.deterministic",
    "systems.corrections",
    "systems.known_systems_unreached.rows",
    "systems.systems_reaching_an_endpoint_deterministic",
    "graph.nodes",
    "organizations_top",
    "organizations_unlinked.rows",
)

# Columns of findings/vendor-endpoint-attribution.csv, in order.
VENDOR_CSV_HEADER = ["url", "org_name", "org_npi", "vendor", "in_ndh",
                     "ndh_has_owner", "npis_on_url"]


def load(path: pathlib.Path):
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as e:
        return e


def rel(p: pathlib.Path) -> str:
    return str(p.relative_to(API))


# --------------------------------------------------------------------------
# Pass 1 — schema
# --------------------------------------------------------------------------
def schema_pass(rep: Report) -> None:
    from jsonschema import Draft202012Validator

    def check(path: pathlib.Path, schema_name: str) -> None:
        doc = load(path)
        if isinstance(doc, json.JSONDecodeError):
            rep.error(rel(path), f"not valid JSON: {doc}")
            return
        rep.checked += 1
        v = Draft202012Validator(SCHEMAS[schema_name])
        for err in sorted(v.iter_errors(doc), key=lambda e: list(e.path)):
            loc = "/".join(str(x) for x in err.path) or "(root)"
            rep.error(rel(path), f"schema[{schema_name}] at {loc}: {err.message}")

    if (API / "stats.json").exists():
        check(API / "stats.json", "stats")
    if (API / "manifest.json").exists():
        check(API / "manifest.json", "manifest")
    if (API / "dq-results.json").exists():
        check(API / "dq-results.json", "dq_results")
    if (API / "source-changes.json").exists():
        check(API / "source-changes.json", "source_changes")
    if (API / "networks.json").exists():
        check(API / "networks.json", "networks")
        doc = load(API / "networks.json")
        if isinstance(doc, dict):
            for msg in check_networks(doc):
                rep.error("networks.json", msg)
    for f in sorted((API / "findings").glob("*.json")):
        # `-detail` payloads are row-level companions to a finding, not
        # findings: they carry an array of records rather than a headline and
        # a numerator. Holding them to the finding shape reported 39 errors
        # about files that were never meant to have it.
        if f.stem.endswith("-detail"):
            continue
        check(f, "finding")
    for f in sorted((API / "states").glob("*.json")):
        # Only the 2-letter slices carry the state-slice shape; the derived
        # payloads next to them (connectivity, rural-health, briefing summary)
        # have their own shapes and are checked by invariants instead.
        if re.fullmatch(r"[a-z]{2}", f.stem):
            check(f, "state")


# --------------------------------------------------------------------------
# Pass 2 — invariants
# --------------------------------------------------------------------------
def invariant_pass(rep: Report) -> None:
    findings = {}
    for f in sorted((API / "findings").glob("*.json")):
        doc = load(f)
        if isinstance(doc, dict):
            findings[f.stem] = doc

    # --- provenance: an NDH-derived payload must name the pinned release ----
    for slug, doc in findings.items():
        rd = doc.get("release_date")
        base = slug.removesuffix("-detail")
        if base in NON_NDH_PROVENANCE:
            continue
        if rd is None:
            rep.warn(f"findings/{slug}", "no release_date")
        elif rd in KNOWN_RELEASES and rd != CURRENT_RELEASE:
            rep.error(
                f"findings/{slug}",
                f"release_date {rd} is a known NDH release but not the pinned "
                f"{CURRENT_RELEASE}. Re-run the generator, or add it to "
                f"NON_NDH_PROVENANCE with a reason.",
            )
        elif rd not in KNOWN_RELEASES and not rd.startswith(CURRENT_RELEASE):
            # Composite labels are allowed but must mention the pinned release
            # if they mention an NDH release at all.
            for known in KNOWN_RELEASES:
                if known in rd and known != CURRENT_RELEASE:
                    rep.error(
                        f"findings/{slug}",
                        f"provenance label names NDH release {known} but the "
                        f"warehouse holds {CURRENT_RELEASE}: {rd!r}",
                    )
                    break

    # --- numerator / denominator sanity ------------------------------------
    for slug, doc in findings.items():
        num, den = doc.get("numerator"), doc.get("denominator")
        if isinstance(num, (int, float)) and isinstance(den, (int, float)):
            if den < 0 or num < 0:
                rep.error(f"findings/{slug}", f"negative numerator/denominator: {num}/{den}")
            elif den and num > den:
                rep.error(
                    f"findings/{slug}",
                    f"numerator {num:,} exceeds denominator {den:,}",
                )

    # --- chart values in range ---------------------------------------------
    for slug, doc in findings.items():
        chart = doc.get("chart") or {}
        unit = chart.get("unit")
        for bar in chart.get("data") or []:
            v = bar.get("value")
            if not isinstance(v, (int, float)):
                continue
            if unit == "percent" and not (0 <= v <= 100):
                rep.error(
                    f"findings/{slug}",
                    f"percent chart value out of range: {bar.get('label')}={v}",
                )
            if unit == "count" and v < 0:
                rep.error(f"findings/{slug}", f"negative count: {bar.get('label')}={v}")

    # --- findings.ts <-> published JSON -------------------------------------
    if FINDINGS_TS.exists():
        src = FINDINGS_TS.read_text()
        entries = re.findall(r"slug:\s*'([a-z0-9-]+)'", src)
        statuses = re.findall(r"status:\s*'([a-z-]+)'", src)
        published = {
            slug for slug, st in zip(entries, statuses) if st == "published"
        } if len(entries) == len(statuses) else set()
        for slug in sorted(published):
            if slug not in findings:
                rep.error(
                    "findings.ts",
                    f"'{slug}' is marked published but "
                    f"frontend/public/api/v1/findings/{slug}.json does not exist",
                )
        orphans = {
            s for s in findings
            if not s.endswith("-detail")
            and s not in entries
            and s != "npi-validity-summary"
        }
        for slug in sorted(orphans):
            rep.warn(
                f"findings/{slug}",
                "published JSON has no entry in findings.ts, so it is "
                "unreachable from the site",
            )

    # --- state slices all on one release ------------------------------------
    state_rel: dict[str, list[str]] = {}
    codes = []
    for f in sorted((API / "states").glob("*.json")):
        if not re.fullmatch(r"[a-z]{2}", f.stem):
            continue
        doc = load(f)
        if isinstance(doc, dict):
            codes.append(f.stem)
            state_rel.setdefault(str(doc.get("release_date")), []).append(f.stem)
    if len(state_rel) > 1:
        rep.error(
            "states/",
            "state slices span multiple releases, so per-state pages disagree "
            "with each other: "
            + "; ".join(f"{k}: {len(v)} ({', '.join(sorted(v)[:4])}...)"
                        for k, v in sorted(state_rel.items())),
        )
    elif state_rel and CURRENT_RELEASE not in state_rel:
        rep.error("states/", f"state slices are on {list(state_rel)[0]}, not {CURRENT_RELEASE}")
    if codes and len(codes) != 51:
        rep.warn("states/", f"{len(codes)} state slices published, expected 51")

    # --- stats.json agrees with the findings it summarises -------------------
    stats = load(API / "stats.json") if (API / "stats.json").exists() else None
    if isinstance(stats, dict):
        if stats.get("release_date") != CURRENT_RELEASE:
            rep.error("stats.json", f"release_date {stats.get('release_date')} != {CURRENT_RELEASE}")
        c = stats.get("counters", {})
        if FINDINGS_TS.exists():
            src = FINDINGS_TS.read_text()
            n_pub = len(re.findall(r"status:\s*'published'", src))
            if c.get("findings_published") != n_pub:
                rep.error(
                    "stats.json",
                    f"findings_published={c.get('findings_published')} but "
                    f"findings.ts marks {n_pub} published",
                )
        # The pair that was wrong: NPI validation counts must come from H9's
        # sidecar, not from a slug that another script overwrites.
        side = load(API / "findings" / "npi-validity-summary.json")
        if isinstance(side, dict):
            if c.get("npis_checked") != side.get("npis_checked"):
                rep.error(
                    "stats.json",
                    f"npis_checked={c.get('npis_checked')} disagrees with H9's "
                    f"sidecar ({side.get('npis_checked')})",
                )
            if c.get("npis_flagged") != side.get("npis_flagged"):
                rep.error(
                    "stats.json",
                    f"npis_flagged={c.get('npis_flagged')} disagrees with H9's "
                    f"sidecar ({side.get('npis_flagged')})",
                )
        # A counter measured against another release must declare it.
        live = findings.get("endpoint-liveness") or {}
        if c.get("endpoints_live_pct") is not None:
            asof = (stats.get("counters_as_of") or {}).get("endpoints_live_pct")
            if live.get("release_date") != CURRENT_RELEASE and not asof:
                rep.error(
                    "stats.json",
                    "endpoints_live_pct comes from a finding measured against "
                    f"{live.get('release_date')} but counters_as_of does not say so",
                )

    # --- cross-finding agreements -------------------------------------------
    # H50's unattributed remainder is H51's denominator. They published 94,711
    # and 94,623 because one counted references present and the other counted
    # references that resolve.
    h50, h51 = findings.get("endpoint-org-linkage"), findings.get("vendor-endpoint-attribution")
    if isinstance(h50, dict) and isinstance(h51, dict):
        n, d = h50.get("numerator"), h50.get("denominator")
        if all(isinstance(x, (int, float)) for x in (n, d)):
            expected = d - n
            got = h51.get("denominator")
            if isinstance(got, (int, float)) and got != expected:
                rep.error(
                    "findings/vendor-endpoint-attribution",
                    f"denominator {got:,} should equal the endpoints H50 leaves "
                    f"unattributed ({expected:,}). One of them is counting "
                    f"references present and the other references that resolve.",
                )

    # --- connectivity ledger: keys consumers and the page read ---------------
    # No JSON schema covers this payload, so a regeneration that dropped a key
    # would ship silently; check presence for every published slice.
    for f in sorted((API / "states").glob("*-connectivity.json")):
        doc = load(f)
        where = rel(f)
        if not isinstance(doc, dict):
            rep.error(where, "not valid JSON")
            continue
        rep.checked += 1
        for k in CONNECTIVITY_KEYS:
            node = doc
            for part in k.split("."):
                node = node.get(part) if isinstance(node, dict) else None
                if node is None:
                    break
            if node is None:
                rep.error(where, f"missing key {k}")
        if doc.get("release_date") != CURRENT_RELEASE:
            rep.error(where, f"release_date {doc.get('release_date')} != {CURRENT_RELEASE}")

    # --- H51 CSV header: org-lookup, the ledger and H53 all parse it ---------
    csv_path = API / "findings" / "vendor-endpoint-attribution.csv"
    if csv_path.exists():
        rep.checked += 1
        with csv_path.open(newline="") as fh:
            header = fh.readline().strip().split(",")
        if header != VENDOR_CSV_HEADER:
            rep.error("findings/vendor-endpoint-attribution.csv",
                      f"header {header} != {VENDOR_CSV_HEADER}")

    # --- manifest points at files that exist --------------------------------
    man = load(API / "manifest.json") if (API / "manifest.json").exists() else None
    if isinstance(man, dict):
        if man.get("release_date") != CURRENT_RELEASE:
            rep.error("manifest.json", f"release_date {man.get('release_date')} != {CURRENT_RELEASE}")
        missing = 0
        for group in ("findings", "states", "downloads_csv"):
            for entry in man.get(group) or []:
                url = entry.get("url") if isinstance(entry, dict) else None
                if not url or "/api/v1/" not in url:
                    continue
                target = API / url.split("/api/v1/", 1)[1]
                if not target.exists():
                    missing += 1
                    if missing <= 8:
                        rep.error("manifest.json", f"advertises a URL with no file: {url}")
        if missing > 8:
            rep.error("manifest.json", f"...and {missing - 8} more missing URLs")

    # --- freshness -----------------------------------------------------------
    now = datetime.now(timezone.utc)
    for slug, doc in findings.items():
        ts = doc.get("generated_at")
        if not isinstance(ts, str):
            continue
        try:
            when = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            rep.warn(f"findings/{slug}", f"unparseable generated_at: {ts!r}")
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        if when > now:
            rep.error(f"findings/{slug}", f"generated_at is in the future: {ts}")


# --------------------------------------------------------------------------
# networks.json invariants
# --------------------------------------------------------------------------
NETWORK_USE_CASES = ["treatment-records", "individual-access", "find-endpoint",
                     "payer-exchange", "encounter-alerts", "public-health",
                     "community-referral"]
STATE_CODES_51 = set(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO "
    "MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()
)
_COUNT_IN_PROSE = re.compile(r"\b\d+\s+(QHINs?|HIEs?|networks?)\b", re.IGNORECASE)
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _strings(node, path=""):
    """Yield (path, string) for every string value under node, recursively."""
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from _strings(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _strings(v, f"{path}[{i}]")


def known_finding_slugs() -> set[str]:
    """Slugs defined in frontend/src/data/findings.ts (path relative to the repo root)."""
    text = FINDINGS_TS.read_text()
    return set(re.findall(r"^\s*slug:\s*'([^']+)'", text, re.MULTILINE))


def _finding_slugs_in(node):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "finding_slug" and isinstance(v, str):
                yield v
            else:
                yield from _finding_slugs_in(v)
    elif isinstance(node, list):
        for v in node:
            yield from _finding_slugs_in(v)


_UNSAFE_PATH_CHARS = re.compile(r"[\x00-\x1f\x7f\s]")


def _is_internal_path(href) -> bool:
    """A single leading '/', not '//' or '/\\', and no whitespace or control characters."""
    return (isinstance(href, str) and href.startswith("/") and not href.startswith("//")
            and not href.startswith("/\\") and not _UNSAFE_PATH_CHARS.search(href))


def _ainpi_hrefs_in(node):
    """Every href value inside an ainpi_links list under node."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "ainpi_links" and isinstance(v, list):
                for link in v:
                    if isinstance(link, dict) and "href" in link:
                        yield link["href"]
            else:
                yield from _ainpi_hrefs_in(v)
    elif isinstance(node, list):
        for v in node:
            yield from _ainpi_hrefs_in(v)


def check_networks(payload, known_slugs: set[str] | None = None) -> list[str]:
    """One error string per violated invariant of networks.json. Never raises."""
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["networks payload is not an object"]
    if known_slugs is None:
        try:
            known_slugs = known_finding_slugs()
        except OSError as e:
            errors.append(f"cannot read findings.ts to check finding_slug links: {e}")
            known_slugs = None

    def section(name):
        raw = payload.get(name, [])
        if not isinstance(raw, list):
            errors.append(f"{name} is not a list")
            return []
        out = []
        for i, it in enumerate(raw):
            if isinstance(it, dict):
                out.append(it)
            else:
                errors.append(f"{name}[{i}] is not an object")
        return out

    use_cases = section("use_cases")
    routes = section("routes")
    networks = section("networks")
    glossary = section("glossary")
    routes_by_id = {r["id"]: r for r in routes if isinstance(r.get("id"), str)}

    slugs = [u.get("slug") for u in use_cases]
    if any(not isinstance(x, str) for x in slugs):
        errors.append("a use case has a missing or non-string slug")
    str_slugs = [x for x in slugs if isinstance(x, str)]
    if sorted(str_slugs) != sorted(NETWORK_USE_CASES) or len(str_slugs) != len(slugs):
        missing = sorted(set(NETWORK_USE_CASES) - set(str_slugs))
        extra = sorted(set(str_slugs) - set(NETWORK_USE_CASES))
        dup = sorted(x for x in set(str_slugs) if str_slugs.count(x) > 1)
        errors.append(
            f"use_cases must be exactly the seven agreed slugs; missing {missing}, "
            f"unexpected {extra}, repeated {dup}"
        )

    def sources_of(it):
        raw = it.get("sources", [])
        return [s for s in raw if isinstance(s, dict)] if isinstance(raw, list) else []

    for kind, items in (("route", routes), ("network", networks)):
        seen: set = set()
        for it in items:
            i = it.get("id")
            if not isinstance(i, str):
                errors.append(f"{kind} id {i!r} is not a string")
                i = repr(i)
            if i in seen:
                errors.append(f"duplicate {kind} id {i}")
            seen.add(i)
            if not any(s.get("primary") is True for s in sources_of(it)):
                errors.append(f"{kind} {i} has no primary source")
            # The page renders these as hrefs; only https is ever a link.
            for j, s in enumerate(sources_of(it)):
                u = s.get("url")
                if not (isinstance(u, str) and u.startswith("https://")):
                    errors.append(f"{kind} {i} sources[{j}].url {u!r} does not start with https://")
            if kind == "network":
                w = it.get("website")
                if not (isinstance(w, str) and w.startswith("https://")):
                    errors.append(f"network {i} website {w!r} does not start with https://")

    for r in routes:
        if not isinstance(r.get("use_case"), str) or r.get("use_case") not in NETWORK_USE_CASES:
            errors.append(f"route {r.get('id')} names unknown use_case {r.get('use_case')}")

    today = datetime.now(timezone.utc).date().isoformat()
    for n in networks:
        nid = n.get("id")
        states = n.get("states", [])
        if not isinstance(states, list):
            errors.append(f"network {nid} states is not a list")
            states = []
        if n.get("national") and states:
            errors.append(f"network {nid} is national but lists states {states}")
        if not n.get("national") and not states:
            errors.append(f"network {nid} is not national and lists no states")
        for st in states:
            if not isinstance(st, str) or st not in STATE_CODES_51:
                errors.append(f"network {nid} has state code {st} outside the 50 states and DC")
        lc = n.get("last_checked", "")
        if not isinstance(lc, str) or not _ISO_DATE.match(lc):
            errors.append(f"network {nid} last_checked {lc!r} is not an ISO date")
        elif lc > today:
            errors.append(f"network {nid} last_checked {lc} is in the future")
        if not isinstance(n.get("type"), str):
            errors.append(f"network {nid} type {n.get('type')!r} is not a string")
        nroutes = n.get("routes", [])
        if not isinstance(nroutes, list):
            errors.append(f"network {nid} routes is not a list")
            nroutes = []
        if n.get("detail_level") == "basic" and nroutes:
            errors.append(f"network {nid} is basic but lists routes")
        for rid in nroutes:
            route = routes_by_id.get(rid) if isinstance(rid, str) else None
            if route is None:
                errors.append(f"network {nid} references unknown route {rid}")
            else:
                types = route.get("network_types", [])
                if not isinstance(types, list):
                    errors.append(f"route {rid} network_types is not a list")
                elif any(not isinstance(x, str) for x in types):
                    errors.append(f"route {rid} network_types has a non-string entry")
                elif n.get("type") not in types:
                    errors.append(
                        f"network {nid} has type {n.get('type')} but route {rid} "
                        f"does not accept it"
                    )

    for sec, items, key in (("use_cases", use_cases, "slug"), ("routes", routes, "id"),
                            ("networks", networks, "id"), ("glossary", glossary, "term")):
        for it in items:
            for path, s in _strings(it):
                where = f"{sec} {it.get(key)} {path}"
                if "\u2014" in s:
                    errors.append(f"{where} contains an em dash")
                if _COUNT_IN_PROSE.search(s):
                    errors.append(f"{where} states a count in prose")
            for href in _ainpi_hrefs_in(it):
                if not _is_internal_path(href):
                    errors.append(f"{sec} {it.get(key)} ainpi_links href {href!r} is not an internal path")
            if known_slugs is not None:
                for fs in _finding_slugs_in(it):
                    if fs not in known_slugs:
                        errors.append(f"{sec} {it.get(key)} links unknown finding_slug {fs}")
    return errors


def write_schemas() -> None:
    out = API / "schemas"
    out.mkdir(parents=True, exist_ok=True)
    for name, schema in SCHEMAS.items():
        p = out / f"{name}.schema.json"
        p.write_text(json.dumps(schema, indent=2) + "\n")
        print(f"  wrote {p.relative_to(ROOT)}")
    index = {
        "description": (
            "JSON Schemas for the AINPI public contract. Validate any payload "
            "under /api/v1/ against the matching schema. Additive keys are "
            "expected; consumers must tolerate them."
        ),
        "schemas": {
            name: f"https://ainpi.dev/api/v1/schemas/{name}.schema.json"
            for name in SCHEMAS
        },
    }
    (out / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    print(f"  wrote {(out / 'index.json').relative_to(ROOT)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write-schemas", action="store_true",
                    help="publish the schemas under /api/v1/schemas/ and exit")
    ap.add_argument("--json", action="store_true", help="machine-readable report")
    args = ap.parse_args()

    if args.write_schemas:
        write_schemas()
        return 0

    rep = Report()
    schema_pass(rep)
    invariant_pass(rep)

    if args.json:
        print(json.dumps({
            "checked": rep.checked,
            "errors": [{"where": w, "message": m} for w, m in rep.errors],
            "warnings": [{"where": w, "message": m} for w, m in rep.warnings],
        }, indent=2))
        return 0 if rep.ok else 1

    print(f"Contract validation — {rep.checked} payloads checked "
          f"against {CURRENT_RELEASE}\n")
    if rep.errors:
        print(f"ERRORS ({len(rep.errors)})")
        for where, msg in rep.errors:
            print(f"  [{where}] {msg}")
        print()
    if rep.warnings:
        print(f"WARNINGS ({len(rep.warnings)})")
        for where, msg in rep.warnings:
            print(f"  [{where}] {msg}")
        print()
    print("PASS" if rep.ok else f"FAIL — {len(rep.errors)} error(s)")
    return 0 if rep.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
