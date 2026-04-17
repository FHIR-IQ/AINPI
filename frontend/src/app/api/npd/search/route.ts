import { NextRequest, NextResponse } from 'next/server';
import { getBigQueryClient } from '@/lib/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';
const MAX_RESULTS = 50;

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

interface SearchParams {
  npi?: string;
  name?: string;
  state?: string;
  city?: string;
  specialty?: string;
  org?: string;
  type?: string;
  limit?: number;
}

function parseSearchParams(req: NextRequest): SearchParams {
  const url = new URL(req.url);
  return {
    npi: url.searchParams.get('npi') || undefined,
    name: url.searchParams.get('name') || undefined,
    state: url.searchParams.get('state')?.toUpperCase() || undefined,
    city: url.searchParams.get('city') || undefined,
    specialty: url.searchParams.get('specialty') || undefined,
    org: url.searchParams.get('org') || undefined,
    type: url.searchParams.get('type') || 'all',
    limit: Math.min(parseInt(url.searchParams.get('limit') || '20', 10), MAX_RESULTS),
  };
}

async function searchPractitioners(params: SearchParams) {
  const where: string[] = [];
  const qp: Record<string, string> = {};

  if (params.npi) { where.push('_npi = @npi'); qp.npi = params.npi; }
  if (params.name) { where.push('(LOWER(_family_name) LIKE LOWER(@name) OR LOWER(_given_name) LIKE LOWER(@name))'); qp.name = '%' + params.name + '%'; }
  if (params.state) { where.push('_state = @state'); qp.state = params.state; }
  if (params.city) { where.push('LOWER(_city) LIKE LOWER(@city)'); qp.city = '%' + params.city + '%'; }
  if (where.length === 0) return [];

  return runQuery(
    'SELECT _npi AS npi, _family_name AS family_name, _given_name AS given_name, ' +
    '_gender AS gender, _state AS state, _city AS city, _postal_code AS postal_code, ' +
    '_active AS active ' +
    'FROM ' + tbl('practitioner') + ' ' +
    'WHERE ' + where.join(' AND ') + ' LIMIT ' + params.limit,
    qp
  );
}

async function searchOrganizations(params: SearchParams) {
  const where: string[] = [];
  const qp: Record<string, string> = {};

  if (params.npi) { where.push('_npi = @npi'); qp.npi = params.npi; }
  if (params.org || params.name) { where.push('LOWER(_name) LIKE LOWER(@orgName)'); qp.orgName = '%' + (params.org || params.name) + '%'; }
  if (params.state) { where.push('_state = @state'); qp.state = params.state; }
  if (where.length === 0) return [];

  return runQuery(
    'SELECT _npi AS npi, _name AS name, _org_type AS org_type, ' +
    '_state AS state, _city AS city, _active AS active ' +
    'FROM ' + tbl('organization') + ' ' +
    'WHERE ' + where.join(' AND ') + ' LIMIT ' + params.limit,
    qp
  );
}

async function searchLocations(params: SearchParams) {
  const where: string[] = [];
  const qp: Record<string, string> = {};

  if (params.state) { where.push('_state = @state'); qp.state = params.state; }
  if (params.city) { where.push('LOWER(_city) LIKE LOWER(@city)'); qp.city = '%' + params.city + '%'; }
  if (params.name) { where.push('LOWER(_name) LIKE LOWER(@lname)'); qp.lname = '%' + params.name + '%'; }
  if (where.length === 0) return [];

  return runQuery(
    'SELECT _name AS name, _status AS status, _state AS state, _city AS city, ' +
    '_postal_code AS postal_code, _managing_org_id AS managing_org_id ' +
    'FROM ' + tbl('location') + ' ' +
    'WHERE ' + where.join(' AND ') + ' LIMIT ' + params.limit,
    qp
  );
}

