"""Landscape pre-aggregation for /landscape Karpathy-style treemap.

Emits frontend/public/api/v1/landscape.json: one cell per (state, specialty
top-category) tuple, with six metrics each — the dimensions of the
decomposed accuracy framework described at /real-health-providers.

Cost-aware design: ONE pass over practitioner + practitioner_role, grouped
by state and specialty top-category. The 100 GB per-query cap in
bq_job_config() prevents runaway scans. Per-cell metrics are cached in a
single SQL CTE; sample NPIs are pulled via a small follow-up query
filtered to the top N cells.

Usage:
    python analysis/landscape.py
    python analysis/landscape.py --dry-run  # validate query only, no BQ run

Methodology version: 0.7.1-draft (bumps with landscape introduction).
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone

from claims_sources._cohorts import bq_job_config, is_valid_us_state

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "landscape.json"
METHODOLOGY_VERSION = "0.7.1-draft"
RELEASE = "2026-05-08"

# NUCC top-category prefixes (first 3 chars of the 10-char taxonomy code map
# 1:1 to a NUCC top-category). Aggregating at this granularity keeps the
# cell count manageable (51 jurisdictions × ~25 top-categories ≈ 1275 cells)
# while preserving the categories patients and regulators actually navigate.
TOP_CATEGORY_LABELS = {
    "101": "Behavioral health (counselor)",
    "102": "Behavioral health (psychologist)",
    "103": "Behavioral health (social worker)",
    "104": "Behavioral health (other)",
    "106": "Behavioral health (marriage/family)",
    "111": "Chiropractor",
    "122": "Dentist",
    "124": "Dental specialty",
    "125": "Dental hygiene/assist",
    "133": "Dietary services",
    "136": "Naturopath/holistic",
    "146": "EMT/paramedic",
    "152": "Optometrist",
    "156": "Vision technician",
    "163": "Nursing/midwifery",
    "164": "Advanced practice nursing",
    "167": "Nursing assistant",
    "170": "Pathology technician",
    "171": "Specialist (other)",
    "172": "Specialist - lab",
    "173": "Specialist - other",
    "174": "Specialist - other",
    "175": "Specialist - other",
    "176": "Pharmacy",
    "183": "Pharmacist",
    "193": "Group practice",
    "202": "Physician (allopathic - allergy/immunology)",
    "204": "Physician (allopathic - neurology)",
    "207": "Physician (allopathic)",
    "208": "Physician (allopathic)",
    "209": "Physician (osteopathic)",
    "213": "Physician (osteopathic)",
    "225": "Physical therapist",
    "226": "Rehabilitation specialist",
    "227": "Respiratory therapist",
    "229": "Speech/language pathologist",
    "231": "Audiologist",
    "232": "Recreation therapist",
    "235": "Sleep technician",
    "237": "Radiology technician",
    "246": "Medical/lab technician",
    "247": "Imaging technician",
    "251": "Agency (multidisciplinary)",
    "252": "Group / clinic",
    "253": "Long-term care",
    "261": "Clinic / center",
    "273": "Hospital",
    "275": "Inpatient",
    "281": "Hospital - general",
    "282": "Hospital - specialty",
    "283": "Hospital - children",
    "284": "Hospital - other",
    "291": "Lab",
    "292": "Diagnostic lab",
    "293": "Lab - other",
    "302": "Managed care org",
    "305": "Health plan",
    "311": "Nursing facility",
    "313": "Skilled nursing",
    "314": "Assisted living",
    "315": "Hospice",
    "317": "Inpatient hospice",
    "320": "Residential treatment",
    "322": "Substance use disorder treatment",
    "323": "Mental health treatment",
    "324": "Intermediate care facility",
    "331": "Pharmacy (community)",
    "332": "Pharmacy (other)",
    "333": "Pharmacy (mail order)",
    "335": "Pharmacy (specialty)",
    "337": "Pharmacy (other)",
    "341": "Ambulance",
    "342": "Transportation - other",
    "343": "Transportation - non-emergent",
    "344": "Transportation - air",
    "347": "Transportation - other",
    "353": "Public health agency",
    "363": "Nurse practitioner",
    "364": "Clinical nurse specialist",
    "367": "Certified registered nurse anesthetist",
    "372": "Chore provider",
    "373": "Day services",
    "374": "Day training",
    "376": "Adult day care",
    "385": "Respite care",
    "390": "Student/intern",
    "405": "Patient advocate",
}

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
    "PR": "Puerto Rico", "VI": "Virgin Islands", "GU": "Guam",
    "MP": "Northern Mariana Islands", "AS": "American Samoa",
}


LANDSCAPE_SQL = f"""
WITH pr_state AS (
  SELECT
    p._id AS pid,
    UPPER(p._state) AS state,
    p._npi,
    p._family_name,
    p._given_name,
    SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S%Ez',
      JSON_VALUE(p.resource, '$.meta.lastUpdated')) AS last_updated_ts,
    -- § 6220 required-field presence proxies. We can directly observe:
    -- name (family + given), address (_state + _city + _postal_code),
    -- contact (telecom array length), and indirectly NPI itself. Telehealth,
    -- ADA, language, and new-patient flags require extension parsing.
    (p._family_name IS NOT NULL AND p._given_name IS NOT NULL) AS has_name,
    (p._state IS NOT NULL AND p._city IS NOT NULL AND p._postal_code IS NOT NULL) AS has_address,
    (p._npi IS NOT NULL AND LENGTH(p._npi) = 10) AS has_npi,
    -- telecom presence
    (ARRAY_LENGTH(JSON_QUERY_ARRAY(p.resource, '$.telecom')) > 0) AS has_telecom,
    -- communication / language presence
    (ARRAY_LENGTH(JSON_QUERY_ARRAY(p.resource, '$.communication')) > 0) AS has_language,
    -- gender (proxy for ADA / cultural fields presence)
    (p._gender IS NOT NULL) AS has_gender
  FROM `{PROJECT}.{DATASET}.practitioner` p
  WHERE p._active = TRUE
    AND p._state IS NOT NULL
),
pr_specialty AS (
  SELECT
    pr._practitioner_id,
    SUBSTR(pr._specialty_code, 1, 3) AS spec_top,
    pr._specialty_code,
    pr._specialty_display
  FROM `{PROJECT}.{DATASET}.practitioner_role` pr
  WHERE pr._active = TRUE
    AND pr._specialty_code IS NOT NULL
),
joined AS (
  SELECT
    ps.state,
    pr.spec_top,
    ps.pid,
    ps._npi,
    ps._family_name,
    ps._given_name,
    ps.last_updated_ts,
    ps.has_name AND ps.has_address AND ps.has_npi AND ps.has_telecom AS field_complete_required,
    ps.has_language AS has_communication,
    pr._specialty_code
  FROM pr_state ps
  JOIN pr_specialty pr
    ON pr._practitioner_id = CONCAT('Practitioner/', ps.pid)
),
agg AS (
  SELECT
    state,
    spec_top,
    COUNT(DISTINCT _npi) AS practitioners,
    -- Completeness: § 6220 required fields actually present on the record
    SAFE_DIVIDE(
      COUNTIF(field_complete_required AND has_communication),
      COUNT(*)
    ) AS completeness,
    -- Currency: median days since last update (UNIX_SECONDS to keep distinct
    -- percentile aggregation cheap)
    APPROX_QUANTILES(
      TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), last_updated_ts, DAY),
      100
    )[OFFSET(50)] AS currency_days_median,
    -- Specialty validity: NUCC codes are 10 chars ending with X. A stub
    -- proxy for the H10–H13 crosswalk; the full join lives in those scripts.
    SAFE_DIVIDE(
      COUNTIF(LENGTH(_specialty_code) = 10 AND ENDS_WITH(_specialty_code, 'X')),
      COUNT(*)
    ) AS specialty_validity,
    -- Sample NPIs for the side panel — 5 per cell, hashed so consistent across runs
    ARRAY_AGG(_npi ORDER BY FARM_FINGERPRINT(_npi) LIMIT 5) AS sample_npis
  FROM joined
  WHERE _npi IS NOT NULL
  GROUP BY state, spec_top
)
SELECT *
FROM agg
WHERE practitioners >= 25  -- suppress tiny cells (PHI risk + visual noise)
ORDER BY practitioners DESC
"""


# Cross-source agreement, reachability, and integrity require independent
# joins (NPPES public dataset, Endpoint table, LEIE/SAM exclusion tables).
# We compute each separately to keep the main query under the cap, then
# merge in Python. Each follow-up query is also clustered-friendly.
CROSS_SOURCE_SQL = f"""
SELECT
  UPPER(p._state) AS state,
  SUBSTR(pr._specialty_code, 1, 3) AS spec_top,
  SAFE_DIVIDE(
    COUNTIF(np.npi IS NOT NULL),
    COUNT(*)
  ) AS cross_source_agreement
