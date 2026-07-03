-- Practitioner telecom channels (reproduces the AINPI H43 per-system counts).
-- 99.98% of active practitioners carry a phone directly on the record;
-- fax is on ~40%; email and url are exactly zero.

SELECT
  count(*) AS active_practitioners,
  count(*) FILTER (WHERE json_extract_string(resource, '$.telecom') LIKE '%"phone"%') AS with_phone,
  count(*) FILTER (WHERE json_extract_string(resource, '$.telecom') LIKE '%"fax"%')   AS with_fax,
  count(*) FILTER (WHERE json_extract_string(resource, '$.telecom') LIKE '%"email"%') AS with_email,
  count(*) FILTER (WHERE json_extract_string(resource, '$.telecom') LIKE '%"url"%')   AS with_url
FROM 'frontend/data/parquet-export/2026-05-08/practitioner.parquet'
WHERE _active;
