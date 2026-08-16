"""Per-state provider connectivity ledger: practitioner to endpoint, end to end.

Every AINPI finding so far measures one link in a chain. This assembles the
whole chain for one state and reports where it breaks, because that is the
question a person actually has: *I saw this clinician, can software reach the
system holding my record?*

The chain, and the finding that measures each link:

    Practitioner (active, in state)
      -> PractitionerRole            the role gap, H52
      -> Organization                referential integrity, H6-H8
      -> Location                    site resolution, unbuilt
      -> Endpoint                    endpoint attribution, H50
      -> EHR vendor                  vendor attribution, H51
      -> Hospital                    facility connectivity, H47

Design rule: **reuse published artifacts, never recompute them.** Endpoint
attribution comes from H50's crosswalk CSV, vendor attribution from H51's, and
hospital connectivity from H47's payload. That keeps this dashboard consistent
with the findings by construction. If it disagreed with H50, one of them would
be wrong and a reader would have no way to tell which.

Cost: one capped BigQuery query per state. Everything else is a local join
against files already in the repo.

Usage:
    python analysis/state_connectivity.py pa
    python analysis/state_connectivity.py pa va oh
    python analysis/state_connectivity.py --all

Outputs:
    frontend/public/api/v1/states/<state>-connectivity.json
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from analysis.claims_sources._cohorts import bq_job_config  # noqa: E402
from analysis.org_systems import (  # noqa: E402
    build_systems,
    describe_affiliation_graph,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
API_V1 = REPO_ROOT / "frontend" / "public" / "api" / "v1"
FINDINGS_DIR = API_V1 / "findings"
STATES_DIR = API_V1 / "states"

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
NDH_RELEASE = "2026-05-08"
METHODOLOGY = "0.7.2-draft"

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut",
    "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida",
    "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
    "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
}


# --------------------------------------------------------------------------
# published artifacts (reused, never recomputed)
# --------------------------------------------------------------------------

def load_endpoint_crosswalk():
    """H50: organization -> a FHIR endpoint the NDH already attributes to it."""
    by_org_id = {}
    by_org_npi = {}
    path = FINDINGS_DIR / "endpoint-org-crosswalk.csv"
    if not path.exists():
        return by_org_id, by_org_npi
    with path.open() as fh:
        for row in csv.DictReader(fh):
            url = row["base_url"]
            if row.get("org_id"):
                by_org_id.setdefault(row["org_id"], url)
            if row.get("org_npi"):
                by_org_npi.setdefault(row["org_npi"], url)
    return by_org_id, by_org_npi


_NAME_NOISE = (
    " INC", " LLC", " LLP", " PC", " PA", " LTD", " CORP", " CORPORATION",
    " COMPANY", " CO", " THE", " GROUP", " HEALTH SYSTEM", " HEALTHCARE",
    " HEALTH CARE",
)


def norm_org_name(name):
    """Normalize an organization name for candidate matching.

    Deliberately conservative: uppercase, strip punctuation to spaces, collapse
    whitespace, and drop a few legal-form suffixes. No fuzzy distance, no token
    subsets. A looser matcher produces more links and less truth, and these
    matches are already the weakest band published.
    """
    if not name:
        return ""
    out = "".join(c if c.isalnum() else " " for c in name.upper())
    out = " ".join(out.split())
    changed = True
    while changed:
        changed = False
        for suffix in _NAME_NOISE:
            if out.endswith(suffix):
                out = out[: -len(suffix)].strip()
                changed = True
    return out


def load_vendor_attribution():
    """H51: endpoint URL -> EHR vendor, vendor NPI -> URL, vendor name -> URL.

    `npi_url` is the deterministic fill layer. Where a vendor publishes an NPI
    beside the endpoint and it matches an NDH organization NPI, the link needs
    no inference.

    `name_url` is the candidate layer, and it is weaker on purpose. It exists
    because the largest health systems are exactly the ones the NPI join
    misses: Epic publishes the endpoint against the brand ("UPMC", NPI
    1306838065) while the NDH holds the practitioners under separate legal
    entities ("UNIVERSITY OF PITTSBURGH PHYSICIANS") whose NPIs the vendor
    never publishes. The NDH carries no hierarchy to bridge them: only 5.3% of
    PA organizations have `partOf`, and the parent NPI Epic names is not in the
    NDH at all.

    Candidates are reported in their own count and never folded into the
    deterministic total.
    """
    url_vendor = {}
    npi_url = {}
    name_url = {}
    path = FINDINGS_DIR / "vendor-endpoint-attribution.csv"
    if not path.exists():
        return url_vendor, npi_url, name_url
    with path.open() as fh:
        for row in csv.DictReader(fh):
            url = (row.get("url") or "").strip()
            if not url:
                continue
            if row.get("vendor"):
                url_vendor.setdefault(url, row["vendor"])
            npi = (row.get("org_npi") or "").strip()
            if npi:
                npi_url.setdefault(npi, url)
            key = norm_org_name(row.get("org_name"))
            if key:
                name_url.setdefault(key, url)
    return url_vendor, npi_url, name_url


def load_org_resolution(state):
    """org_id -> (endpoint, tier) from H53 entity resolution.

    Separate from the NPI-based maps because it is a different kind of
    evidence: name and brand agreement rather than a published identifier. It
    is loaded as its own tier so it can be reported and, if a reader disagrees
    with the method, subtracted.
    """
    path = STATES_DIR / f"{state.lower()}-org-endpoint-resolution.csv"
    if not path.exists():
        return {}
    out = {}
    with path.open() as fh:
        for row in csv.DictReader(fh):
            tier = row.get("tier")
            if tier in ("alias", "name-state", "brand-state") and row.get("endpoint"):
                out[row["org_id"]] = (row["endpoint"], tier)
    return out


def load_hospital_owners(state):
    """NPI -> corporate owner, from CMS enrollment ownership data.

    Prefers the owner holding the largest stake, falling back to the first
    named owner. Built by analysis/ingest_cms_ownership.py; absent until that
    has been run, in which case the tier is simply skipped.
    """
    path = FINDINGS_DIR / "hospital-ownership-crosswalk.csv"
    if not path.exists():
        return {}
    best = {}
    with path.open() as fh:
        for row in csv.DictReader(fh):
            if state and row.get("state") != state.upper():
                continue
            npi = (row.get("npi") or "").strip()
            owner = (row.get("owner") or "").strip()
            if not npi or not owner:
                continue
            try:
                pct = float(row.get("percentage") or 0)
            except ValueError:
                pct = 0.0
            current = best.get(npi)
            if current is None or pct > current[1]:
                best[npi] = (owner, pct)
    return {npi: owner for npi, (owner, _) in best.items()}


def load_hospitals(state):
    """H47: per-hospital connectivity. Only Pennsylvania has this today."""
    path = STATES_DIR / f"{state.lower()}-rural-health.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


# --------------------------------------------------------------------------
# BigQuery
# --------------------------------------------------------------------------

PRACTITIONER_SQL = f"""
WITH prac AS (
  SELECT _id AS pid, _npi AS npi
  FROM `{PROJECT}.{DATASET}.practitioner`
  WHERE _active AND _state = @state AND _npi IS NOT NULL
),
roles AS (
  SELECT
    _practitioner_id AS pref,
    _org_id          AS oref,
    _location_ids    AS loc_ids
  FROM `{PROJECT}.{DATASET}.practitioner_role`
  WHERE _active
),
orgs AS (
  SELECT _id, _npi, _name, _city, _state
  FROM `{PROJECT}.{DATASET}.organization`
  WHERE _active
)
SELECT
  p.npi,
  COUNTIF(r.pref IS NOT NULL)                              AS n_roles,
  COUNTIF(o._id IS NOT NULL)                               AS n_resolved_orgs,
  COUNTIF(o._npi IS NOT NULL)                              AS n_orgs_with_npi,
  COUNTIF(r.loc_ids IS NOT NULL AND r.loc_ids != '')       AS n_roles_with_location,
  ARRAY_AGG(DISTINCT o._id IGNORE NULLS)                   AS org_ids,
  ARRAY_AGG(DISTINCT o._npi IGNORE NULLS)                  AS org_npis,
  ARRAY_AGG(DISTINCT o._name IGNORE NULLS)                 AS org_names