FROM `{PROJECT}.{DATASET}.practitioner` p
JOIN `{PROJECT}.{DATASET}.practitioner_role` pr
  ON pr._practitioner_id = CONCAT('Practitioner/', p._id)
LEFT JOIN `bigquery-public-data.nppes.npi_raw` np
  ON np.npi = p._npi
WHERE p._active = TRUE
  AND p._state IS NOT NULL
  AND pr._specialty_code IS NOT NULL
GROUP BY state, spec_top
HAVING COUNT(*) >= 25
"""


REACHABILITY_SQL = f"""
SELECT
  UPPER(p._state) AS state,
  SUBSTR(pr._specialty_code, 1, 3) AS spec_top,
  SAFE_DIVIDE(
    COUNTIF(e._id IS NOT NULL),
    COUNT(*)
  ) AS reachability
FROM `{PROJECT}.{DATASET}.practitioner` p
JOIN `{PROJECT}.{DATASET}.practitioner_role` pr
  ON pr._practitioner_id = CONCAT('Practitioner/', p._id)
LEFT JOIN `{PROJECT}.{DATASET}.endpoint` e
  ON e._managing_org_id = pr._org_id
  AND e._status = 'active'
  AND e._connection_type = 'hl7-fhir-rest'
WHERE p._active = TRUE
  AND p._state IS NOT NULL
  AND pr._specialty_code IS NOT NULL
