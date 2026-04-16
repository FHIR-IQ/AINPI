import { NextRequest, NextResponse } from 'next/server';
import { queryBigQuery } from '@/lib/bigquery';

/**
 * CMS National Provider Directory Search API
 *
 * Public search endpoint — no authentication required.
 * Queries BigQuery for provider, organization, location, and endpoint data.
 *
 * GET /api/npd/search?npi=1234567890
 * GET /api/npd/search?name=Smith&state=CA
 * GET /api/npd/search?org=Mayo+Clinic
 * GET /api/npd/search?specialty=207R00000X
 */

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';
const MAX_RESULTS = 50;

interface SearchParams {
  npi?: string;
  name?: string;
  state?: string;
  city?: string;
  specialty?: string;
  org?: string;
  type?: 'practitioner' | 'organization' | 'location' | 'endpoint' | 'all';
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
    type: (url.searchParams.get('type') as SearchParams['type']) || 'all',
    limit: Math.min(parseInt(url.searchParams.get('limit') || '20', 10), MAX_RESULTS),
  };
}

function sanitize(value: string): string {
  // Prevent SQL injection in BigQuery parameterized queries
  return value.replace(/['"\\;]/g, '');
}

async function searchPractitioners(params: SearchParams) {
  const conditions: string[] = [];
  const queryParams: Record<string, string> = {};

  if (params.npi) {
    conditions.push('_npi = @npi');
    queryParams.npi = sanitize(params.npi);
  }
  if (params.name) {
    conditions.push('(LOWER(_family_name) LIKE LOWER(@name) OR LOWER(_given_name) LIKE LOWER(@name))');
    queryParams.name = `%${sanitize(params.name)}%`;
  }
  if (params.state) {
    conditions.push('_state = @state');
    queryParams.state = sanitize(params.state);
  }
  if (params.city) {
    conditions.push('LOWER(_city) LIKE LOWER(@city)');
    queryParams.city = `%${sanitize(params.city)}%`;
  }

  if (conditions.length === 0) return [];

  const sql = `
    SELECT
      id, _npi AS npi, _family_name AS family_name, _given_name AS given_name,
      gender, _state AS state, _city AS city, _postal_code AS postal_code,
      active,
      TO_JSON_STRING(telecom) AS telecom,
      TO_JSON_STRING(address) AS address,
      TO_JSON_STRING(qualification) AS qualification
    FROM \`${PROJECT_ID}.${DATASET_ID}.practitioner\`
    WHERE ${conditions.join(' AND ')}
    LIMIT ${params.limit}
  `;

  return queryBigQuery(sql, queryParams);
}

async function searchOrganizations(params: SearchParams) {
  const conditions: string[] = [];
  const queryParams: Record<string, string> = {};

  if (params.npi) {
    conditions.push('_npi = @npi');
    queryParams.npi = sanitize(params.npi);
  }
  if (params.org || params.name) {
    conditions.push('LOWER(name) LIKE LOWER(@orgName)');
    queryParams.orgName = `%${sanitize(params.org || params.name!)}%`;
  }
  if (params.state) {
    conditions.push('_state = @state');
    queryParams.state = sanitize(params.state);
  }

  if (conditions.length === 0) return [];

  const sql = `
    SELECT
      id, _npi AS npi, name, _org_type AS org_type,
      _state AS state, _city AS city, active,
      TO_JSON_STRING(telecom) AS telecom,
      TO_JSON_STRING(address) AS address
    FROM \`${PROJECT_ID}.${DATASET_ID}.organization\`
    WHERE ${conditions.join(' AND ')}
    LIMIT ${params.limit}
  `;

  return queryBigQuery(sql, queryParams);
}

async function searchLocations(params: SearchParams) {
  const conditions: string[] = [];
  const queryParams: Record<string, string> = {};

  if (params.state) {
    conditions.push('_state = @state');
    queryParams.state = sanitize(params.state);
  }
  if (params.city) {
    conditions.push('LOWER(_city) LIKE LOWER(@city)');
    queryParams.city = `%${sanitize(params.city)}%`;
  }
  if (params.name) {
    conditions.push('LOWER(name) LIKE LOWER(@name)');
    queryParams.name = `%${sanitize(params.name)}%`;
  }

  if (conditions.length === 0) return [];

  const sql = `
    SELECT
      id, name, status, _state AS state, _city AS city,
      _postal_code AS postal_code, _managing_org_npi AS managing_org_npi,
      TO_JSON_STRING(telecom) AS telecom,
      TO_JSON_STRING(address) AS address,
      TO_JSON_STRING(position) AS position
    FROM \`${PROJECT_ID}.${DATASET_ID}.location\`
    WHERE ${conditions.join(' AND ')}
    LIMIT ${params.limit}
  `;

  return queryBigQuery(sql, queryParams);
}

async function searchEndpoints(params: SearchParams) {
  const conditions: string[] = [];
  const queryParams: Record<string, string> = {};

  if (params.org) {
    conditions.push('LOWER(_managing_org_name) LIKE LOWER(@org)');
    queryParams.org = `%${sanitize(params.org)}%`;
  }
  if (params.name) {
    conditions.push('LOWER(name) LIKE LOWER(@name)');
    queryParams.name = `%${sanitize(params.name)}%`;
  }

  if (conditions.length === 0) return [];

  const sql = `
    SELECT
      id, status, _connection_type_code AS connection_type,
      name, address AS endpoint_url,
      _managing_org_name AS managing_org,
      _mime_types AS mime_types
    FROM \`${PROJECT_ID}.${DATASET_ID}.endpoint\`
    WHERE ${conditions.join(' AND ')}
    LIMIT ${params.limit}
  `;

  return queryBigQuery(sql, queryParams);
}

// Get full provider profile: practitioner + roles + endpoints
async function getProviderProfile(npi: string) {
  const [practitioners, roles, endpoints] = await Promise.all([
    queryBigQuery(
      `SELECT id, _npi AS npi, _family_name AS family_name, _given_name AS given_name,
              gender, _state AS state, _city AS city, _postal_code AS postal_code,
              active,
              TO_JSON_STRING(telecom) AS telecom,
              TO_JSON_STRING(address) AS address,
              TO_JSON_STRING(qualification) AS qualification
       FROM \`${PROJECT_ID}.${DATASET_ID}.practitioner\` WHERE _npi = @npi LIMIT 1`,
      { npi }
    ),
    queryBigQuery(
      `SELECT id, _practitioner_npi, _org_npi, _specialty_code, _specialty_display, active
       FROM \`${PROJECT_ID}.${DATASET_ID}.practitioner_role\` WHERE _practitioner_npi = @npi`,
      { npi }
    ),
    // Find endpoints through org affiliations
    queryBigQuery(`
      SELECT e.id, e.status, e._connection_type_code AS connection_type,
             e.name, e.address AS endpoint_url, e._managing_org_name AS managing_org,
             e._mime_types AS mime_types
      FROM \`${PROJECT_ID}.${DATASET_ID}.practitioner_role\` pr
      JOIN \`${PROJECT_ID}.${DATASET_ID}.organization\` o ON pr._org_npi = o._npi
      JOIN \`${PROJECT_ID}.${DATASET_ID}.endpoint\` e ON e._managing_org_name = o.name
      WHERE pr._practitioner_npi = @npi
      LIMIT 20
    `, { npi }),
  ]);

  return {
    practitioner: practitioners[0] || null,
    roles,
    endpoints,
  };
}

export async function GET(req: NextRequest) {
  try {
    const params = parseSearchParams(req);

    // Validate at least one search param
    if (!params.npi && !params.name && !params.state && !params.city && !params.specialty && !params.org) {
      return NextResponse.json(
        { error: 'At least one search parameter required: npi, name, state, city, specialty, org' },
        { status: 400 }
      );
    }

    // If NPI provided, return full provider profile
    if (params.npi && params.type === 'all') {
      const profile = await getProviderProfile(params.npi);
      return NextResponse.json({
        type: 'provider_profile',
        data: profile,
        source: 'cms_npd',
        release_date: '2026-04-09',
      });
    }

    // Run searches based on type
    const results: Record<string, unknown[]> = {};

    if (params.type === 'all' || params.type === 'practitioner') {
      results.practitioners = await searchPractitioners(params);
    }
    if (params.type === 'all' || params.type === 'organization') {
      results.organizations = await searchOrganizations(params);
    }
    if (params.type === 'all' || params.type === 'location') {
      results.locations = await searchLocations(params);
    }
    if (params.type === 'all' || params.type === 'endpoint') {
      results.endpoints = await searchEndpoints(params);
    }

    const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

    return NextResponse.json({
      type: 'search',
      query: params,
      total_results: totalResults,
      data: results,
      source: 'cms_npd',
      release_date: '2026-04-09',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('NPD search error:', message);
    return NextResponse.json(
      { error: `Search failed: ${message}` },
      { status: 500 }
    );
  }
}
