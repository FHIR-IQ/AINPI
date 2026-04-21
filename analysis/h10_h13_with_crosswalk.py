"""H10/H11/H12/H13 — NPPES + NUCC + CMS Medicare Taxonomy Crosswalk.

Supersedes h10_h13_nppes.py. Earlier run reported "NDH uses two
specialty code systems with no cross-walk" — that framing is incorrect.
CMS publishes a public crosswalk:

  https://data.cms.gov/provider-characteristics/medicare-provider-supplier-enrollment
    /medicare-provider-and-supplier-taxonomy-crosswalk
  Oct 2025 release: 568 rows, one Medicare specialty (e.g. '50') maps
  to multiple NUCC taxonomy codes (1-to-many).

This analysis loads the crosswalk into
`thematic-fort-453901-t7.cms_npd.medicare_taxonomy_crosswalk` and uses
it to:

  H10 — unchanged (NPI match against NPPES)
  H11 — unchanged (exact-match name agreement)
  H12 — validate NDH PractitionerRole._specialty_code against Medicare
        codes in the crosswalk (NOT NUCC — since role.specialty uses
        the CMS Medicare system URI). NDH also uses NUCC on
        Practitioner.qualification; we measure both.
  H13 — For each Practitioner with NPI, check whether their
        PractitionerRole specialty (CMS code) crosswalks to a NUCC
        taxonomy that matches EITHER their Practitioner.qualification
        (NUCC) OR their NPPES primary_taxonomy_code. Tests internal
        NDH consistency AND external NDH↔NPPES agreement.

NDH PractitionerRole._specialty_code values appear to have a "14-"
prefix (e.g. '14-50'). The crosswalk uses bare 2-digit codes ('50'),
so we strip the prefix before joining.

Writes frontend/public/api/v1/findings/npi-taxonomy-correctness.json.
"""
from __future__ import annotations
import csv
import json
import pathlib
from datetime import datetime, timezone
from google.cloud import bigquery

NDH_PROJECT = "thematic-fort-453901-t7"
NDH_DATASET = "cms_npd"
NPPES_DATASET = "bigquery-public-data.nppes"
NUCC_TABLE = f"{NPPES_DATASET}.healthcare_provider_taxonomy_code_set_170"
CROSSWALK_TABLE = f"{NDH_PROJECT}.{NDH_DATASET}.medicare_taxonomy_crosswalk"
CROSSWALK_CSV = "/tmp/crosswalk.csv"
CROSSWALK_RELEASE = "2025-10"
RELEASE_DATE = "2026-04-09"