FROM prac p
LEFT JOIN roles r ON r.pref = CONCAT('Practitioner/', p.pid)
LEFT JOIN orgs  o ON r.oref = CONCAT('Organization/', o._id)
GROUP BY p.npi
"""

ORG_SQL = f"""
WITH prac AS (
  SELECT _id AS pid, _npi AS npi
  FROM `{PROJECT}.{DATASET}.practitioner`
  WHERE _active AND _state = @state AND _npi IS NOT NULL
),
roles AS (
  SELECT _practitioner_id AS pref, _org_id AS oref, _location_ids AS loc_ids
  FROM `{PROJECT}.{DATASET}.practitioner_role`
  WHERE _active
),
orgs AS (
  SELECT _id, _npi, _name, _city, _state
  FROM `{PROJECT}.{DATASET}.organization`
  WHERE _active
)
SELECT
  o._id   AS org_id,
  o._npi  AS org_npi,
  o._name AS org_name,
  o._city AS org_city,
  o._state AS org_state,
  COUNT(DISTINCT p.npi) AS practitioners,
  COUNT(DISTINCT NULLIF(r.loc_ids, '')) AS location_sets
FROM prac p
JOIN roles r ON r.pref = CONCAT('Practitioner/', p.pid)
JOIN orgs  o ON r.oref = CONCAT('Organization/', o._id)
GROUP BY org_id, org_npi, org_name, org_city, org_state
ORDER BY practitioners DESC
"""


AFFILIATION_SQL = f"""
-- Affiliation edges where both ends are organizations in this state. The
-- resources carry no `code`, so the edge is undirected here: reading direction
-- as parent-to-child would assume a meaning the data does not state.
WITH orgs AS (
  SELECT _id, _name
  FROM `{PROJECT}.{DATASET}.organization`
  WHERE _active AND _state = @state
)
SELECT DISTINCT
  a._id AS org_a,
  a._name AS name_a,
  b._id AS org_b,
  b._name AS name_b
