-- Stage 1 — Referential-integrity edge extraction
--
-- Streams every FHIR Reference field in the shard Parquets into a single
-- long table so DuckDB can compute dangling-reference / orphan / cycle
-- reports on top of it.
--
-- Schema:
--   source_id       : the Resource.id of the resource emitting the reference
--   source_type     : Practitioner | PractitionerRole | ...
--   ref_path        : dot-path of the reference field (e.g. 'organization')
--   target_type     : FHIR resource type expected at the target
--   target_id       : id portion of the Reference string
--                     (e.g. 'Organization-1518732023' from 'Organization/Organization-1518732023')
--   target_ref_str  : the raw Reference.reference string, for debugging
--   target_identifier_system : if Reference.identifier, the system URI
--   target_identifier_value  : if Reference.identifier, the value
--
-- Output: out/edges.parquet
--
-- Run: duckdb -c ".read 1_extract_edges.sql"

-- Where the sharded parquets live
SET VARIABLE shards_glob = 'out/shards/*.parquet';

-- Reusable: parse 'Organization/Organization-1234' -> target_id='Organization-1234'
CREATE OR REPLACE MACRO ref_id(ref_str) AS
  CASE
    WHEN ref_str IS NULL THEN NULL
    WHEN position('/' IN ref_str) > 0
      THEN split_part(ref_str, '/', array_length(string_split(ref_str, '/')))
    ELSE ref_str
  END;

-- Reusable: get the resourceType prefix from a reference string
CREATE OR REPLACE MACRO ref_type(ref_str) AS
  CASE
    WHEN ref_str IS NULL THEN NULL
    WHEN position('/' IN ref_str) > 0
      THEN split_part(ref_str, '/', 1)
    ELSE NULL
  END;

