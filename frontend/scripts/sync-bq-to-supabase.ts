#!/usr/bin/env npx tsx
/**
 * Sync BigQuery aggregations to Supabase index tables
 *
 * Runs BigQuery aggregation queries and writes the results to Supabase Postgres
 * so the Next.js app can serve dashboard and search data without hitting BigQuery
 * on every page load.
 *
 * Usage: npx tsx scripts/sync-bq-to-supabase.ts
 */

import { BigQuery } from '@google-cloud/bigquery';
import { PrismaClient } from '@prisma/client';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';
const RELEASE_DATE = process.env.NPD_RELEASE_DATE || '2026-04-09';

const bigquery = new BigQuery({ projectId: PROJECT_ID });
const prisma = new PrismaClient();

async function query<T>(sql: string): Promise<T[]> {
  const [rows] = await bigquery.query({ query: sql });
  return rows as T[];
}

async function syncDataQualitySummary() {
  console.log('Syncing data quality summary...');

  const rows = await query<{
    resource_type: string;
    total_records: number;
    with_primary_id: number;
    with_name: number;
    with_address: number;
    active_records: number;
    id_completeness_pct: number;
    name_completeness_pct: number;
    address_completeness_pct: number;
  }>(`SELECT * FROM \`${PROJECT_ID}.${DATASET_ID}.v_data_quality_summary\``);

  for (const row of rows) {
    await prisma.npdDataQualitySummary.upsert({
      where: {
        releaseDate_resourceType: {
          releaseDate: RELEASE_DATE,
          resourceType: row.resource_type,
        },
      },
      update: {
        totalRecords: row.total_records,
        withPrimaryId: row.with_primary_id,
        withName: row.with_name,
        withAddress: row.with_address,
        activeRecords: row.active_records,
        idCompletenessPct: row.id_completeness_pct,
        nameCompletenessPct: row.name_completeness_pct,
        addressCompletenessPct: row.address_completeness_pct,
        updatedAt: new Date(),
      },
      create: {
        releaseDate: RELEASE_DATE,
        resourceType: row.resource_type,
        totalRecords: row.total_records,
        withPrimaryId: row.with_primary_id,
        withName: row.with_name,
        withAddress: row.with_address,
        activeRecords: row.active_records,
        idCompletenessPct: row.id_completeness_pct,
        nameCompletenessPct: row.name_completeness_pct,
        addressCompletenessPct: row.address_completeness_pct,
      },
    });
  }
  console.log(`  Synced ${rows.length} resource type summaries.`);
}

// 50 US states + DC + inhabited territories. Anything outside this set is
// dropped from syncs so the dashboard doesn't report "351 states" when the
// raw data contains free-text entries like "SARAJEVO" or "BRANSON MO 65616".
const VALID_US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
  'DC', // District of Columbia
  'PR','VI','GU','MP','AS', // Puerto Rico, US Virgin Islands, Guam, N. Mariana Islands, American Samoa
]);

function isValidUsState(s: string | null | undefined): boolean {
  return typeof s === 'string' && VALID_US_STATES.has(s.trim().toUpperCase());
}