FROM `{PROJECT}.{DATASET}.organization_affiliation` oa
JOIN orgs a ON oa._org_id = CONCAT('Organization/', a._id)
JOIN orgs b ON oa._participating_org_id = CONCAT('Organization/', b._id)
WHERE oa._active AND a._id != b._id
"""


PARENT_SQL = """
-- Corporate parentage from NPPES. `is_organization_subpart` plus
-- `parent_organization_lbn` is CMS's own subpart-to-parent relationship, so
-- unlike OrganizationAffiliation it states what it means: ownership.
--
-- npi_raw, never npi_optimized. npi_optimized is frozen at 2019-04-08 and is
-- still in the catalogue; joining to it reports every NPI issued since as
-- absent, which produced a fake 2.39M-provider finding earlier in this project.
--
-- parent_organization_tin is deliberately not selected. It is a tax
-- identification number, it is not needed to group, and republishing it is a
-- privacy posture this project does not take (compare H27, which publishes
-- counts and locations of exposed SSNs but never the values).
SELECT
  CAST(npi AS STRING)                        AS org_npi,
  CAST(parent_organization_lbn AS STRING)    AS parent_lbn
FROM `bigquery-public-data.nppes.npi_raw`
WHERE CAST(entity_type_code AS STRING) = "2"
  AND provider_business_practice_location_address_state_name = @state
  AND CAST(parent_organization_lbn AS STRING) NOT IN ("", "null")
