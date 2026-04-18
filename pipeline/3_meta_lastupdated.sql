-- Stage 3 — Temporal analysis: meta.lastUpdated CDF
--
-- H18: what fraction of each resource type is within the regulatory
-- freshness thresholds?
--
--   30-day  — CMS-9115-F standard
--   90-day  — REAL Health Providers Act + No Surprises Act standard
--   365-day — stale
--   > 365-day — very stale
--
-- Output: out/meta_lastupdated.parquet
-- Also emits a summary table to stdout for the finding headline.
--
-- Run: duckdb -c ".read 3_meta_lastupdated.sql"

SET VARIABLE shards_glob = 'out/shards/*.parquet';
-- Release date of the NPD artifact we're measuring against.
-- Override at the command line: duckdb -c "SET VARIABLE release_date = '2026-04-09'; .read 3_meta_lastupdated.sql"
SET VARIABLE release_date = '2026-04-09';

COPY (
  WITH parsed AS (
    SELECT
      id AS resource_id,
      resource_type,
      TRY_CAST(meta_last_updated AS TIMESTAMP) AS last_updated_ts,
      DATE_DIFF(
        'day',
        TRY_CAST(meta_last_updated AS TIMESTAMP),
        TRY_CAST(getvariable('release_date') AS TIMESTAMP)
      ) AS age_days
    FROM read_parquet(getvariable('shards_glob'))
  )
  SELECT
    resource_id,
    resource_type,
    last_updated_ts,
    age_days,
    CASE
      WHEN age_days IS NULL THEN 'UNKNOWN'
      WHEN age_days <= 30 THEN 'FRESH_30D'
      WHEN age_days <= 90 THEN 'FRESH_90D'
      WHEN age_days <= 365 THEN 'STALE'
      ELSE 'VERY_STALE'
    END AS freshness_bucket
  FROM parsed
) TO 'out/meta_lastupdated.parquet' (FORMAT PARQUET, COMPRESSION 'zstd');

-- Headline summary: freshness distribution by resource type
SELECT
  resource_type,
  COUNT(*) AS total,
  SUM(CASE WHEN freshness_bucket = 'FRESH_30D'  THEN 1 ELSE 0 END) AS fresh_30d,
  SUM(CASE WHEN freshness_bucket = 'FRESH_90D'  THEN 1 ELSE 0 END) AS fresh_90d,
  SUM(CASE WHEN freshness_bucket = 'STALE'      THEN 1 ELSE 0 END) AS stale,
  SUM(CASE WHEN freshness_bucket = 'VERY_STALE' THEN 1 ELSE 0 END) AS very_stale,
  SUM(CASE WHEN freshness_bucket = 'UNKNOWN'    THEN 1 ELSE 0 END) AS unknown,
  ROUND(100.0 * SUM(CASE WHEN freshness_bucket IN ('FRESH_30D','FRESH_90D') THEN 1 ELSE 0 END) / COUNT(*), 2)
    AS within_90d_pct
FROM read_parquet('out/meta_lastupdated.parquet')
GROUP BY resource_type
ORDER BY resource_type;

-- CDF: for each 30-day cohort, cumulative share within it
SELECT
  resource_type,
  WIDTH_BUCKET(age_days, 0, 720, 24) * 30 AS age_bucket_days,
  COUNT(*) AS n,
  ROUND(
    100.0 * SUM(COUNT(*)) OVER (PARTITION BY resource_type ORDER BY WIDTH_BUCKET(age_days, 0, 720, 24))
    / SUM(COUNT(*)) OVER (PARTITION BY resource_type),
    2
  ) AS cumulative_pct
FROM read_parquet('out/meta_lastupdated.parquet')
WHERE age_days IS NOT NULL
GROUP BY resource_type, WIDTH_BUCKET(age_days, 0, 720, 24)
ORDER BY resource_type, age_bucket_days;
