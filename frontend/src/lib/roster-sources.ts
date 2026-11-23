/**
 * I/O for roster verification: one capped BigQuery query per batch, the live
 * NPPES registry, and the shared endpoint index. Rules for interpreting what
 * comes back live in src/lib/roster.ts.
 *
 * Cost: the warehouse query filters every table on its cluster key or on a
 * small table (dry-run upper bound 28.8 MB for any batch, 2026-11-22) and runs
 * under ROSTER_MAX_BYTES, far below the project default.
 */
import { getDatasetId, getProjectId, queryBigQuery } from '@/lib/bigquery';
import type { NppesResult, WarehouseRow } from '@/lib/roster';

export const ROSTER_MAX_BYTES = 2_000_000_000; // 2 GB; the measured bound is 28.8 MB
const NPPES_URL = 'https://npiregistry.cms.hhs.gov/api/?version=2.1&number=';
const NPPES_TIMEOUT_MS = 5000;
const NPPES_CONCURRENCY = 8;
const NPPES_TTL_MS = 6 * 60 * 60 * 1000;
const NPPES_CACHE_MAX = 20_000;

export function rosterSql(project: string, dataset: string): string {
  const t = (name: string) => `\`${project}.${dataset}.${name}\``;
  return `
WITH
prac AS (SELECT _npi AS npi, _active AS active, _family_name AS family, _given_name AS given, _state AS state
         FROM ${t('practitioner')} WHERE _npi IN UNNEST(@npis)),
org AS (SELECT _npi AS npi, _active AS active, _name AS name, _state AS state
        FROM ${t('organization')} WHERE _npi IN UNNEST(@npis)),
roles AS (SELECT REGEXP_EXTRACT(_practitioner_id, r'(\\d{10})$') AS npi, COUNTIF(_active) AS active_roles,
                 ARRAY_AGG(DISTINCT _org_id IGNORE NULLS LIMIT 50) AS org_refs
          FROM ${t('practitioner_role')} WHERE _practitioner_id IN UNNEST(@prefs) GROUP BY 1),
leie AS (SELECT NPI AS npi, MIN(EXCLDATE) AS excldate, ANY_VALUE(EXCLTYPE) AS excltype
         FROM ${t('oig_leie')}
         WHERE NPI IN UNNEST(@npis) AND (REINDATE = '00000000' OR REINDATE IS NULL OR REINDATE = '') GROUP BY 1),
sam AS (SELECT npi, CAST(MIN(active_date) AS STRING) AS active_date, ANY_VALUE(name) AS name,
               ANY_VALUE(first_name) AS first_name, ANY_VALUE(last_name) AS last_name, ANY_VALUE(excluding_agency) AS agency
        FROM ${t('sam_exclusions')} WHERE npi IN UNNEST(@npis) AND record_status = 'Active' GROUP BY 1)
SELECT n AS npi, TO_JSON_STRING(prac) AS prac, TO_JSON_STRING(org) AS org, TO_JSON_STRING(roles) AS roles,
       TO_JSON_STRING(leie) AS leie, TO_JSON_STRING(sam) AS sam
FROM UNNEST(@npis) AS n
LEFT JOIN prac ON prac.npi = n LEFT JOIN org ON org.npi = n LEFT JOIN roles ON roles.npi = n
LEFT JOIN leie ON leie.npi = n LEFT JOIN sam ON sam.npi = n`;
}

/** A LEFT JOIN miss serializes as an object of nulls; treat that as absent. */
function parsePart<T>(json: unknown): T | null {
  if (typeof json !== 'string') return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown> | null;
    if (!o || Object.values(o).every((v) => v === null)) return null;
    return o as T;
  } catch {
    return null;
  }
}

/** Map of npi -> row. Throws on a query failure; the caller reports "not checked". */
export async function queryWarehouse(npis: string[]): Promise<Map<string, WarehouseRow>> {
  const out = new Map<string, WarehouseRow>();
  if (npis.length === 0) return out;
  const rows = await queryBigQuery<Record<string, unknown>>(
    rosterSql(getProjectId(), getDatasetId()),
    { npis, prefs: npis.map((n) => `Practitioner/Practitioner-${n}`) },
    { maximumBytesBilled: ROSTER_MAX_BYTES },
  );
  for (const r of rows) {
    const npi = String(r.npi);
    out.set(npi, {
      npi,
      prac: parsePart(r.prac),
      org: parsePart(r.org),
      roles: parsePart(r.roles),
      leie: parsePart(r.leie),
      sam: parsePart(r.sam),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// NPPES
// ---------------------------------------------------------------------------

const nppesCache = new Map<string, { at: number; value: NppesResult }>();

/** Parse one registry response. Exported for tests. */
export function parseNppes(body: unknown): NppesResult {
  const b = body as { result_count?: number; results?: Record<string, unknown>[]; Errors?: unknown };
  if (!b || typeof b !== 'object' || b.Errors || typeof b.result_count !== 'number') return { checked: false };
  if (b.result_count === 0 || !b.results?.length) return { checked: true, found: false };
  const r = b.results[0] as {
    enumeration_type?: string;
    basic?: Record<string, string | null | undefined>;
    taxonomies?: { code?: string; desc?: string; primary?: boolean }[];
  };
  const basic = r.basic ?? {};
  const name = basic.organization_name || [basic.first_name, basic.last_name].filter(Boolean).join(' ');
  const primary = (r.taxonomies ?? []).find((t) => t.primary) ?? (r.taxonomies ?? [])[0];
  return {
    checked: true,
    found: true,
    enumeration_type: r.enumeration_type ?? 'unknown',
    status: basic.status ?? null,
    name: name || '',
    last_name: basic.last_name ?? null,
    first_name: basic.first_name ?? null,
    primary_taxonomy: primary?.code ? { code: primary.code, desc: primary.desc ?? null } : null,
    last_updated: basic.last_updated ?? null,
  };
}

async function fetchOne(npi: string): Promise<NppesResult> {
  const hit = nppesCache.get(npi);
  if (hit && Date.now() - hit.at < NPPES_TTL_MS) return hit.value;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NPPES_TIMEOUT_MS);
  try {
    const res = await fetch(`${NPPES_URL}${npi}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return { checked: false };
    const value = parseNppes(await res.json());
    // Only answers are cached; a failure is retried on the next call.
    if (value.checked) {
      if (nppesCache.size >= NPPES_CACHE_MAX) nppesCache.clear();
      nppesCache.set(npi, { at: Date.now(), value });
    }
    return value;
  } catch {
    return { checked: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Live registry lookups, NPPES_CONCURRENCY at a time. Never throws. */
export async function fetchNppes(npis: string[]): Promise<Map<string, NppesResult>> {
  const out = new Map<string, NppesResult>();
  let next = 0;
  const worker = async () => {
    while (next < npis.length) {
      const npi = npis[next++];
      out.set(npi, await fetchOne(npi));
    }
  };
  await Promise.all(Array.from({ length: Math.min(NPPES_CONCURRENCY, npis.length) }, worker));
  return out;
}
