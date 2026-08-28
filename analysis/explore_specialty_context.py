"""Does the NDH carry specialty scoped to where a practitioner works?

WHY THIS IS EXPLORATORY AND NOT A FINDING

The question came from the CMS NDH community Slack: whether taxonomy can
attach to the provider-location-organization relationship rather than to one
provider-level "primary". Every AINPI finding registers its hypothesis before
the numbers exist. This ran the other way round, so it is published as
exploratory, the same call made for the credential-to-taxonomy analysis in
`analysis/explore_credential_taxonomy.py`.

WHAT IT MEASURES

FHIR already models the thing being asked for. `PractitionerRole.specialty` is
scoped to one practitioner at one organization, and its cardinality is 0..*, so
a practitioner can legitimately carry different specialties at different places
and more than one at the same place. Three questions follow, and none of them
had been measured:

  1. How common is multi-specialty in the first place (NPPES, 15 slots)?
  2. Does the NDH populate the role-scoped field at all?
  3. Where it is populated, does the specialty actually vary by organization?

READ THE RAW RESOURCE, NOT OUR OWN FLATTENED COLUMN

`practitioner_role._specialty_code` keeps the first specialty only. 421,613
role rows carry two or more, up to 17. Measured through the flattened column
the varies-by-organization count is 52,898; measured against the stored
`resource` JSON it is 89,061. The flattened column understates it by 40%.

The script computes both so the difference is attributable to the column rather
than to the query, and so a reader can see which number is current.

POSITIVE CONTROLS

Every number here can go to zero silently if a field moves or a table is empty,
which is the failure shape this project keeps hitting. Three controls run
before anything is written:

  * the raw specialty array must still contain multi-entry rows, which proves
    the JSON path is reading what it claims to read
  * the role row count must be within 5% of the pinned release, so a partial
    load or a wrong release cannot publish plausible-looking output
  * no query may return an empty result

Cost: four capped BigQuery queries, two of which scan the practitioner_role
resource JSON. Under a dime.

Usage:
    python analysis/explore_specialty_context.py

Output:
    frontend/public/api/v1/exploratory/specialty-context.json
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from analysis.claims_sources._cohorts import bq_job_config  # noqa: E402
from analysis.release import CURRENT_RELEASE as RELEASE  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "exploratory"

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
METHODOLOGY = "0.7.2-draft"

# Role rows in the pinned release. The control below fails the run if the table
# has drifted from this by more than 5%, which catches a partial load and a
# release bump nobody updated this script for.
EXPECTED_ROLE_ROWS = 16_545_158
ROLE_ROW_TOLERANCE = 0.05

# NPPES stores 15 (taxonomy, primary switch) pairs per NPI. Entity type 1 is an
# individual; organizations carry taxonomies too and are a different question.
NPPES_SQL = """
WITH slots AS (
  SELECT
    (SELECT COUNT(*) FROM UNNEST([{tax}]) c
     WHERE c IS NOT NULL AND TRIM(c) != "") AS n_tax,
    (SELECT COUNTIF(UPPER(TRIM(s)) = "Y") FROM UNNEST([{sw}]) s) AS n_primary
  FROM `bigquery-public-data.nppes.npi_raw`
  WHERE entity_type_code = 1
)
SELECT
  COUNT(*) AS individual_npis,
  COUNTIF(n_tax >= 2) AS with_2plus_taxonomies,
  COUNTIF(n_tax >= 3) AS with_3plus_taxonomies,
  MAX(n_tax) AS max_taxonomies,
  COUNTIF(n_primary = 0) AS no_primary_flagged,
  COUNTIF(n_primary > 1) AS multiple_primaries_flagged
