-- Organization NPI multiplication (reproduces AINPI H14/H15).
-- Practitioners dedupe cleanly; organizations multiply: ~70.6% of org NPIs
-- map to more than one Organization resource in the 2026-05-08 release.

WITH per_npi AS (
  SELECT _npi, count(*) AS resources
  FROM 'frontend/data/parquet-export/2026-05-08/organization.parquet'
  WHERE _npi IS NOT NULL
  GROUP BY _npi
)
SELECT
  count(*) AS unique_org_npis,
  count(*) FILTER (WHERE resources > 1) AS npis_with_multiple_resources,
  round(100.0 * count(*) FILTER (WHERE resources > 1) / count(*), 1) AS pct_multiplied,
  sum(resources) - count(*) AS excess_rows,
  max(resources) AS max_resources_per_npi
FROM per_npi;