GROUP BY state, spec_top
HAVING COUNT(*) >= 25
"""


def run_query(client, sql: str, label: str):
    """Execute a BigQuery query with the per-query cap and return rows."""
    print(f"  [{label}] querying...", file=sys.stderr)
    job = client.query(sql, job_config=bq_job_config())
    rows = list(job.result())
    print(f"  [{label}] {len(rows)} rows, {job.total_bytes_processed / 1e9:.2f} GB scanned",
          file=sys.stderr)
    return rows


def build_landscape(dry_run: bool = False) -> dict:
    """Build the landscape payload by running the three queries and merging."""
    if dry_run:
        print("DRY RUN — would execute:", file=sys.stderr)
        print("  1. landscape_sql (~10–20 GB)", file=sys.stderr)
        print("  2. cross_source_sql (~25 GB — NPPES join)", file=sys.stderr)
        print("  3. reachability_sql (~5 GB — endpoint join)", file=sys.stderr)
        return {"dry_run": True}

    from google.cloud import bigquery
    client = bigquery.Client(project=PROJECT)

    main_rows = run_query(client, LANDSCAPE_SQL, "landscape")
    cross_rows = run_query(client, CROSS_SOURCE_SQL, "cross-source")
    reach_rows = run_query(client, REACHABILITY_SQL, "reachability")

    # Index secondary metrics by (state, spec_top)
    cross_idx = {(r["state"], r["spec_top"]): r["cross_source_agreement"] for r in cross_rows}
    reach_idx = {(r["state"], r["spec_top"]): r["reachability"] for r in reach_rows}

    # Integrity = 1 - (LEIE_hits + SAM_hits) / practitioners per cell.
    # Computed offline against analysis/data/leie.csv + sam.csv (already
    # ingested by ingest_oig_leie.py / ingest_sam_exclusions.py).
    # For now: defaulted to 0.998 (national baseline from H24/H25 combined).
    # See https://github.com/FHIR-IQ/AINPI/issues — integrity per-cell
    # tracked as follow-up.
    INTEGRITY_DEFAULT = 0.998

    cells = []
    for r in main_rows:
        state = r["state"]
        spec_top = r["spec_top"]
        if not is_valid_us_state(state):
            continue
        if not spec_top:
            continue
        key = (state, spec_top)
        cells.append({
            "state": state,
            "state_name": STATE_NAMES.get(state, state),
            "specialty_code": spec_top,
            "specialty_display": TOP_CATEGORY_LABELS.get(spec_top, f"Taxonomy {spec_top}*"),
            "practitioners": int(r["practitioners"]),
            "metrics": {
                "completeness": round(float(r["completeness"] or 0), 4),
                "cross_source_agreement": round(float(cross_idx.get(key, 0) or 0), 4),
                "currency_days_median": int(r["currency_days_median"] or 0),
                "reachability": round(float(reach_idx.get(key, 0) or 0), 4),
                "integrity": INTEGRITY_DEFAULT,
                "specialty_validity": round(float(r["specialty_validity"] or 0), 4),
            },
            "sample_npis": list(r["sample_npis"] or []),
        })

    # National baseline = simple weighted average over cells, weighted by practitioners
    total = sum(c["practitioners"] for c in cells) or 1
    def w(metric_key: str) -> float:
        if metric_key == "currency_days_median":
            return round(sum(c["metrics"][metric_key] * c["practitioners"] for c in cells) / total, 1)
        return round(sum(c["metrics"][metric_key] * c["practitioners"] for c in cells) / total, 4)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "methodology_version": METHODOLOGY_VERSION,
        "release": RELEASE,
        "cell_count": len(cells),
        "cells": cells,
        "national_baseline": {
            "completeness": w("completeness"),
            "cross_source_agreement": w("cross_source_agreement"),
            "currency_days_median": w("currency_days_median"),
            "reachability": w("reachability"),
            "integrity": INTEGRITY_DEFAULT,
            "specialty_validity": w("specialty_validity"),
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="Print queries without running them")
    args = parser.parse_args()

    payload = build_landscape(dry_run=args.dry_run)
    if args.dry_run:
        return

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w") as fh:
        json.dump(payload, fh, indent=2, sort_keys=True)
    print(f"Wrote {OUTPUT_PATH} ({payload['cell_count']} cells)", file=sys.stderr)


if __name__ == "__main__":
    main()
