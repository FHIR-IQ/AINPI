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
    const state = url.searchParams.get('state')?.toUpperCase();
    const city = url.searchParams.get('city');

    if (!state) {
      return NextResponse.json({ error: 'state parameter required' }, { status: 400 });
    }

    const cityFilter = city ? ' AND _city = @city' : '';
    const params: Record<string, string> = { state };
    if (city) params.city = city;

    // Top cities in state (from locations — highest quality address data)
    const cities = await runQuery(
      'SELECT _city AS city, COUNT(*) AS location_count, ' +
      'COUNT(DISTINCT _postal_code) AS unique_zips ' +
      'FROM ' + tbl('location') + ' ' +
      'WHERE _state = @state AND _city IS NOT NULL' + cityFilter + ' ' +
      'GROUP BY _city ORDER BY location_count DESC LIMIT 50',
      params
    );

    // Practitioner count by city
    const pracByCity = await runQuery(
      'SELECT _city AS city, COUNT(*) AS practitioner_count, ' +
      'COUNTIF(_active = true) AS active_count ' +
      'FROM ' + tbl('practitioner') + ' ' +
      'WHERE _state = @state AND _city IS NOT NULL' + cityFilter + ' ' +
      'GROUP BY _city ORDER BY practitioner_count DESC LIMIT 50',
      params
    );

    // Organization count by city
    const orgByCity = await runQuery(
      'SELECT _city AS city, COUNT(*) AS org_count ' +
      'FROM ' + tbl('organization') + ' ' +
      'WHERE _state = @state AND _city IS NOT NULL' + cityFilter + ' ' +
      'GROUP BY _city ORDER BY org_count DESC LIMIT 50',
      params
    );

    // Top specialties in state (via practitioner_role join to practitioner on state)
    const specialties = await runQuery(
      'SELECT pr._specialty_code AS code, pr._specialty_display AS display, ' +
      'COUNT(DISTINCT pr._practitioner_id) AS provider_count ' +
      'FROM ' + tbl('practitioner_role') + ' pr ' +
      'JOIN ' + tbl('practitioner') + ' p ON CONCAT("Practitioner/", p._id) = pr._practitioner_id ' +
      'WHERE p._state = @state' +
      (city ? ' AND p._city = @city' : '') + ' ' +
      'AND pr._specialty_code IS NOT NULL ' +
      'GROUP BY pr._specialty_code, pr._specialty_display ' +
      'ORDER BY provider_count DESC LIMIT 30',
      params
    );

    // Top organizations in state by practitioner count
    const topOrgs = await runQuery(
      'SELECT o._id AS org_id, o._name AS org_name, o._city AS city, ' +
      'COUNT(DISTINCT pr._practitioner_id) AS practitioner_count ' +
      'FROM ' + tbl('organization') + ' o ' +
      'JOIN ' + tbl('practitioner_role') + ' pr ON CONCAT("Organization/", o._id) = pr._org_id ' +
      'WHERE o._state = @state' +
      (city ? ' AND o._city = @city' : '') + ' ' +
      'GROUP BY o._id, o._name, o._city ' +
      'ORDER BY practitioner_count DESC LIMIT 20',
      params
    );

    return NextResponse.json({
      state,
      city: city || null,
      cities,
      practitioners_by_city: pracByCity,
      organizations_by_city: orgByCity,
      top_specialties: specialties,
      top_organizations: topOrgs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('State detail error:', message);
    return NextResponse.json({ error: 'Failed: ' + message }, { status: 500 });
  }
}