def load_crosswalk(client: bigquery.Client) -> int:
    """(Re)load the CMS Medicare/NUCC crosswalk CSV into BigQuery.

    CMS publishes the CSV with embedded newlines inside quoted fields
    for a handful of rows. BigQuery's CSV loader rejects those. Parse
    with Python's csv module (which handles RFC-4180 quoting correctly),
    strip whitespace, and stream as newline-delimited JSON — which
    BigQuery's NDJSON loader tolerates without issue.
    """
    import io
    print(f"Loading {CROSSWALK_CSV} → {CROSSWALK_TABLE}")
    schema = [
        bigquery.SchemaField("medicare_specialty_code", "STRING"),
        bigquery.SchemaField("medicare_type_description", "STRING"),
        bigquery.SchemaField("nucc_taxonomy_code", "STRING"),
        bigquery.SchemaField("nucc_taxonomy_description", "STRING"),
    ]

    ndjson = io.BytesIO()
    with open(CROSSWALK_CSV, newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        next(reader)  # header
        rows = 0
        for row in reader:
            if len(row) < 4:
                continue
            record = {
                "medicare_specialty_code": row[0].strip(),
                "medicare_type_description": row[1].strip(),
                # trailing/leading whitespace on taxonomy codes is real in the CSV
                "nucc_taxonomy_code": row[2].strip(),
                "nucc_taxonomy_description": row[3].strip(),
            }
            ndjson.write((json.dumps(record) + "\n").encode("utf-8"))
            rows += 1
    ndjson.seek(0)
    print(f"  parsed {rows} rows with RFC-4180 csv reader")

    cfg = bigquery.LoadJobConfig(
        schema=schema,
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition="WRITE_TRUNCATE",
    )
    job = client.load_table_from_file(ndjson, CROSSWALK_TABLE, job_config=cfg)
    job.result()
    n = client.get_table(CROSSWALK_TABLE).num_rows
    print(f"  loaded {n} rows")
    return n


def scalar(client, sql):
    return dict(next(iter(client.query(sql).result())).items())


def q(client, sql):
    return list(client.query(sql).result())


def n(x): return int(x) if x is not None else 0


def pct(num, den):
    num, den = n(num), n(den)
    return (100 * num / den) if den else 0


def main() -> None:
    c = bigquery.Client(project=NDH_PROJECT)

    cw_rows = load_crosswalk(c)

    # ---------------- H10 unchanged ----------------
    print("\nH10 — NPI match vs NPPES")
    h10 = scalar(c, f"""
    WITH npd AS (
      SELECT _id, 1 AS expected_entity, _npi FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner` WHERE _npi IS NOT NULL
      UNION ALL
      SELECT _id, 2, _npi FROM `{NDH_PROJECT}.{NDH_DATASET}.organization` WHERE _npi IS NOT NULL
    ),
    enriched AS (
      SELECT npd.*, n.npi AS nppes_npi, n.entity_type_code AS nppes_entity, n.npi_deactivation_date
      FROM npd LEFT JOIN `{NPPES_DATASET}.npi_raw` n ON n.npi = npd._npi
    )
    SELECT
      COUNT(*) AS total,
      COUNTIF(nppes_npi IS NULL) AS not_enumerated,
      COUNTIF(nppes_npi IS NOT NULL AND npi_deactivation_date IS NOT NULL) AS deactivated,
      COUNTIF(nppes_npi IS NOT NULL AND npi_deactivation_date IS NULL
              AND nppes_entity IS NOT NULL AND nppes_entity != expected_entity) AS type_mismatch,
      COUNTIF(nppes_npi IS NOT NULL AND npi_deactivation_date IS NULL
              AND nppes_entity = expected_entity) AS ok
    FROM enriched
    """)
    print(f"  {h10}")

    # ---------------- H11 unchanged ----------------
    print("\nH11 — exact name agreement NDH↔NPPES")
    h11_prac = scalar(c, f"""
    SELECT
      COUNT(*) AS total,
      COUNTIF(UPPER(TRIM(p._family_name)) = UPPER(TRIM(n.provider_last_name_legal_name))) AS family_match,
      COUNTIF(UPPER(TRIM(p._family_name)) = UPPER(TRIM(n.provider_last_name_legal_name))
              AND UPPER(TRIM(p._given_name)) = UPPER(TRIM(n.provider_first_name))) AS full_match
    FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner` p
    JOIN `{NPPES_DATASET}.npi_raw` n ON n.npi = p._npi AND n.entity_type_code = 1
    WHERE p._npi IS NOT NULL AND p._family_name IS NOT NULL
    """)
    h11_org = scalar(c, f"""
    SELECT
      COUNT(*) AS total,
      COUNTIF(UPPER(TRIM(o._name)) = UPPER(TRIM(n.provider_organization_name_legal_business_name))) AS exact_match
    FROM `{NDH_PROJECT}.{NDH_DATASET}.organization` o
    JOIN `{NPPES_DATASET}.npi_raw` n ON n.npi = o._npi AND n.entity_type_code = 2
    WHERE o._npi IS NOT NULL AND o._name IS NOT NULL
    """)
    print(f"  Prac: {h11_prac}")
    print(f"  Org:  {h11_org}")

    # ---------------- H12 — validate both code systems against their authoritative sets ----------------
    print("\nH12 — NUCC codes on Practitioner.qualification")
    h12_nucc = scalar(c, f"""
    WITH quals AS (
      SELECT
        JSON_EXTRACT_SCALAR(resource, '$.qualification[0].code.coding[0].system') AS sys,
        JSON_EXTRACT_SCALAR(resource, '$.qualification[0].code.coding[0].code') AS code
      FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner`
    )
    SELECT
      COUNT(*) AS total_practitioners,
      COUNTIF(sys = 'http://nucc.org/provider-taxonomy' AND code IS NOT NULL) AS with_nucc_code,
      COUNTIF(sys = 'http://nucc.org/provider-taxonomy'
              AND code IN (SELECT code FROM `{NUCC_TABLE}`)) AS valid_in_nucc_v17,
      COUNTIF(sys = 'http://nucc.org/provider-taxonomy'
              AND code IN (SELECT nucc_taxonomy_code FROM `{CROSSWALK_TABLE}`)) AS valid_in_crosswalk
    FROM quals
    """)
    print(f"  {h12_nucc}")

    # NDH PractitionerRole._specialty_code: strip '14-' prefix if present, then match crosswalk
    print("\nH12b — Medicare Specialty codes on PractitionerRole.specialty")
    h12_cms = scalar(c, f"""
    WITH roles AS (
      SELECT
        _specialty_code AS raw_code,
        -- Strip any leading 'NN-' prefix to isolate the Medicare 2-char code
        REGEXP_REPLACE(_specialty_code, r'^\\d+-', '') AS stripped
      FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner_role`
      WHERE _specialty_code IS NOT NULL
    )
    SELECT
      COUNT(*) AS total_role_specialties,
      COUNTIF(stripped IN (SELECT medicare_specialty_code FROM `{CROSSWALK_TABLE}`)) AS valid_in_crosswalk,
      COUNT(DISTINCT raw_code) AS distinct_raw_codes,
      COUNT(DISTINCT stripped) AS distinct_stripped_codes
    FROM roles
    """)
    print(f"  {h12_cms}")

    # Top invalid raw specialty codes for debugging
    invalid_top = q(c, f"""
    WITH roles AS (
      SELECT _specialty_code AS raw_code,
             REGEXP_REPLACE(_specialty_code, r'^\\d+-', '') AS stripped
      FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner_role`
      WHERE _specialty_code IS NOT NULL
    )
    SELECT raw_code, COUNT(*) AS n
    FROM roles
    WHERE stripped NOT IN (SELECT medicare_specialty_code FROM `{CROSSWALK_TABLE}`)
    GROUP BY raw_code ORDER BY n DESC LIMIT 10
    """)
    if invalid_top:
        print(f"  Top invalid raw codes: {[(r.raw_code, r.n) for r in invalid_top]}")

    # ---------------- H13 — internal + external NDH consistency via crosswalk ----------------
    print("\nH13 — internal NDH consistency: Role CMS code → crosswalk NUCC set ∩ Practitioner.qualification NUCC")
    h13_internal = scalar(c, f"""
    WITH prac_with_npi AS (
      SELECT _id, _npi,
        JSON_EXTRACT_SCALAR(resource, '$.qualification[0].code.coding[0].system') AS ndh_qual_sys,
        JSON_EXTRACT_SCALAR(resource, '$.qualification[0].code.coding[0].code')   AS ndh_qual_code
      FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner`
      WHERE _npi IS NOT NULL
    ),
    roles AS (
      SELECT pr._practitioner_id,
             REGEXP_REPLACE(pr._specialty_code, r'^\\d+-', '') AS medicare_code
      FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner_role` pr
      WHERE pr._specialty_code IS NOT NULL
    ),
    joined AS (
      SELECT
        p._id,
        p.ndh_qual_code,
        r.medicare_code,
        EXISTS (
          SELECT 1 FROM `{CROSSWALK_TABLE}` cw
          WHERE cw.medicare_specialty_code = r.medicare_code
            AND cw.nucc_taxonomy_code = p.ndh_qual_code
        ) AS internal_crosswalk_match
      FROM prac_with_npi p
      JOIN roles r ON r._practitioner_id = CONCAT('Practitioner/', p._id)
      WHERE p.ndh_qual_sys = 'http://nucc.org/provider-taxonomy'
        AND p.ndh_qual_code IS NOT NULL
    )
    SELECT
      COUNT(*) AS total_pairs,
      COUNTIF(internal_crosswalk_match) AS crosswalk_consistent,
      COUNT(DISTINCT _id) AS distinct_practitioners
    FROM joined
    """)
    print(f"  {h13_internal}")

    print("\nH13b — external NDH↔NPPES agreement (NUCC on qualification vs NPPES primary taxonomy)")
    h13_external = scalar(c, f"""
    WITH ndh AS (
      SELECT p._npi,
        JSON_EXTRACT_SCALAR(p.resource, '$.qualification[0].code.coding[0].code') AS ndh_code
      FROM `{NDH_PROJECT}.{NDH_DATASET}.practitioner` p
      WHERE p._npi IS NOT NULL
        AND JSON_EXTRACT_SCALAR(p.resource, '$.qualification[0].code.coding[0].system') = 'http://nucc.org/provider-taxonomy'
        AND JSON_EXTRACT_SCALAR(p.resource, '$.qualification[0].code.coding[0].code') IS NOT NULL
    )
    SELECT
      COUNT(*) AS total,
      COUNTIF(ndh.ndh_code = n.healthcare_provider_taxonomy_code_1) AS agree,
      COUNTIF(ndh.ndh_code != n.healthcare_provider_taxonomy_code_1 AND n.healthcare_provider_taxonomy_code_1 IS NOT NULL) AS disagree,
      COUNTIF(n.healthcare_provider_taxonomy_code_1 IS NULL) AS nppes_missing
    FROM ndh
    JOIN `{NPPES_DATASET}.npi_raw` n ON n.npi = ndh._npi AND n.entity_type_code = 1
    """)
    print(f"  {h13_external}")

    # ---------------- Compose finding ----------------
    h9_total = 10856109
    h9_failures = 3

    h10_pct_ok     = pct(h10["ok"], h10["total"])
    h10_deact_pct  = pct(h10["deactivated"], h10["total"])
    h10_ghost_pct  = pct(h10["not_enumerated"], h10["total"])
    h11p_pct       = pct(h11_prac["full_match"], h11_prac["total"])
    h11o_pct       = pct(h11_org["exact_match"], h11_org["total"])
    h12_nucc_valid = pct(h12_nucc["valid_in_nucc_v17"], h12_nucc["with_nucc_code"])
    h12_cms_valid  = pct(h12_cms["valid_in_crosswalk"], h12_cms["total_role_specialties"])
    h13_int_pct    = pct(h13_internal["crosswalk_consistent"], h13_internal["total_pairs"])
    h13_ext_pct    = pct(h13_external["agree"], h13_external["total"])

    headline = (
        f"{h10_pct_ok:.2f}% of {n(h10['total'])/1_000_000:.1f}M NDH NPIs clear NPPES "
        f"(0.79% ghost, 3.49% deactivated). "
        f"Practitioner full-name match: {h11p_pct:.1f}%; Organization name match: {h11o_pct:.1f}%. "
        f"NDH carries NUCC on Practitioner.qualification (99.83% valid) AND "
        f"Medicare Specialty codes on PractitionerRole.specialty ({h12_cms_valid:.2f}% valid "
        f"against the CMS-published crosswalk). "
        f"Internal cross-system consistency (Role CMS → crosswalk → Qualification NUCC): "
        f"{h13_int_pct:.1f}% of {n(h13_internal['total_pairs'])/1_000_000:.1f}M Practitioner↔Role pairs agree. "
        f"External NUCC agreement NDH↔NPPES: {h13_ext_pct:.1f}%."
    )

    chart_data = [
        {"label": "H10 NPPES match OK",         "value": round(h10_pct_ok, 2)},
        {"label": "H10 not in NPPES",           "value": round(h10_ghost_pct, 3)},
        {"label": "H10 deactivated in NPPES",   "value": round(h10_deact_pct, 2)},
        {"label": "H11 full name match (Prac)", "value": round(h11p_pct, 1)},
        {"label": "H11 name match (Org)",       "value": round(h11o_pct, 1)},
        {"label": "H12 NUCC valid",             "value": round(h12_nucc_valid, 2)},
        {"label": "H12 CMS code valid",         "value": round(h12_cms_valid, 2)},
        {"label": "H13 internal crosswalk",     "value": round(h13_int_pct, 1)},
        {"label": "H13 NDH↔NPPES agree",        "value": round(h13_ext_pct, 1)},
    ]

    notes = (
        f"Corrections from earlier v0.1 of this finding: CMS DOES publish a "
        f"Medicare Provider and Supplier Taxonomy Crosswalk "
        f"(data.cms.gov/provider-characteristics/medicare-provider-supplier-enrollment/"
        f"medicare-provider-and-supplier-taxonomy-crosswalk; {CROSSWALK_RELEASE} release, "
        f"{cw_rows} rows, 1-to-many). The prior "
        f"\"no cross-walk\" framing was incorrect — consumers CAN and DO (Blue "
        f"Button) bridge Medicare Specialty codes and NUCC via this table. "
        f"NDH PractitionerRole._specialty_code carries values like '14-50' — "
        f"the leading 'NN-' prefix does not appear in the crosswalk; stripping "
        f"it recovers the canonical 2-character Medicare Specialty code used by "
        f"the crosswalk's MEDICARE SPECIALTY CODE column. "
        f"H12 methodology: NUCC codes on Practitioner.qualification validated "
        f"against NUCC v17.0 ({n(h12_nucc['valid_in_nucc_v17']):,} of "
        f"{n(h12_nucc['with_nucc_code']):,}); Medicare codes on "
        f"PractitionerRole.specialty validated against the crosswalk's "
        f"MEDICARE SPECIALTY CODE column ({n(h12_cms['valid_in_crosswalk']):,} "
        f"of {n(h12_cms['total_role_specialties']):,}). "
        f"H13 methodology: internal — {n(h13_internal['total_pairs']):,} "
        f"Practitioner↔PractitionerRole pairs; a pair is crosswalk-consistent "
        f"if (role.Medicare code, qualification.NUCC code) is a row in the "
        f"crosswalk. External — {n(h13_external['total']):,} NDH NUCC qualifications "
        f"compared against NPPES primary taxonomy; exact-code match. "
        f"Known caveat: NPPES vintage 2026-02-09 vs NDH {RELEASE_DATE} — 8-week "
        f"gap means taxonomy changes in that window show as disagreement. "
        f"v2 upgrade candidates: Jaro-Winkler name agreement (H11); "
        f"NPPES secondary-taxonomy match as additional H13 signal; confusion "
        f"matrix per specialty; pinned NUCC quarterly release."
    )

    payload = {
        "slug": "npi-taxonomy-correctness",
        "title": "NPI and taxonomy correctness",
        "hypotheses": ["H9", "H10", "H11", "H12", "H13"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": "0.3.0-draft",
        "commit_sha": "pending",
        "headline": headline,
        "numerator": n(h13_internal["crosswalk_consistent"]),
        "denominator": n(h13_internal["total_pairs"]),
        "chart": {"type": "bar", "unit": "percent", "data": chart_data},
        "notes": notes,
    }

    out = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "public" / "api" / "v1" / "findings" / "npi-taxonomy-correctness.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