async function searchEndpoints(params: SearchParams) {
  const where: string[] = [];
  const qp: Record<string, string> = {};

  // Endpoint stores _managing_org_id (FHIR ref like "Organization/Organization-1234"),
  // not the org name. To search by org name we JOIN to organization.
  if (params.org) {
    where.push('LOWER(o._name) LIKE LOWER(@org)');
    qp.org = '%' + params.org + '%';
  }
  if (params.name) {
    where.push('LOWER(e._name) LIKE LOWER(@ename)');
    qp.ename = '%' + params.name + '%';
  }
  if (where.length === 0) return [];

  return runQuery(
    'SELECT e._name AS name, e._status AS status, e._connection_type AS connection_type, ' +
    'e._address AS endpoint_url, o._name AS managing_org ' +
    'FROM ' + tbl('endpoint') + ' e ' +
    'LEFT JOIN ' + tbl('organization') + ' o ON e._managing_org_id = CONCAT("Organization/", o._id) ' +
    'WHERE ' + where.join(' AND ') + ' LIMIT ' + params.limit,
    qp
  );
}

async function getProviderProfile(npi: string) {
  // First find the practitioner and their _id so we can build the FHIR reference
  const practitioners = await runQuery(
    'SELECT _id, _npi AS npi, _family_name AS family_name, _given_name AS given_name, ' +
    '_gender AS gender, _state AS state, _city AS city, _postal_code AS postal_code, _active AS active ' +
    'FROM ' + tbl('practitioner') + ' WHERE _npi = @npi LIMIT 1',
    { npi }
  ) as Array<Record<string, unknown>>;

  if (practitioners.length === 0) {
    return { practitioner: null, roles: [], endpoints: [] };
  }

  const practitionerRef = 'Practitioner/' + practitioners[0]._id;

  const [roles, endpoints] = await Promise.all([
    runQuery(
      'SELECT _practitioner_id, _org_id, _specialty_code, _specialty_display, _active ' +
      'FROM ' + tbl('practitioner_role') + ' WHERE _practitioner_id = @ref LIMIT 100',
      { ref: practitionerRef }
    ),
    runQuery(
      'SELECT e._name AS name, e._status AS status, e._connection_type AS connection_type, ' +
      'e._address AS endpoint_url, o._name AS managing_org ' +
      'FROM ' + tbl('practitioner_role') + ' pr ' +
      'JOIN ' + tbl('organization') + ' o ON pr._org_id = CONCAT("Organization/", o._id) ' +
      'JOIN ' + tbl('endpoint') + ' e ON e._managing_org_id = CONCAT("Organization/", o._id) ' +
      'WHERE pr._practitioner_id = @ref LIMIT 20',
      { ref: practitionerRef }
    ),
  ]);

  return { practitioner: practitioners[0], roles, endpoints };
}

export async function GET(req: NextRequest) {
  try {
    const params = parseSearchParams(req);

    if (!params.npi && !params.name && !params.state && !params.city && !params.specialty && !params.org) {
      return NextResponse.json(
        { error: 'At least one search parameter required: npi, name, state, city, specialty, org' },
        { status: 400 }
      );
    }

    if (params.npi && params.type === 'all') {
      const profile = await getProviderProfile(params.npi);
      return NextResponse.json({ type: 'provider_profile', data: profile, source: 'cms_npd', release_date: '2026-04-09' });
    }

    const results: Record<string, unknown[]> = {};
    if (params.type === 'all' || params.type === 'practitioner') results.practitioners = await searchPractitioners(params);
    if (params.type === 'all' || params.type === 'organization') results.organizations = await searchOrganizations(params);
    if (params.type === 'all' || params.type === 'location') results.locations = await searchLocations(params);
    if (params.type === 'all' || params.type === 'endpoint') results.endpoints = await searchEndpoints(params);

    const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

    return NextResponse.json({ type: 'search', query: params, total_results: totalResults, data: results, source: 'cms_npd', release_date: '2026-04-09' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('NPD search error:', message);
    return NextResponse.json({ error: 'Search failed: ' + message }, { status: 500 });
  }
}
