"""H10/H11/H12/H13 — NPPES + NUCC conformance.

All entirely in BigQuery using the public NPPES dataset:
  bigquery-public-data.nppes.npi_raw                         (9.37M NPIs)
  bigquery-public-data.nppes.healthcare_provider_taxonomy_code_set_170

Vintage: NPPES latest update 2026-02-09; NDH release 2026-04-09 — an
~8-week gap. NPIs deactivated in the gap window would appear active in
NPPES; this is documented as a known caveat.

H10 — NPI-to-NPPES match
  codes: NPI_OK, NPI_NOT_ENUMERATED, NPI_DEACTIVATED, NPI_TYPE_MISMATCH
  (entity_type_code: 1=individual→Practitioner, 2=org→Organization)

H11 — Name agreement (exact-match v1; Jaro-Winkler = v2)
  Practitioner: NDH _family_name, _given_name vs NPPES legal name fields
  Organization: NDH _name vs NPPES organization legal name

H12 — NUCC taxonomy validity
  Every NDH practitioner_role._specialty_code must appear in NUCC v17.0

H13 — Primary specialty agreement
  NDH first PractitionerRole specialty per practitioner
  vs NPPES healthcare_provider_taxonomy_code_1 (primary)

Writes frontend/public/api/v1/findings/npi-taxonomy-correctness.json.
"""
from __future__ import annotations
import json
import pathlib
from datetime import datetime, timezone
from google.cloud import bigquery

NDH_PROJECT = "thematic-fort-453901-t7"
NDH_DATASET = "cms_npd"
NPPES_DATASET = "bigquery-public-data.nppes"
NUCC_TABLE = f"{NPPES_DATASET}.healthcare_provider_taxonomy_code_set_170"
RELEASE_DATE = "2026-04-09"


def q(client, sql):
    return list(client.query(sql).result())


def scalar(client, sql):
    return dict(next(iter(q(client, sql))).items())


