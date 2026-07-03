-- Release census: resource counts per NDH release and the April-to-May shift.
-- Reproduces the release-baseline table in the AINPI repo.
-- Swap the path root for hf://datasets/DATASET_PATH/ to run remotely.

WITH counts AS (
  SELECT '2026-04-09' AS release, 'practitioner' AS tbl, count(*) AS n FROM 'frontend/data/parquet-export/2026-04-09/practitioner.parquet'
  UNION ALL SELECT '2026-05-08', 'practitioner', count(*) FROM 'frontend/data/parquet-export/2026-05-08/practitioner.parquet'
  UNION ALL SELECT '2026-04-09', 'organization', count(*) FROM 'frontend/data/parquet-export/2026-04-09/organization.parquet'
  UNION ALL SELECT '2026-05-08', 'organization', count(*) FROM 'frontend/data/parquet-export/2026-05-08/organization.parquet'
  UNION ALL SELECT '2026-04-09', 'location', count(*) FROM 'frontend/data/parquet-export/2026-04-09/location.parquet'
  UNION ALL SELECT '2026-05-08', 'location', count(*) FROM 'frontend/data/parquet-export/2026-05-08/location.parquet'
  UNION ALL SELECT '2026-04-09', 'endpoint', count(*) FROM 'frontend/data/parquet-export/2026-04-09/endpoint.parquet'
  UNION ALL SELECT '2026-05-08', 'endpoint', count(*) FROM 'frontend/data/parquet-export/2026-05-08/endpoint.parquet'
  UNION ALL SELECT '2026-04-09', 'practitioner_role', count(*) FROM 'frontend/data/parquet-export/2026-04-09/practitioner_role.parquet'
  UNION ALL SELECT '2026-05-08', 'practitioner_role', count(*) FROM 'frontend/data/parquet-export/2026-05-08/practitioner_role.parquet'
  UNION ALL SELECT '2026-04-09', 'organization_affiliation', count(*) FROM 'frontend/data/parquet-export/2026-04-09/organization_affiliation.parquet'
  UNION ALL SELECT '2026-05-08', 'organization_affiliation', count(*) FROM 'frontend/data/parquet-export/2026-05-08/organization_affiliation.parquet'
)
SELECT
  tbl,
  max(CASE WHEN release = '2026-04-09' THEN n END) AS april,
  max(CASE WHEN release = '2026-05-08' THEN n END) AS may,
  round(100.0 * (may - april) / april, 1) AS pct_change
FROM counts
GROUP BY tbl
ORDER BY april DESC;
