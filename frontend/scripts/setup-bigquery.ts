/**
 * BigQuery Dataset & Table Setup for CMS National Provider Directory
 *
 * Creates the dataset and tables needed to store the full CMS NPD NDJSON data.
 * Run: npx tsx scripts/setup-bigquery.ts
 *
 * Prerequisites:
 *   gcloud auth application-default login
 *   gcloud config set project thematic-fort-453901-t7
 */

import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';
const LOCATION = 'US';

const bigquery = new BigQuery({ projectId: PROJECT_ID });

async function createDataset() {
  try {
    const [dataset] = await bigquery.createDataset(DATASET_ID, {
      location: LOCATION,
    });
    console.log(`Dataset ${dataset.id} created.`);
  } catch (err: unknown) {
    const error = err as { code?: number };
    if (error.code === 409) {
      console.log(`Dataset ${DATASET_ID} already exists.`);
    } else {
      throw err;
    }
  }
}

// FHIR R4 Practitioner resource schema for BigQuery
const PRACTITIONER_SCHEMA = [
  { name: 'resourceType', type: 'STRING' },
  { name: 'id', type: 'STRING' },
  { name: 'meta', type: 'JSON' },
  { name: 'identifier', type: 'JSON' },
  { name: 'active', type: 'BOOLEAN' },
  { name: 'name', type: 'JSON' },
  { name: 'telecom', type: 'JSON' },
  { name: 'address', type: 'JSON' },
  { name: 'gender', type: 'STRING' },
  { name: 'birthDate', type: 'STRING' },
  { name: 'qualification', type: 'JSON' },
  { name: 'communication', type: 'JSON' },
  // Extracted fields for efficient querying
  { name: '_npi', type: 'STRING', description: 'Extracted NPI from identifier array' },
  { name: '_family_name', type: 'STRING', description: 'Extracted family name' },
  { name: '_given_name', type: 'STRING', description: 'Extracted first given name' },
  { name: '_state', type: 'STRING', description: 'Extracted state from first address' },
  { name: '_city', type: 'STRING', description: 'Extracted city from first address' },
  { name: '_postal_code', type: 'STRING', description: 'Extracted postal code from first address' },
];

const PRACTITIONER_ROLE_SCHEMA = [
  { name: 'resourceType', type: 'STRING' },
  { name: 'id', type: 'STRING' },
  { name: 'meta', type: 'JSON' },
  { name: 'identifier', type: 'JSON' },
  { name: 'active', type: 'BOOLEAN' },
  { name: 'period', type: 'JSON' },
  { name: 'practitioner', type: 'JSON' },
  { name: 'organization', type: 'JSON' },
  { name: 'code', type: 'JSON' },
  { name: 'specialty', type: 'JSON' },
  { name: 'location', type: 'JSON' },
  { name: 'healthcareService', type: 'JSON' },
  { name: 'telecom', type: 'JSON' },
  { name: 'endpoint', type: 'JSON' },
  // Extracted fields
  { name: '_practitioner_npi', type: 'STRING' },
  { name: '_org_npi', type: 'STRING' },
  { name: '_specialty_code', type: 'STRING' },
  { name: '_specialty_display', type: 'STRING' },
];

const ORGANIZATION_SCHEMA = [
  { name: 'resourceType', type: 'STRING' },
  { name: 'id', type: 'STRING' },
  { name: 'meta', type: 'JSON' },
  { name: 'identifier', type: 'JSON' },
  { name: 'active', type: 'BOOLEAN' },
  { name: 'type', type: 'JSON' },
  { name: 'name', type: 'STRING' },
  { name: 'alias', type: 'JSON' },
  { name: 'telecom', type: 'JSON' },
  { name: 'address', type: 'JSON' },
  { name: 'partOf', type: 'JSON' },
  { name: 'contact', type: 'JSON' },
  { name: 'endpoint', type: 'JSON' },
  // Extracted fields
  { name: '_npi', type: 'STRING' },
  { name: '_state', type: 'STRING' },
  { name: '_city', type: 'STRING' },
  { name: '_org_type', type: 'STRING' },
];

