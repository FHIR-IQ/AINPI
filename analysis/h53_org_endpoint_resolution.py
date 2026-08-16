"""H53 - resolve directory organizations to published FHIR endpoints.

The connectivity ledger for Pennsylvania stops at 6.6%: of the 86,816
practitioners who have any organizational affiliation, only 5,705 reach a FHIR
endpoint. The reason is not missing endpoints. It is that the two sides name the
same organization differently.

The directory carries legal entities: "UNIVERSITY OF PITTSBURGH PHYSICIANS",
"UPMC COMMUNITY MEDICINE INC". The vendors publish brands and sites: Epic's
bundle holds "UPMC Passavant - Cranberry", "Allegheny Health Network -
Neurosurgery", "WellSpan Orthopedics at JPM Road". An NPI join misses almost all
of it, because Epic publishes an NPI for 560 of 96,190 organizations.

H53 resolves the two sides and reports each method separately, because the
methods are not equally trustworthy and collapsing them into one coverage
number is how a directory comes to look complete while being wrong invisibly.

Null hypothesis: organizations the NDH cannot link to an endpoint cannot be
linked from public vendor files either, so resolution adds nothing beyond the
NPI join already measured in H51.

Denominator: active NDH organizations in the state that hold at least one
active practitioner role, weighted by the practitioners they hold. Coverage is
reported against practitioners who have an affiliation at all, never against
every practitioner in the state, because the role gap is a separate finding
with a separate fix and mixing them flatters both.

Tiers, strongest first. Each is counted on its own.

  npi          The vendor published an NPI beside the endpoint and it matches
               the NDH organization NPI. No inference.
  name-state   Normalized organization names match exactly and the state
               agrees. Two independent signals.
  brand-state  The NDH name and a vendor brand share a leading brand token
               sequence, and the state agrees. This is what reaches the large
               systems, and it is the weakest tier that ships.
  unresolved   Nothing matched.

Every tier above `unresolved` writes a row with the evidence that produced it,
so a reader can check any single link against the primary source.

Prerequisite: the vendor files cached by h51_vendor_endpoint_attribution.py.

Cost: one capped BigQuery query per state. Vendor files are read from cache.

Usage:
    python analysis/h53_org_endpoint_resolution.py pa
    python analysis/h53_org_endpoint_resolution.py pa --sample 40

Outputs:
    frontend/public/api/v1/findings/org-endpoint-resolution.json
    frontend/public/api/v1/states/<state>-org-endpoint-resolution.csv
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import json
import pathlib
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from analysis.claims_sources._cohorts import bq_job_config  # noqa: E402
from analysis.org_systems import GENERIC_OPENERS, normalize  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
STATES_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states"
CACHE = pathlib.Path("/tmp/ainpi-vendor-endpoints")

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
SLUG = "org-endpoint-resolution"
NDH_RELEASE = "2026-05-08"
METHODOLOGY = "0.7.2-draft"

EPIC_FILE = "epic_user_access_brands.json"
FLAT_FILES = {
    "athenahealth.json": "athenahealth",
    "eclinicalworks.json": "eClinicalWorks",
    "office_ally.json": "Office Ally",
    "practice_fusion.json": "Practice Fusion",
    "pointclickcare.json": "PointClickCare",
    "oracle_health.json": "Oracle Health",
}

ORG_SQL = f"""
WITH prac AS (
  SELECT _id AS pid FROM `{PROJECT}.{DATASET}.practitioner`
  WHERE _active AND _state = @state AND _npi IS NOT NULL
),
roles AS (
  SELECT _practitioner_id AS pref, _org_id AS oref
  FROM `{PROJECT}.{DATASET}.practitioner_role` WHERE _active
),
orgs AS (
  SELECT _id, _npi, _name, _city, _state
  FROM `{PROJECT}.{DATASET}.organization` WHERE _active
)
SELECT
  o._id AS org_id, o._npi AS org_npi, o._name AS org_name,
  o._city AS org_city, o._state AS org_state,
  COUNT(DISTINCT p.pid) AS practitioners
