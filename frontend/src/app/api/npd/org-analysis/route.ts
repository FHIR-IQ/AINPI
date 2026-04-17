import { NextRequest, NextResponse } from 'next/server';
import { getBigQueryClient } from '@/lib/bigquery';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';

function tbl(name: string): string {
  return PROJECT_ID + '.' + DATASET_ID + '.' + name;
}

async function runQuery(sql: string, params?: Record<string, unknown>) {
  const client = getBigQueryClient();
  const options: Record<string, unknown> = { query: sql };
  if (params) options.params = params;
  const [rows] = await client.query(options);
  return rows;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const org = url.searchParams.get('org');
    if (!org) return NextResponse.json({ error: 'org parameter required' }, { status: 400 });

    const pattern = '%' + org.toLowerCase() + '%';

    // Match organizations by name
    const orgs = await runQuery(
      'SELECT _id, _npi, _name, _state, _city, _active ' +
      'FROM ' + tbl('organization') + ' ' +
      'WHERE LOWER(_name) LIKE @pattern ORDER BY _name LIMIT 500',
      { pattern }
    ) as Array<{ _id: string; _npi: string | null; _name: string; _state: string | null; _city: string | null; _active: boolean | null }>;

    const totalOrgs = orgs.length;
    const activeOrgs = orgs.filter((o) => o._active === true).length;
    const inactiveOrgs = orgs.filter((o) => o._active === false).length;

    // Group by state
    const byState: Record<string, number> = {};
    orgs.forEach((o) => {
      const s = o._state || 'unknown';
      byState[s] = (byState[s] || 0) + 1;
    });

    const stateDistribution = Object.entries(byState)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // Build practitioner/role/location/endpoint counts
    const [practitionerCounts, endpoints, locs, topSpecialties, endpointSample] = await Promise.all([
      runQuery(
        'SELECT COUNT(DISTINCT pr._practitioner_id) AS unique_practitioners, COUNT(*) AS total_roles ' +
        'FROM ' + tbl('practitioner_role') + ' pr ' +
        'JOIN ' + tbl('organization') + ' o ON pr._org_id = CONCAT("Organization/", o._id) ' +
        'WHERE LOWER(o._name) LIKE @pattern',
        { pattern }
      ) as Promise<Array<{ unique_practitioners: string | number; total_roles: string | number }>>,
      runQuery(
        'SELECT e._connection_type AS connection_type, e._status AS status, COUNT(*) AS n ' +
        'FROM ' + tbl('endpoint') + ' e ' +
        'JOIN ' + tbl('organization') + ' o ON e._managing_org_id = CONCAT("Organization/", o._id) ' +
        'WHERE LOWER(o._name) LIKE @pattern ' +
        'GROUP BY e._connection_type, e._status ORDER BY n DESC',
        { pattern }
      ) as Promise<Array<{ connection_type: string | null; status: string | null; n: string | number }>>,
      runQuery(
        'SELECT COUNT(*) AS n FROM ' + tbl('location') + ' l ' +
        'JOIN ' + tbl('organization') + ' o ON l._managing_org_id = CONCAT("Organization/", o._id) ' +
        'WHERE LOWER(o._name) LIKE @pattern',
        { pattern }
      ) as Promise<Array<{ n: string | number }>>,
      runQuery(
        'SELECT pr._specialty_display AS display, COUNT(DISTINCT pr._practitioner_id) AS unique_pracs ' +
        'FROM ' + tbl('practitioner_role') + ' pr ' +
        'JOIN ' + tbl('organization') + ' o ON pr._org_id = CONCAT("Organization/", o._id) ' +
        'WHERE LOWER(o._name) LIKE @pattern AND pr._specialty_display IS NOT NULL ' +
        'GROUP BY pr._specialty_display ORDER BY unique_pracs DESC LIMIT 15',
        { pattern }
      ) as Promise<Array<{ display: string; unique_pracs: string | number }>>,
      runQuery(
        'SELECT e._name AS name, e._connection_type AS connection_type, e._address AS address, e._status AS status, o._name AS managing_org ' +
        'FROM ' + tbl('endpoint') + ' e ' +
        'JOIN ' + tbl('organization') + ' o ON e._managing_org_id = CONCAT("Organization/", o._id) ' +
        'WHERE LOWER(o._name) LIKE @pattern LIMIT 10',
        { pattern }
      ) as Promise<Array<Record<string, string | null>>>,
    ]);

    return NextResponse.json({
      query: org,
      totals: {
        organizations: totalOrgs,
        active_organizations: activeOrgs,
        inactive_organizations: inactiveOrgs,
        unique_practitioners: Number(practitionerCounts[0]?.unique_practitioners || 0),
        total_practitioner_roles: Number(practitionerCounts[0]?.total_roles || 0),
        endpoints: endpoints.reduce((sum, e) => sum + Number(e.n), 0),
        locations: Number(locs[0]?.n || 0),
      },
      state_distribution: stateDistribution,
      endpoint_breakdown: endpoints.map((e) => ({
        connection_type: e.connection_type || 'unknown',
        status: e.status || 'unknown',
        count: Number(e.n),
      })),
      endpoint_sample: endpointSample,
      top_specialties: topSpecialties.map((s) => ({
        display: s.display,
        unique_practitioners: Number(s.unique_pracs),
      })),
      sample_organizations: orgs.slice(0, 20).map((o) => ({
        name: o._name,
        npi: o._npi,
        state: o._state,
        city: o._city,
        active: o._active,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Org analysis error:', message);
    return NextResponse.json({ error: 'Failed: ' + message }, { status: 500 });
  }
}
