"""Build cms_npd.phones_per_practitioner — per-release helper table.

Pre-extracts and normalizes phone numbers for every active practitioner
across all three FHIR resolution paths:

  1. Practitioner.telecom            (source = 'P')
  2. PractitionerRole.telecom        (source = 'R')
  3. Location.telecom via            (source = 'L')
     PractitionerRole.location -> Location

The output is a single thin row per practitioner per NDH release with
the four resulting normalized-phone arrays. Once this exists, every
downstream phone-related finding (H43 path-combo Venn, H44 phone-value
agreement, future H45 phone-churn diff-since-last-release) can be a
sub-second GROUP BY on a small clustered table rather than a fresh full
extraction across three big resource tables.

Cost: ~21 GB scanned per release run (~$0.10 at $5/TB). Capped at
100 GB via bq_job_config(). Run once per NDH release; idempotent within
a release (DELETEs and re-INSERTs the matching partition).

Schema:

    release_date DATE                  -- partition key
    practitioner_id STRING             -- cluster key; matches Practitioner._id
    npi STRING                         -- 10-digit NPI when present on the
                                       --   Practitioner record
    state STRING                       -- UPPER(Practitioner._state)
    phones ARRAY<STRING>               -- normalized union across all 3 paths
    phones_p ARRAY<STRING>             -- normalized phones from Practitioner.telecom
    phones_r ARRAY<STRING>             -- normalized phones from PractitionerRole.telecom
    phones_l ARRAY<STRING>             -- normalized phones from traversed
                                       --   Location.telecom
    invalid_dropped INT64              -- count of telecom values that failed
                                       --   normalization (caught garbage)

Normalization rules (encoded in SQL):

  1. Strip every non-digit character.
  2. Drop a leading '1' if the result is 11 digits (US country code).
  3. Reject anything that isn't exactly 10 digits after that.

The dropped-as-invalid count is its own data-quality signal — e.g. a
spike in invalid_dropped across releases is evidence that an upstream
source started feeding malformed values.

Usage:

    # Run against the current ingested release (default 2026-05-08):
    python analysis/build_phones_per_practitioner.py

    # Re-run for a specific release (idempotent):
    python analysis/build_phones_per_practitioner.py --release 2026-04-09

    # Print the rendered SQL without running it:
    python analysis/build_phones_per_practitioner.py --print-sql
"""
from __future__ import annotations

import argparse
import sys

from google.cloud import bigquery

# analysis/ is on sys.path[0] when run as a top-level script.
from claims_sources._cohorts import bq_job_config

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
HELPER_TABLE = "phones_per_practitioner"
DEFAULT_RELEASE = "2026-05-08"

# DDL — idempotent. Partitioned by release_date so per-release re-runs are a
# DELETE + INSERT on one partition; clustered by practitioner_id so downstream
# joins by NPI/practitioner_id are cheap.
DDL_SQL = f"""
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.{HELPER_TABLE}` (
  release_date DATE NOT NULL,
  practitioner_id STRING NOT NULL,
  npi STRING,
  state STRING,
  phones ARRAY<STRING>,
  phones_p ARRAY<STRING>,
  phones_r ARRAY<STRING>,
  phones_l ARRAY<STRING>,
  invalid_dropped INT64
)
PARTITION BY release_date
CLUSTER BY practitioner_id
OPTIONS (
  description = 'AINPI helper: normalized phones per practitioner per NDH release. Substrate for H43 / H44 / H45 phone-related findings. Rebuilt by analysis/build_phones_per_practitioner.py.'
)
"""


