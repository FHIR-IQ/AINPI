-- Endpoint connection-type split (reproduces AINPI H28).
-- Only ~8.4% of Endpoint records are FHIR REST URLs an integrator can GET;
-- the rest are Direct Trust HISP messaging addresses.

SELECT
  _connection_type,
  count(*) AS records,
  round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM 'frontend/data/parquet-export/2026-05-08/endpoint.parquet'
GROUP BY _connection_type
ORDER BY records DESC;