const LOCATION_SCHEMA = [
  { name: 'resourceType', type: 'STRING' },
  { name: 'id', type: 'STRING' },
  { name: 'meta', type: 'JSON' },
  { name: 'identifier', type: 'JSON' },
  { name: 'status', type: 'STRING' },
  { name: 'name', type: 'STRING' },
  { name: 'description', type: 'STRING' },
  { name: 'mode', type: 'STRING' },
  { name: 'type', type: 'JSON' },
  { name: 'telecom', type: 'JSON' },
  { name: 'address', type: 'JSON' },
  { name: 'position', type: 'JSON' },
  { name: 'managingOrganization', type: 'JSON' },
  { name: 'endpoint', type: 'JSON' },
  // Extracted fields
  { name: '_state', type: 'STRING' },
  { name: '_city', type: 'STRING' },
  { name: '_postal_code', type: 'STRING' },
  { name: '_managing_org_npi', type: 'STRING' },
];

const ENDPOINT_SCHEMA = [
  { name: 'resourceType', type: 'STRING' },
  { name: 'id', type: 'STRING' },
  { name: 'meta', type: 'JSON' },
  { name: 'identifier', type: 'JSON' },
  { name: 'status', type: 'STRING' },
  { name: 'connectionType', type: 'JSON' },
  { name: 'name', type: 'STRING' },
  { name: 'managingOrganization', type: 'JSON' },
  { name: 'contact', type: 'JSON' },
  { name: 'period', type: 'JSON' },
  { name: 'payloadType', type: 'JSON' },
  { name: 'payloadMimeType', type: 'JSON' },
  { name: 'address', type: 'STRING' },
  { name: 'header', type: 'JSON' },
  // Extracted fields
  { name: '_connection_type_code', type: 'STRING' },
  { name: '_managing_org_name', type: 'STRING' },
  { name: '_mime_types', type: 'STRING' },
];

const ORGANIZATION_AFFILIATION_SCHEMA = [
  { name: 'resourceType', type: 'STRING' },
  { name: 'id', type: 'STRING' },
  { name: 'meta', type: 'JSON' },
  { name: 'identifier', type: 'JSON' },
  { name: 'active', type: 'BOOLEAN' },
  { name: 'period', type: 'JSON' },
  { name: 'organization', type: 'JSON' },
  { name: 'participatingOrganization', type: 'JSON' },
  { name: 'network', type: 'JSON' },
  { name: 'code', type: 'JSON' },
  { name: 'specialty', type: 'JSON' },
  { name: 'location', type: 'JSON' },
  { name: 'healthcareService', type: 'JSON' },
  { name: 'endpoint', type: 'JSON' },
  // Extracted
  { name: '_org_npi', type: 'STRING' },
  { name: '_participating_org_npi', type: 'STRING' },
];

const TABLES = [
  { id: 'practitioner', schema: PRACTITIONER_SCHEMA },
  { id: 'practitioner_role', schema: PRACTITIONER_ROLE_SCHEMA },
  { id: 'organization', schema: ORGANIZATION_SCHEMA },
  { id: 'location', schema: LOCATION_SCHEMA },
  { id: 'endpoint', schema: ENDPOINT_SCHEMA },
  { id: 'organization_affiliation', schema: ORGANIZATION_AFFILIATION_SCHEMA },
];

async function createTables() {
  const dataset = bigquery.dataset(DATASET_ID);

  for (const table of TABLES) {
    try {
      await dataset.createTable(table.id, {
        schema: { fields: table.schema },
        timePartitioning: undefined,
        clustering: undefined,
      });
      console.log(`Table ${table.id} created.`);
    } catch (err: unknown) {
      const error = err as { code?: number };
      if (error.code === 409) {
        console.log(`Table ${table.id} already exists.`);
      } else {
        throw err;
      }
    }
  }
}

