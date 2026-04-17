import { NextResponse } from 'next/server';
import { getBigQueryClient } from '@/lib/bigquery';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';

function tbl(name: string): string {
  return PROJECT_ID + '.' + DATASET_ID + '.' + name;
}

async function runQuery(sql: string) {
  const [rows] = await getBigQueryClient().query({ query: sql });
  return rows;
}

// Source file record counts from CMS NPD release manifest (2026-04-09)
const SOURCE_COUNTS: Record<string, number> = {
  practitioner: 7_441_212,
  organization: 3_605_261,
  location: 3_494_239,
  endpoint: 5_043_524,
  practitioner_role: 7_180_732,
  organization_affiliation: 439_599,
};

export async function GET() {
  try {
    // Get actual counts from BigQuery
    const countQueries = Object.keys(SOURCE_COUNTS).map((t) =>
      'SELECT "' + t + '" AS resource, COUNT(*) AS total FROM ' + tbl(t)
    ).join(' UNION ALL ');

    const countRows = await runQuery(countQueries) as Array<{ resource: string; total: string | number }>;
    const actualCounts: Record<string, number> = {};
    countRows.forEach((r) => { actualCounts[r.resource] = Number(r.total); });

    // NPI validity checks (10 digits, non-null)
    const npiValidity = await runQuery(
      'SELECT ' +
      '(SELECT COUNT(*) FROM ' + tbl('practitioner') + ' WHERE REGEXP_CONTAINS(_npi, r"^[0-9]{10}$")) AS valid_practitioner_npis, ' +
      '(SELECT COUNT(*) FROM ' + tbl('practitioner') + ' WHERE _npi IS NULL) AS missing_practitioner_npis, ' +
      '(SELECT COUNT(*) FROM ' + tbl('organization') + ' WHERE REGEXP_CONTAINS(_npi, r"^[0-9]{10}$")) AS valid_org_npis, ' +
      '(SELECT COUNT(*) FROM ' + tbl('organization') + ' WHERE _npi IS NULL) AS missing_org_npis'
    ) as Array<Record<string, string | number>>;

    // Referential integrity: PractitionerRoles pointing to non-existent practitioners
    const orphans = await runQuery(
      'WITH pr_refs AS ( ' +
      '  SELECT DISTINCT _practitioner_id AS ref FROM ' + tbl('practitioner_role') + ' WHERE _practitioner_id IS NOT NULL ' +
      '), prac_refs AS ( ' +
      '  SELECT CONCAT("Practitioner/", _id) AS ref FROM ' + tbl('practitioner') + ' ' +
      ') ' +
      'SELECT ' +
      '  (SELECT COUNT(*) FROM pr_refs) AS total_practitioner_refs, ' +
      '  (SELECT COUNT(*) FROM pr_refs WHERE ref NOT IN (SELECT ref FROM prac_refs)) AS orphan_practitioner_refs'
    ) as Array<Record<string, string | number>>;

    const orgOrphans = await runQuery(
      'WITH pr_refs AS ( ' +
      '  SELECT DISTINCT _org_id AS ref FROM ' + tbl('practitioner_role') + ' WHERE _org_id IS NOT NULL ' +
      '), org_refs AS ( ' +
      '  SELECT CONCAT("Organization/", _id) AS ref FROM ' + tbl('organization') + ' ' +
      ') ' +
      'SELECT ' +
      '  (SELECT COUNT(*) FROM pr_refs) AS total_org_refs, ' +
      '  (SELECT COUNT(*) FROM pr_refs WHERE ref NOT IN (SELECT ref FROM org_refs)) AS orphan_org_refs'
    ) as Array<Record<string, string | number>>;

    // Endpoint validity
    const endpointChecks = await runQuery(
      'SELECT ' +
      'COUNT(*) AS total_endpoints, ' +
      'COUNTIF(REGEXP_CONTAINS(_address, r"^https?://")) AS valid_urls, ' +
      'COUNTIF(_connection_type IS NOT NULL) AS has_connection_type, ' +
      'COUNTIF(_managing_org_id IS NOT NULL) AS has_managing_org ' +
      'FROM ' + tbl('endpoint')
    ) as Array<Record<string, string | number>>;

    // Build resource-level comparison
    const resources = Object.keys(SOURCE_COUNTS).map((name) => {
      const expected = SOURCE_COUNTS[name];
      const actual = actualCounts[name] || 0;
      const completeness = (actual / expected) * 100;
      return {
        resource: name,
        expected,
        actual,
        delta: actual - expected,
        completeness_pct: Math.min(completeness, 100),
        status: completeness >= 99.9 ? 'complete' : completeness >= 95 ? 'near_complete' : completeness > 0 ? 'partial' : 'empty',
      };
    });

    const v = npiValidity[0];
    const orphanResult = orphans[0];
    const orgOrphanResult = orgOrphans[0];
    const ep = endpointChecks[0];

    return NextResponse.json({
      release_date: '2026-04-09',
      generated_at: new Date().toISOString(),
      resource_counts: resources,
      total_expected: Object.values(SOURCE_COUNTS).reduce((a, b) => a + b, 0),
      total_actual: Object.values(actualCounts).reduce((a, b) => a + b, 0),
      npi_validity: {
        valid_practitioner_npis: Number(v.valid_practitioner_npis),
        missing_practitioner_npis: Number(v.missing_practitioner_npis),
        valid_org_npis: Number(v.valid_org_npis),
        missing_org_npis: Number(v.missing_org_npis),
      },
      referential_integrity: {
        practitioner_refs: {
          total: Number(orphanResult.total_practitioner_refs),
          orphans: Number(orphanResult.orphan_practitioner_refs),
          integrity_pct: Number(orphanResult.total_practitioner_refs) > 0
            ? ((Number(orphanResult.total_practitioner_refs) - Number(orphanResult.orphan_practitioner_refs)) / Number(orphanResult.total_practitioner_refs)) * 100
            : 0,
        },
        org_refs: {
          total: Number(orgOrphanResult.total_org_refs),
          orphans: Number(orgOrphanResult.orphan_org_refs),
          integrity_pct: Number(orgOrphanResult.total_org_refs) > 0
            ? ((Number(orgOrphanResult.total_org_refs) - Number(orgOrphanResult.orphan_org_refs)) / Number(orgOrphanResult.total_org_refs)) * 100
            : 0,
        },
      },
      endpoint_validity: {
        total: Number(ep.total_endpoints),
        valid_url_format: Number(ep.valid_urls),
        has_connection_type: Number(ep.has_connection_type),
        has_managing_org: Number(ep.has_managing_org),
        url_validity_pct: Number(ep.total_endpoints) > 0 ? (Number(ep.valid_urls) / Number(ep.total_endpoints)) * 100 : 0,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Validation error:', message);
    return NextResponse.json({ error: 'Failed: ' + message }, { status: 500 });
  }
}