def run():
    c = bigquery.Client(project=NDH_PROJECT)

    # ---------------- H10 — NPI match ----------------
    # Note: ~333K NPPES rows have entity_type_code=NULL (mostly deactivated).
    # Use n.npi IS NOT NULL as the "found in NPPES" flag, not entity_type_code.
    print("H10 — NPI existence vs NPPES")
    h10 = scalar(c, f"""
    WITH npd AS (
      SELECT _id, 'Practitioner' AS kind, 1 AS expected_entity, _npi
      FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner` WHERE _npi IS NOT NULL
      UNION ALL
      SELECT _id, 'Organization', 2, _npi
      FROM `{NDH_PROJECT}.{NDH_DATASET}.organization` WHERE _npi IS NOT NULL
    ),
    enriched AS (
      SELECT
        npd._id,
        npd.expected_entity,
        n.npi AS nppes_npi,
        n.entity_type_code AS nppes_entity,
        n.npi_deactivation_date
      FROM npd
      LEFT JOIN `{NPPES_DATASET}.npi_raw` n ON n.npi = npd._npi
    )
    SELECT
      COUNT(*) AS total,
      COUNTIF(nppes_npi IS NULL) AS not_enumerated,
      COUNTIF(nppes_npi IS NOT NULL AND npi_deactivation_date IS NOT NULL) AS deactivated,
      COUNTIF(nppes_npi IS NOT NULL AND npi_deactivation_date IS NULL
              AND nppes_entity IS NOT NULL AND nppes_entity != expected_entity) AS type_mismatch,
      COUNTIF(nppes_npi IS NOT NULL AND npi_deactivation_date IS NULL
              AND nppes_entity = expected_entity) AS ok,
      COUNTIF(nppes_npi IS NOT NULL AND npi_deactivation_date IS NULL
              AND nppes_entity IS NULL) AS active_but_no_entity_code
    FROM enriched
    """)
    for k, v in h10.items():
        print(f"  {k:<20} {v:>12,}")

    # Practitioner + Organization breakouts
    h10_prac = scalar(c, f"""
    SELECT
      COUNT(*) AS total,
      COUNTIF(n.npi IS NULL) AS not_enumerated,
      COUNTIF(n.npi IS NOT NULL AND n.npi_deactivation_date IS NOT NULL) AS deactivated,
      COUNTIF(n.entity_type_code = 2 AND n.npi_deactivation_date IS NULL) AS type_mismatch_as_org,
      COUNTIF(n.entity_type_code = 1 AND n.npi_deactivation_date IS NULL) AS ok
    FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner` p
    LEFT JOIN `{NPPES_DATASET}.npi_raw` n ON n.npi = p._npi
    WHERE p._npi IS NOT NULL
    """)
    h10_org = scalar(c, f"""
    SELECT
      COUNT(*) AS total,
      COUNTIF(n.npi IS NULL) AS not_enumerated,
      COUNTIF(n.npi IS NOT NULL AND n.npi_deactivation_date IS NOT NULL) AS deactivated,
      COUNTIF(n.entity_type_code = 1 AND n.npi_deactivation_date IS NULL) AS type_mismatch_as_indiv,
      COUNTIF(n.entity_type_code = 2 AND n.npi_deactivation_date IS NULL) AS ok
    FROM `{NDH_PROJECT}.{NDH_DATASET}.organization` o
    LEFT JOIN `{NPPES_DATASET}.npi_raw` n ON n.npi = o._npi
    WHERE o._npi IS NOT NULL
    """)
    print(f"  Practitioner breakdown: {h10_prac}")
    print(f"  Organization breakdown: {h10_org}")

    # ---------------- H11 — Name agreement ----------------
    print("\nH11 — Name agreement (exact match after normalization)")
    # Individuals: family + first. Use UPPER + trim; NPPES names are usually uppercased.
    h11_prac = scalar(c, f"""
    WITH joined AS (
      SELECT
        UPPER(TRIM(p._family_name)) AS ndh_last,
        UPPER(TRIM(p._given_name)) AS ndh_first,
        UPPER(TRIM(n.provider_last_name_legal_name)) AS nppes_last,
        UPPER(TRIM(n.provider_first_name)) AS nppes_first
      FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner` p
      JOIN `{NPPES_DATASET}.npi_raw` n ON n.npi = p._npi AND n.entity_type_code = 1
      WHERE p._npi IS NOT NULL AND p._family_name IS NOT NULL
    )
    SELECT
      COUNT(*) AS total,
      COUNTIF(ndh_last = nppes_last) AS family_match,
      COUNTIF(ndh_last = nppes_last AND ndh_first = nppes_first) AS full_match
    FROM joined
    """)
    h11_org = scalar(c, f"""
    WITH joined AS (
      SELECT
        UPPER(TRIM(o._name)) AS ndh_name,
        UPPER(TRIM(n.provider_organization_name_legal_business_name)) AS nppes_name
      FROM `{NDH_PROJECT}.{NDH_DATASET}.organization` o
      JOIN `{NPPES_DATASET}.npi_raw` n ON n.npi = o._npi AND n.entity_type_code = 2
      WHERE o._npi IS NOT NULL AND o._name IS NOT NULL
    )
    SELECT
      COUNT(*) AS total,
      COUNTIF(ndh_name = nppes_name) AS exact_match
    FROM joined
    """)
    print(f"  Practitioner: {h11_prac}")
    print(f"  Organization: {h11_org}")

    # ---------------- H12 — NUCC taxonomy validity ----------------
    # IMPORTANT: NDH PractitionerRole.specialty uses CMS Medicare Physician
    # Specialty Types (codes like '14-50' with system URI pointing to
    # cms.gov/files/document/acceptable-physician-specialty-types-py-2025.pdf),
    # NOT NUCC. NUCC codes live on Practitioner.qualification.code
    # (system http://nucc.org/provider-taxonomy), 7.12M rows.
    # H12 must query qualification, not role.
    print("\nH12 — NUCC taxonomy validity (on Practitioner.qualification)")
    h12 = scalar(c, f"""
    WITH quals AS (
      SELECT
        _id,
        JSON_EXTRACT_SCALAR(resource, '$.qualification[0].code.coding[0].system') AS sys,
        JSON_EXTRACT_SCALAR(resource, '$.qualification[0].code.coding[0].code') AS code
      FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner`
    )
    SELECT
      COUNT(*) AS total_practitioners,
      COUNTIF(sys = 'http://nucc.org/provider-taxonomy' AND code IS NOT NULL) AS with_nucc_code,
      COUNTIF(sys = 'http://nucc.org/provider-taxonomy'
              AND code IN (SELECT code FROM `{NUCC_TABLE}`)) AS valid_nucc,
      COUNTIF(sys IS NULL) AS no_system,
      COUNTIF(sys IS NOT NULL AND sys != 'http://nucc.org/provider-taxonomy') AS other_system
    FROM quals
    """)
    print(f"  {h12}")
    # Invalid NUCC codes (still using nucc system but not in the code set)
    invalid_top = q(c, f"""
    WITH quals AS (
      SELECT
        JSON_EXTRACT_SCALAR(resource, '$.qualification[0].code.coding[0].system') AS sys,
        JSON_EXTRACT_SCALAR(resource, '$.qualification[0].code.coding[0].code') AS code
      FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner`
    )
    SELECT code, COUNT(*) AS n
    FROM quals
    WHERE sys = 'http://nucc.org/provider-taxonomy'
      AND code IS NOT NULL
      AND code NOT IN (SELECT code FROM `{NUCC_TABLE}`)
    GROUP BY code ORDER BY n DESC LIMIT 10
    """)
    if invalid_top:
        print(f"  Top invalid NUCC codes: {[(r.code, r.n) for r in invalid_top]}")

    # ---------------- H12-bonus — PractitionerRole.specialty system ----------------
    # Finding: NDH uses CMS Medicare Physician Specialty Types on PractitionerRole
    # (codes like '14-50' → 'PRACTITIONER - NURSE PRACTITIONER'), not NUCC.
    # Check: what fraction of role specialties carry each system URI?
    h12b = scalar(c, f"""
    WITH roles AS (
      SELECT
        JSON_EXTRACT_SCALAR(resource, '$.specialty[0].coding[0].system') AS sys,
        JSON_EXTRACT_SCALAR(resource, '$.specialty[0].coding[0].code') AS code
      FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner_role`
    )
    SELECT
      COUNT(*) AS total_roles,
      COUNTIF(sys IS NOT NULL) AS with_system,
      COUNTIF(sys LIKE 'https://www.cms.gov%') AS cms_medicare_system,
      COUNTIF(sys = 'http://nucc.org/provider-taxonomy') AS nucc_system
    FROM roles
    """)
    print(f"  PractitionerRole system distribution: {h12b}")

    # ---------------- H13 — Primary specialty agreement ----------------
    # Apples-to-apples: compare NDH Practitioner.qualification (NUCC) vs
    # NPPES primary_taxonomy_code (NUCC).
    print("\nH13 — Primary NUCC specialty agreement (Practitioner.qualification vs NPPES)")
    h13 = scalar(c, f"""
    WITH ndh AS (
      SELECT
        p._id,
        p._npi,
        JSON_EXTRACT_SCALAR(p.resource, '$.qualification[0].code.coding[0].system') AS ndh_sys,
        JSON_EXTRACT_SCALAR(p.resource, '$.qualification[0].code.coding[0].code') AS ndh_code
      FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner` p
      WHERE p._npi IS NOT NULL
    ),
    joined AS (
      SELECT
        ndh.ndh_code,
        n.healthcare_provider_taxonomy_code_1 AS nppes_code,
        n.entity_type_code
      FROM ndh
      JOIN `{NPPES_DATASET}.npi_raw` n ON n.npi = ndh._npi
      WHERE ndh.ndh_sys = 'http://nucc.org/provider-taxonomy'
        AND ndh.ndh_code IS NOT NULL
        AND n.entity_type_code = 1
    )
    SELECT
      COUNT(*) AS total,
      COUNTIF(ndh_code = nppes_code) AS agree,
      COUNTIF(nppes_code IS NULL) AS nppes_missing_taxonomy,
      COUNTIF(nppes_code IS NOT NULL AND ndh_code != nppes_code) AS disagree
    FROM joined
    """)
    print(f"  {h13}")

    # ---------------- Compose finding ----------------
    def n(x): return int(x) if x is not None else 0
    def pct(num, den): return (100 * n(num) / n(den)) if n(den) else 0

    # H9 carry-over (from previous analysis)
    h9_total = 10856109
    h9_failures = 3

    h10_pct_ok = pct(h10["ok"], h10["total"])
    h10_deact_pct = pct(h10["deactivated"], h10["total"])
    h10_not_enum_pct = pct(h10["not_enumerated"], h10["total"])

    h11p_pct = pct(h11_prac["full_match"], h11_prac["total"])
    h11o_pct = pct(h11_org["exact_match"], h11_org["total"])

    # H12 denom is Practitioners with NUCC on qualification (system = nucc.org)
    h12_pct = pct(h12["valid_nucc"], h12["with_nucc_code"])
    # H12-bonus — the "NDH uses CMS Medicare codes on PractitionerRole" finding
    h12b_cms_pct = pct(h12b["cms_medicare_system"], h12b["with_system"])

    h13_pct = pct(h13["agree"], h13["total"])

    headline = (
        f"H9 {h9_failures}/{h9_total:,} NPIs fail structural+Luhn. "
        f"H10 — {h10_not_enum_pct:.3f}% of {n(h10['total'])/1_000_000:.1f}M NDH NPIs "
        f"are NOT in NPPES; {h10_deact_pct:.2f}% are deactivated in NPPES; "
        f"{pct(h10['type_mismatch'], h10['total']):.3f}% have entity-type mismatch "
        f"({h10_pct_ok:.2f}% clean). "
        f"H11 — {h11p_pct:.1f}% of Practitioners match NPPES on full name (exact); "
        f"{h11o_pct:.1f}% of Organizations match NPPES on business name (exact). "
        f"H12 — {h12_pct:.2f}% of {n(h12['with_nucc_code'])/1_000_000:.1f}M "
        f"NDH Practitioner.qualification NUCC codes are valid in NUCC v17.0. "
        f"NDH PractitionerRole.specialty uses CMS Medicare Physician Specialty "
        f"Types ({h12b_cms_pct:.1f}% of specialty-bearing roles), NOT NUCC. "
        f"H13 — {h13_pct:.2f}% of {n(h13['total'])/1_000_000:.1f}M NDH Practitioners "
        f"agree with NPPES on primary taxonomy code."
    )

    chart_data = [
        {"label": "H10 NPPES match OK",         "value": round(h10_pct_ok, 2)},
        {"label": "H10 not in NPPES",           "value": round(h10_not_enum_pct, 3)},
        {"label": "H10 deactivated in NPPES",   "value": round(h10_deact_pct, 2)},
        {"label": "H11 full name match (Prac)", "value": round(h11p_pct, 1)},
        {"label": "H11 name match (Org)",       "value": round(h11o_pct, 1)},
        {"label": "H12 NUCC valid (qual.)",     "value": round(h12_pct, 2)},
        {"label": "H13 NUCC agree w/ NPPES",    "value": round(h13_pct, 1)},
    ]

    notes = (
        f"Source: bigquery-public-data.nppes.npi_raw (latest update 2026-02-09, "
        f"9.37M NPIs) + .healthcare_provider_taxonomy_code_set_170 joined against "
        f"NDH 2026-04-09. ~8-week gap window means NPIs deactivated between "
        f"2026-02-09 and 2026-04-09 may appear active in NPPES — known caveat. "
        f"H10: Practitioner — {n(h10_prac['ok']):,} ok / "
        f"{n(h10_prac['not_enumerated']):,} not in NPPES / "
        f"{n(h10_prac['deactivated']):,} deactivated / "
        f"{n(h10_prac['type_mismatch_as_org']):,} enumerated as org in NPPES. "
        f"Organization — {n(h10_org['ok']):,} ok / "
        f"{n(h10_org['not_enumerated']):,} not in NPPES / "
        f"{n(h10_org['deactivated']):,} deactivated / "
        f"{n(h10_org['type_mismatch_as_indiv']):,} enumerated as individual. "
        f"H11 uses exact case-insensitive match after TRIM+UPPER; Jaro-Winkler "
        f"≥0.85 = v2 upgrade. "
        f"H12 NOTE: NDH PractitionerRole.specialty uses CMS Medicare Physician "
        f"Specialty Types with system URI https://www.cms.gov/files/document/"
        f"acceptable-physician-specialty-types-py-2025.pdf (codes like '14-50' = "
        f"'PRACTITIONER - NURSE PRACTITIONER'), NOT NUCC. NUCC codes appear on "
        f"Practitioner.qualification.code with system http://nucc.org/"
        f"provider-taxonomy ({n(h12['with_nucc_code']):,} of "
        f"{n(h12['total_practitioners']):,} Practitioners). H12's metric is "
        f"validity of those NUCC codes against the v17.0 code set "
        f"({n(h12['valid_nucc']):,} valid of {n(h12['with_nucc_code']):,} populated). "
        f"NUCC v17.0 is the latest version in bigquery-public-data; if NDH uses "
        f"a newer code set, codes from later releases would appear invalid here "
        f"(upgrade to current quarterly NUCC + accept-last-3-years window = v2). "
        f"H13 compares NUCC primary taxonomy NDH→NPPES only for Practitioners "
        f"where NDH.qualification.system = http://nucc.org/provider-taxonomy AND "
        f"NPPES entity_type_code = 1."
    )

    payload = {
        "slug": "npi-taxonomy-correctness",
        "title": "NPI and taxonomy correctness",
        "hypotheses": ["H9", "H10", "H11", "H12", "H13"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": "0.1.0-draft",
        "commit_sha": "pending",
        "headline": headline,
        "numerator": int(h10["ok"]),
        "denominator": int(h10["total"]),
        "chart": {"type": "bar", "unit": "percent", "data": chart_data},
        "notes": notes,
    }

    out = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "public" / "api" / "v1" / "findings" / "npi-taxonomy-correctness.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    run()