FROM slots
""".format(
    tax=", ".join(f"healthcare_provider_taxonomy_code_{i}" for i in range(1, 16)),
    sw=", ".join(f"healthcare_provider_primary_taxonomy_switch_{i}"
                 for i in range(1, 16)),
)

# Cardinality of the specialty element as stored, plus the denominators every
# percentage on this page divides by.
PRESENCE_SQL = f"""
SELECT
  COUNT(*) AS role_rows,
  COUNTIF(JSON_EXTRACT_ARRAY(resource, "$.specialty") IS NULL)
    AS rows_with_no_specialty,
  COUNTIF(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(resource, "$.specialty")) = 1)
    AS rows_with_one_specialty,
  COUNTIF(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(resource, "$.specialty")) >= 2)
    AS rows_with_2plus_specialties,
  MAX(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(resource, "$.specialty")))
    AS max_specialty_entries,
  (SELECT COUNT(*) FROM `{PROJECT}.{DATASET}.practitioner` WHERE _active)
    AS active_practitioners,
  COUNT(DISTINCT IF(_active AND _practitioner_id IS NOT NULL,
                    _practitioner_id, NULL)) AS practitioners_with_active_role
FROM `{PROJECT}.{DATASET}.practitioner_role`
"""

# The funnel. `spec_source` swaps the flattened column for the raw array so the
# same logic produces both numbers and the difference is attributable to the
# column rather than to the query.
FUNNEL_SQL = """
WITH r AS (
  SELECT DISTINCT pid, org, spec FROM ({source})
),
by_org AS (
  SELECT pid, org,
         COUNT(DISTINCT spec) AS specs_here,
         STRING_AGG(DISTINCT spec ORDER BY spec) AS spec_set
  FROM r GROUP BY pid, org
),
per_pract AS (
  SELECT pid,
         COUNT(*) AS n_orgs,
         COUNT(DISTINCT spec_set) AS distinct_sets,
         MAX(specs_here) AS max_specs_one_org
  FROM by_org GROUP BY pid
),
specs AS (SELECT pid, COUNT(DISTINCT spec) AS n_specs FROM r GROUP BY pid)
SELECT
  COUNT(*) AS practitioners,
  COUNTIF(p.n_orgs >= 2) AS at_2plus_orgs,
  COUNTIF(s.n_specs >= 2) AS carry_2plus_specialties,
  COUNTIF(p.max_specs_one_org >= 2) AS multi_specialty_at_one_org,
  MAX(p.max_specs_one_org) AS max_specialties_at_one_org,
  COUNTIF(p.n_orgs >= 2 AND p.distinct_sets >= 2) AS specialty_varies_by_org,
  COUNTIF(p.n_orgs >= 2 AND p.distinct_sets = 1) AS same_specialty_everywhere
FROM per_pract p JOIN specs s USING (pid)
"""

RAW_SOURCE = f"""
  SELECT pr._practitioner_id AS pid, pr._org_id AS org,
         JSON_EXTRACT_SCALAR(s, "$.coding[0].code") AS spec
  FROM `{PROJECT}.{DATASET}.practitioner_role` pr,
       UNNEST(JSON_EXTRACT_ARRAY(pr.resource, "$.specialty")) s
  WHERE pr._active AND pr._practitioner_id IS NOT NULL
    AND pr._org_id IS NOT NULL
    AND JSON_EXTRACT_SCALAR(s, "$.coding[0].code") IS NOT NULL
"""

FLATTENED_SOURCE = f"""
  SELECT pr._practitioner_id AS pid, pr._org_id AS org,
         pr._specialty_code AS spec
  FROM `{PROJECT}.{DATASET}.practitioner_role` pr
  WHERE pr._active AND pr._practitioner_id IS NOT NULL
    AND pr._org_id IS NOT NULL AND pr._specialty_code IS NOT NULL
