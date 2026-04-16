#!/usr/bin/env npx tsx
/**
 * Recreate BigQuery views for new schema (resource JSON + _* flat fields)
 */
import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';
const bigquery = new BigQuery({ projectId: PROJECT_ID });

const views = [
  {
    id: 'v_provider_by_state',
    sql: `
      CREATE OR REPLACE VIEW \`${PROJECT_ID}.${DATASET_ID}.v_provider_by_state\` AS
      SELECT
        _state AS state,
        COUNT(*) AS provider_count,
        COUNTIF(_active = true) AS active_count,
        COUNTIF(_npi IS NOT NULL) AS with_npi_count,
        ROUND(SAFE_DIVIDE(COUNTIF(_npi IS NOT NULL), COUNT(*)) * 100, 2) AS npi_completeness_pct
      FROM \`${PROJECT_ID}.${DATASET_ID}.practitioner\`
      WHERE _state IS NOT NULL
      GROUP BY _state
      ORDER BY provider_count DESC
    `,
  },
  {
    id: 'v_provider_by_specialty',
    sql: `
      CREATE OR REPLACE VIEW \`${PROJECT_ID}.${DATASET_ID}.v_provider_by_specialty\` AS
      SELECT
        _specialty_code AS specialty_code,
        _specialty_display AS specialty_display,
        COUNT(*) AS role_count,
        COUNT(DISTINCT _practitioner_npi) AS unique_providers,
        COUNT(DISTINCT _org_npi) AS unique_orgs
      FROM \`${PROJECT_ID}.${DATASET_ID}.practitioner_role\`
      WHERE _specialty_code IS NOT NULL
      GROUP BY _specialty_code, _specialty_display
      ORDER BY role_count DESC
    `,
  },
  {
    id: 'v_endpoint_by_type',
    sql: `
      CREATE OR REPLACE VIEW \`${PROJECT_ID}.${DATASET_ID}.v_endpoint_by_type\` AS
      SELECT
        _connection_type_code AS connection_type,
        _status AS status,
        COUNT(*) AS endpoint_count,
        COUNT(DISTINCT _managing_org_name) AS unique_orgs
      FROM \`${PROJECT_ID}.${DATASET_ID}.endpoint\`
      GROUP BY _connection_type_code, _status
      ORDER BY endpoint_count DESC
    `,
  },
  {
    id: 'v_org_by_state',
    sql: `
      CREATE OR REPLACE VIEW \`${PROJECT_ID}.${DATASET_ID}.v_org_by_state\` AS
      SELECT
        _state AS state,
        _org_type AS org_type,
        COUNT(*) AS org_count,
        COUNTIF(_active = true) AS active_count,
        COUNTIF(_npi IS NOT NULL) AS with_npi_count
      FROM \`${PROJECT_ID}.${DATASET_ID}.organization\`
      WHERE _state IS NOT NULL
      GROUP BY _state, _org_type
      ORDER BY org_count DESC
    `,
  },
  {
    id: 'v_data_quality_summary',
    sql: `
      CREATE OR REPLACE VIEW \`${PROJECT_ID}.${DATASET_ID}.v_data_quality_summary\` AS
      SELECT
        'practitioner' AS resource_type,
        COUNT(*) AS total_records,
        COUNTIF(_npi IS NOT NULL) AS with_primary_id,
        COUNTIF(_family_name IS NOT NULL) AS with_name,
        COUNTIF(_state IS NOT NULL) AS with_address,
        COUNTIF(_active = true) AS active_records,
        ROUND(SAFE_DIVIDE(COUNTIF(_npi IS NOT NULL), COUNT(*)) * 100, 2) AS id_completeness_pct,
        ROUND(SAFE_DIVIDE(COUNTIF(_family_name IS NOT NULL), COUNT(*)) * 100, 2) AS name_completeness_pct,
        ROUND(SAFE_DIVIDE(COUNTIF(_state IS NOT NULL), COUNT(*)) * 100, 2) AS address_completeness_pct
      FROM \`${PROJECT_ID}.${DATASET_ID}.practitioner\`
      UNION ALL
      SELECT
        'organization',
        COUNT(*),
        COUNTIF(_npi IS NOT NULL),
        COUNTIF(_name IS NOT NULL),
        COUNTIF(_state IS NOT NULL),
        COUNTIF(_active = true),
        ROUND(SAFE_DIVIDE(COUNTIF(_npi IS NOT NULL), COUNT(*)) * 100, 2),
        ROUND(SAFE_DIVIDE(COUNTIF(_name IS NOT NULL), COUNT(*)) * 100, 2),
        ROUND(SAFE_DIVIDE(COUNTIF(_state IS NOT NULL), COUNT(*)) * 100, 2)
      FROM \`${PROJECT_ID}.${DATASET_ID}.organization\`
      UNION ALL
      SELECT
        'location',
        COUNT(*),
        COUNTIF(_managing_org_npi IS NOT NULL),
        COUNTIF(_name IS NOT NULL),
        COUNTIF(_state IS NOT NULL),
        COUNTIF(_status = 'active'),
        ROUND(SAFE_DIVIDE(COUNTIF(_managing_org_npi IS NOT NULL), COUNT(*)) * 100, 2),
        ROUND(SAFE_DIVIDE(COUNTIF(_name IS NOT NULL), COUNT(*)) * 100, 2),
        ROUND(SAFE_DIVIDE(COUNTIF(_state IS NOT NULL), COUNT(*)) * 100, 2)
      FROM \`${PROJECT_ID}.${DATASET_ID}.location\`
      UNION ALL
      SELECT
        'endpoint',
        COUNT(*),
        COUNTIF(_address IS NOT NULL),
        COUNTIF(_name IS NOT NULL),
        COUNTIF(_connection_type_code IS NOT NULL),
        COUNTIF(_status = 'active'),
        ROUND(SAFE_DIVIDE(COUNTIF(_address IS NOT NULL), COUNT(*)) * 100, 2),
        ROUND(SAFE_DIVIDE(COUNTIF(_name IS NOT NULL), COUNT(*)) * 100, 2),
        ROUND(SAFE_DIVIDE(COUNTIF(_connection_type_code IS NOT NULL), COUNT(*)) * 100, 2)
      FROM \`${PROJECT_ID}.${DATASET_ID}.endpoint\`
    `,
  },
];

async function main() {
  console.log('Recreating BigQuery views...\n');
  for (const view of views) {
    try {
      await bigquery.query({ query: view.sql });
      console.log(`  ${view.id} created.`);
    } catch (err) {
      console.error(`  ${view.id} FAILED:`, err);
    }
  }
  console.log('\nDone.');
}

main().catch(console.error);
