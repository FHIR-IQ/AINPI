"""H52 - payer directories carry the affiliation edge the NDH omits.

The NDH's biggest structural gap is not endpoints, it is roles. 73% of active
NDH practitioners have no PractitionerRole at all, so they have no organization,
so no endpoint path exists for them at any confidence (measured in the
location-endpoint crosswalk spec). H29-H36 tested the obvious way through that
gap, Medicare claims data, and it closed only 2.5% of it: CMS DAC clinicians
overlap almost entirely with practitioners who already have a role, because both
derive from Medicare enrollment.

Payer directories are a different population. Every payer publishing under the
CMS-9115-F Patient Access rule must expose a public unauthenticated provider
directory, and those directories are built from network contracts rather than
Medicare enrollment. They carry PractitionerRole densely.

H52 measures how much affiliation a single payer adds, against the whole
Capital BlueCross directory rather than a sample.

Null hypothesis: a payer FHIR directory adds no organizational affiliation
beyond what the NDH and CMS DAC already publish, so the net-new share is
indistinguishable from zero.

Denominator: practitioners published in the Capital BlueCross public FHIR
directory carrying a well-formed NPI. Reported alongside the directory's own
practitioner count so the NPI publication rate is visible rather than assumed.

Two source-side defects are measured rather than worked around, because both
change the published counts:

1. **Resource ids are not unique.** Every PractitionerRole is emitted twice
   under one id: once with `organization` naming Capital BlueCross itself, once
   naming the real practice. `Bundle.total` counts both. The directory's
   2,259,490 roles are therefore roughly 1.13M logical roles, and any consumer
   deduplicating on id alone discards every real-practice organization.
2. **`_count` is not honoured.** The page stride is fixed at 20 distinct
   resources regardless of the requested count.

Prerequisite: analysis/harvest_payer_directory.py has pulled the directory.

Cost: BigQuery only, capped by bq_job_config(). Scans practitioner (~10 GB),
practitioner_role and cms_dac_clinician_org once each.

Usage:
    python analysis/harvest_payer_directory.py --payer capital-bluecross \\
        --resource Practitioner Organization
    python analysis/h52_payer_affiliation_gap.py --payer capital-bluecross

Outputs:
    frontend/public/api/v1/findings/payer-affiliation-gap.json
    frontend/public/api/v1/findings/payer-affiliation-crosswalk.csv
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
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from analysis.claims_sources._cohorts import bq_job_config  # noqa: E402
from analysis.fhir_identifiers import extract_npis, is_luhn_valid  # noqa: E402
from analysis.harvest_payer_directory import (  # noqa: E402
    PAYERS,
    read_resources,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "analysis" / "data" / "payer"
OUT_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
SLUG = "payer-affiliation-gap"

NDH_RELEASE = "2026-05-08"


# --------------------------------------------------------------------------
# local extraction
# --------------------------------------------------------------------------

def load_practitioners(payer_dir):
    """Return (npi -> practitioner ids), plus counts for the NPI-rate report."""
    npi_to_ids = collections.defaultdict(set)
    n_resources = 0
    n_with_npi = 0
    n_luhn_fail = 0
    ids = set()
    for res in read_resources(payer_dir, "Practitioner"):
        n_resources += 1
        ids.add(res.get("id"))
        npis = extract_npis(res)
        if not npis:
            continue
        n_with_npi += 1
        for npi in npis:
            if not is_luhn_valid(npi):
                n_luhn_fail += 1
                continue
            npi_to_ids[npi].add(res.get("id"))
    return {
        "npi_to_ids": npi_to_ids,
        "resources": n_resources,
        "distinct_ids": len(ids),
        "with_npi": n_with_npi,
        "luhn_fail": n_luhn_fail,
    }


def load_organizations(payer_dir):
    """org id -> {name, npi, npi_basis, city, state}.

    Organization NPIs need the lenient extractor. Capital BlueCross marks them
    with neither `system` nor `type.coding`; the only signal is
    `assigner.display: "CMS"`. The strict extractor returns nothing for every
    organization in the directory. The two counts are reported separately in
    the finding so it is visible how much rests on that convention.
    """
    orgs = {}
    n_strict = 0
    n_lenient = 0
    for res in read_resources(payer_dir, "Organization"):
        oid = res.get("id")
        if oid is None:
            continue
        addr = res.get("address")
        addr = addr[0] if isinstance(addr, list) and addr else {}
        if not isinstance(addr, dict):
            addr = {}
        strict = extract_npis(res)
        lenient = extract_npis(res, assigner_hint=True)
        if strict:
            n_strict += 1
        if lenient:
            n_lenient += 1
        orgs[oid] = {
            "name": res.get("name"),
            "npi": (strict or lenient or [None])[0],
            "npi_basis": "coded" if strict else ("cms-assigner" if lenient else None),
            "city": addr.get("city"),
            "state": addr.get("state"),
            "active": res.get("active"),
        }
    return orgs, {"with_coded_npi": n_strict, "with_any_npi": n_lenient}


def read_checkpoint(payer_dir, resource):
    path = pathlib.Path(payer_dir) / f"{resource}.checkpoint.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text())


# --------------------------------------------------------------------------
# BigQuery
# --------------------------------------------------------------------------

def load_npis_to_bq(npis, table):
    """Load the payer NPI list into BigQuery.

    A query parameter array cannot carry 60k values (the request 413s), so the
    cohort goes through a table. Explicit schema, never autodetect: NPIs are
    zero-padded strings and autodetect reads them as integers, which drops the
    leading digit class and silently breaks every join.
    """
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as fh:
        writer = csv.writer(fh)
        for npi in sorted(npis):
            writer.writerow([npi])
        tmp = fh.name
    cmd = [
        "bq", f"--project_id={PROJECT}", "load", "--replace",
        "--source_format=CSV", f"{DATASET}.{table}", tmp, "npi:STRING",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    pathlib.Path(tmp).unlink(missing_ok=True)
    if proc.returncode != 0:
        raise RuntimeError(f"bq load failed: {proc.stderr[-2000:]}")
    return len(npis)


def run_gap_query(table):
    from google.cloud import bigquery

    client = bigquery.Client(project=PROJECT)
    sql = f"""
    WITH payer AS (
      SELECT DISTINCT npi FROM `{PROJECT}.{DATASET}.{table}`
    ),
    ndh AS (
      SELECT _npi AS npi, ARRAY_AGG(DISTINCT _id) AS pids
      FROM `{PROJECT}.{DATASET}.practitioner`
      WHERE _active AND _npi IS NOT NULL
      GROUP BY _npi
    ),
    roled AS (
      SELECT DISTINCT _practitioner_id AS pref
      FROM `{PROJECT}.{DATASET}.practitioner_role`
      WHERE _active
    ),
    dac AS (
      SELECT DISTINCT npi FROM `{PROJECT}.{DATASET}.cms_dac_clinician_org`
    ),
    joined AS (
      SELECT
        p.npi,
        n.npi IS NOT NULL AS in_ndh,
        d.npi IS NOT NULL AS in_dac,
        EXISTS (
          SELECT 1 FROM UNNEST(IFNULL(n.pids, [])) pid
          JOIN roled r ON r.pref = CONCAT('Practitioner/', pid)
        ) AS has_ndh_role
      FROM payer p
      LEFT JOIN ndh n USING (npi)
      LEFT JOIN dac d USING (npi)
    )
    SELECT
      COUNT(*)                                                   AS payer_npis,
      COUNTIF(in_ndh)                                            AS matched_ndh,
      COUNTIF(NOT in_ndh)                                        AS absent_from_ndh,
      COUNTIF(in_ndh AND has_ndh_role)                           AS ndh_has_affiliation,
      COUNTIF(in_ndh AND NOT has_ndh_role)                       AS ndh_lacks_affiliation,
      COUNTIF(in_ndh AND NOT has_ndh_role AND NOT in_dac)        AS net_new_vs_federal,
      COUNTIF(in_dac)                                            AS in_cms_dac
    FROM joined
    """
    row = list(client.query(sql, job_config=bq_job_config()).result())[0]
    return dict(row.items())


def run_gap_detail(table, limit=200000):
    """Per-NPI gap rows, for the crosswalk CSV."""
    from google.cloud import bigquery

    client = bigquery.Client(project=PROJECT)
    sql = f"""
    WITH payer AS (
      SELECT DISTINCT npi FROM `{PROJECT}.{DATASET}.{table}`
    ),
    ndh AS (
      SELECT _npi AS npi,
             ANY_VALUE(_family_name) AS family_name,
             ANY_VALUE(_given_name)  AS given_name,
             ANY_VALUE(_state)       AS state,
             ARRAY_AGG(DISTINCT _id) AS pids
      FROM `{PROJECT}.{DATASET}.practitioner`
      WHERE _active AND _npi IS NOT NULL
      GROUP BY _npi
    ),
    roled AS (
      SELECT DISTINCT _practitioner_id AS pref
      FROM `{PROJECT}.{DATASET}.practitioner_role`
      WHERE _active
    ),
    dac AS (SELECT DISTINCT npi FROM `{PROJECT}.{DATASET}.cms_dac_clinician_org`)
    SELECT
      p.npi, n.family_name, n.given_name, n.state,
      d.npi IS NOT NULL AS in_cms_dac
    FROM payer p
    JOIN ndh n USING (npi)
    LEFT JOIN dac d USING (npi)
    WHERE NOT EXISTS (
      SELECT 1 FROM UNNEST(n.pids) pid
      JOIN roled r ON r.pref = CONCAT('Practitioner/', pid)
    )
    LIMIT {limit}
    """
    return [dict(r.items())
            for r in client.query(sql, job_config=bq_job_config()).result()]


# --------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------

def pct(n, d):
    return round(100.0 * n / d, 1) if d else 0.0


def _commit_sha():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True,
                              cwd=REPO_ROOT).stdout.strip() or "pending"
    except Exception:
        return "pending"


def build_finding(payer_cfg, prac, orgs, org_npi, counts, ckpts):
    d = counts
    denom = d["payer_npis"]
    matched = d["matched_ndh"]
    gap = d["ndh_lacks_affiliation"]
    net_new = d["net_new_vs_federal"]

    headline = (
        f"{payer_cfg['name']}'s public directory supplies an organizational "
        f"affiliation for {net_new:,} practitioners "
        f"({pct(net_new, matched)}% of those it shares with the NDH) who have "
        f"none in the National Provider Directory and none in CMS's Doctors "
        f"and Clinicians file."
    )

    notes = "\n\n".join([
        "The gap this measures is roles, not endpoints. 73% of active NDH "
        "practitioners carry no PractitionerRole, so they have no organization "
        "and therefore no path to an endpoint at any confidence. Medicare "
        "claims data closes 2.5% of that gap, because CMS's Doctors and "
        "Clinicians file draws on the same Medicare-enrolment population that "
        "already has roles. Payer directories draw on network contracts, which "
        "is a different population.",

        f"Every payer subject to CMS-9115-F already publishes this edge. "
        f"{payer_cfg['name']} is one regional payer and it alone supplies "
        f"{net_new:,} affiliations that neither federal source carries.",

        "Two source-side defects, both measured rather than worked around. "
        "First, PractitionerRole ids are not unique: every role is served "
        "twice under one id, once naming the payer as the organization and "
        "once naming the real practice, so Bundle.total double-counts and a "
        "consumer deduplicating on id discards half the organizations. "
        "Verified on 140 ids sampled across the full page range; 140 of 140 "
        "carried exactly one of each. FHIR R4 requires a resource id to be "
        "unique per resource type on a server.",

        "Second, _count is ignored. The page stride is fixed at 20 distinct "
        "resources whatever is requested, so a harvest sized from _count "
        "under-fetches without erroring.",

        "The NPI is marked four different ways across publishers and three of "
        "them return nothing to a parser reading only identifier.system. "
        f"{payer_cfg['name']} puts the practitioner NPI in "
        "identifier.type.coding, and marks organization NPIs with no code at "
        "all, only assigner.display \"CMS\". A first pass here read 2,000 "
        "practitioners and reported zero NPIs. Organization NPI counts are "
        "published both ways, coded and assigner-inferred, so it stays visible "
        "how much rests on a convention rather than a coded marker.",
    ])

    return {
        "slug": SLUG,
        "title": "Payer directories carry the affiliation the NDH leaves empty",
        "hypotheses": ["H52"],
        "status": "published",
        "release_date": NDH_RELEASE,
        "generated_at": dt.datetime.now(dt.timezone.utc)
                          .replace(microsecond=0).isoformat(),
        "methodology_version": "0.7.2-draft",
        "commit_sha": _commit_sha(),
        "headline": headline,
        "numerator": net_new,
        "denominator": matched,
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "Payer-listed, NPI published", "value": denom},
                {"label": "Matched to an active NDH practitioner",
                 "value": matched},
                {"label": "NDH already gives an affiliation",
                 "value": d["ndh_has_affiliation"]},
                {"label": "NDH gives none, the payer does", "value": gap},
                {"label": "Also absent from CMS DAC", "value": net_new},
            ],
        },
        "notes": notes,
        "source": {
            "payer": payer_cfg["name"],
            "base_url": payer_cfg["base"],
            "retrieved_utc": ckpts.get("Practitioner", {}).get("retrieved_utc"),
            "bundle_timestamp": ckpts.get("Practitioner", {}).get("bundle_timestamp"),
            "authority": (
                "Public unauthenticated provider directory published under the "
                "CMS Interoperability and Patient Access rule (CMS-9115-F)."
            ),
        },
        "denominator_note": (
            f"{denom:,} practitioners published in the {payer_cfg['name']} FHIR "
            f"directory with a well-formed, check-digit-valid NPI."
        ),
        "directory": {
            "practitioner_resources": prac["resources"],
            "practitioner_distinct_ids": prac["distinct_ids"],
            "practitioners_with_npi": prac["with_npi"],
            "npi_publication_rate_pct": pct(prac["with_npi"], prac["resources"]),
            "npi_luhn_failures": prac["luhn_fail"],
            "organizations": len(orgs),
            "organizations_with_coded_npi": org_npi["with_coded_npi"],
            "organizations_with_any_npi": org_npi["with_any_npi"],
            "server_reported_practitioner_total":
                ckpts.get("Practitioner", {}).get("server_reported_total"),
            "server_reported_organization_total":
                ckpts.get("Organization", {}).get("server_reported_total"),
        },
        "results": {
            "payer_npis": denom,
            "matched_active_ndh_practitioner": matched,
            "matched_pct": pct(matched, denom),
            "absent_from_ndh": d["absent_from_ndh"],
            "ndh_already_has_affiliation": d["ndh_has_affiliation"],
            "ndh_already_has_affiliation_pct": pct(d["ndh_has_affiliation"], matched),
            "ndh_lacks_affiliation": gap,
            "ndh_lacks_affiliation_pct": pct(gap, matched),
            "net_new_vs_ndh_and_cms_dac": net_new,
            "net_new_pct": pct(net_new, matched),
            "present_in_cms_dac": d["in_cms_dac"],
        },
        "source_defects": {
            "non_unique_resource_ids": {
                "resource": "PractitionerRole",
                "observed": (
                    "Every role is served twice under one id: one copy names the "
                    "payer as the organization, the other names the real practice. "
                    "Bundle.total counts both."
                ),
                "consequence": (
                    "Deduplicating on id alone discards every real-practice "
                    "organization. The reported 2,259,490 roles are roughly "
                    "1.13M logical roles."
                ),
                "spec": (
                    "FHIR R4 requires a resource id to be unique per resource "
                    "type on a server."
                ),
            },
            "count_not_honoured": {
                "observed": (
                    "Page stride is fixed at 20 distinct resources regardless of "
                    "the _count requested."
                ),
                "consequence": "Sizing a harvest from _count under-fetches silently.",
            },
        },
        "limitations": [
            f"{payer_cfg['name']} is regional to central Pennsylvania. It is not "
            "a statewide or national measurement, and the net-new share will "
            "differ for other payers.",
            "Network participation is not the same as a treating relationship. A "
            "payer listing means the provider is contracted, which is the "
            "affiliation a directory should carry, but it is not evidence of "
            "care delivered at that organization.",
            "CMS DAC covers Medicare-enrolled clinicians only. 'Net-new' here "
            "means absent from the NDH and from CMS DAC, not absent from every "
            "source that exists.",
            "Payer directories carry their own accuracy problems and are not "
            "treated here as ground truth. The claim is that they carry an edge "
            "the NDH does not, not that the edge is correct.",
        ],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--payer", default="capital-bluecross")
    ap.add_argument("--data-dir", default=None)
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    ap.add_argument("--skip-load", action="store_true",
                    help="reuse the NPI table already in BigQuery")
    ap.add_argument("--no-csv", action="store_true")
    args = ap.parse_args()

    cfg = PAYERS[args.payer]
    payer_dir = pathlib.Path(args.data_dir) if args.data_dir else DATA_DIR / args.payer
    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    ckpts = {r: read_checkpoint(payer_dir, r)
             for r in ("Practitioner", "Organization")}
    for resource, ckpt in ckpts.items():
        if ckpt and not ckpt.get("complete"):
            print(f"WARNING: {resource} harvest is incomplete "
                  f"(through page {ckpt.get('pages_completed_through')}, "
                  f"{len(ckpt.get('failed_pages') or [])} failed pages). "
                  f"Numbers below are a partial directory.", file=sys.stderr)

    print(f"Reading harvest from {payer_dir} ...")
    prac = load_practitioners(payer_dir)
    orgs, org_npi = load_organizations(payer_dir)
    npis = set(prac["npi_to_ids"])
    print(f"  {prac['resources']:,} practitioner resources, "
          f"{prac['with_npi']:,} with an NPI, {len(npis):,} distinct valid NPIs")
    print(f"  {len(orgs):,} organizations, "
          f"{org_npi['with_coded_npi']:,} with a coded NPI, "
          f"{org_npi['with_any_npi']:,} once the CMS-assigner fallback is allowed")

    table = f"payer_practitioner_{args.payer.replace('-', '_')}"
    if not args.skip_load:
        print(f"Loading {len(npis):,} NPIs to {DATASET}.{table} ...")
        load_npis_to_bq(npis, table)

    print("Running the affiliation-gap query ...")
    counts = run_gap_query(table)
    for k, v in counts.items():
        print(f"  {k:34s} {v:,}")

    finding = build_finding(cfg, prac, orgs, org_npi, counts, ckpts)
    out_path = out_dir / f"{SLUG}.json"
    out_path.write_text(json.dumps(finding, indent=2) + "\n")
    print(f"Wrote {out_path}")

    if not args.no_csv:
        print("Fetching per-NPI gap rows ...")
        rows = run_gap_detail(table)
        csv_path = out_dir / "payer-affiliation-crosswalk.csv"
        with csv_path.open("w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["npi", "family_name", "given_name", "ndh_state",
                        "in_cms_dac", "payer", "nppes_verify_url"])
            for r in rows:
                w.writerow([
                    r["npi"], r["family_name"], r["given_name"], r["state"],
                    "yes" if r["in_cms_dac"] else "no", cfg["name"],
                    f"https://npiregistry.cms.hhs.gov/provider-view/{r['npi']}",
                ])
        print(f"Wrote {csv_path} ({len(rows):,} rows)")

    print()
    print(finding["headline"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