"""


# The directory publishes more than one Organization record for the same
# organization, so "two different organizations" by reference id is not the
# same claim as by name. This merges same-named organizations for one
# practitioner and re-asks the question. The stricter number is the one to
# quote outward.
SAME_NAME_SQL = f"""
WITH r AS (
  SELECT DISTINCT pr._practitioner_id AS pid, pr._org_id AS org,
         JSON_EXTRACT_SCALAR(s, "$.coding[0].code") AS spec
  FROM `{PROJECT}.{DATASET}.practitioner_role` pr,
       UNNEST(JSON_EXTRACT_ARRAY(pr.resource, "$.specialty")) s
  WHERE pr._active AND pr._practitioner_id IS NOT NULL
    AND pr._org_id IS NOT NULL
    AND JSON_EXTRACT_SCALAR(s, "$.coding[0].code") IS NOT NULL
),
named AS (
  SELECT r.pid, r.org, COALESCE(o._name, r.org) AS org_name, r.spec
  FROM r LEFT JOIN `{PROJECT}.{DATASET}.organization` o
    ON r.org = CONCAT("Organization/", o._id)
),
by_id AS (
  SELECT pid, org, STRING_AGG(DISTINCT spec ORDER BY spec) AS ss
  FROM named GROUP BY pid, org
),
by_name AS (
  SELECT pid, org_name, STRING_AGG(DISTINCT spec ORDER BY spec) AS ss
  FROM named GROUP BY pid, org_name
),
per_id AS (
  SELECT pid, COUNT(DISTINCT org) AS n, COUNT(DISTINCT ss) AS sets
  FROM by_id GROUP BY pid
),
per_name AS (
  SELECT pid, COUNT(DISTINCT org_name) AS n, COUNT(DISTINCT ss) AS sets
  FROM by_name GROUP BY pid
)
SELECT
  COUNTIF(i.n >= 2 AND i.sets >= 2) AS varies_by_org_record,
  COUNTIF(m.n >= 2 AND m.sets >= 2) AS varies_by_distinct_org_name,
  COUNTIF(i.n >= 2 AND i.sets >= 2 AND NOT (m.n >= 2 AND m.sets >= 2))
    AS only_across_same_named_records
FROM per_id i JOIN per_name m USING (pid)
"""


# Worked examples for the browsable page. Sampled by hash of the practitioner
# id rather than by NPI order, because NPI order is issue order and would show
# a page of long-enrolled providers. Deterministic, so the same cases come back
# on every run and a reader can cite one.
# Cases cited outside this repo. A sampled payload can drop any given row on
# the next run, which would leave a citation pointing at nothing. These are
# always published in addition to the sample.
PINNED_NPIS = [
    "1871883355",  # AZ: Hospitalist + Internal Medicine at one group,
                   # Internal Medicine at two others
    "1821108309",  # WA: Surgery at one site, Surgery + Urology at another
    "1902010168",  # NC: CRNA at a hospital, CRNA + RN at an anesthesia group
]

EXAMPLES_SQL = f"""
WITH r AS (
  SELECT DISTINCT pr._practitioner_id AS pid, pr._org_id AS org,
         JSON_EXTRACT_SCALAR(s, "$.coding[0].code") AS code,
         COALESCE(JSON_EXTRACT_SCALAR(s, "$.coding[0].display"),
                  JSON_EXTRACT_SCALAR(s, "$.coding[0].code")) AS spec
  FROM `{PROJECT}.{DATASET}.practitioner_role` pr,
       UNNEST(JSON_EXTRACT_ARRAY(pr.resource, "$.specialty")) s
  WHERE pr._active AND pr._practitioner_id IS NOT NULL
    AND pr._org_id IS NOT NULL
    AND JSON_EXTRACT_SCALAR(s, "$.coding[0].code") IS NOT NULL
),
by_org AS (
  SELECT pid, org,
         ARRAY_AGG(DISTINCT spec ORDER BY spec) AS specialties,
         STRING_AGG(DISTINCT code ORDER BY code) AS spec_set
  FROM r GROUP BY pid, org
),
varies AS (
  SELECT pid FROM by_org
  GROUP BY pid
  HAVING COUNT(*) BETWEEN 2 AND 8 AND COUNT(DISTINCT spec_set) >= 2
),
sampled AS (
  SELECT pid FROM varies ORDER BY FARM_FINGERPRINT(pid) LIMIT @n
),
pinned AS (
  SELECT v.pid FROM varies v
  JOIN `{PROJECT}.{DATASET}.practitioner` pp
    ON v.pid = CONCAT("Practitioner/", pp._id)
  WHERE pp._npi IN UNNEST(@pinned)
),
sample AS (
  SELECT pid FROM sampled
  UNION DISTINCT
  SELECT pid FROM pinned
)
SELECT p._npi AS npi, p._family_name AS family, p._given_name AS given,
       p._state AS state, o._name AS org_name, o._npi AS org_npi,
       b.specialties