def build_insert_sql(release_date: str) -> str:
    """Render the DELETE-then-INSERT body for one release partition.

    Two consecutive statements separated by a semicolon; BigQuery runs them
    as a multi-statement script in one job, which keeps the DELETE and INSERT
    atomic for the calling release (other releases stay untouched).
    """
    return f"""
DELETE FROM `{PROJECT}.{DATASET}.{HELPER_TABLE}`
WHERE release_date = DATE('{release_date}');

INSERT INTO `{PROJECT}.{DATASET}.{HELPER_TABLE}` (
  release_date, practitioner_id, npi, state,
  phones, phones_p, phones_r, phones_l, invalid_dropped
)
WITH
-- Path 1 — direct on the Practitioner record.
p_phones AS (
  SELECT
    p._id   AS practitioner_id,
    p._npi  AS npi,
    UPPER(p._state) AS state,
    'P' AS source,
    JSON_VALUE(t, '$.value') AS phone_raw
  FROM `{PROJECT}.{DATASET}.practitioner` p,
       UNNEST(JSON_QUERY_ARRAY(p.resource, '$.telecom')) AS t
  WHERE p._active = TRUE
    AND JSON_VALUE(t, '$.system') = 'phone'
),
-- Path 2 — direct on the PractitionerRole record. Active roles only.
r_phones AS (
  SELECT
    REPLACE(pr._practitioner_id, 'Practitioner/', '') AS practitioner_id,
    CAST(NULL AS STRING) AS npi,
    CAST(NULL AS STRING) AS state,
    'R' AS source,
    JSON_VALUE(t, '$.value') AS phone_raw
  FROM `{PROJECT}.{DATASET}.practitioner_role` pr,
       UNNEST(JSON_QUERY_ARRAY(pr.resource, '$.telecom')) AS t
  WHERE pr._active = TRUE
    AND pr._practitioner_id IS NOT NULL
    AND JSON_VALUE(t, '$.system') = 'phone'
),
-- Path 3 — traverse PractitionerRole.location -> Location.telecom.
-- Active roles only; _location_ids is a pipe-joined list of "Location/<id>"
-- reference strings written by analysis/fast_ingest_ndh.py.
role_loc AS (
  SELECT
    REPLACE(pr._practitioner_id, 'Practitioner/', '') AS practitioner_id,
    REPLACE(loc_ref, 'Location/', '') AS loc_id
  FROM `{PROJECT}.{DATASET}.practitioner_role` pr
  CROSS JOIN UNNEST(SPLIT(pr._location_ids, '|')) AS loc_ref
  WHERE pr._active = TRUE
    AND pr._practitioner_id IS NOT NULL
    AND pr._location_ids IS NOT NULL
    AND loc_ref != ''
),
l_phones AS (
  SELECT
    rl.practitioner_id,
    CAST(NULL AS STRING) AS npi,
    CAST(NULL AS STRING) AS state,
    'L' AS source,
    JSON_VALUE(t, '$.value') AS phone_raw
  FROM role_loc rl
  JOIN `{PROJECT}.{DATASET}.location` l ON l._id = rl.loc_id
  CROSS JOIN UNNEST(JSON_QUERY_ARRAY(l.resource, '$.telecom')) AS t
  WHERE JSON_VALUE(t, '$.system') = 'phone'
),
all_phones AS (
  SELECT * FROM p_phones
  UNION ALL SELECT * FROM r_phones
  UNION ALL SELECT * FROM l_phones
),
-- Normalize: strip non-digits, drop leading '1' if 11 digits, require
-- exactly 10 digits. Anything else collapses to NULL and contributes to
-- invalid_dropped instead of phones.
normalized AS (
  SELECT
    practitioner_id,
    npi,
    state,
    source,
    phone_raw,
    REGEXP_EXTRACT(
      REGEXP_REPLACE(phone_raw, r'\\D', ''),
      r'^1?(\\d{{10}})$'
    ) AS phone_norm
  FROM all_phones
)
SELECT
  DATE('{release_date}') AS release_date,
  practitioner_id,
  -- ANY_VALUE already returns a non-NULL value when any non-NULL exists, so
  -- no IGNORE NULLS clause (BigQuery rejects it on ANY_VALUE).
  ANY_VALUE(npi)                                                                    AS npi,
  ANY_VALUE(state)                                                                  AS state,
  ARRAY_AGG(DISTINCT phone_norm IGNORE NULLS)                                       AS phones,
  ARRAY_AGG(DISTINCT IF(source = 'P', phone_norm, NULL) IGNORE NULLS)               AS phones_p,
  ARRAY_AGG(DISTINCT IF(source = 'R', phone_norm, NULL) IGNORE NULLS)               AS phones_r,
  ARRAY_AGG(DISTINCT IF(source = 'L', phone_norm, NULL) IGNORE NULLS)               AS phones_l,
  COUNTIF(phone_norm IS NULL AND phone_raw IS NOT NULL)                             AS invalid_dropped
FROM normalized
WHERE practitioner_id IS NOT NULL
GROUP BY practitioner_id
"""


# Quick verification SQL — counts the resulting partition + a small sample.
VERIFY_SQL_TEMPLATE = f"""
SELECT
  COUNT(*) AS rows_written,
  COUNTIF(ARRAY_LENGTH(phones)   > 0) AS with_any_phone,
  COUNTIF(ARRAY_LENGTH(phones_p) > 0) AS with_p,
  COUNTIF(ARRAY_LENGTH(phones_r) > 0) AS with_r,
  COUNTIF(ARRAY_LENGTH(phones_l) > 0) AS with_l,
  SUM(invalid_dropped)                 AS total_invalid_dropped
FROM `{PROJECT}.{DATASET}.{HELPER_TABLE}`
WHERE release_date = DATE('@release_date')
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--release",
        default=DEFAULT_RELEASE,
        help=f"NDH release date YYYY-MM-DD to build the partition for (default: {DEFAULT_RELEASE})",
    )
    parser.add_argument(
        "--print-sql",
        action="store_true",
        help="Print the rendered SQL without executing it. Useful for local SQL review.",
    )
    args = parser.parse_args()

    release = args.release
    if args.print_sql:
        print("-- DDL --")
        print(DDL_SQL)
        print("-- INSERT (release =", release, ") --")
        print(build_insert_sql(release))
        return 0

    client = bigquery.Client(project=PROJECT)

    # Step 1 — ensure the helper table exists. DDL is free; no scan.
    print(f"Ensuring helper table `{HELPER_TABLE}` exists...")
    client.query(DDL_SQL, job_config=bq_job_config()).result()
    print("  OK")

    # Step 2 — DELETE + INSERT the partition for this release. Capped at 100 GB
    # by bq_job_config(); the rendered scan is ~21 GB so well within budget.
    print(f"Rebuilding {release} partition...")
    job = client.query(build_insert_sql(release), job_config=bq_job_config())
    job.result()
    print(f"  bytes processed: {(job.total_bytes_processed or 0) / 1e9:.2f} GB")
    print(f"  bytes billed:    {(job.total_bytes_billed or 0) / 1e9:.2f} GB")

    # Step 3 — verify the partition. Cheap (~few MB scan against the clustered
    # partition we just wrote).
    verify_sql = VERIFY_SQL_TEMPLATE.replace("@release_date", release)
    rows = list(client.query(verify_sql, job_config=bq_job_config()).result())
    if not rows:
        print("VERIFY: 0 rows in the new partition; build may have silently no-op'd")
        return 2
    r = rows[0]
    print()
    print(f"=== {HELPER_TABLE} @ {release} ===")
    print(f"  rows_written:         {r.rows_written:,}")
    print(f"  with any phone:       {r.with_any_phone:,}")
    print(f"  with P-path phone:    {r.with_p:,}")
    print(f"  with R-path phone:    {r.with_r:,}")
    print(f"  with L-path phone:    {r.with_l:,}")
    print(f"  total invalid dropped:{r.total_invalid_dropped:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
