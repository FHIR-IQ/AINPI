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

    // Get totals + state distribution with server-side aggregation (no row limit)
    const [totalsAgg, stateAgg, sampleOrgs] = await Promise.all([
      runQuery(
        'SELECT COUNT(*) AS total_orgs, ' +
        'COUNTIF(_active = true) AS active_orgs, ' +
        'COUNTIF(_active = false) AS inactive_orgs ' +
        'FROM ' + tbl('organization') + ' WHERE LOWER(_name) LIKE @pattern',
        { pattern }
      ) as Promise<Array<{ total_orgs: string | number; active_orgs: string | number; inactive_orgs: string | number }>>,
      runQuery(
        'SELECT COALESCE(_state, "unknown") AS state, COUNT(*) AS c ' +
        'FROM ' + tbl('organization') + ' WHERE LOWER(_name) LIKE @pattern ' +
        'GROUP BY state ORDER BY c DESC LIMIT 15',
        { pattern }
      ) as Promise<Array<{ state: string; c: string | number }>>,
      runQuery(
        'SELECT _id, _npi, _name, _state, _city, _active ' +
        'FROM ' + tbl('organization') + ' ' +
        'WHERE LOWER(_name) LIKE @pattern ORDER BY _name LIMIT 20',
        { pattern }
      ) as Promise<Array<{ _id: string; _npi: string | null; _name: string; _state: string | null; _city: string | null; _active: boolean | null }>>,
    ]);

    const totalOrgs = Number(totalsAgg[0]?.total_orgs || 0);
    const activeOrgs = Number(totalsAgg[0]?.active_orgs || 0);
    const inactiveOrgs = Number(totalsAgg[0]?.inactive_orgs || 0);
    const stateDistribution = stateAgg.map((r) => ({ state: r.state, count: Number(r.c) }));

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
      sample_organizations: sampleOrgs.slice(0, 20).map((o) => ({
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
