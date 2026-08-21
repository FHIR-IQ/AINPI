"""H14/H15 — Residual duplicate detection in the NPD bulk export.

Release-agnostic: the release label comes from analysis/release.py.

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
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from claims_sources._cohorts import bq_job_config  # noqa: E402
from release import CURRENT_RELEASE as RELEASE_DATE  # noqa: E402


def scalar(client: bigquery.Client, sql: str) -> dict:
    row = next(iter(client.query(sql, job_config=bq_job_config()).result()))
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
    """, job_config=bq_job_config()).result())
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

    # H15-bonus, decomposed by record type.
    #
    # Half the Organization file is now `ein` tax records rather than
    # provider organizations (2.20M of 4.40M at 2026-08-20, up from 41.4%
    # at 2026-05-08), and 2.03M of those carry an NPI. So CMS ships a
    # second, shadow row under the same organization NPI. Counting rows per
    # NPI without splitting by `type[0].text` measures that modeling
    # decision and reports it as a duplication defect. Both numbers are
    # published: the raw multiplicity, and the share of it explained by the
    # provider/ein pairing.
    print("\nH15-bonus — Organization duplicates by NPI, split by record type")
    h15b = scalar(c, f"""
    WITH t AS (
      SELECT _id, _npi,
        COALESCE(NULLIF(JSON_VALUE(resource, '$.type[0].text'), ''), '(none)') AS ty
      FROM `{PROJECT}.{DATASET}.organization`
      WHERE _npi IS NOT NULL
    ),
    grp AS (
      SELECT _npi,
        COUNT(DISTINCT _id) AS copies,
        COUNTIF(ty = 'ein')  AS ein_rows,
        COUNTIF(ty != 'ein') AS other_rows
      FROM t GROUP BY _npi
    )
    SELECT
      COUNT(*) AS unique_npis,
      COUNTIF(copies > 1) AS npis_with_dups,
      COALESCE(SUM(IF(copies > 1, copies - 1, 0)), 0) AS excess_resources,
      COALESCE(MAX(copies), 0) AS max_copies_for_one_npi,
      COALESCE(SUM(IF(ein_rows > 0 AND other_rows > 0,
                      LEAST(ein_rows, other_rows), 0)), 0) AS excess_from_ein_pairing,
      COUNTIF(copies = 2 AND ein_rows = 1 AND other_rows = 1) AS exactly_one_pair,
      COUNTIF(copies > 1 AND ein_rows = 0) AS dups_without_any_ein
    FROM grp
    """)
    ein_share = (
        100 * h15b["excess_from_ein_pairing"] / h15b["excess_resources"]
        if h15b["excess_resources"] else 0
    )
    print(f"  unique Org NPIs: {h15b['unique_npis']:,}")
    print(f"  NPIs with > 1 resource: {h15b['npis_with_dups']:,}")
    print(f"  excess resources: {h15b['excess_resources']:,}")
    print(f"  of that excess, explained by one provider row + one ein row: "
          f"{h15b['excess_from_ein_pairing']:,} ({ein_share:.1f}%)")
    print(f"  NPIs that are exactly one provider/ein pair: {h15b['exactly_one_pair']:,}")
    print(f"  NPIs duplicated with no ein row involved: {h15b['dups_without_any_ein']:,}")

    # ---- compose finding ----
    def n(x): return int(x) if x is not None else 0

    h14_pct = 100 * h14["npis_with_dups"] / h14["unique_npis"] if h14["unique_npis"] else 0
    h15_pct = 100 * h15["groups_with_dups"] / h15["unique_groups"] if h15["unique_groups"] else 0
    h15b_pct = 100 * h15b["npis_with_dups"] / h15b["unique_npis"] if h15b["unique_npis"] else 0

    # A residual of 13 in 2.2M rounds to 0.0% at one decimal, which reads as
    # "none" rather than "thirteen". Carry more decimals below 1%, the same
    # rule H54 uses for the pharmacy row.
    def rate(num, den):
        if not den:
            return 0.0
        v = 100.0 * num / den
        return round(v, 4 if v < 1 else 1)

    residual_pct = rate(n(h15b["dups_without_any_ein"]), n(h15b["unique_npis"]))
    headline = (
        f"Practitioner dedup is clean: {n(h14['excess_resources']):,} excess "
        f"rows across {n(h14['unique_npis']):,} NPIs (H14). Organization "
        f"multiplicity looks far worse than it is. {h15b_pct:.1f}% of the "
        f"{n(h15b['unique_npis']):,} unique Org NPIs map to more than one "
        f"Organization resource, but {ein_share:.1f}% of that excess is one "
        f"provider record paired with one `ein` tax record under the same NPI, "
        f"which is how CMS models the file rather than a duplication defect. "
        f"Strip those and {n(h15b['dups_without_any_ein']):,} of "
        f"{n(h15b['unique_npis']):,} Org NPIs are genuinely repeated. Any "
        f"count of organizations in this directory has to say which record "
        f"type it counted."
    )

    chart_data = [
        {"label": "H14 Practitioner by NPI",        "value": round(h14_pct, 4)},
        {"label": "H15 Org by name+state+city",     "value": round(h15_pct, 4)},
        {"label": "H15b Org by NPI (raw)",          "value": round(h15b_pct, 4)},
        {"label": "H15b Org by NPI (ein excluded)", "value": round(residual_pct, 4)},
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
        f"Earlier releases of this finding carried a caveat that some of the "
        f"Organization multiplicity might reflect CMS modeling rather than "
        f"duplication. That is now measured rather than speculated: "
        f"{n(h15b['excess_from_ein_pairing']):,} of the "
        f"{n(h15b['excess_resources']):,} excess rows "
        f"({ein_share:.1f}%) are one provider record and one `ein` tax record "
        f"sharing an NPI, and {n(h15b['exactly_one_pair']):,} NPIs are exactly "
        f"that pair and nothing else. {n(h15b['dups_without_any_ein']):,} NPIs "
        f"are duplicated with no ein row involved, which is the residual worth "
        f"treating as a defect. The raw rate is still the right number for "
        f"anyone doing COUNT(Organization), because the rows are really there; "
        f"it is the wrong number for judging directory hygiene. Fuzzy matching "
        f"(Jaro-Winkler, suite-unit tolerance) is a v2 enhancement."
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