COPY (
  WITH shards AS (
    SELECT id AS source_id, resource_type AS source_type, resource::JSON AS j
    FROM read_parquet(getvariable('shards_glob'))
  ),

  -- PractitionerRole.practitioner (cardinality 0..1)
  prac_prac AS (
    SELECT
      source_id, source_type,
      'practitioner' AS ref_path,
      'Practitioner' AS target_type,
      ref_id(j->>'$.practitioner.reference') AS target_id,
      j->>'$.practitioner.reference' AS target_ref_str,
      j->>'$.practitioner.identifier.system' AS target_identifier_system,
      j->>'$.practitioner.identifier.value' AS target_identifier_value
    FROM shards WHERE source_type = 'PractitionerRole'
  ),

  -- PractitionerRole.organization (0..1)
  prac_org AS (
    SELECT
      source_id, source_type,
      'organization',
      'Organization',
      ref_id(j->>'$.organization.reference'),
      j->>'$.organization.reference',
      j->>'$.organization.identifier.system',
      j->>'$.organization.identifier.value'
    FROM shards WHERE source_type = 'PractitionerRole'
  ),

  -- PractitionerRole.location (0..*)
  prac_loc AS (
    SELECT
      source_id, source_type,
      'location[' || idx || ']',
      'Location',
      ref_id(loc->>'$.reference'),
      loc->>'$.reference',
      loc->>'$.identifier.system',
      loc->>'$.identifier.value'
    FROM (
      SELECT source_id, source_type,
        generate_subscripts(json_extract(j, '$.location'), 1) AS idx,
        json_extract(j, '$.location')[generate_subscripts(json_extract(j, '$.location'), 1)] AS loc
      FROM shards WHERE source_type = 'PractitionerRole'
    )
  ),

  -- PractitionerRole.endpoint (0..*)
  prac_ep AS (
    SELECT
      source_id, source_type,
      'endpoint[' || idx || ']',
      'Endpoint',
      ref_id(ep->>'$.reference'),
      ep->>'$.reference',
      ep->>'$.identifier.system',
      ep->>'$.identifier.value'
    FROM (
      SELECT source_id, source_type,
        generate_subscripts(json_extract(j, '$.endpoint'), 1) AS idx,
        json_extract(j, '$.endpoint')[generate_subscripts(json_extract(j, '$.endpoint'), 1)] AS ep
      FROM shards WHERE source_type = 'PractitionerRole'
    )
  ),

  -- Location.managingOrganization (0..1)
  loc_org AS (
    SELECT
      source_id, source_type,
      'managingOrganization',
      'Organization',
      ref_id(j->>'$.managingOrganization.reference'),
      j->>'$.managingOrganization.reference',
      j->>'$.managingOrganization.identifier.system',
      j->>'$.managingOrganization.identifier.value'
    FROM shards WHERE source_type = 'Location'
  ),

  -- Location.partOf (0..1) — for cycle detection
  loc_partof AS (
    SELECT
      source_id, source_type,
      'partOf',
      'Location',
      ref_id(j->>'$.partOf.reference'),
      j->>'$.partOf.reference',
      NULL, NULL
    FROM shards WHERE source_type = 'Location'
  ),

  -- Organization.partOf (0..1) — for cycle detection
  org_partof AS (
    SELECT
      source_id, source_type,
      'partOf',
      'Organization',
      ref_id(j->>'$.partOf.reference'),
      j->>'$.partOf.reference',
      NULL, NULL
    FROM shards WHERE source_type = 'Organization'
  ),

  -- Endpoint.managingOrganization (0..1)
  ep_org AS (
    SELECT
      source_id, source_type,
      'managingOrganization',
      'Organization',
      ref_id(j->>'$.managingOrganization.reference'),
      j->>'$.managingOrganization.reference',
      j->>'$.managingOrganization.identifier.system',
      j->>'$.managingOrganization.identifier.value'
    FROM shards WHERE source_type = 'Endpoint'
  ),

  -- OrganizationAffiliation.organization (0..1)
  oa_org AS (
    SELECT
      source_id, source_type,
      'organization',
      'Organization',
      ref_id(j->>'$.organization.reference'),
      j->>'$.organization.reference',
      j->>'$.organization.identifier.system',
      j->>'$.organization.identifier.value'
    FROM shards WHERE source_type = 'OrganizationAffiliation'
  ),

  -- OrganizationAffiliation.participatingOrganization (0..1)
  oa_part AS (
    SELECT
      source_id, source_type,
      'participatingOrganization',
      'Organization',
      ref_id(j->>'$.participatingOrganization.reference'),
      j->>'$.participatingOrganization.reference',
      NULL, NULL
    FROM shards WHERE source_type = 'OrganizationAffiliation'
  ),

  all_edges AS (
    SELECT * FROM prac_prac
    UNION ALL SELECT * FROM prac_org
    UNION ALL SELECT * FROM prac_loc
    UNION ALL SELECT * FROM prac_ep
    UNION ALL SELECT * FROM loc_org
    UNION ALL SELECT * FROM loc_partof
    UNION ALL SELECT * FROM org_partof
    UNION ALL SELECT * FROM ep_org
    UNION ALL SELECT * FROM oa_org
    UNION ALL SELECT * FROM oa_part
  )

  SELECT *
  FROM all_edges
  WHERE target_id IS NOT NULL OR target_identifier_value IS NOT NULL
) TO 'out/edges.parquet' (FORMAT PARQUET, COMPRESSION 'zstd');

-- Report: dangling reference rate per source_type
SELECT
  e.source_type,
  COUNT(*) AS total_refs,
  SUM(CASE WHEN s.id IS NULL THEN 1 ELSE 0 END) AS dangling_literal_refs,
  ROUND(100.0 * SUM(CASE WHEN s.id IS NULL THEN 1 ELSE 0 END) / COUNT(*), 3)
    AS dangling_pct
FROM read_parquet('out/edges.parquet') e
LEFT JOIN read_parquet(getvariable('shards_glob')) s
  ON s.id = e.target_id AND s.resource_type = e.target_type
WHERE e.target_id IS NOT NULL
GROUP BY e.source_type
ORDER BY dangling_pct DESC;