async function syncStateMetrics() {
  console.log('Syncing state metrics (US states + territories only)...');

  // Combine practitioner, org, location, endpoint counts by state
  const allRows = await query<{
    state: string;
    provider_count: number;
    active_count: number;
    with_npi_count: number;
    npi_completeness_pct: number;
  }>(`SELECT * FROM \`${PROJECT_ID}.${DATASET_ID}.v_provider_by_state\``);

  const rows = allRows.filter((r) => isValidUsState(r.state));
  if (allRows.length !== rows.length) {
    console.log('  Filtered ' + (allRows.length - rows.length) + ' non-US state values (kept ' + rows.length + ').');
  }

  // Remove any previously-synced rows that are no longer in the valid set
  // (e.g., "SARAJEVO", "BRANSON MO 65616" left over from earlier syncs).
  const existing = await prisma.npdStateMetrics.findMany({
    where: { releaseDate: RELEASE_DATE },
    select: { state: true },
  });
  const invalidExisting = existing.filter((e) => !isValidUsState(e.state));
  if (invalidExisting.length > 0) {
    await prisma.npdStateMetrics.deleteMany({
      where: { releaseDate: RELEASE_DATE, state: { in: invalidExisting.map((e) => e.state) } },
    });
    console.log('  Deleted ' + invalidExisting.length + ' stale non-US state rows from Supabase.');
  }

  const orgRows = await query<{
    state: string;
    org_count: number;
  }>(`
    SELECT _state AS state, COUNT(*) AS org_count
    FROM \`${PROJECT_ID}.${DATASET_ID}.organization\`
    WHERE _state IS NOT NULL
    GROUP BY _state
  `);

  const locRows = await query<{
    state: string;
    location_count: number;
  }>(`
    SELECT _state AS state, COUNT(*) AS location_count
    FROM \`${PROJECT_ID}.${DATASET_ID}.location\`
    WHERE _state IS NOT NULL
    GROUP BY _state
  `);

  const orgMap = new Map(orgRows.map((r) => [r.state, r.org_count]));
  const locMap = new Map(locRows.map((r) => [r.state, r.location_count]));

  for (const row of rows) {
    await prisma.npdStateMetrics.upsert({
      where: {
        releaseDate_state: {
          releaseDate: RELEASE_DATE,
          state: row.state,
        },
      },
      update: {
        providerCount: row.provider_count,
        orgCount: orgMap.get(row.state) || 0,
        locationCount: locMap.get(row.state) || 0,
        endpointCount: 0,
        activeProviders: row.active_count || 0,
        npiCompleteness: row.npi_completeness_pct || 0,
        addressCompleteness: 100,
        updatedAt: new Date(),
      },
      create: {
        releaseDate: RELEASE_DATE,
        state: row.state,
        providerCount: row.provider_count,
        orgCount: orgMap.get(row.state) || 0,
        locationCount: locMap.get(row.state) || 0,
        endpointCount: 0,
        activeProviders: row.active_count || 0,
        npiCompleteness: row.npi_completeness_pct || 0,
        addressCompleteness: 100,
      },
    });
  }
  console.log(`  Synced ${rows.length} state metrics.`);
}

async function syncSpecialtyMetrics() {
  console.log('Syncing specialty metrics...');

  const rows = await query<{
    specialty_code: string;
    specialty_display: string;
    role_count: number;
    unique_providers: number;
    unique_orgs: number;
  }>(`SELECT * FROM \`${PROJECT_ID}.${DATASET_ID}.v_provider_by_specialty\` LIMIT 500`);

  for (const row of rows) {
    await prisma.npdSpecialtyMetrics.upsert({
      where: {
        releaseDate_specialtyCode: {
          releaseDate: RELEASE_DATE,
          specialtyCode: row.specialty_code,
        },
      },
      update: {
        specialtyDisplay: row.specialty_display,
        providerCount: row.unique_providers,
        orgCount: row.unique_orgs,
        updatedAt: new Date(),
      },
      create: {
        releaseDate: RELEASE_DATE,
        specialtyCode: row.specialty_code,
        specialtyDisplay: row.specialty_display,
        providerCount: row.unique_providers,
        orgCount: row.unique_orgs,
      },
    });
  }
  console.log(`  Synced ${rows.length} specialty metrics.`);
}

async function syncEndpointMetrics() {
  console.log('Syncing endpoint metrics...');

  const rows = await query<{
    connection_type: string;
    status: string;
    endpoint_count: number;
    unique_orgs: number;
  }>(`SELECT * FROM \`${PROJECT_ID}.${DATASET_ID}.v_endpoint_by_type\``);

  for (const row of rows) {
    await prisma.npdEndpointMetrics.upsert({
      where: {
        releaseDate_connectionType_status: {
          releaseDate: RELEASE_DATE,
          connectionType: row.connection_type || 'unknown',
          status: row.status || 'unknown',
        },
      },
      update: {
        endpointCount: row.endpoint_count,
        uniqueOrgs: row.unique_orgs,
        updatedAt: new Date(),
      },
      create: {
        releaseDate: RELEASE_DATE,
        connectionType: row.connection_type || 'unknown',
        status: row.status || 'unknown',
        endpointCount: row.endpoint_count,
        uniqueOrgs: row.unique_orgs,
      },
    });
  }
  console.log(`  Synced ${rows.length} endpoint metrics.`);
}

async function main() {
  console.log(`Syncing BigQuery -> Supabase for release ${RELEASE_DATE}\n`);

  try {
    await syncDataQualitySummary();
    await syncStateMetrics();
    await syncSpecialtyMetrics();
    await syncEndpointMetrics();
    console.log('\nSync complete!');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
