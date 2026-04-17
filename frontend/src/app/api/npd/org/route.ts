import { NextRequest, NextResponse } from 'next/server';
import { getBigQueryClient } from '@/lib/bigquery';
import { refToId } from '@/lib/npd-search-utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

/**
 * GET /api/npd/org?id=<org_id>   — resolve a single org by its internal _id
 * GET /api/npd/org?npi=<npi>     — resolve by NPI
 *
 * Returns:
 *   - the org itself (with addresses, telecom, partOf)
 *   - parent (if partOf is set) fetched by reference
 *   - subsidiaries (other orgs whose partOf points back here)
 *   - counts: practitioners, endpoints, locations
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const npi = url.searchParams.get('npi');
    if (!id && !npi) {
      return NextResponse.json({ error: 'id or npi parameter required' }, { status: 400 });
    }

    const where = id ? '_id = @id' : '_npi = @npi';
    const qp: Record<string, string> = id ? { id } : { npi: npi! };

    const orgRows = await runQuery(
      'SELECT _id AS id, _npi AS npi, _name AS name, _org_type AS org_type, ' +
      '_state AS state, _city AS city, _active AS active, ' +
      'JSON_EXTRACT_SCALAR(resource, "$.partOf.reference") AS part_of_ref, ' +
      'TO_JSON_STRING(JSON_EXTRACT_ARRAY(resource, "$.address")) AS addresses_json, ' +
      'TO_JSON_STRING(JSON_EXTRACT_ARRAY(resource, "$.telecom")) AS telecom_json, ' +
      'TO_JSON_STRING(JSON_EXTRACT_ARRAY(resource, "$.alias")) AS aliases_json ' +
      'FROM ' + tbl('organization') + ' WHERE ' + where + ' LIMIT 1',
      qp
    ) as Array<Record<string, string | boolean | null>>;

    if (orgRows.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const org = orgRows[0];
    const orgRef = 'Organization/' + org.id;

    // Parent (via partOf) and subsidiaries run in parallel with the usage counts
    const parentId = refToId(org.part_of_ref as string | null);
    const [parentRows, childrenRows, usage] = await Promise.all([
      parentId
        ? (runQuery(
            'SELECT _id AS id, _npi AS npi, _name AS name, _state AS state, _city AS city, _active AS active ' +
            'FROM ' + tbl('organization') + ' WHERE _id = @pid LIMIT 1',
            { pid: parentId }
          ) as Promise<Array<Record<string, unknown>>>)
        : Promise.resolve([]),
      runQuery(
        'SELECT _id AS id, _npi AS npi, _name AS name, _state AS state, _city AS city, _active AS active ' +
        'FROM ' + tbl('organization') + ' ' +
        'WHERE JSON_EXTRACT_SCALAR(resource, "$.partOf.reference") = @ref ' +
        'ORDER BY _name LIMIT 100',
        { ref: orgRef }
      ) as Promise<Array<Record<string, unknown>>>,
      runQuery(
        'SELECT ' +
        '(SELECT COUNT(DISTINCT _practitioner_id) FROM ' + tbl('practitioner_role') + ' WHERE _org_id = @ref) AS practitioners, ' +
        '(SELECT COUNT(*) FROM ' + tbl('practitioner_role') + ' WHERE _org_id = @ref) AS roles, ' +
        '(SELECT COUNT(*) FROM ' + tbl('endpoint') + ' WHERE _managing_org_id = @ref) AS endpoints, ' +
        '(SELECT COUNT(*) FROM ' + tbl('location') + ' WHERE _managing_org_id = @ref) AS locations',
        { ref: orgRef }
      ) as Promise<Array<Record<string, string | number>>>,
    ]);

    return NextResponse.json({
      organization: org,
      parent: parentRows[0] || null,
      subsidiaries: childrenRows,
      usage: {
        unique_practitioners: Number(usage[0]?.practitioners || 0),
        total_roles: Number(usage[0]?.roles || 0),
        endpoints: Number(usage[0]?.endpoints || 0),
        locations: Number(usage[0]?.locations || 0),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Org detail error:', message);
    return NextResponse.json({ error: 'Failed: ' + message }, { status: 500 });
  }
}
