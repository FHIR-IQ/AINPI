import { NextRequest, NextResponse } from 'next/server';
import { getBigQueryClient } from '@/lib/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';

function tbl(name: string): string {
  return PROJECT_ID + '.' + DATASET_ID + '.' + name;
}

async function runQuery(sql: string, params?: Record<string, string>) {
  const client = getBigQueryClient();
  const options: Record<string, unknown> = { query: sql };
  if (params) options.params = params;
  const [rows] = await client.query(options);
  return rows;
}

// Get relationship data for an organization (its practitioners, endpoints, locations)
async function getOrgRelationships(orgName: string) {
  // Find the organization
  const orgs = await runQuery(
    'SELECT _id, _npi, _name, _state, _city FROM ' + tbl('organization') +
    ' WHERE LOWER(_name) LIKE LOWER(@name) LIMIT 1',
    { name: '%' + orgName + '%' }
  ) as Array<Record<string, unknown>>;

  if (orgs.length === 0) return null;
  const org = orgs[0];
  const orgId = 'Organization/' + org._id;

  // Get practitioners via PractitionerRole
  const practitioners = await runQuery(
    'SELECT pr._practitioner_id, pr._specialty_display, pr._location_ids, ' +
    'p._family_name, p._given_name, p._npi ' +
    'FROM ' + tbl('practitioner_role') + ' pr ' +
    'LEFT JOIN ' + tbl('practitioner') + ' p ON CONCAT("Practitioner/", p._id) = pr._practitioner_id ' +
    'WHERE pr._org_id = @orgId AND pr._active = true LIMIT 200',
    { orgId }
  ) as Array<Record<string, unknown>>;

  // Get endpoints
  const endpoints = await runQuery(
    'SELECT _id, _name, _address, _connection_type, _status FROM ' + tbl('endpoint') +
    ' WHERE _managing_org_id = @orgId LIMIT 50',
    { orgId }
  ) as Array<Record<string, unknown>>;

  // Get locations via PractitionerRole location references
  const locationRefs = new Set<string>();
  practitioners.forEach((pr: any) => {
    if (pr._location_ids) {
      pr._location_ids.split('|').forEach((ref: string) => locationRefs.add(ref));
    }
  });

  let locations: Array<Record<string, unknown>> = [];
  if (locationRefs.size > 0) {
    const locIds = Array.from(locationRefs).slice(0, 50).map(ref => {
      const parts = ref.split('/');
      return parts[parts.length - 1];
    });
    if (locIds.length > 0) {
      locations = await runQuery(
        'SELECT _id, _name, _state, _city, _postal_code FROM ' + tbl('location') +
        ' WHERE _id IN UNNEST(@locIds) LIMIT 50',
        { locIds: locIds as unknown as string }
      ) as Array<Record<string, unknown>>;
    }
  }

  return { organization: org, practitioners, endpoints, locations };
}

// Get top organizations with their relationship counts for Sankey/Knowledge graph
async function getNetworkOverview(limit: number = 20) {
  // Top orgs by practitioner count
  const topOrgs = await runQuery(
    'SELECT pr._org_id AS org_id, o._name AS org_name, o._state AS state, o._city AS city, ' +
    'COUNT(DISTINCT pr._practitioner_id) AS practitioner_count, ' +
    'COUNT(DISTINCT pr._specialty_code) AS specialty_count ' +
    'FROM ' + tbl('practitioner_role') + ' pr ' +
    'JOIN ' + tbl('organization') + ' o ON CONCAT("Organization/", o._id) = pr._org_id ' +
    'WHERE pr._org_id IS NOT NULL AND pr._active = true ' +
    'GROUP BY pr._org_id, o._name, o._state, o._city ' +
    'ORDER BY practitioner_count DESC LIMIT ' + limit
  ) as Array<Record<string, unknown>>;

  // Get endpoint counts per org
  const orgIds = topOrgs.map((o: any) => o.org_id).filter(Boolean);
  let endpointCounts: Array<Record<string, unknown>> = [];
  if (orgIds.length > 0) {
    endpointCounts = await runQuery(
      'SELECT _managing_org_id AS org_id, COUNT(*) AS endpoint_count ' +
      'FROM ' + tbl('endpoint') + ' WHERE _managing_org_id IN UNNEST(@orgIds) ' +
      'GROUP BY _managing_org_id',
      { orgIds: orgIds as unknown as string }
    ) as Array<Record<string, unknown>>;
  }

  const epMap = new Map(endpointCounts.map((e: any) => [e.org_id, e.endpoint_count]));

  return topOrgs.map((o: any) => ({
    ...o,
    endpoint_count: epMap.get(o.org_id) || 0,
  }));
}

// Get global stats for the relationship overview
async function getRelationshipStats() {
  const stats = await runQuery(
    'SELECT ' +
    '(SELECT COUNT(*) FROM ' + tbl('practitioner') + ') AS total_practitioners, ' +
    '(SELECT COUNT(*) FROM ' + tbl('organization') + ') AS total_organizations, ' +
    '(SELECT COUNT(*) FROM ' + tbl('location') + ') AS total_locations, ' +
    '(SELECT COUNT(*) FROM ' + tbl('endpoint') + ') AS total_endpoints, ' +
    '(SELECT COUNT(*) FROM ' + tbl('practitioner_role') + ') AS total_roles, ' +
    '(SELECT COUNT(DISTINCT _practitioner_id) FROM ' + tbl('practitioner_role') + ' WHERE _practitioner_id IS NOT NULL) AS practitioners_with_roles, ' +
    '(SELECT COUNT(DISTINCT _org_id) FROM ' + tbl('practitioner_role') + ' WHERE _org_id IS NOT NULL) AS orgs_with_practitioners, ' +
    '(SELECT COUNT(DISTINCT _managing_org_id) FROM ' + tbl('endpoint') + ' WHERE _managing_org_id IS NOT NULL) AS orgs_with_endpoints'
  ) as Array<Record<string, unknown>>;

  return stats[0];
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const view = url.searchParams.get('view') || 'overview';
    const org = url.searchParams.get('org');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);

    switch (view) {
      case 'overview': {
        const [topOrgs, stats] = await Promise.all([
          getNetworkOverview(limit),
          getRelationshipStats(),
        ]);
        return NextResponse.json({ stats, top_organizations: topOrgs });
      }
      case 'org': {
        if (!org) return NextResponse.json({ error: 'org parameter required' }, { status: 400 });
        const data = await getOrgRelationships(org);
        if (!data) return NextResponse.json({ error: 'Organization not found: ' + org }, { status: 404 });
        return NextResponse.json(data);
      }
      default:
        return NextResponse.json({ error: 'Unknown view: ' + view }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Relationships API error:', message);
    return NextResponse.json({ error: 'Failed: ' + message }, { status: 500 });
  }
}