"""


def run_query(sql, state):
    from google.cloud import bigquery

    client = bigquery.Client(project=PROJECT)
    cfg = bq_job_config()
    cfg.query_parameters = [
        bigquery.ScalarQueryParameter("state", "STRING", state.upper())
    ]
    return list(client.query(sql, job_config=cfg).result())


# --------------------------------------------------------------------------
# assembly
# --------------------------------------------------------------------------

def pct(n, d):
    return round(100.0 * n / d, 1) if d else 0.0


def build(state, rows, org_rows, edges, edge_names, parent_by_npi, owner_by_npi,
          org_resolution, ep_by_id, ep_by_npi, url_vendor, npi_url, name_url,
          hospitals):
    total = len(rows)
    with_role = 0
    with_org = 0
    with_org_npi = 0
    with_location = 0
    reaches_endpoint = 0
    vendor_known = 0
    fill_only = 0
    resolved_only = 0
    vendors = collections.Counter()
    bands = collections.Counter()

    for r in rows:
        has_role = r["n_roles"] > 0
        has_org = r["n_resolved_orgs"] > 0
        has_org_npi = r["n_orgs_with_npi"] > 0
        has_loc = r["n_roles_with_location"] > 0
        with_role += has_role
        with_org += has_org
        with_org_npi += has_org_npi
        with_location += has_loc

        # Endpoint via what the NDH itself already attributes (H50).
        url = None
        for oid in r["org_ids"] or []:
            url = ep_by_id.get(oid)
            if url:
                break
        native = url is not None

        # Fill layer: a vendor published an NPI beside the endpoint and it
        # matches an NDH organization NPI. Deterministic, but not the NDH's
        # own statement, so it never counts as green.
        filled = False
        if not native:
            for onpi in r["org_npis"] or []:
                url = ep_by_npi.get(onpi) or npi_url.get(onpi)
                if url:
                    filled = True
                    break

        # H53 resolution: name or brand agreement with a vendor-published
        # organization, plus state. Inference, so it never counts as green.
        resolved = None
        if not native:
            for oid in r["org_ids"] or []:
                hit = org_resolution.get(oid)
                if hit:
                    resolved = hit
                    if not filled:
                        url = hit[0]
                    break

        # Candidate layer: the vendor published an endpoint against an
        # organization name that normalizes to one of this practitioner's NDH
        # organization names. Never added to `reaches_endpoint`.
        candidate_url = None
        if not (native or filled or resolved):
            for oname in r["org_names"] or []:
                candidate_url = name_url.get(norm_org_name(oname))
                if candidate_url:
                    break

        if native or filled or resolved:
            reaches_endpoint += 1
            fill_only += bool(filled)
            resolved_only += bool(resolved and not (native or filled))
            vendor = url_vendor.get(url)
            if vendor:
                vendor_known += 1
                vendors[vendor] += 1

        if native:
            bands["green"] += 1
        elif filled:
            bands["yellow"] += 1
        elif resolved:
            bands["resolved"] += 1
        elif candidate_url:
            bands["candidate"] += 1
        elif has_org:
            bands["red"] += 1
        else:
            bands["none"] += 1

    funnel = [
        {"step": "Active practitioners with an NPI", "count": total,
         "pct": 100.0,
         "note": "Everyone the NDH lists as practising in this state."},
        {"step": "Has an active PractitionerRole", "count": with_role,
         "pct": pct(with_role, total),
         "note": "Without a role there is no organization, so no path to an "
                 "endpoint at any confidence. This is the binding constraint.",
         "finding": "payer-affiliation-gap"},
        {"step": "Role names an organization that resolves", "count": with_org,
         "pct": pct(with_org, total),
         "note": "The reference points at an Organization that exists.",
         "finding": "referential-integrity"},
        {"step": "Organization carries an NPI", "count": with_org_npi,
         "pct": pct(with_org_npi, total),
         "note": "An organization NPI is what lets the org be joined to any "
                 "other federal or vendor source."},
        {"step": "Role names a location", "count": with_location,
         "pct": pct(with_location, total),
         "note": "The site the patient actually visited. No NDH Location "
                 "carries an endpoint or a parent, so the place layer stops "
                 "here."},
        {"step": "Reaches a FHIR endpoint", "count": reaches_endpoint,
         "pct": pct(reaches_endpoint, total),
         "note": f"Includes {fill_only:,} reachable only after the "
                 f"vendor-published NPI fill. The NDH alone reaches "
                 f"{reaches_endpoint - fill_only:,}.",
         "finding": "endpoint-org-linkage"},
        {"step": "Name-matched endpoint candidate (not a linkage)",
         "count": bands["candidate"],
         "pct": pct(bands["candidate"], total),
         "excluded_from_total": True,
         "note": "An endpoint is published against an organization name that "
                 "matches, but nothing deterministic connects them. This is "
                 "where the large health systems land: the vendor names the "
                 "brand, the NDH holds the practitioners under separate legal "
                 "entities, and the NDH carries no hierarchy to bridge them. "
                 "Triage material, not a directory linkage.",
         "finding": "vendor-endpoint-attribution"},
        {"step": "Endpoint attributed to an EHR vendor", "count": vendor_known,
         "pct": pct(vendor_known, total),
         "note": "The vendor is derived from the endpoint host and "
                 "cross-checked against the file that published the URL.",
         "finding": "vendor-endpoint-attribution"},
    ]

    def resolve_org(o):
        """(url, basis) for one organization, best evidence first."""
        url = ep_by_id.get(o["org_id"])
        if url:
            return url, "ndh"
        npi = o["org_npi"] or ""
        url = ep_by_npi.get(npi) or npi_url.get(npi)
        if url:
            return url, "vendor-npi"
        url = name_url.get(norm_org_name(o["org_name"]))
        if url:
            return url, "name-candidate"
        return None, None

    orgs_with_endpoint = 0
    orgs_with_candidate = 0
    for o in org_rows:
        _, basis = resolve_org(o)
        if basis in ("ndh", "vendor-npi"):
            orgs_with_endpoint += 1
        elif basis == "name-candidate":
            orgs_with_candidate += 1

    # The work queue: the organizations holding the most practitioners that no
    # method reaches. This is the most actionable output on the page, because
    # it names exactly who has to publish what.
    #
    # A "same brand" hint was tried here and removed. Matching the first two
    # normalized name tokens proposed "UNIVERSITY OF MOUNT UNION STUDENT HEALTH
    # CENTER" for the University of Pittsburgh Physicians, because both start
    # "UNIVERSITY OF". On a page meant to be audit-worthy a confident wrong
    # pointer is worse than no pointer, so the list ships without one. Closing
    # these needs a real entity resolution pass, not a string trick.
    unlinked = [
        {
            "org_id": o["org_id"],
            "npi": o["org_npi"],
            "name": o["org_name"],
            "city": o["org_city"],
            "practitioners": o["practitioners"],
            "nppes_verify_url":
                f"https://npiregistry.cms.hhs.gov/provider-view/{o['org_npi']}"
                if o["org_npi"] else None,
        }
        for o in org_rows
        if resolve_org(o)[1] is None and o["practitioners"] >= 25
    ]
    unlinked.sort(key=lambda r: -r["practitioners"])
    unlinked = unlinked[:100]

    orgs = []
    for o in org_rows[:250]:
        url, basis = resolve_org(o)
        orgs.append({
            "org_id": o["org_id"],
            "npi": o["org_npi"],
            "name": o["org_name"],
            "city": o["org_city"],
            "state": o["org_state"],
            "practitioners": o["practitioners"],
            # A candidate URL is reported in its own field so a consumer cannot
            # read it as a resolved endpoint by accident.
            "endpoint": url if basis in ("ndh", "vendor-npi") else None,
            "endpoint_candidate": url if basis == "name-candidate" else None,
            "endpoint_basis": basis,
            "vendor": url_vendor.get(url) if url else None,
        })

    # Health-system rollup. Organizations are the leaves; the systems that own
    # them are mostly not in the directory. Where a system member reaches an
    # endpoint, every practitioner in that system gets a system-level path,
    # which is weaker than a direct one and is reported as its own number.
    org_by_id = {o["org_id"]: o for o in org_rows}
    systems = build_systems(org_rows, parent_by_npi, owner_by_npi)
    affiliation = describe_affiliation_graph(edges, edge_names)
    for sysrow in systems:
        # Collect every endpoint anywhere in the system, not the first one
        # found. A health system does not have "an endpoint": UPMC publishes an
        # Epic endpoint for its physicians and separate athenahealth endpoints
        # for individual surgery centres. Taking the first member with a hit
        # handed all 7,308 UPMC practitioners an ambulatory surgery centre's
        # athenahealth URL, which is not where their records live.
        found = {}
        for oid in sysrow["member_org_ids"]:
            member = org_by_id.get(oid)
            if not member:
                continue
            url, basis = resolve_org(member)
            if basis in ("ndh", "vendor-npi") and url not in found:
                found[url] = {
                    "url": url,
                    "vendor": url_vendor.get(url),
                    "via_member": member["org_name"],
                }
        sysrow["endpoints"] = list(found.values())[:10]
        sysrow["endpoint_count"] = len(found)
        sysrow["vendors"] = sorted(
            {e["vendor"] for e in found.values() if e["vendor"]}
        )
        # Trim the id list: useful in aggregate, noise in a published payload.
        sysrow["member_org_ids"] = sysrow["member_org_ids"][:25]

    systems_with_endpoint = [s for s in systems if s["endpoint_count"]]
    practitioners_gained = sum(
        s["practitioners"] for s in systems_with_endpoint
    )

    # Graph payload, precomputed here so the browser renders rather than
    # derives. Capped at the 50 largest systems: a force layout of 19,535
    # organizations is a hairball that answers no question, and the point of
    # this picture is which large systems hang unconnected.
    g_nodes = []
    g_links = []
    seen_vendor = {}
    for sysrow in systems[:50]:
        sid = f"sys:{sysrow['system_key']}"
        g_nodes.append({
            "id": sid,
            "label": sysrow["label"],
            "type": "system",
            "practitioners": sysrow["practitioners"],
            "organizations": sysrow["organizations"],
            "basis": sysrow["basis"],
            "connected": bool(sysrow["endpoint_count"]),
        })
        for ep in sysrow["endpoints"][:3]:
            host = (ep["url"] or "").split("/")[2] if "//" in (ep["url"] or "") else ep["url"]
            eid = f"ep:{host}"
            if not any(n["id"] == eid for n in g_nodes):
                g_nodes.append({
                    "id": eid, "label": host, "type": "endpoint",
                    "vendor": ep["vendor"], "via": ep["via_member"],
                })
            g_links.append({"source": sid, "target": eid, "kind": "reaches"})
            if ep["vendor"]:
                vid = f"vendor:{ep['vendor']}"
                if vid not in seen_vendor:
                    seen_vendor[vid] = {
                        "id": vid, "label": ep["vendor"], "type": "vendor",
                    }
                g_links.append({"source": eid, "target": vid,
                                "kind": "served-by"})
    g_nodes.extend(seen_vendor.values())

    payload = {
        "state": state.upper(),
        "state_name": STATE_NAMES.get(state.upper(), state.upper()),
        "slug": f"{state.lower()}-connectivity",
        "release_date": NDH_RELEASE,
        "generated_at": dt.datetime.now(dt.timezone.utc)
                          .replace(microsecond=0).isoformat(),
        "methodology_version": METHODOLOGY,
        "commit_sha": _commit_sha(),
        "summary": {
            "practitioners": total,
            "with_role": with_role,
            "with_role_pct": pct(with_role, total),
            "reaches_endpoint": reaches_endpoint,
            "reaches_endpoint_pct": pct(reaches_endpoint, total),
            # NDH-only must subtract every added tier, not just the NPI fill.
            "reaches_endpoint_ndh_only":
                reaches_endpoint - fill_only - resolved_only,
            "reaches_endpoint_after_vendor_npi_fill":
                reaches_endpoint - resolved_only,
            "reaches_endpoint_after_resolution": reaches_endpoint,
            # The role gap is a separate finding with a separate fix, so
            # endpoint coverage is also reported against practitioners who have
            # an affiliation at all. Quoting only the share of every
            # practitioner in the state hides how much of the endpoint problem
            # has actually been solved; quoting only this one hides the role
            # gap. Both ship.
            "reaches_endpoint_pct_of_affiliated": pct(reaches_endpoint, with_role),
            "vendor_known": vendor_known,
            "organizations": len(org_rows),
            "organizations_with_endpoint": orgs_with_endpoint,
            "name_matched_candidates": bands["candidate"],
            "organizations_with_name_candidate_only": orgs_with_candidate,
        },
        "funnel": funnel,
        "confidence": {
            "note": (
                "Bands describe method, not quality. Green means the NDH "
                "itself carries the whole chain. Yellow means the last link "
                "came from a vendor-published NPI that matches an NDH "
                "organization: deterministic, but not the directory's own "
                "statement. Red means the practitioner reaches an "
                "organization and stops. None means no organization at all. "
                "Candidate is weaker than red on evidence and is never counted "
                "as connectivity: an endpoint exists under a matching name, "
                "with nothing deterministic tying it to this organization."
            ),
            "green": bands["green"],
            "yellow": bands["yellow"],
            "candidate": bands["candidate"],
            "red": bands["red"],
            "none": bands["none"],
        },
        "vendors": dict(vendors.most_common()),
        "systems": {
            "note": (
                "Health systems, best evidence first. `cms-ownership` groups "
                "come from CMS enrollment ownership data, which states "
                "ownership and names holding companies explicitly, but covers "
                "hospitals only. `nppes-parent` groups come from NPPES "
                "is_organization_subpart plus parent_organization_lbn: real, "
                "but sparse, sometimes stale, and sometimes a program rather "
                "than an owner. `brand-name` groups are inferred from the "
                "organization name and cover the rest. The directory's own "
                "OrganizationAffiliation resource was tried and rejected: see "
                "affiliation_graph below."
            ),
            "affiliation_graph": affiliation,
            "organizations_with_cms_attested_owner": sum(
                1 for o in org_rows if owner_by_npi.get(o["org_npi"] or "")),
            "organizations_with_nppes_parent": sum(
                1 for o in org_rows if parent_by_npi.get(o["org_npi"] or "")),
            "systems_found": len(systems),
            "systems_by_basis": dict(collections.Counter(
                s["basis"] for s in systems)),
            "systems_reaching_an_endpoint": len(systems_with_endpoint),
            "practitioners_in_a_system_that_reaches_an_endpoint":
                practitioners_gained,
            "routing_caveat": (
                "A system reaching an endpoint is not a routing answer. Large "
                "systems publish several: UPMC has an Epic endpoint for its "
                "physicians and separate athenahealth endpoints for individual "
                "surgery centres. Every endpoint found in a system is listed "
                "with the member that carries it, and none of them is "
                "presented as the one serving a given practitioner."
            ),
            "rows": systems[:60],
        },
        "graph": {
            "note": (
                "The 50 largest systems, the endpoints any of their members "
                "reach, and the EHR vendor behind each endpoint. Systems with "
                "no edge are the finding: they hold practitioners and nothing "
                "public connects them to a system that serves records."
            ),
            "nodes": g_nodes,
            "links": g_links,
        },
        "organizations_top": orgs,
        "organizations_unlinked": {
            "note": (
                "Organizations with 25 or more practitioners that no method "
                "reaches: not by the NDH's own attribution, not by a "
                "vendor-published NPI, not by an exact name match. This is the "
                "work queue. Every row carries an NPPES link so each one can "
                "be checked against the primary source."
            ),
            "practitioners_affected": sum(r["practitioners"] for r in unlinked),
            "rows": unlinked,
        },
        "hospitals": _hospital_block(hospitals),
        "sources": {
            "chain": "cms_npd practitioner, practitioner_role, organization "
                     f"({NDH_RELEASE} NDH release)",
            "endpoint_attribution": "/api/v1/findings/endpoint-org-crosswalk.csv (H50)",
            "vendor_attribution": "/api/v1/findings/vendor-endpoint-attribution.csv (H51)",
            "hospitals": f"/api/v1/states/{state.lower()}-rural-health.json (H47)"
                         if hospitals else None,
        },
        "limits": [
            "Reaching an endpoint is not the same as the endpoint answering. "
            "Liveness is measured separately in H1-H5 and is not folded in "
            "here, because a reachable-but-dead endpoint should not be "
            "counted as connectivity.",
            "The vendor is derived from the endpoint host. That is reliable "
            "because vendors host tenants on their own domains, but it is "
            "inference and is labelled as such.",
            "Location is counted as named, not as resolved to a site with its "
            "own endpoint. No NDH Location carries an endpoint or a parent in "
            "this release, so site-level routing cannot be measured yet.",
            "A practitioner with several organizations is counted at the best "
            "band any of them reaches. The funnel is per practitioner, not "
            "per role.",
        ],
    }
    return payload


def _hospital_block(hospitals):
    if not hospitals:
        return None
    s = hospitals.get("summary", {})
    return {
        "source_slug": hospitals.get("slug"),
        "hospitals": s.get("hospitals"),
        "in_vendor_bundle": s.get("in_cehrt_bundle"),
        "endpoint_resolvable": s.get("endpoint_resolvable"),
        "org_endpoint_linked": s.get("org_endpoint_linked"),
        "critical_access": s.get("critical_access_hospitals"),
        "in_rural_counties": s.get("hospitals_in_rural_counties"),
        "ehr_vendors": s.get("ehr_vendors"),
    }


def _commit_sha():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True,
                              cwd=REPO_ROOT).stdout.strip() or "pending"
    except Exception:
        return "pending"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("states", nargs="*", help="two-letter state codes")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--out-dir", default=str(STATES_DIR))
    args = ap.parse_args()

    codes = [s.upper() for s in args.states]
    if args.all:
        codes = sorted(STATE_NAMES)
    if not codes:
        ap.error("name at least one state, or pass --all")

    ep_by_id, ep_by_npi = load_endpoint_crosswalk()
    url_vendor, npi_url, name_url = load_vendor_attribution()
    print(f"Reused artifacts: {len(ep_by_id):,} NDH-attributed endpoints, "
          f"{len(url_vendor):,} vendor-attributed URLs, "
          f"{len(npi_url):,} vendor-published NPIs, "
          f"{len(name_url):,} vendor-published names")

    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    for code in codes:
        print(f"\n{code} ...")
        rows = [dict(r.items()) for r in run_query(PRACTITIONER_SQL, code)]
        org_rows = [dict(r.items()) for r in run_query(ORG_SQL, code)]
        edge_rows = [dict(r.items()) for r in run_query(AFFILIATION_SQL, code)]
        edges = [(r["org_a"], r["org_b"]) for r in edge_rows]
        # Hub names must come from the edge query, not from org_rows: org_rows
        # only holds organizations that have practitioners, and the biggest
        # hubs in this graph are pharmacy chains that have none.
        edge_names = {}
        for r in edge_rows:
            edge_names[r["org_a"]] = r["name_a"]
            edge_names[r["org_b"]] = r["name_b"]
        print(f"  {len(rows):,} practitioners, {len(org_rows):,} organizations, "
              f"{len(edges):,} affiliation edges")
        parent_by_npi = {r["org_npi"]: r["parent_lbn"]
                         for r in run_query(PARENT_SQL, code)}
        print(f"  {len(parent_by_npi):,} organizations with an NPPES corporate parent")
        owner_by_npi = load_hospital_owners(code)
        print(f"  {len(owner_by_npi):,} organizations with a CMS-attested owner")
        org_resolution = load_org_resolution(code)
        print(f"  {len(org_resolution):,} organizations resolved to an endpoint "
              f"by name or brand (H53)")
        payload = build(code, rows, org_rows, edges, edge_names, parent_by_npi,
                        owner_by_npi, org_resolution, ep_by_id, ep_by_npi,
                        url_vendor, npi_url, name_url, load_hospitals(code))
        path = out_dir / f"{code.lower()}-connectivity.json"
        path.write_text(json.dumps(payload, indent=2) + "\n")
        s = payload["summary"]
        print(f"  role {s['with_role_pct']}%  "
              f"endpoint {s['reaches_endpoint_pct']}% of all, "
              f"{s['reaches_endpoint_pct_of_affiliated']}% of affiliated")
        print(f"    NDH alone {s['reaches_endpoint_ndh_only']:,} -> "
              f"+vendor NPI {s['reaches_endpoint_after_vendor_npi_fill']:,} -> "
              f"+resolution {s['reaches_endpoint_after_resolution']:,}")
        print(f"  wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