FROM by_org b
JOIN sample USING (pid)
JOIN `{PROJECT}.{DATASET}.practitioner` p ON b.pid = CONCAT("Practitioner/", p._id)
LEFT JOIN `{PROJECT}.{DATASET}.organization` o
  ON b.org = CONCAT("Organization/", o._id)
WHERE p._npi IS NOT NULL
ORDER BY npi, org_name
"""


def run(client, sql: str, label: str) -> dict:
    rows = list(client.query(sql, job_config=bq_job_config()).result())
    if not rows:
        raise SystemExit(f"{label} returned no rows; refusing to write")
    return dict(rows[0])


def run_rows(client, sql: str, label: str, n: int) -> list[dict]:
    from google.cloud import bigquery
    cfg = bq_job_config()
    cfg.query_parameters = [
        bigquery.ScalarQueryParameter("n", "INT64", n),
        bigquery.ArrayQueryParameter("pinned", "STRING", PINNED_NPIS),
    ]
    rows = [dict(r) for r in client.query(sql, job_config=cfg).result()]
    if not rows:
        raise SystemExit(f"{label} returned no rows; refusing to write")
    return rows


def _commit_sha() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT,
                              capture_output=True, text=True,
                              check=True).stdout.strip()
    except Exception:
        return "pending"


def pct(num: int, den: int) -> float:
    return round(100 * num / den, 1) if den else 0.0


def main() -> int:
    import argparse
    from google.cloud import bigquery

    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--examples", type=int, default=1000,
                    help="worked examples to publish for the browser page")
    args = ap.parse_args()

    client = bigquery.Client(project=PROJECT)

    print(f"Release {RELEASE}")
    print("NPPES taxonomy multiplicity")
    nppes = run(client, NPPES_SQL, "NPPES multiplicity")
    print("Role-level specialty presence")
    presence = run(client, PRESENCE_SQL, "specialty presence")
    print("Context variation, raw resource JSON")
    raw = run(client, FUNNEL_SQL.format(source=RAW_SOURCE), "funnel (raw)")
    print("Same-named organization records, merged")
    same = run(client, SAME_NAME_SQL, "same-name control")
    print("Context variation, flattened column")
    flat = run(client, FUNNEL_SQL.format(source=FLATTENED_SOURCE),
               "funnel (flattened)")

    # Positive controls. Each distinguishes "nothing there" from "not looking".
    if presence["rows_with_2plus_specialties"] <= 0:
        raise SystemExit(
            "control failed: no role carries more than one specialty entry. "
            "Either the specialty element moved or the JSON path is wrong. "
            "Refusing to publish a zero that cannot be told from a miss.")
    drift = abs(presence["role_rows"] - EXPECTED_ROLE_ROWS) / EXPECTED_ROLE_ROWS
    if drift > ROLE_ROW_TOLERANCE:
        raise SystemExit(
            f"control failed: practitioner_role holds "
            f"{presence['role_rows']:,} rows against an expected "
            f"{EXPECTED_ROLE_ROWS:,} for release {RELEASE}. Bump "
            "EXPECTED_ROLE_ROWS in the same commit as a reload.")

    # The stricter of the two counts leads, because "different organizations"
    # is read by everyone as differently-named ones.
    strict = same["varies_by_distinct_org_name"]
    headline = (
        f"{strict:,} practitioners carry a different specialty at "
        f"differently-named organizations, out of {raw['at_2plus_orgs']:,} the "
        f"directory places at two or more "
        f"({pct(strict, raw['at_2plus_orgs'])}%). Counting organization "
        f"records instead of names, which the directory duplicates, it is "
        f"{raw['specialty_varies_by_org']:,}. The field that carries any of "
        f"this is empty on {presence['rows_with_no_specialty']:,} of "
        f"{presence['role_rows']:,} role records "
        f"({pct(presence['rows_with_no_specialty'], presence['role_rows'])}%)."
    )

    payload = {
        "slug": "specialty-context",
        "title": "Where the NDH puts specialty, and how often it is empty",
        "status": "exploratory",
        "not_preregistered": (
            "The question came from the CMS NDH community Slack and this "
            "analysis followed it. AINPI findings register a hypothesis "
            "before the numbers exist; this did not, so it is published as "
            "exploratory rather than as a finding."
        ),
        "release_date": RELEASE,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "methodology_version": METHODOLOGY,
        "commit_sha": _commit_sha(),
        "headline": headline,
        "source": {
            "ndh": f"cms_npd.practitioner_role and cms_npd.practitioner, release {RELEASE}",
            "nppes": (
                "bigquery-public-data.nppes.npi_raw, a static snapshot whose "
                "newest enumeration is 2026-02-07. Used here for the shape of "
                "taxonomy multiplicity rather than for currency."
            ),
            "compute": "analysis/explore_specialty_context.py",
        },
        "nppes_multiplicity": {
            "individual_npis": nppes["individual_npis"],
            "with_2plus_taxonomies": nppes["with_2plus_taxonomies"],
            "with_2plus_pct": pct(nppes["with_2plus_taxonomies"],
                                  nppes["individual_npis"]),
            "with_3plus_taxonomies": nppes["with_3plus_taxonomies"],
            "max_taxonomies": nppes["max_taxonomies"],
            "npis_with_no_primary_flagged": nppes["no_primary_flagged"],
            "npis_with_multiple_primaries_flagged":
                nppes["multiple_primaries_flagged"],
        },
        "role_specialty_presence": {
            "role_rows": presence["role_rows"],
            "rows_with_no_specialty": presence["rows_with_no_specialty"],
            "rows_with_no_specialty_pct": pct(presence["rows_with_no_specialty"],
                                              presence["role_rows"]),
            "rows_with_one_specialty": presence["rows_with_one_specialty"],
            "rows_with_2plus_specialties": presence["rows_with_2plus_specialties"],
            "max_specialty_entries": presence["max_specialty_entries"],
            "active_practitioners": presence["active_practitioners"],
            "practitioners_with_active_role":
                presence["practitioners_with_active_role"],
            "practitioners_with_role_specialty": raw["practitioners"],
            "practitioners_with_role_specialty_pct":
                pct(raw["practitioners"], presence["active_practitioners"]),
        },
        "context_variation": {
            "denominator": (
                "Practitioners holding at least one active PractitionerRole "
                "that carries both an organization reference and a specialty."
            ),
            "practitioners": raw["practitioners"],
            "at_2plus_orgs": raw["at_2plus_orgs"],
            "carry_2plus_specialties": raw["carry_2plus_specialties"],
            "multi_specialty_at_one_org": raw["multi_specialty_at_one_org"],
            "max_specialties_at_one_org": raw["max_specialties_at_one_org"],
            "specialty_varies_by_org": raw["specialty_varies_by_org"],
            "specialty_varies_by_distinct_org_name":
                same["varies_by_distinct_org_name"],
            "varies_only_across_same_named_records":
                same["only_across_same_named_records"],
            "specialty_varies_by_org_pct": pct(raw["specialty_varies_by_org"],
                                               raw["at_2plus_orgs"]),
            "same_specialty_everywhere": raw["same_specialty_everywhere"],
        },
        "flattened_column_collapse": {
            "what": (
                "practitioner_role._specialty_code keeps the first specialty "
                "entry only. Same queries against that column instead of the "
                "stored resource JSON, so the difference is attributable to "
                "the column. The raw figure is the current one."
            ),
            "varies_by_org_raw": raw["specialty_varies_by_org"],
            "varies_by_org_via_flattened_column":
                flat["specialty_varies_by_org"],
            "understatement_pct": pct(
                raw["specialty_varies_by_org"] - flat["specialty_varies_by_org"],
                raw["specialty_varies_by_org"]),
            "multi_specialty_at_one_org_raw": raw["multi_specialty_at_one_org"],
            "multi_specialty_at_one_org_via_flattened_column":
                flat["multi_specialty_at_one_org"],
        },
        "chart": {
            "type": "bar",
            "unit": "percent",
            "data": [
                {"label": "NPPES NPIs with 2+ taxonomies",
                 "value": pct(nppes["with_2plus_taxonomies"],
                              nppes["individual_npis"])},
                {"label": "Role records carrying a specialty",
                 "value": pct(presence["role_rows"]
                              - presence["rows_with_no_specialty"],
                              presence["role_rows"])},
                {"label": "Active practitioners with a role specialty",
                 "value": pct(raw["practitioners"],
                              presence["active_practitioners"])},
                {"label": "Multi-org practitioners whose specialty varies",
                 "value": pct(raw["specialty_varies_by_org"],
                              raw["at_2plus_orgs"])},
            ],
        },
        "notes": (
            "Read from the stored resource JSON rather than the flattened "
            "_specialty_code column, which keeps the first specialty entry "
            "only. Through that column the varies-by-organization count reads "
            f"{flat['specialty_varies_by_org']:,} instead of "
            f"{raw['specialty_varies_by_org']:,}. Two figures in "
            "npi-taxonomy-correctness.json were computed the same way (H13 "
            "internal through _specialty_code, H13b external through "
            "qualification[0]) and are first-entry measurements until re-run. "
            "Roles with no organization reference are excluded from the "
            "funnel, because whether a specialty varies BY organization is "
            "undefined without one. NPPES multiplicity is measured on entity "
            "type 1 only; organizations carry taxonomies too and are a "
            "different question."
        ),
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "specialty-context.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")

    print(f"Worked examples ({args.examples})")
    rows = run_rows(client, EXAMPLES_SQL, "examples", args.examples)
    cases: dict[str, dict] = {}
    for row in rows:
        case = cases.setdefault(row["npi"], {
            "npi": row["npi"],
            "name": ", ".join(x for x in (row["family"], row["given"]) if x),
            "state": row["state"],
            "orgs": [],
        })
        case["orgs"].append({
            # An organization reference that resolves to nothing is a real
            # state of the directory, so it is labelled rather than dropped.
            "org": row["org_name"] or "(organization not published)",
            # Carried because the directory publishes more than one record
            # for the same organization. Without it, two rows with the same
            # name and different specialties read as a rendering bug.
            "org_npi": row["org_npi"],
            "specialties": list(row["specialties"]),
        })
    examples = {
        "slug": "specialty-by-organization",
        "status": "exploratory",
        "release_date": RELEASE,
        "generated_at": payload["generated_at"],
        "commit_sha": payload["commit_sha"],
        "of": "specialty-context",
        "population": raw["specialty_varies_by_org"],
        # Carried so the page can state the caveat without hardcoding a
        # number that would drift away from the analysis payload.
        "population_distinct_org_name": same["varies_by_distinct_org_name"],
        "only_across_same_named_records": same["only_across_same_named_records"],
        "role_specialty_blank_pct": pct(presence["rows_with_no_specialty"],
                                        presence["role_rows"]),
        "sample_size": len(cases),
        "sampling": (
            "Deterministic hash order over the practitioner id, not NPI order, "
            "because NPI order is issue order and would show a page of "
            "long-enrolled providers. The same cases come back on every run, "
            "so one can be cited. Limited to practitioners at two to eight "
            "organizations so a case fits on a screen."
        ),
        # Pinned first, then by NPI. Sorting purely by NPI put a case whose
        # two organizations share a name at the top of the page, which reads
        # as a rendering bug before a visitor reaches the note explaining it.
        "cases": sorted(
            cases.values(),
            key=lambda c: (PINNED_NPIS.index(c["npi"])
                           if c["npi"] in PINNED_NPIS else len(PINNED_NPIS),
                           c["npi"]),
        ),
    }
    missing = [npi for npi in PINNED_NPIS if npi not in cases]
    if missing:
        raise SystemExit(
            f"control failed: pinned example(s) {missing} no longer appear as "
            "specialty-varies-by-organization cases. They are cited outside "
            "this repo, so fix the citation or update PINNED_NPIS rather than "
            "publishing a payload that cannot back it.")
    examples["pinned"] = PINNED_NPIS

    ex_out = OUT_DIR / "specialty-by-organization.json"
    ex_out.write_text(json.dumps(examples, indent=2) + "\n")
    print(f"Wrote {ex_out} ({len(cases)} cases)")
    print(f"\n{headline}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