FROM prac p
JOIN roles r ON r.pref = CONCAT('Practitioner/', p.pid)
JOIN orgs  o ON r.oref = CONCAT('Organization/', o._id)
GROUP BY org_id, org_npi, org_name, org_city, org_state
"""


# --------------------------------------------------------------------------
# vendor side
# --------------------------------------------------------------------------

def norm_url(url):
    if not url:
        return None
    return re.sub(r"^http://", "https://", url.strip().lower().rstrip("/")) or None


def brand_tokens(name, max_tokens=3):
    """Leading tokens that identify a brand, skipping generic openers.

    Returns a tuple so it can key a dict. Requires the result to contain at
    least one distinctive token, otherwise a site called "Family Medicine"
    would claim every practice in the state.
    """
    tokens = normalize(name).split()
    out = []
    for token in tokens[:max_tokens + 1]:
        out.append(token)
        if token not in GENERIC_OPENERS and len(token) >= 3:
            break
    else:
        return None
    if len(out) == 1 and (len(out[0]) < 4 or out[0] in GENERIC_OPENERS):
        return None
    return tuple(out)


def load_epic():
    """Epic brands: site -> parent brand -> endpoint, plus the states covered.

    Entries are indexed by fullUrl AND by Type/id. Epic references bundle
    entries as `urn:uuid:`; a resolver understanding only `Type/id` returns
    zero matches and does not error, which already produced one wrong published
    claim about Epic in H47 and silently broke the first run of H51.
    """
    path = CACHE / EPIC_FILE
    if not path.exists():
        return []
    bundle = json.loads(path.read_text(errors="ignore"))
    by_ref = {}
    orgs = {}
    endpoints = {}
    for entry in bundle.get("entry") or []:
        res = entry.get("resource") or {}
        rid = res.get("id")
        full = entry.get("fullUrl")
        for key in (full, f"{res.get('resourceType')}/{rid}"):
            if key:
                by_ref[key] = res
        if res.get("resourceType") == "Organization":
            orgs[rid] = res
        elif res.get("resourceType") == "Endpoint":
            endpoints[rid] = res

    def endpoint_of(org, depth=0):
        """Walk partOf to the ancestor that carries an endpoint. Depth-capped
        and cycle-safe: a bundle with a deliberate cycle must terminate."""
        seen = set()
        cur = org
        while cur is not None and depth < 12:
            oid = cur.get("id")
            if oid in seen:
                return None
            seen.add(oid)
            for ref in cur.get("endpoint") or []:
                target = by_ref.get(ref.get("reference"))
                if target and target.get("address"):
                    return target["address"], cur.get("name")
            parent = (cur.get("partOf") or {}).get("reference")
            cur = by_ref.get(parent) if parent else None
            depth += 1
        return None

    rows = []
    for org in orgs.values():
        hit = endpoint_of(org)
        if not hit:
            continue
        url, brand_name = hit
        states = {a.get("state") for a in (org.get("address") or [])
                  if a.get("state")}
        rows.append({
            "vendor": "Epic",
            "name": org.get("name"),
            "brand": brand_name,
            "states": states,
            "url": norm_url(url),
        })
    return rows


def load_flat():
    """HTI-1 style service base URL lists: one endpoint per organization."""
    rows = []
    for filename, vendor in FLAT_FILES.items():
        path = CACHE / filename
        if not path.exists():
            continue
        try:
            doc = json.loads(path.read_text(errors="ignore"))
        except json.JSONDecodeError:
            continue
        entries = (doc.get("entry") if isinstance(doc, dict) else None) or []
        if entries:
            for entry in entries:
                res = entry.get("resource") or {}
                if res.get("resourceType") != "Organization":
                    continue
                url = None
                for ident in res.get("identifier") or []:
                    if "endpoint" in str(ident.get("system", "")).lower():
                        url = ident.get("value")
                rows.append({
                    "vendor": vendor, "name": res.get("name"), "brand": None,
                    "states": {a.get("state") for a in (res.get("address") or [])
                               if a.get("state")},
                    "url": norm_url(url),
                })
            continue
        items = doc if isinstance(doc, list) else doc.get("endpoints") or []
        for item in items:
            if not isinstance(item, dict):
                continue
            rows.append({
                "vendor": vendor,
                "name": item.get("name") or item.get("organizationName"),
                "brand": None,
                "states": set(),
                "url": norm_url(item.get("url") or item.get("baseUrl")
                                or item.get("fhirBaseUrl")),
            })
    return [r for r in rows if r["url"] and r["name"]]


# --------------------------------------------------------------------------
# resolution
# --------------------------------------------------------------------------

def load_aliases():
    """Curated legal-name to brand aliases, keyed by (normalized name, state)."""
    path = REPO_ROOT / "analysis" / "org_aliases.json"
    if not path.exists():
        return {}
    doc = json.loads(path.read_text())
    return {(normalize(a["ndh_name"]), a["state"]): a
            for a in doc.get("aliases", [])}


def resolve(org_rows, vendor_rows, ep_by_npi, npi_url, aliases=None):
    aliases = aliases or {}
    vendor_by_brand = {}
    by_name_state = {}
    # A brand key that reaches more than one distinct vendor brand inside a
    # state is ambiguous, and ambiguity must refuse rather than pick. Without
    # this, "PENN STATE HEALTH MEDICAL GROUP" and "Penn Medicine" both reduce
    # to the token PENN, and 857 Penn State Health practitioners get handed
    # University of Pennsylvania's endpoint. They are different health systems.
    brand_candidates = collections.defaultdict(dict)
    for v in vendor_rows:
        key_name = normalize(v["name"])
        for st in (v["states"] or set()):
            if key_name:
                by_name_state.setdefault((key_name, st), v)
        bt = brand_tokens(v["brand"] or v["name"])
        if bt:
            for st in (v["states"] or set()):
                brand_candidates[(bt, st)].setdefault(
                    normalize(v["brand"] or v["name"]), v)

    # Index vendor brands by state so a match can be scored against every
    # brand competing for the same name, not just the first one indexed.
    brands_by_state = collections.defaultdict(dict)
    for v in vendor_rows:
        label = v["brand"] or v["name"]
        toks = tuple(normalize(label).split())
        if not toks:
            continue
        for st in (v["states"] or set()):
            brands_by_state[st].setdefault(toks, v)
            vendor_by_brand.setdefault((normalize(label), st), v)

    ambiguous = 0

    def brand_match(org_name, state):
        """Longest distinctive shared prefix, refused when it is ambiguous.

        A single shared token is only enough when exactly one vendor brand in
        the state starts with it. That is what separates GEISINGER, which is
        one system, from PENN, which is Penn Medicine and Penn State Health and
        Penn Highlands. Matching on PENN sent 857 Penn State Health
        practitioners to the University of Pennsylvania's endpoint.
        """
        nonlocal ambiguous
        org_toks = tuple(normalize(org_name).split())
        if not org_toks:
            return None
        best = {}
        best_len = 0
        for toks, v in brands_by_state.get(state, {}).items():
            shared = 0
            for a, b in zip(org_toks, toks):
                if a != b:
                    break
                shared += 1
            if shared == 0:
                continue
            prefix = org_toks[:shared]
            if all(t in GENERIC_OPENERS or len(t) < 3 for t in prefix):
                continue  # a shared "THE COMMUNITY" prefix identifies nothing
            # One shared token is only enough when the vendor's whole brand IS
            # that token, meaning the vendor treats it as the complete identity
            # ("Geisinger", "WellSpan", "Guthrie"). Otherwise a single token
            # off the front of a longer brand is far too weak: "Penn Medicine"
            # and "Penn State Health" are different systems, and ambiguity
            # rejection cannot catch it because Penn State Health is absent
            # from Epic's Pennsylvania set, which makes the wrong match look
            # unique.
            if shared == 1 and len(toks) > 1:
                continue
            if shared > best_len:
                best_len, best = shared, {normalize(v["brand"] or v["name"]): v}
            elif shared == best_len:
                best.setdefault(normalize(v["brand"] or v["name"]), v)
        if not best:
            return None
        if len(best) > 1:
            ambiguous += 1
            return None
        return next(iter(best.values())), best_len

    out = []
    tiers = collections.Counter()
    practitioners = collections.Counter()
    for o in org_rows:
        npi = o["org_npi"] or ""
        name = normalize(o["org_name"])
        state = o["org_state"]
        tier = url = vendor = evidence = None

        if npi and (npi in ep_by_npi or npi in npi_url):
            tier = "npi"
            url = ep_by_npi.get(npi) or npi_url.get(npi)
            evidence = f"vendor published NPI {npi}"
        else:
            alias = aliases.get((name, state))
            hit = by_name_state.get((name, state))
            if alias and vendor_by_brand.get((normalize(alias["brand"]), state)):
                av = vendor_by_brand[(normalize(alias["brand"]), state)]
                tier, url, vendor = "alias", av["url"], av["vendor"]
                evidence = f"curated alias to '{alias['brand']}': {alias['basis'][:90]}"
            elif hit:
                tier, url, vendor = "name-state", hit["url"], hit["vendor"]
                evidence = f"name '{hit['name']}' + state {state}"
            else:
                found = brand_match(o["org_name"], state)
                if found:
                    hit, shared = found
                    tier, url, vendor = "brand-state", hit["url"], hit["vendor"]
                    evidence = (f"{shared}-token brand prefix matches "
                                f"'{hit['brand'] or hit['name']}' in {state}")

        tier = tier or "unresolved"
        tiers[tier] += 1
        practitioners[tier] += o["practitioners"]
        out.append({**o, "tier": tier, "endpoint": url, "vendor": vendor,
                    "evidence": evidence})
    return out, tiers, practitioners, ambiguous


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("states", nargs="+")
    ap.add_argument("--sample", type=int, default=30,
                    help="rows to print for hand verification")
    args = ap.parse_args()

    from google.cloud import bigquery
    client = bigquery.Client(project=PROJECT)

    print("Loading vendor files ...")
    vendor_rows = load_epic() + load_flat()
    print(f"  {len(vendor_rows):,} vendor organizations with a resolvable endpoint")

    # Reuse the already-published NPI maps so this cannot disagree with H50/H51.
    ep_by_npi, npi_url = {}, {}
    xw = OUT_DIR / "endpoint-org-crosswalk.csv"
    if xw.exists():
        for row in csv.DictReader(xw.open()):
            if row.get("org_npi"):
                ep_by_npi.setdefault(row["org_npi"], row["base_url"])
    va = OUT_DIR / "vendor-endpoint-attribution.csv"
    if va.exists():
        for row in csv.DictReader(va.open()):
            if row.get("org_npi") and row.get("url"):
                npi_url.setdefault(row["org_npi"], row["url"])

    for code in [c.upper() for c in args.states]:
        cfg = bq_job_config()
        cfg.query_parameters = [
            bigquery.ScalarQueryParameter("state", "STRING", code)]
        org_rows = [dict(r.items())
                    for r in client.query(ORG_SQL, job_config=cfg).result()]
        total_prac = sum(o["practitioners"] for o in org_rows)
        print(f"\n{code}: {len(org_rows):,} organizations holding "
              f"{total_prac:,} affiliated practitioner slots")

        aliases = load_aliases()
        rows, tiers, prac, ambiguous = resolve(
            org_rows, vendor_rows, ep_by_npi, npi_url, aliases)
        print(f"  {len(aliases)} curated aliases loaded")
        print(f"  {ambiguous:,} brand keys refused as ambiguous "
              f"(more than one vendor brand shares the key in-state)")
        resolved_prac = sum(v for k, v in prac.items() if k != "unresolved")
        print(f"  {'tier':<14}{'orgs':>8}{'practitioners':>16}")
        for tier in ("npi", "alias", "name-state", "brand-state", "unresolved"):
            print(f"  {tier:<14}{tiers[tier]:>8,}{prac[tier]:>16,}")
        print(f"  resolved: {resolved_prac:,} of {total_prac:,} "
              f"({100.0 * resolved_prac / total_prac:.1f}%)")

        csv_path = STATES_DIR / f"{code.lower()}-org-endpoint-resolution.csv"
        with csv_path.open("w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=[
                "org_id", "org_npi", "org_name", "org_city", "org_state",
                "practitioners", "tier", "endpoint", "vendor", "evidence"])
            w.writeheader()
            for r in sorted(rows, key=lambda r: -r["practitioners"]):
                w.writerow(r)
        print(f"  wrote {csv_path}")

        print(f"\n  Hand-check sample (largest {args.sample} resolved):")
        shown = 0
        for r in sorted(rows, key=lambda r: -r["practitioners"]):
            if r["tier"] == "unresolved" or shown >= args.sample:
                continue
            shown += 1
            print(f"    {(r['org_name'] or '')[:34]:36s} {r['practitioners']:>5,} "
                  f"{r['tier']:<12} {(r['evidence'] or '')[:52]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
