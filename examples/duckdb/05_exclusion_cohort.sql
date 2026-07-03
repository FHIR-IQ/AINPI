-- The high-risk cohort: LEIE + SAM + NPPES cross-checks per NPI
-- (reproduces AINPI H23/H24/H25 signals).
-- REMINDER: signals are data-quality flags, not investigative findings.
-- Verify any row against the primary sources before acting on it.

SELECT
  bucket,
  count(*) AS npis,
  count(*) FILTER (WHERE reasons LIKE '%oig_excluded%')      AS leie,
  count(*) FILTER (WHERE reasons LIKE '%sam_excluded%')      AS sam,
  count(*) FILTER (WHERE reasons LIKE '%nppes_deactivated%') AS nppes_deactivated,
  count(*) FILTER (WHERE reasons LIKE '%not_in_nppes%')      AS not_in_nppes
FROM 'frontend/data/parquet-export/exclusions/high_risk_cohort.parquet'
GROUP BY bucket
ORDER BY npis DESC;
