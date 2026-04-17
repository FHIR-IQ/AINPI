import { NextRequest, NextResponse } from 'next/server';
import { getBigQueryClient } from '@/lib/bigquery';
import { parseNameQuery, groupRolesBySpecialty, type RoleRow } from '@/lib/npd-search-utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

  if (params.npi) {
    where.push('_npi = @npi');
    qp.npi = params.npi;
  }

  if (params.name) {
    const { family, given } = parseNameQuery(params.name);
    if (family && given) {
      where.push(
        '((LOWER(_family_name) LIKE LOWER(@familyTok) AND LOWER(_given_name) LIKE LOWER(@givenTok)) ' +
        'OR (LOWER(_family_name) LIKE LOWER(@givenTok) AND LOWER(_given_name) LIKE LOWER(@familyTok)))'
      );
      qp.familyTok = '%' + family + '%';
      qp.givenTok = '%' + given + '%';
    } else if (family) {
      where.push('(LOWER(_family_name) LIKE LOWER(@name) OR LOWER(_given_name) LIKE LOWER(@name))');
      qp.name = '%' + family + '%';
    }
  }

  // State search matches the extracted _state (address[0]) OR any address in the array.
  // This catches providers whose primary practice address is 2nd/3rd in the list.
  if (params.state) {
    where.push(
      '(_state = @state OR EXISTS(' +
      'SELECT 1 FROM UNNEST(JSON_EXTRACT_ARRAY(resource, "$.address")) a ' +
      'WHERE JSON_EXTRACT_SCALAR(a, "$.state") = @state))'
    );
    qp.state = params.state;
  }

  if (params.city) {
    where.push(
      '(LOWER(_city) LIKE LOWER(@city) OR EXISTS(' +
      'SELECT 1 FROM UNNEST(JSON_EXTRACT_ARRAY(resource, "$.address")) a ' +
      'WHERE LOWER(JSON_EXTRACT_SCALAR(a, "$.city")) LIKE LOWER(@city)))'
    );
    qp.city = '%' + params.city + '%';
  }

  if (where.length === 0) return [];

  // Return a deduplicated list of states across all addresses so the UI can
  // show "CA, NY, PA" rather than just the first one.
  return runQuery(
    'SELECT ' +
    '_npi AS npi, _family_name AS family_name, _given_name AS given_name, ' +
    '_gender AS gender, _state AS state, _city AS city, _postal_code AS postal_code, ' +
    '_active AS active, ' +
    '(SELECT STRING_AGG(DISTINCT JSON_EXTRACT_SCALAR(a, "$.state"), ",") ' +
    ' FROM UNNEST(JSON_EXTRACT_ARRAY(resource, "$.address")) a ' +
    ' WHERE JSON_EXTRACT_SCALAR(a, "$.state") IS NOT NULL) AS all_states ' +
    'FROM ' + tbl('practitioner') + ' ' +
    'WHERE ' + where.join(' AND ') + ' LIMIT ' + params.limit,
    qp
  );
}

async function searchOrganizations(params: SearchParams) {
  const where: string[] = [];
  const qp: Record<string, string> = {};

  if (params.npi) {
    where.push('_npi = @npi');
    qp.npi = params.npi;
  }
  if (params.org || params.name) {
    const q = (params.org || params.name || '').trim();
    // Match _name OR any alias in resource.alias[] (alias array is 0%-populated
    // in the 2026-04-09 release but including it keeps us forward-compatible
    // and costs essentially nothing per query).
    where.push(
      '(LOWER(_name) LIKE LOWER(@orgName) OR EXISTS(' +
      'SELECT 1 FROM UNNEST(JSON_EXTRACT_STRING_ARRAY(resource, "$.alias")) a ' +
      'WHERE LOWER(a) LIKE LOWER(@orgName)))'
    );
    qp.orgName = '%' + q + '%';
  }
  if (params.state) {
    where.push('_state = @state');
    qp.state = params.state;
  }
  if (where.length === 0) return [];

  // Include partOf so the UI can show parent-org relationships.
  return runQuery(
    'SELECT _id AS id, _npi AS npi, _name AS name, _org_type AS org_type, ' +
    '_state AS state, _city AS city, _active AS active, ' +
    'JSON_EXTRACT_SCALAR(resource, "$.partOf.reference") AS part_of_ref ' +
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

  if (params.org) { where.push('LOWER(o._name) LIKE LOWER(@org)'); qp.org = '%' + params.org + '%'; }
  if (params.name) { where.push('LOWER(e._name) LIKE LOWER(@ename)'); qp.ename = '%' + params.name + '%'; }
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
  // Find the practitioner + all their addresses (parsed from resource JSON)
  const practitioners = await runQuery(
    'SELECT _id, _npi AS npi, _family_name AS family_name, _given_name AS given_name, ' +
    '_gender AS gender, _active AS active, ' +
    'TO_JSON_STRING(JSON_EXTRACT_ARRAY(resource, "$.address")) AS addresses_json, ' +
    'TO_JSON_STRING(JSON_EXTRACT_ARRAY(resource, "$.telecom")) AS telecom_json, ' +
    'TO_JSON_STRING(JSON_EXTRACT_ARRAY(resource, "$.qualification")) AS qualification_json ' +
    'FROM ' + tbl('practitioner') + ' WHERE _npi = @npi LIMIT 1',
    { npi }
  ) as Array<Record<string, unknown>>;

  if (practitioners.length === 0) {
    return { practitioner: null, roles: [], endpoints: [], specialties: [] };
  }

  const practitionerRef = 'Practitioner/' + practitioners[0]._id;

  const [rawRoles, endpoints] = await Promise.all([
    runQuery(
      'SELECT _practitioner_id, _org_id, _specialty_code, _specialty_display, _active ' +
      'FROM ' + tbl('practitioner_role') + ' WHERE _practitioner_id = @ref LIMIT 200',
      { ref: practitionerRef }
    ) as Promise<RoleRow[]>,
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

  const specialties = groupRolesBySpecialty(rawRoles);

  return {
    practitioner: practitioners[0],
    roles: rawRoles,           // raw list (for debugging / API consumers)
    specialties,               // grouped view (for UI)
    endpoints,
  };
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
      return NextResponse.json({
        type: 'provider_profile',
        data: profile,
        source: 'cms_npd',
        release_date: '2026-04-09',
      });
    }

    const results: Record<string, unknown[]> = {};
    if (params.type === 'all' || params.type === 'practitioner') results.practitioners = await searchPractitioners(params);
    if (params.type === 'all' || params.type === 'organization') results.organizations = await searchOrganizations(params);
    if (params.type === 'all' || params.type === 'location') results.locations = await searchLocations(params);
    if (params.type === 'all' || params.type === 'endpoint') results.endpoints = await searchEndpoints(params);

    const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

    return NextResponse.json({
      type: 'search',
      query: params,
      total_results: totalResults,
      data: results,
      source: 'cms_npd',
      release_date: '2026-04-09',
      // Hint for the UI about how we expanded the search
      search_scope_notes: [
        params.name ? 'Name matches use fuzzy multi-token + credential-suffix stripping.' : null,
        params.state ? 'State matches any address in the practitioner\'s address[] array, not just the primary one.' : null,
        params.org ? 'Org matches both _name and Organization.alias[]. Note: alias is 0% populated in 2026-04-09 release.' : null,
      ].filter(Boolean),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('NPD search error:', message);
    return NextResponse.json({ error: 'Search failed: ' + message }, { status: 500 });
  }
}
