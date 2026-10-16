"""Why the largest health systems in a state show zero endpoints (FHI-19).

The connectivity ledger (`state_connectivity.py`) rolls organizations up into
health systems and lists every FHIR endpoint any member reaches. For
Pennsylvania on the 2026-10-07 release the six largest systems all show
`endpoint_count: 0`. This script explains that zero, one system at a time,
and separates three different things a zero can mean:

  1. The system publishes no FHIR endpoint anywhere.
  2. It publishes one, and nothing in the public record ties it to the
     organizations the directory files its clinicians under.
  3. Something ties them, and our own method does not follow it.

Only the first is a statement about the system. The second is a directory or
vendor defect with a named owner. The third is a bug here and outranks the
other two.

For each system it walks the chain and counts what survives each step:

    member organizations (the ledger's own grouping, rebuilt exactly)
      -> carries an Organization.endpoint reference in the NDH
      -> is the managingOrganization of an NDH Endpoint (H50)
      -> carries Organization.partOf, and whether the parent holds an endpoint
      -> its NPI is published by the EHR vendor beside an endpoint (H51)
    and, from the other side, the system's published endpoint
      -> Epic's User-access Brands bundle: brand, care sites, NPIs published
      -> the NDH Endpoint table: same address, and who manages it

Then it classifies the gap into a small set of named causes, each with who can
fix it (the system, CMS, the vendor, or this project).

Positive control (the silent-zero rule, `positive_control()`): the run
refuses to write unless the connectivity payload is on the warehouse release,
the rebuilt grouping matches every analysed payload row, the Epic bundle
parses to a plausible number of brands, the vendor names at least one host
for the analysed systems, the NDH Endpoint lookup finds at least one FHIR
endpoint on those hosts' domains, and every analysed system's members return
practitioners from the warehouse. A zero below that line means "looked and
found nothing", never "did not look".

Cost: four small capped queries (1.76 GB billed in all at 2026-10-07). Runs
through the `bq` CLI with `--maximum_bytes_billed` set to the project cap
(`DEFAULT_MAX_BYTES_BILLED`, the same value `bq_job_config()` applies), so it
works with gcloud user credentials when Application Default Credentials have
lapsed. Query results are cached under analysis/data/ (gitignored).

Usage:
    python3 analysis/pa_system_endpoint_gap.py            # PA, top 6
    python3 analysis/pa_system_endpoint_gap.py --top 10 --refresh

Output:
    frontend/public/api/v1/states/pa-system-endpoint-gap.json
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from analysis.claims_sources._cohorts import DEFAULT_MAX_BYTES_BILLED  # noqa: E402
from analysis.fhir_identifiers import extract_npis  # noqa: E402
from analysis.org_systems import build_systems, normalize  # noqa: E402
from analysis.state_connectivity import (  # noqa: E402
    PARENT_SQL,
    load_endpoint_crosswalk,
    load_enrollment_endpoints,
    load_hospital_owners,
    load_org_resolution,
    load_vendor_attribution,
)
from release import CURRENT_RELEASE  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
API_V1 = REPO_ROOT / "frontend" / "public" / "api" / "v1"
STATES_DIR = API_V1 / "states"
VENDOR_CACHE = pathlib.Path("/tmp/ainpi-vendor-endpoints")
EPIC_FILE = "epic_user_access_brands.json"
EPIC_URL = "https://open.epic.com/Endpoints/Brands"
QUERY_CACHE = REPO_ROOT / "analysis" / "data" / "pa-system-endpoint-gap"

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
METHODOLOGY = "0.7.3-draft"

# Positive-control floor for the Epic bundle. The 2026-10-13 cache holds tens
# of thousands of organizations; a few hundred means a truncated download or
# a changed shape, and every "no brand found" below it would be an artifact.
MIN_EPIC_BRANDS = 500

# Curated: ledger system label -> the vendor brand label it trades under, for
# systems whose directory name shares no leading token with the brand. Each is
# one checkable corporate fact; the basis travels into the payload. Systems
# not listed here are matched by label prefix only (GEISINGER -> "Geisinger").
CURATED_BRANDS = {
    "UNIVERSITY OF PITTSBURGH": (
        "MYUPMC",
        "University of Pittsburgh Physicians is UPMC's employed physician "
        "group; Epic publishes UPMC's tenant under the brand 'MyUPMC'."),
    "UPMC": ("MYUPMC", "Named UPMC in the organization name."),
    "PINNACLE": (
        "MYUPMC",
        "PinnacleHealth was acquired by UPMC in 2017 and operates as UPMC in "
        "Central Pa. (same basis as analysis/org_aliases.json)."),
    "AHN": (
        "ALLEGHENY HEALTH NETWORK",
        "AHN is the abbreviation Allegheny Health Network uses in its own "
        "organization names."),
}

CAUSES = {
    "vendor-brand-without-entity-npi": (
        "The vendor publishes the system's endpoint under a brand, and none "
        "of the NPIs it publishes is an NPI the directory files these "
        "clinicians under.",
        ["system", "vendor"]),
    "endpoint-on-leaf-without-practitioners": (
        "The NDH does carry the system's endpoint with a managingOrganization, "
        "but on an organization that holds no practitioner roles in the "
        "state, so no clinician reaches it.",
        ["system", "cms"]),
    "endpoint-without-managing-org": (
        "The NDH carries the system's endpoint with no managingOrganization.",
        ["system", "cms"]),
    "no-ndh-endpoint": (
        "The NDH carries no endpoint on the system's published address.",
        ["system", "cms"]),
    "no-hierarchy": (
        "No member organization carries Organization.partOf to an "
        "organization that holds the endpoint, so the directory has no path "
        "from the employing entity up to the one that serves records.",
        ["system", "cms"]),
    "no-endpoint-published": (
        "Epic's brand file matches no brand for this system and the NDH holds "
        "no FHIR endpoint on its domain. Other vendors' files are not indexed "
        "for brands, so check them before reading this as an absence. It is "
        "the only cause that would be a statement about the system rather "
        "than about the record.",
        ["system"]),
    "rollup-omits-h53-tier": (
        "AINPI defect: the ledger's system rollup accepts only NDH and "
        "vendor-NPI links, while its practitioner funnel also counts H53 "
        "name/brand resolution, an organization-level tier. The system shows "
        "zero endpoints while the same payload's funnel credits clinicians "
        "of its member organizations, through H53, with reaching one.",
        ["ainpi"]),
    "rollup-omits-enrollment-own-domain": (
        "AINPI defect: the rollup also ignores CMS enrollment, a "
        "practitioner-level tier the funnel counts. Raised only when most of "
        "the system's enrollment-tier reach (clinicians reached by no "
        "stronger tier) lands on the system's own domain, so the omission "
        "hides the system's own endpoint rather than some other "
        "organization's. The raw count is reach.enrollment_on_own_domain on "
        "every row, including systems below that threshold.",
        ["ainpi"]),
    "dead-curated-alias": (
        "AINPI defect: a curated alias in analysis/org_aliases.json points "
        "member names at a brand label no vendor publishes any more, so it "
        "resolves nothing and does not error.",
        ["ainpi"]),
    "h51-one-npi-per-url": (
        "AINPI defect: the vendor publishes an NPI that matches a member "
        "organization, but H51's CSV keeps one NPI per endpoint URL and "
        "dropped it.",
        ["ainpi"]),
    "system-split-across-groups": (
        "The same vendor brand is matched by more than one ledger system, so "
        "one enterprise is counted as several. Fixable by the system "
        "(NPPES subpart/parent) or by AINPI (grouping).",
        ["system", "ainpi"]),
}


# --------------------------------------------------------------------------
# pure logic (tested in analysis/tests/test_pa_system_endpoint_gap.py)
# --------------------------------------------------------------------------

def norm_url(url):
    """Lowercase, https, no trailing slash. Matches H51/H53 normalization."""
    if not url:
        return None
    u = url.strip().lower().rstrip("/")
    return re.sub(r"^http://", "https://", u) or None


def host_of(url):
    u = norm_url(url)
    if not u or "//" not in u:
        return None
    return u.split("/")[2]


def domain_of(host):
    """Registrable domain, taken as the last two labels (upmc.com, ahn.org).

    Systems publish more than one FHIR host under their own domain: UPMC has
    epicent-prd-rp.upmc.com in Epic's bundle and epic-fhir-prd.upmc.com in the
    NDH. Matching on the vendor's exact host would miss the second.
    """
    if not host:
        return None
    labels = host.split(":")[0].split(".")
    return ".".join(labels[-2:]) if len(labels) >= 2 else host


def domain_regex(domains):
    """SQL regex matching an address on any of `domains` (host or Direct)."""
    alts = "|".join(re.escape(d) for d in sorted(domains) if d)
    return rf"[./@]({alts})([/:]|$)" if alts else "^$"


def index_epic_brands(bundle):
    """Root brand -> {name, urls, care_sites, states, npis}.

    Entries are indexed by fullUrl AND Type/id: Epic references entries as
    urn:uuid, and a resolver that understands only Type/id returns nothing and
    does not error (the H47 and first-H51 failure). Every care site is walked
    up `partOf` to its root, and the root's endpoint is the brand's endpoint.
    NPIs are read with the shared four-way extractor, from the root and every
    site beneath it, because the brand-level organization often carries the
    whole list while the sites carry none.
    """
    by_ref = {}
    for e in bundle.get("entry") or []:
        r = e.get("resource") or {}
        if e.get("fullUrl"):
            by_ref[e["fullUrl"]] = r
        if r.get("id"):
            by_ref[f"{r.get('resourceType')}/{r['id']}"] = r
    orgs = {k: v for k, v in by_ref.items()
            if v.get("resourceType") == "Organization"}

    def ep_urls(org):
        out = []
        for ref in org.get("endpoint") or []:
            t = by_ref.get((ref.get("reference") or "").strip())
            if t and t.get("resourceType") == "Endpoint" and t.get("address"):
                out.append(norm_url(t["address"]))
        return out

    def root_of(ref):
        seen = set()
        cur = ref
        while cur in orgs and cur not in seen:
            seen.add(cur)
            parent = ((orgs[cur].get("partOf") or {}).get("reference") or "").strip()
            if parent not in orgs:
                return cur
            cur = parent
        return cur

    brands = {}
    visited = set()
    for ref, org in orgs.items():
        if id(org) in visited:
            continue
        visited.add(id(org))
        rref = root_of(ref)
        root = orgs.get(rref, org)
        b = brands.setdefault(id(root), {
            "name": root.get("name"), "urls": set(), "care_sites": 0,
            "states": set(), "npis": set(), "root_npis": set(),
        })
        b["urls"].update(ep_urls(root))
        b["urls"].update(ep_urls(org))
        if org is not root:
            b["care_sites"] += 1
        else:
            b["root_npis"].update(extract_npis(org))
        b["npis"].update(extract_npis(org))
        for a in org.get("address") or []:
            if a.get("state"):
                b["states"].add(a["state"])
    return [b for b in brands.values() if b["urls"]]


def match_brands(label, brands, state, curated=None):
    """Vendor brands a ledger system trades under, with the basis.

    `label-prefix`: the system label's tokens open the brand's normalized
    name (GEISINGER -> "Geisinger", ST LUKE -> "St Luke's"). `curated`: the
    brand named in CURATED_BRANDS. Only brands with a care site in `state`.
    """
    curated = CURATED_BRANDS if curated is None else curated
    want = normalize(label).split()
    cur = curated.get(label)
    out = []
    for b in brands:
        if state not in b["states"]:
            continue
        have = normalize(b["name"]).split()
        if cur and " ".join(have) == cur[0]:
            out.append((b, "curated"))
        elif want and have[:len(want)] == want:
            out.append((b, "label-prefix"))
    return out


def reach_counts(prac_orgs, member_ids, strict_orgs, resolved_orgs,
                 enrollment_npis):
    """Distinct practitioners in a system, and how many reach an endpoint.

    `prac_orgs`: practitioner NPI -> set of org ids (system members only).
    A practitioner counts once, at the strongest tier any of their member
    organizations reaches: strict (NDH or vendor NPI, what the system rollup
    accepts), then H53 resolution, then CMS enrollment.
    """
    c = collections.Counter({k: 0 for k in (
        "practitioners", "strict", "resolution", "enrollment", "none")})
    for npi, oids in prac_orgs.items():
        oids = set(oids) & member_ids
        if not oids:
            continue
        c["practitioners"] += 1
        if oids & strict_orgs:
            c["strict"] += 1
        elif oids & resolved_orgs:
            c["resolution"] += 1
        elif npi in enrollment_npis:
            c["enrollment"] += 1
        else:
            c["none"] += 1
    c["reaches_any"] = c["strict"] + c["resolution"] + c["enrollment"]
    return dict(c)


def classify(m):
    """Named causes for one system from its measured chain. Pure.

    `m` keys: published (bool), npis_matching_members (int),
    ndh_endpoints (list of dicts with managed, manager_holds_practitioners),
    members_with_partof_to_endpoint_holder (int), ledger_endpoint_count,
    reach_resolution (int, H53 tier), reach_enrollment (int, enrollment
    tier), reach_enrollment_own_domain (int, enrollment-tier clinicians whose
    enrollment endpoint is on the system's own domain), dead_aliases (int),
    h51_dropped_member_npis (int), shared_brand_with (list).

    The two rollup causes are kept apart because they are different defects:
    H53 resolves an organization, CMS enrollment resolves a practitioner, and
    enrollment often lands on an endpoint that is not the system's.
    """
    causes = []
    if not m["published"] and not m["ndh_endpoints"]:
        return ["no-endpoint-published"]
    if m["published"] and m["npis_matching_members"] == 0:
        causes.append("vendor-brand-without-entity-npi")
    eps = m["ndh_endpoints"]
    if not eps:
        causes.append("no-ndh-endpoint")
    else:
        if any(e["managed"] and not e["manager_holds_practitioners"] for e in eps):
            causes.append("endpoint-on-leaf-without-practitioners")
        if any(not e["managed"] for e in eps):
            causes.append("endpoint-without-managing-org")
    if m["members_with_partof_to_endpoint_holder"] == 0:
        causes.append("no-hierarchy")
    if m["ledger_endpoint_count"] == 0:
        if m["reach_resolution"] > 0:
            causes.append("rollup-omits-h53-tier")
        own = m["reach_enrollment_own_domain"]
        if own > 0 and 2 * own > m["reach_enrollment"]:
            causes.append("rollup-omits-enrollment-own-domain")
    if m["dead_aliases"]:
        causes.append("dead-curated-alias")
    if m["h51_dropped_member_npis"]:
        causes.append("h51-one-npi-per-url")
    if m["shared_brand_with"]:
        causes.append("system-split-across-groups")
    return causes


def system_links(row):
    """A system row's practitioner-organization link sum, either shape.

    FHI-73 payloads (and `build_systems` since then) carry the link sum as
    `practitioner_org_links` and distinct clinicians as `practitioners`.
    Earlier payloads carry only `practitioners`, which was the link sum.
    """
    links = row.get("practitioner_org_links")
    return links if links is not None else row.get("practitioners")


def positive_control(conn_release, release, chosen, payload_rows, n_brands,
                     hosts, domains, ndh_eps, prac_orgs):
    """The silent-zero checks. Pure; returns the list of problems.

    `chosen`: rebuilt systems (system_key, organizations, practitioners,
    member_org_ids). `payload_rows`: system_key -> connectivity payload row.
    `ndh_eps`: rows from ENDPOINT_SQL. `prac_orgs`: practitioner NPI -> set
    of member org ids.
    """
    problems = []
    if conn_release != release:
        problems.append(f"connectivity payload is {conn_release}, "
                        f"warehouse is {release}")
    for s in chosen:
        key = s["system_key"]
        pr = payload_rows.get(key)
        if not pr:
            problems.append(f"rebuilt {key} has no payload row")
            continue
        # Compare link sums. Since FHI-73 the payload's `practitioners` is
        # distinct clinicians and the link sum is `practitioner_org_links`;
        # payloads generated before that put the link sum in `practitioners`.
        rebuilt_links = system_links(s)
        payload_links = system_links(pr)
        if payload_links != rebuilt_links:
            problems.append(f"rebuilt {key} ({rebuilt_links} links) does "
                            f"not match the payload row ({payload_links})")
        # state_connectivity.py keeps only the first 25 member ids per row,
        # so membership is checked as payload ids within the rebuilt ids plus
        # an equal organization count, not as set equality.
        pids = set(pr.get("member_org_ids") or [])
        rids = set(s["member_org_ids"])
        if pids - rids:
            problems.append(f"{key}: {len(pids - rids)} payload member ids "
                            f"are not in the rebuilt grouping")
        if pr.get("organizations") is not None and \
                pr["organizations"] != len(rids):
            problems.append(f"{key}: payload has {pr['organizations']} "
                            f"members, rebuilt has {len(rids)}")
    if n_brands < MIN_EPIC_BRANDS:
        problems.append(f"Epic bundle parsed to {n_brands} brands "
                        f"(< {MIN_EPIC_BRANDS}); refusing to report absences")
    if chosen and not hosts:
        problems.append("vendor file names no host for any analysed system; "
                        "the NDH Endpoint lookup would search nothing")
    want = set(domains)
    if hosts and not any(e.get("connection_type") == "hl7-fhir-rest"
                         and domain_of(host_of(e.get("address"))) in want
                         for e in ndh_eps):
        problems.append("NDH Endpoint lookup found no FHIR endpoint on the "
                        f"{len(want)} domains of {len(hosts)} vendor-published "
                        "hosts")
    for s in chosen:
        mids = set(s["member_org_ids"])
        if not any(oids & mids for oids in prac_orgs.values()):
            problems.append(f"{s['system_key']}: warehouse returned no "
                            f"practitioners for its {len(mids)} members")
    return problems


def pairwise_overlap(prac_orgs, systems):
    """Distinct practitioners held by both of each pair of systems.

    `systems`: list of (system_key, member id set). Only pairs that share at
    least one practitioner are returned, largest first.
    """
    sets = [(k, {n for n, oids in prac_orgs.items() if oids & mids})
            for k, mids in systems]
    out = []
    for i, (a, sa) in enumerate(sets):
        for b, sb in sets[i + 1:]:
            both = len(sa & sb)
            if both:
                out.append({"a": a, "b": b, "both": both,
                            "either": len(sa | sb)})
    return sorted(out, key=lambda r: (-r["both"], r["a"], r["b"]))


# --------------------------------------------------------------------------
# BigQuery, through the bq CLI with the project cap
# --------------------------------------------------------------------------

BYTES_BILLED = []


def _param_args(params):
    out = []
    for name, value in params.items():
        if isinstance(value, (list, tuple, set)):
            out.append(f"--parameter={name}:ARRAY<STRING>:"
                       + json.dumps(sorted(value)))
        else:
            out.append(f"--parameter={name}::{value}")
    return out


def bq_rows(label, sql, params, refresh=False):
    """Run one capped query, cache rows by (release, label, params)."""
    QUERY_CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1((sql + json.dumps(params, sort_keys=True, default=sorted))
                       .encode()).hexdigest()[:12]
    path = QUERY_CACHE / f"{CURRENT_RELEASE}-{label}-{key}.json"
    if path.exists() and not refresh:
        cached = json.loads(path.read_text())
        BYTES_BILLED.append({"query": label, "bytes_billed": cached["bytes_billed"],
                             "cached": True,
                             "bq_result_cache_hit": cached.get("cache_hit", False)})
        print(f"  {label}: {len(cached['rows']):,} rows (cached)")
        return cached["rows"]
    job_id = f"fhi19_{label}_{uuid.uuid4().hex[:10]}"
    cmd = ["bq", f"--project_id={PROJECT}", "query", "--nouse_legacy_sql",
           f"--maximum_bytes_billed={DEFAULT_MAX_BYTES_BILLED}",
           "--format=json", "--max_rows=10000000", f"--job_id={job_id}",
           *_param_args(params), sql]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{label}: bq failed: {(r.stderr or r.stdout)[-600:]}")
    rows = json.loads(r.stdout or "[]")
    show = subprocess.run(["bq", f"--project_id={PROJECT}", "show",
                           "--format=json", "-j", job_id],
                          capture_output=True, text=True)
    billed = 0
    cache_hit = False
    if show.returncode == 0:
        stats = json.loads(show.stdout).get("statistics", {}).get("query", {})
        billed = int(stats.get("totalBytesBilled") or 0)
        # A BigQuery result-cache hit bills nothing; say so rather than let a
        # zero read as a free scan.
        cache_hit = bool(stats.get("cacheHit"))
    BYTES_BILLED.append({"query": label, "bytes_billed": billed, "cached": False,
                         "bq_result_cache_hit": cache_hit})
    print(f"  {label}: {len(rows):,} rows, {billed / 1e9:.2f} GB billed"
          + (" (BigQuery result cache)" if cache_hit else ""))
    path.write_text(json.dumps({"rows": rows, "bytes_billed": billed,
                                "cache_hit": cache_hit}))
    return rows


PAIRS_SQL = f"""
-- Practitioner -> member organization pairs for the analysed systems, so a
-- clinician in several member organizations is counted once.
WITH prac AS (
  SELECT _id AS pid, _npi AS npi
  FROM `{PROJECT}.{DATASET}.practitioner`
  WHERE _active AND _state = @state AND _npi IS NOT NULL
)
SELECT DISTINCT p.npi, o._id AS org_id
FROM prac p
JOIN `{PROJECT}.{DATASET}.practitioner_role` r
  ON r._practitioner_id = CONCAT('Practitioner/', p.pid) AND r._active
JOIN `{PROJECT}.{DATASET}.organization` o
  ON r._org_id = CONCAT('Organization/', o._id) AND o._active
WHERE o._id IN UNNEST(@org_ids)
"""

MEMBER_SQL = f"""
-- Member organizations: their own endpoint references and their partOf
-- parent. Filtered on _npi, the cluster key.
SELECT
  _id AS org_id,
  _npi AS org_npi,
  JSON_VALUE(resource, '$.partOf.reference') AS part_of,
  ARRAY(SELECT JSON_VALUE(x, '$.reference')
        FROM UNNEST(JSON_QUERY_ARRAY(resource, '$.endpoint')) x) AS endpoint_refs
FROM `{PROJECT}.{DATASET}.organization`
WHERE _npi IN UNNEST(@npis) AND _id IN UNNEST(@org_ids)
"""

PARENT_ORG_SQL = f"""
-- partOf targets of the member organizations, and whether each one is the
-- managingOrganization of any Endpoint. Flattened columns only.
SELECT o._id AS org_id, o._npi AS org_npi, o._name AS org_name,
       o._state AS org_state, o._active AS active,
       COUNT(e._id) AS managed_endpoints,
       ARRAY_AGG(e._address IGNORE NULLS LIMIT 5) AS managed_addresses
FROM `{PROJECT}.{DATASET}.organization` o
LEFT JOIN `{PROJECT}.{DATASET}.endpoint` e
  ON e._managing_org_id = CONCAT('Organization/', o._id)
WHERE o._id IN UNNEST(@org_ids)
GROUP BY 1, 2, 3, 4, 5
"""

ENDPOINT_SQL = f"""
-- Every NDH Endpoint on a host the vendor publishes for one of the systems,
-- or referenced by a member organization, with whoever manages it.
SELECT e._id AS endpoint_id, e._address AS address, e._status AS status,
       e._connection_type AS connection_type,
       e._managing_org_id AS managing_ref,
       o._id AS org_id, o._npi AS org_npi, o._name AS org_name,
       o._state AS org_state
FROM `{PROJECT}.{DATASET}.endpoint` e
LEFT JOIN `{PROJECT}.{DATASET}.organization` o
  ON e._managing_org_id = CONCAT('Organization/', o._id)
WHERE REGEXP_CONTAINS(LOWER(e._address), @host_re)
   OR CONCAT('Endpoint/', e._id) IN UNNEST(@refs)
"""


# --------------------------------------------------------------------------
# assembly
# --------------------------------------------------------------------------

def load_org_rows(state):
    """The ledger's org_rows, from the H53 resolution CSV that was written
    from the same query on the same release (one row per organization holding
    active practitioners in the state)."""
    path = STATES_DIR / f"{state.lower()}-org-endpoint-resolution.csv"
    rows = []
    with path.open() as fh:
        for r in csv.DictReader(fh):
            rows.append({
                "org_id": r["org_id"], "org_npi": r["org_npi"] or None,
                "org_name": r["org_name"], "org_city": r["org_city"],
                "org_state": r["org_state"] or None,
                "practitioners": int(r["practitioners"]),
                "tier": r["tier"], "endpoint": r["endpoint"] or None,
            })
    return rows


def load_epic(refresh=False):
    path = VENDOR_CACHE / EPIC_FILE
    if refresh or not path.exists():
        from analysis.h51_vendor_endpoint_attribution import fetch
        VENDOR_CACHE.mkdir(parents=True, exist_ok=True)
        path.unlink(missing_ok=True)
        fetch(EPIC_URL, path)
    bundle = json.loads(path.read_text(errors="ignore"))
    fetched = dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc)
    return bundle, fetched.date().isoformat()


def dead_aliases(state, brands):
    """Curated aliases whose brand no vendor publishes in the state."""
    path = REPO_ROOT / "analysis" / "org_aliases.json"
    doc = json.loads(path.read_text())
    present = {normalize(b["name"]) for b in brands if state in b["states"]}
    out = []
    for a in doc.get("aliases", []):
        if a.get("state") != state:
            continue
        if normalize(a["brand"]) not in present:
            out.append({"ndh_name": a["ndh_name"], "brand": a["brand"]})
    return out


def h51_dropped(org_rows, brands, h51_npi_url, ep_by_npi):
    """Organizations whose NPI Epic publishes but the ledger cannot use,
    because H51's CSV keeps one NPI per URL."""
    epic_npi = {}
    for b in brands:
        for n in b["npis"]:
            epic_npi.setdefault(n, sorted(b["urls"])[0])
    out = []
    for o in org_rows:
        n = o["org_npi"]
        if n and n in epic_npi and n not in h51_npi_url and n not in ep_by_npi:
            out.append({**o, "epic_url": epic_npi[n]})
    return out


def run(state, top, refresh):
    state = state.upper()
    conn_path = STATES_DIR / f"{state.lower()}-connectivity.json"
    conn = json.loads(conn_path.read_text())

    # Rebuild the ledger's grouping exactly, so membership is the full list
    # rather than the 25 ids the payload keeps.
    org_rows = load_org_rows(state)
    parent_by_npi = {r["org_npi"]: r["parent_lbn"] for r in bq_rows(
        "parent", PARENT_SQL, {"state": state}, refresh)}
    owner_by_npi = load_hospital_owners(state)
    systems = build_systems(org_rows, parent_by_npi, owner_by_npi, excluded=[])
    payload_rows = {r["system_key"]: r for r in conn["systems"]["rows"]}
    chosen = systems[:top]

    org_by_id = {o["org_id"]: o for o in org_rows}
    ep_by_id, ep_by_npi = load_endpoint_crosswalk()
    url_vendor, h51_npi_url, _ = load_vendor_attribution()
    resolution = load_org_resolution(state)
    enrollment = load_enrollment_endpoints(state)

    bundle, epic_fetched = load_epic(refresh)
    brands = index_epic_brands(bundle)

    strict_orgs = {o["org_id"] for o in org_rows
                   if o["org_id"] in ep_by_id
                   or (o["org_npi"] and (o["org_npi"] in ep_by_npi
                                         or o["org_npi"] in h51_npi_url))}
    resolved_orgs = set(resolution)

    member_ids = set()
    for s in chosen:
        member_ids.update(s["member_org_ids"])
    member_npis = {org_by_id[i]["org_npi"] for i in member_ids
                   if org_by_id[i]["org_npi"]}

    pairs = bq_rows("pairs", PAIRS_SQL,
                    {"state": state, "org_ids": member_ids}, refresh)
    prac_orgs = collections.defaultdict(set)
    for r in pairs:
        prac_orgs[r["npi"]].add(r["org_id"])

    members = {r["org_id"]: r for r in bq_rows(
        "members", MEMBER_SQL, {"npis": member_npis, "org_ids": member_ids},
        refresh)}
    parent_ids = set()
    for r in members.values():
        ref = r.get("part_of") or ""
        if ref.startswith("Organization/"):
            parent_ids.add(ref.split("/", 1)[1])
    parents = {}
    if parent_ids:
        parents = {r["org_id"]: r for r in bq_rows(
            "parents", PARENT_ORG_SQL, {"org_ids": parent_ids}, refresh)}

    # Hosts the vendor publishes for any analysed system.
    sys_brands = {s["system_key"]: match_brands(s["label"], brands, state)
                  for s in systems[:60]}
    hosts = sorted({host_of(u) for s in chosen
                    for b, _ in sys_brands[s["system_key"]] for u in b["urls"]}
                   - {None})
    domains = sorted({domain_of(h) for h in hosts} - {None})
    refs = {ref for r in members.values() for ref in (r.get("endpoint_refs") or [])
            if ref}
    host_re = domain_regex(domains)
    ndh_eps = bq_rows("endpoints", ENDPOINT_SQL,
                      {"host_re": host_re, "refs": refs or {"none"}}, refresh)
    problems = positive_control(conn.get("release_date"), CURRENT_RELEASE,
                                chosen, payload_rows, len(brands), hosts,
                                domains, ndh_eps, prac_orgs)
    if problems:
        raise RuntimeError("positive control failed, not writing:\n  "
                           + "\n  ".join(problems))

    prac_org_ids = {o["org_id"] for o in org_rows}
    aliases_dead = dead_aliases(state, brands)
    dropped = h51_dropped(org_rows, brands, h51_npi_url, ep_by_npi)

    out_rows = []
    for s in chosen:
        key = s["system_key"]
        mids = set(s["member_org_ids"])
        pr = payload_rows.get(key, {})
        reach = reach_counts(prac_orgs, mids, strict_orgs, resolved_orgs,
                             set(enrollment))
        # Which of the reaching practitioners land on the system's own host.
        own_hosts = {host_of(u) for b, _ in sys_brands[key] for u in b["urls"]}
        own_domains = {domain_of(h) for h in own_hosts} - {None}

        def on_own_domain(url):
            return domain_of(host_of(url)) in own_domains
        own = 0
        own_by_tier = collections.Counter()
        for npi, all_oids in prac_orgs.items():
            oids = all_oids & mids
            if not oids:
                continue
            res_urls = {resolution[o][0] for o in oids if o in resolution}
            strict_urls = {ep_by_id.get(o) for o in oids} - {None}
            enr_url = enrollment[npi][0] if npi in enrollment else None
            urls = res_urls | strict_urls | ({enr_url} if enr_url else set())
            if any(on_own_domain(u) for u in urls if u):
                own += 1
            # The tier this practitioner is counted at in reach_counts, and
            # whether that tier's own endpoint is on the system's domain.
            if oids & strict_orgs:
                continue
            if oids & resolved_orgs:
                if any(on_own_domain(u) for u in res_urls if u):
                    own_by_tier["resolution"] += 1
            elif enr_url and on_own_domain(enr_url):
                own_by_tier["enrollment"] += 1

        mrows = [members.get(i) for i in mids]
        with_ref = sum(1 for r in mrows if r and r.get("endpoint_refs"))
        with_partof = [r for r in mrows if r and r.get("part_of")]
        holder_ids = {e["org_id"] for e in ndh_eps
                      if e.get("org_id") and on_own_domain(e["address"])}
        partof_targets = collections.Counter()
        partof_to_holder = 0
        for r in with_partof:
            pid = r["part_of"].split("/", 1)[-1]
            p = parents.get(pid)
            partof_targets[(pid, p and p["org_name"], bool(p and int(p["managed_endpoints"])))] += 1
            if pid in holder_ids or (p and int(p["managed_endpoints"]) and any(
                    on_own_domain(a) for a in p.get("managed_addresses") or [])):
                partof_to_holder += 1

        brand_out = []
        npis_matching_members = 0
        h51_member_drop = 0
        for b, basis in sys_brands[key]:
            m_npis = sorted(b["npis"] & {org_by_id[i]["org_npi"] for i in mids
                                          if org_by_id[i]["org_npi"]})
            npis_matching_members += len(m_npis)
            state_matches = [o for o in org_rows if o["org_npi"] in b["npis"]]
            kept = sorted({n for n, u in h51_npi_url.items()
                           if norm_url(u) in b["urls"]})
            h51_member_drop += sum(1 for n in m_npis if n not in h51_npi_url)
            brand_out.append({
                "brand": b["name"], "basis": basis,
                "basis_note": (CURATED_BRANDS.get(s["label"], (None, None))[1]
                               if basis == "curated" else None),
                "urls": sorted(b["urls"]),
                "care_sites": b["care_sites"],
                "npis_published": len(b["npis"]),
                "npis_matching_members": m_npis,
                "npis_matching_any_ndh_org_in_state": len(state_matches),
                "ndh_orgs_matched_elsewhere": [
                    {"name": o["org_name"], "npi": o["org_npi"],
                     "practitioners": o["practitioners"]}
                    for o in sorted(state_matches, key=lambda o: -o["practitioners"])[:5]
                    if o["org_id"] not in mids],
                "npis_h51_csv_keeps_for_these_urls": kept,
            })

        # Endpoints the member organizations themselves reference, summarised
        # by type only: Direct addresses can carry a person's name, and this
        # file has no reason to republish one.
        member_refs = {ref for r in mrows if r for ref in (r.get("endpoint_refs") or [])}
        member_ref_types = collections.Counter()
        member_ref_fhir_hosts = collections.Counter()
        for e in ndh_eps:
            if f"Endpoint/{e['endpoint_id']}" in member_refs:
                member_ref_types[e["connection_type"] or "unknown"] += 1
                if e["connection_type"] == "hl7-fhir-rest":
                    member_ref_fhir_hosts[host_of(e["address"])] += 1

        ep_out = []
        for e in ndh_eps:
            if e["connection_type"] != "hl7-fhir-rest" or not on_own_domain(e["address"]):
                continue
            ep_out.append({
                "address": e["address"], "status": e["status"],
                "connection_type": e["connection_type"],
                "managed": bool(e.get("managing_ref")),
                "manager_name": e.get("org_name"),
                "manager_npi": e.get("org_npi"),
                "manager_state": e.get("org_state"),
                "manager_holds_practitioners": e.get("org_id") in prac_org_ids,
                "manager_in_this_system": e.get("org_id") in mids,
                "manager_in_any_analysed_system": e.get("org_id") in member_ids,
            })

        member_names = {normalize(org_by_id[i]["org_name"]) for i in mids}
        sys_dead = [a for a in aliases_dead if normalize(a["ndh_name"]) in member_names]
        shared = sorted({other for other, bl in sys_brands.items() if other != key
                         and {id(b) for b, _ in bl} & {id(b) for b, _ in sys_brands[key]}})

        tier_links = collections.Counter(org_by_id[i]["tier"] for i in mids)
        metrics = {
            "published": bool(sys_brands[key]),
            "npis_matching_members": npis_matching_members,
            "ndh_endpoints": ep_out,
            "members_with_partof_to_endpoint_holder": partof_to_holder,
            "ledger_endpoint_count": pr.get("endpoint_count", 0),
            "reach_resolution": reach.get("resolution", 0),
            "reach_enrollment": reach.get("enrollment", 0),
            "reach_enrollment_own_domain": own_by_tier["enrollment"],
            "dead_aliases": len(sys_dead),
            "h51_dropped_member_npis": h51_member_drop,
            "shared_brand_with": shared,
        }
        causes = classify(metrics)
        out_rows.append({
            "system_key": key,
            "label": s["label"],
            "basis": s["basis"],
            "organizations": s["organizations"],
            "practitioner_org_links": system_links(s),
            "practitioners_distinct": reach.get("practitioners", 0),
            "ledger_endpoint_count": pr.get("endpoint_count"),
            "chain": {
                "member_organizations": len(mids),
                "members_with_npi": sum(1 for i in mids if org_by_id[i]["org_npi"]),
                "members_found_in_warehouse": sum(1 for r in mrows if r),
                "members_with_organization_endpoint_reference": with_ref,
                "member_endpoint_references_by_type": dict(member_ref_types),
                "member_referenced_fhir_hosts": dict(member_ref_fhir_hosts),
                "members_managing_an_ndh_endpoint":
                    sum(1 for i in mids if i in ep_by_id),
                "members_with_partof": len(with_partof),
                "members_with_partof_to_endpoint_holder": partof_to_holder,
                "partof_targets": [
                    {"org_id": k[0], "name": k[1], "manages_an_endpoint": k[2],
                     "members": n}
                    for k, n in partof_targets.most_common(5)],
                "members_by_h53_tier": dict(tier_links),
                "members_with_vendor_published_npi":
                    sum(1 for i in mids if org_by_id[i]["org_npi"] in h51_npi_url),
            },
            "reach": {
                **reach,
                "reaches_systems_own_endpoint": own,
                "resolution_on_own_domain": own_by_tier["resolution"],
                "enrollment_on_own_domain": own_by_tier["enrollment"],
                "reaches_any_pct": round(100.0 * reach.get("reaches_any", 0)
                                         / reach["practitioners"], 1)
                if reach.get("practitioners") else None,
            },
            "vendor_brands": brand_out,
            "ndh_endpoints_on_system_hosts": ep_out,
            "dead_aliases": sys_dead,
            "shares_vendor_brand_with": shared,
            "causes": [{"code": c, "explanation": CAUSES[c][0],
                        "fixable_by": CAUSES[c][1]} for c in causes],
        })

    dropped_unresolved = [o for o in dropped if o["tier"] == "unresolved"]
    union_reach = reach_counts(prac_orgs, member_ids, strict_orgs,
                               resolved_orgs, set(enrollment))
    union = {n for n, oids in prac_orgs.items() if oids & member_ids}
    payload = {
        "state": state,
        "slug": f"{state.lower()}-system-endpoint-gap",
        "release_date": CURRENT_RELEASE,
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "methodology_version": METHODOLOGY,
        "question": ("Why do the largest health systems in the connectivity "
                     "ledger show zero endpoints?"),
        "answer": None,  # filled below
        "sources": {
            "systems": f"/api/v1/states/{state.lower()}-connectivity.json "
                       "(grouping rebuilt with analysis/org_systems.build_systems)",
            "organizations": f"/api/v1/states/{state.lower()}-org-endpoint-resolution.csv (H53)",
            "ndh_endpoint_attribution": "/api/v1/findings/endpoint-org-crosswalk.csv (H50)",
            "vendor_attribution": "/api/v1/findings/vendor-endpoint-attribution.csv (H51)",
            "epic_brands": {"url": EPIC_URL, "fetched": epic_fetched},
            "warehouse": f"cms_npd {CURRENT_RELEASE}: practitioner, practitioner_role, "
                         "organization, endpoint; bigquery-public-data.nppes.npi_raw "
                         "(parent_organization_lbn only)",
        },
        "positive_control": {
            "note": ("The run refuses to write unless every check below holds, "
                     "so a zero in this file is a measured absence."),
            "epic_brands_parsed": len(brands),
            "epic_brands_floor": MIN_EPIC_BRANDS,
            "vendor_hosts_looked_up": hosts,
            "domains_looked_up_in_ndh": domains,
            "ndh_fhir_endpoints_found_on_those_domains": sum(
                1 for e in ndh_eps if e["connection_type"] == "hl7-fhir-rest"
                and domain_of(host_of(e["address"])) in set(domains)),
            "systems_with_warehouse_practitioners": len(out_rows),
            "rebuilt_grouping_matches_payload": True,
            "membership_check": ("payload member_org_ids (first 25 per row) "
                                 "within the rebuilt ids, equal organization "
                                 "count, equal link total"),
        },
        "systems": out_rows,
        "ledger_defects": {
            "note": ("Defects in AINPI's own method found while answering "
                     "this. Each one makes a reachable endpoint read as "
                     "absent."),
            "system_practitioners_are_link_sums": {
                "note": ("The ledger's per-system `practitioners` is the sum of "
                         "each member organization's practitioner count, so a "
                         "clinician with roles at several member organizations "
                         "is counted once per organization."),
                "practitioner_org_links_in_these_systems":
                    sum(r["practitioner_org_links"] for r in out_rows),
                "distinct_practitioners_in_these_systems": len(union),
                "where": "analysis/org_systems.py build_systems(): "
                         "entry['practitioners'] += o['practitioners'].",
            },
            "rollup_omits_h53_tier": {
                "systems_affected_in_this_table": [
                    r["system_key"] for r in out_rows
                    if any(c["code"] == "rollup-omits-h53-tier" for c in r["causes"])],
                "where": "analysis/state_connectivity.py build(): the system "
                         "rollup calls resolve_org(), which never consults "
                         "org_resolution (H53, organization level).",
            },
            "rollup_omits_enrollment_own_domain": {
                "systems_affected_in_this_table": [
                    r["system_key"] for r in out_rows
                    if any(c["code"] == "rollup-omits-enrollment-own-domain"
                           for c in r["causes"])],
                "enrollment_on_own_domain_by_system": {
                    r["system_key"]: r["reach"]["enrollment_on_own_domain"]
                    for r in out_rows},
                "threshold": "raised when more than half of a system's "
                             "enrollment-tier reach lands on its own domain",
                "where": "analysis/state_connectivity.py build(): the system "
                         "rollup never consults enrollment_endpoints "
                         "(CMS enrollment, practitioner level).",
            },
            "dead_curated_aliases": {
                "count": len(aliases_dead),
                "of": sum(1 for a in json.loads((REPO_ROOT / "analysis" / "org_aliases.json")
                                                .read_text())["aliases"]
                          if a.get("state") == state),
                "rows": aliases_dead,
                "where": "analysis/h53_org_endpoint_resolution.py resolve(): "
                         "alias brand must equal a vendor-published label "
                         "exactly; Epic now publishes 'MyUPMC', 'TempleHealth', "
                         "'Thomas Jefferson University Health System'.",
            },
            "h51_one_npi_per_url": {
                "organizations": len(dropped),
                "practitioner_org_links": sum(o["practitioners"] for o in dropped),
                "of_which_unresolved_by_any_tier": len(dropped_unresolved),
                "unresolved_practitioner_org_links":
                    sum(o["practitioners"] for o in dropped_unresolved),
                "top": [{"name": o["org_name"], "npi": o["org_npi"],
                         "practitioners": o["practitioners"], "tier": o["tier"],
                         "epic_url": o["epic_url"]}
                        for o in sorted(dropped, key=lambda o: -o["practitioners"])[:15]],
                "where": "analysis/h51_vendor_endpoint_attribution.py parse_bundle(): "
                         "url2npi.setdefault keeps the first NPI per URL.",
            },
        },
        "causes": {k: {"explanation": v[0], "fixable_by": v[1]} for k, v in CAUSES.items()},
        "bytes_billed": BYTES_BILLED,
        "limits": [
            "Membership is the ledger's own grouping, which is name inference "
            "for every system in this table. Where a member is not really part "
            "of the system, its counts are here too.",
            "Vendor brands are matched by label prefix or one curated name per "
            "system; the basis is on every row.",
            "Reaching an endpoint is not the endpoint answering. Liveness is "
            "H1-H5 and is not folded in.",
        ],
    }
    payload["all_analysed_systems"] = {
        "note": "Distinct practitioners across the analysed systems, each "
                "counted once at the strongest tier any member reaches.",
        **union_reach,
    }
    payload["pairwise_overlap"] = {
        "note": "Distinct practitioners holding roles in member organizations "
                "of both systems, and in either. Only pairs sharing at least "
                "one practitioner are listed.",
        "pairs": pairwise_overlap(
            prac_orgs, [(s["system_key"], set(s["member_org_ids"])) for s in chosen]),
        "sum_of_system_counts": sum(r["practitioners_distinct"] for r in out_rows),
        "union": len(union),
    }
    payload["answer"] = summarize(out_rows, union_reach)
    return payload


def summarize(rows, union):
    """One-paragraph answer built from the measured rows, never asserted.

    Every clause is conditional on the counts, because this runs again on the
    next release and a template must not carry this release's facts forward.
    """
    n = len(rows)
    published = sum(1 for r in rows if r["vendor_brands"])
    in_ndh = [r for r in rows if r["ndh_endpoints_on_system_hosts"]]
    orphaned = sum(1 for r in in_ndh if all(
        not e["manager_holds_practitioners"]
        for e in r["ndh_endpoints_on_system_hosts"]))
    no_partof = sum(1 for r in rows if r["chain"]["members_with_partof"] == 0)
    no_npi = sum(1 for r in rows
                 if not any(b["npis_matching_members"] for b in r["vendor_brands"]))
    parts = [
        ("The zero is not an absence. " if published == n else ""),
        f"{published} of {n} systems publish a FHIR endpoint in Epic's brand "
        f"file, and the NDH itself carries that endpoint for {len(in_ndh)}. ",
        f"For {orphaned} of those {len(in_ndh)}, every copy has either no "
        f"managingOrganization or one holding no practitioner roles in the "
        f"state. ",
        f"In {no_partof} of {n} no member organization carries partOf, and in "
        f"{no_npi} of {n} the vendor publishes no member organization's NPI. ",
        f"The systems hold {union.get('practitioners', 0):,} distinct "
        f"clinicians (the ledger's per-system counts sum "
        f"practitioner-organization links). Through a member organization or "
        f"CMS enrollment, the same tiers the ledger's practitioner funnel "
        f"accepts, {union.get('reaches_any', 0):,} of them already reach an "
        f"endpoint (a lower bound on what the funnel credits them, since it "
        f"also counts non-member organizations): "
        f"{union.get('strict', 0):,} through the NDH or a vendor-published NPI, "
        f"the only links the system rollup counts, "
        f"{union.get('resolution', 0):,} through name or brand resolution (H53) "
        f"and {union.get('enrollment', 0):,} through CMS enrollment.",
    ]
    return "".join(parts)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--state", default="PA")
    ap.add_argument("--top", type=int, default=6)
    ap.add_argument("--refresh", action="store_true",
                    help="re-run cached queries")
    args = ap.parse_args()
    payload = run(args.state, args.top, args.refresh)
    path = STATES_DIR / f"{args.state.lower()}-system-endpoint-gap.json"
    path.write_text(json.dumps(payload, indent=2, default=sorted) + "\n")
    print(payload["answer"])
    billed = sum(b["bytes_billed"] for b in BYTES_BILLED)
    fresh = sum(b["bytes_billed"] for b in BYTES_BILLED if not b.get("cached"))
    print(f"bytes billed: {fresh / 1e9:.2f} GB this run, "
          f"{billed / 1e9:.2f} GB for the queries behind this payload")
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