// Create materialized views for common queries
async function createAggregationViews() {
  const views = [
    {
      id: 'v_provider_by_state',
      sql: `
        CREATE OR REPLACE VIEW \`${PROJECT_ID}.${DATASET_ID}.v_provider_by_state\` AS
        SELECT
          _state AS state,
          COUNT(*) AS provider_count,
          COUNTIF(active = true) AS active_count,
          COUNTIF(_npi IS NOT NULL) AS with_npi_count,
          ROUND(COUNTIF(_npi IS NOT NULL) / COUNT(*) * 100, 2) AS npi_completeness_pct
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
          status,
          COUNT(*) AS endpoint_count,
          COUNT(DISTINCT _managing_org_name) AS unique_orgs
        FROM \`${PROJECT_ID}.${DATASET_ID}.endpoint\`
        GROUP BY _connection_type_code, status
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
          COUNTIF(active = true) AS active_count,
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
          COUNTIF(active = true) AS active_records,
          ROUND(COUNTIF(_npi IS NOT NULL) / COUNT(*) * 100, 2) AS id_completeness_pct,
          ROUND(COUNTIF(_family_name IS NOT NULL) / COUNT(*) * 100, 2) AS name_completeness_pct,
          ROUND(COUNTIF(_state IS NOT NULL) / COUNT(*) * 100, 2) AS address_completeness_pct
        FROM \`${PROJECT_ID}.${DATASET_ID}.practitioner\`
        UNION ALL
        SELECT
          'organization',
          COUNT(*),
          COUNTIF(_npi IS NOT NULL),
          COUNTIF(name IS NOT NULL),
          COUNTIF(_state IS NOT NULL),
          COUNTIF(active = true),
          ROUND(COUNTIF(_npi IS NOT NULL) / COUNT(*) * 100, 2),
          ROUND(COUNTIF(name IS NOT NULL) / COUNT(*) * 100, 2),
          ROUND(COUNTIF(_state IS NOT NULL) / COUNT(*) * 100, 2)
        FROM \`${PROJECT_ID}.${DATASET_ID}.organization\`
        UNION ALL
        SELECT
          'location',
          COUNT(*),
          COUNTIF(_managing_org_npi IS NOT NULL),
          COUNTIF(name IS NOT NULL),
          COUNTIF(_state IS NOT NULL),
          COUNTIF(status = 'active'),
          ROUND(COUNTIF(_managing_org_npi IS NOT NULL) / COUNT(*) * 100, 2),
          ROUND(COUNTIF(name IS NOT NULL) / COUNT(*) * 100, 2),
          ROUND(COUNTIF(_state IS NOT NULL) / COUNT(*) * 100, 2)
        FROM \`${PROJECT_ID}.${DATASET_ID}.location\`
        UNION ALL
        SELECT
          'endpoint',
          COUNT(*),
          COUNTIF(address IS NOT NULL),
          COUNTIF(name IS NOT NULL),
          COUNTIF(_connection_type_code IS NOT NULL),
          COUNTIF(status = 'active'),
          ROUND(COUNTIF(address IS NOT NULL) / COUNT(*) * 100, 2),
          ROUND(COUNTIF(name IS NOT NULL) / COUNT(*) * 100, 2),
          ROUND(COUNTIF(_connection_type_code IS NOT NULL) / COUNT(*) * 100, 2)
        FROM \`${PROJECT_ID}.${DATASET_ID}.endpoint\`
      `,
    },
  ];

  for (const view of views) {
    try {
      await bigquery.query({ query: view.sql });
      console.log(`View ${view.id} created.`);
    } catch (err) {
      console.error(`Error creating view ${view.id}:`, err);
    }
  }
}

async function main() {
  console.log(`Setting up BigQuery for CMS NPD in project: ${PROJECT_ID}`);
  console.log(`Dataset: ${DATASET_ID}, Location: ${LOCATION}\n`);

  await createDataset();
  await createTables();
  await createAggregationViews();

  console.log('\nSetup complete! Next steps:');
  console.log('  1. Download CMS NPD files from https://directory.cms.gov/');
  console.log('  2. Run: npx tsx scripts/ingest-cms-npd.ts');
}

main().catch(console.error);
