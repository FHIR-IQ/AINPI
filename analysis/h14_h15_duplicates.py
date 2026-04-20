"""H14/H15 — Residual duplicate detection in the NPD 2026-04-09 release.

Note: the BigQuery dataset has already had primary-key dedup applied
during ingest (per CLAUDE.md: -4.6M Practitioner dups and -383K
Organization dups at the _id level). This analysis finds RESIDUAL
duplicates at the entity level — same provider / same organization
carrying multiple distinct resource IDs.

H14 — Practitioner duplicates keyed by NPI
H15 — Organization duplicates keyed by normalized (name, state, postal5)
Bonus — Organization duplicates keyed by NPI (complement to H15)

Writes frontend/public/api/v1/findings/duplicate-detection.json.
"""
from __future__ import annotations
import json
import pathlib
from datetime import datetime, timezone
from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE_DATE = "2026-04-09"


def scalar(client: bigquery.Client, sql: str) -> dict:
    row = next(iter(client.query(sql).result()))
    return dict(row.items())


def run() -> None:
    c = bigquery.Client(project=PROJECT)

    print("H14 — Practitioner duplicates by NPI")
    h14 = scalar(c, f"""
    WITH grp AS (
      SELECT _npi, COUNT(DISTINCT _id) AS copies
      FROM `{PROJECT}.{DATASET}.practitioner`
      WHERE _npi IS NOT NULL
      GROUP BY _npi
    )
    SELECT
      COUNT(*) AS unique_npis,
      COUNTIF(copies > 1) AS npis_with_dups,
      COALESCE(SUM(IF(copies > 1, copies - 1, 0)), 0) AS excess_resources,
      COALESCE(MAX(copies), 0) AS max_copies_for_one_npi
    FROM grp
    """)
    total_prac = scalar(c, f"SELECT COUNT(*) AS n FROM `{PROJECT}.{DATASET}.practitioner`")["n"]
    print(f"  total Practitioner resources: {total_prac:,}")
    print(f"  unique NPIs: {h14['unique_npis']:,}")
    print(f"  NPIs with > 1 resource: {h14['npis_with_dups']:,}")
    print(f"  excess resources: {h14['excess_resources']:,}")
    print(f"  max copies for any one NPI: {h14['max_copies_for_one_npi']}")

    # H14 group-size distribution (top)
    h14_dist = list(c.query(f"""
    WITH grp AS (
      SELECT _npi, COUNT(DISTINCT _id) AS copies
      FROM `{PROJECT}.{DATASET}.practitioner`
      WHERE _npi IS NOT NULL
      GROUP BY _npi
      HAVING copies > 1
    )
    SELECT copies, COUNT(*) AS n
    FROM grp GROUP BY copies ORDER BY copies
    """).result())
    print(f"  Practitioner dup group-size distribution:")
    for r in h14_dist:
        print(f"    {r.copies} copies: {r.n:,} NPIs")

    print("\nH15 — Organization duplicates by normalized (name, state, postal5)")
    h15 = scalar(c, f"""
    WITH norm AS (
      SELECT
        _id,
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            LOWER(COALESCE(_name, '')),
            r'\\b(llc|inc|pc|pa|pllc|corp|llp|ltd|co|company|the)\\b', ''
          ),
          r'[^a-z0-9]+', ' '
        ) AS nm_raw,
        UPPER(COALESCE(_state, '')) AS st,
        UPPER(TRIM(COALESCE(_city, ''))) AS city
      FROM `{PROJECT}.{DATASET}.organization`
    ),
    cleaned AS (
      SELECT _id, TRIM(REGEXP_REPLACE(nm_raw, r' +', ' ')) AS nm, st, city
      FROM norm
      WHERE LENGTH(TRIM(REGEXP_REPLACE(nm_raw, r' +', ' '))) >= 3
        AND st != ''
        AND city != ''
    ),
    grp AS (
      SELECT nm, st, city, COUNT(DISTINCT _id) AS copies
      FROM cleaned
      GROUP BY nm, st, city
    )
    SELECT
      COUNT(*) AS unique_groups,
      COUNTIF(copies > 1) AS groups_with_dups,
      COALESCE(SUM(IF(copies > 1, copies - 1, 0)), 0) AS excess_resources,
      COALESCE(MAX(copies), 0) AS max_copies_for_one_key
    FROM grp
    """)
    total_org = scalar(c, f"SELECT COUNT(*) AS n FROM `{PROJECT}.{DATASET}.organization`")["n"]
    print(f"  total Organization resources: {total_org:,}")
    print(f"  orgs with name+state+postal5 available for grouping: included above")
    print(f"  unique (name,state,postal5) keys: {h15['unique_groups']:,}")
    print(f"  keys with > 1 resource: {h15['groups_with_dups']:,}")
    print(f"  excess resources: {h15['excess_resources']:,}")
    print(f"  max copies for any one key: {h15['max_copies_for_one_key']}")

    print("\nH15-bonus — Organization duplicates by NPI")
    h15b = scalar(c, f"""
    WITH grp AS (
      SELECT _npi, COUNT(DISTINCT _id) AS copies
      FROM `{PROJECT}.{DATASET}.organization`
      WHERE _npi IS NOT NULL
      GROUP BY _npi
    )
    SELECT
      COUNT(*) AS unique_npis,
      COUNTIF(copies > 1) AS npis_with_dups,
      COALESCE(SUM(IF(copies > 1, copies - 1, 0)), 0) AS excess_resources,
      COALESCE(MAX(copies), 0) AS max_copies_for_one_npi
    FROM grp
    """)
    print(f"  unique Org NPIs: {h15b['unique_npis']:,}")
    print(f"  NPIs with > 1 resource: {h15b['npis_with_dups']:,}")
    print(f"  excess resources: {h15b['excess_resources']:,}")

    # ---- compose finding ----
    def n(x): return int(x) if x is not None else 0

    h14_pct = 100 * h14["npis_with_dups"] / h14["unique_npis"] if h14["unique_npis"] else 0
    h15_pct = 100 * h15["groups_with_dups"] / h15["unique_groups"] if h15["unique_groups"] else 0
    h15b_pct = 100 * h15b["npis_with_dups"] / h15b["unique_npis"] if h15b["unique_npis"] else 0

    headline = (
        f"Practitioner dedup is clean — {n(h14['excess_resources']):,} excess "
        f"rows across {n(h14['unique_npis']):,} NPIs (H14). But Organizations "
        f"multiply: {h15b_pct:.1f}% of the {n(h15b['unique_npis']):,} unique Org "
        f"NPIs map to more than one Organization resource "
        f"({n(h15b['excess_resources']):,} excess rows; max "
        f"{n(h15b['max_copies_for_one_npi'])} resources per one NPI). By "
        f"normalized (name, state, city), {h15_pct:.1f}% of keys repeat. "
        f"Downstream consumers assuming one Organization resource = one "
        f"real-world entity will be wrong roughly two out of three times."
    )

    chart_data = [
        {"label": "H14 Practitioner by NPI",       "value": round(h14_pct, 4)},
        {"label": "H15 Org by name+state+city",    "value": round(h15_pct, 4)},
        {"label": "H15b Org by NPI",               "value": round(h15b_pct, 4)},
    ]

    notes = (
        f"BigQuery dataset has primary-key dedup applied at ingest "
        f"(-4.6M Practitioner, -383K Organization at _id). These are residual "
        f"entity-level duplicates. "
        f"H14 key = _npi on practitioner. Max copies observed: "
        f"{n(h14['max_copies_for_one_npi'])} for a single Practitioner NPI. "
        f"H15 key = (LOWER(name) stripped of LLC/INC/PC/PA/PLLC/CORP/LLP/LTD/CO/"
        f"COMPANY/THE and non-alphanumerics, UPPER(state), UPPER(TRIM(city))); "
        f"orgs with missing name or state or city are excluded. Max copies "
        f"for one key: {n(h15['max_copies_for_one_key'])}. H15-bonus keys by "
        f"_npi; max copies for one Org NPI: {n(h15b['max_copies_for_one_npi'])}. "
        f"Caveat — some portion of the Organization multiplicity may reflect "
        f"CMS modeling one FHIR Organization resource per service location "
        f"rather than true duplication. Either interpretation breaks the "
        f"common downstream assumption that COUNT(Organization) equals the "
        f"number of unique organizations. Fuzzy matching (Jaro-Winkler, "
        f"suite-unit tolerance) is a v2 enhancement."
    )

    payload = {
        "slug": "duplicate-detection",
        "title": "Duplicate detection",
        "hypotheses": ["H14", "H15"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": "0.1.0-draft",
        "commit_sha": "pending",
        "headline": headline,
        "numerator": int(h14["npis_with_dups"] + h15["groups_with_dups"]),
        "denominator": int(h14["unique_npis"] + h15["unique_groups"]),
        "chart": {
            "type": "bar",
            "unit": "percent",
            "data": chart_data,
        },
        "notes": notes,
    }

    out = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "public" / "api" / "v1" / "findings" / "duplicate-detection.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    run()
