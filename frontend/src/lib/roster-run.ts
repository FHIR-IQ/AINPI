/**
 * One roster verification, end to end, for a caller already identified:
 * tier limit, quota charge, sources, assembly, audit. Used by
 * POST /api/v1/roster/verify and the `verify_roster` MCP tool.
 */
import { prisma } from '@/lib/prisma';
import { CURRENT_RELEASE } from '@/lib/release';
import { enforceForCaller, type Caller } from '@/lib/rate-limit';
import { getOrgSuppressedNpis, getSuppressedNpis } from '@/lib/suppression';
import { getDatasetId, getProjectId, queryBigQuery } from '@/lib/bigquery';
import { loadOrgIndex } from '@/lib/org-index';
import {
  BATCH_LIMITS,
  DISCLAIMER,
  assemble,
  invalidResult,
  parseRoster,
  rosterUnits,
  summarize,
  type NppesResult,
  type RosterResult,
  type RosterSummary,
} from '@/lib/roster';
import { fetchNppes, queryWarehouse } from '@/lib/roster-sources';

const BATCH_DEADLINE_MS = 40_000;

export interface RosterResponse {
  checked_at: string;
  summary: RosterSummary;
  sources: Record<string, string>;
  results: RosterResult[];
  disclaimer: string;
}

export type RunOutcome =
  | { status: 200; body: RosterResponse }
  | { status: number; body: { error: string }; retryAfter?: number };

/**
 * Positive control for the exclusion checks: how many active, NPI-bearing
 * rows each table holds right now. 9,023 (LEIE) and 7,063 (SAM) on
 * 2026-11-22. Below these floors the table is broken or the filter no longer
 * matches (the H24 "0 of 0" failure of 2026-10-12), and every NPI would read
 * as not excluded, so exclusions are reported as not checked instead.
 */
export const LEIE_FLOOR = 4500;
export const SAM_FLOOR = 3500;

interface ExclusionState {
  ok: boolean;
  dates: Record<string, string>;
}
let exclusionCache: { at: number; value: ExclusionState } | null = null;

async function exclusionState(): Promise<ExclusionState> {
  if (exclusionCache && Date.now() - exclusionCache.at < 6 * 3_600_000) return exclusionCache.value;
  const p = `${getProjectId()}.${getDatasetId()}`;
  try {
    const [row] = await queryBigQuery<{ leie: number; sam: number; leie_mod: number; sam_mod: number }>(
      `SELECT
         (SELECT COUNT(*) FROM \`${p}.oig_leie\` WHERE NPI NOT IN ('', '0000000000')
            AND (REINDATE = '00000000' OR REINDATE IS NULL OR REINDATE = '')) AS leie,
         (SELECT COUNT(*) FROM \`${p}.sam_exclusions\` WHERE record_status = 'Active'
            AND REGEXP_CONTAINS(npi, r'^[1-9]\\d{9}$')) AS sam,
         (SELECT last_modified_time FROM \`${p}.__TABLES__\` WHERE table_id = 'oig_leie') AS leie_mod,
         (SELECT last_modified_time FROM \`${p}.__TABLES__\` WHERE table_id = 'sam_exclusions') AS sam_mod`,
      undefined,
      { maximumBytesBilled: 500_000_000 },
    );
    const day = (ms: number) => new Date(Number(ms)).toISOString().slice(0, 10);
    const value: ExclusionState = {
      ok: Number(row.leie) >= LEIE_FLOOR && Number(row.sam) >= SAM_FLOOR,
      dates: { oig_leie: day(row.leie_mod), sam_exclusions: day(row.sam_mod) },
    };
    exclusionCache = { at: Date.now(), value };
    if (!value.ok) console.error('[roster] exclusion tables below their floors; exclusions reported as not checked');
    return value;
  } catch {
    // Unknown is not "fine": without the control, do not vouch for a zero.
    return { ok: false, dates: {} };
  }
}

/**
 * Positive control for NPPES: a batch in which every lookup came back "not
 * found" is far likelier to be a changed or failing API than a roster of
 * deactivated NPIs, so it is reported as not checked.
 */
export function nppesControl(results: Map<string, NppesResult>): Map<string, NppesResult> {
  const checked = Array.from(results.values()).filter((r) => r.checked);
  if (checked.length >= 5 && checked.every((r) => r.checked && !r.found)) {
    return new Map(Array.from(results.keys()).map((k) => [k, { checked: false } as NppesResult]));
  }
  return results;
}

function audit(caller: Caller, surface: string, npiCount: number, flagged: number, outcome: string) {
  // Counts only. The NPI list is never logged.
  void prisma.rosterVerification
    .create({ data: { keyId: caller.keyId ?? 'none', surface, npiCount, flaggedCount: flagged, outcome } })
    .catch(() => {});
}

export async function runRoster(caller: Caller, input: unknown, surface: 'api' | 'mcp'): Promise<RunOutcome> {
  const limit = caller.keyId ? BATCH_LIMITS[caller.tier.name] : undefined;
  if (!limit) {
    return {
      status: 401,
      body: { error: 'Roster verification needs an AINPI API key. Start a 14-day trial at https://ainpi.dev/trial.' },
    };
  }
  const parsed = parseRoster(input, limit);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  const n = parsed.npis.length + parsed.invalid.length;
  const charge = await enforceForCaller(caller, { shape: 'roster/verify', units: rosterUnits(n) });
  if (!charge.ok) {
    const status = charge.response?.status ?? 429;
    audit(caller, surface, n, 0, `refused-${status}`);
    return {
      status,
      body: { error: (await charge.response?.json().catch(() => null))?.error ?? 'Quota exceeded.' },
      retryAfter: Number(charge.response?.headers.get('retry-after')) || undefined,
    };
  }

  const [suppressed, hiddenOrgNpis] = await Promise.all([getSuppressedNpis(), getOrgSuppressedNpis()]);
  const lookup = parsed.npis.filter((x) => !suppressed.has(x));
  // The whole batch must finish inside the 60 s function limit.
  const deadline = Date.now() + BATCH_DEADLINE_MS;
  const [warehouse, nppesRaw, index, exclusions] = await Promise.all([
    queryWarehouse(lookup).catch(() => null),
    fetchNppes(lookup, deadline),
    loadOrgIndex().then((l) => l.index).catch(() => null),
    exclusionState(),
  ]);
  const nppes = nppesControl(nppesRaw);
  const dates = exclusions.dates;

  const results: RosterResult[] = parsed.npis.map((npi) =>
    assemble({
      npi,
      row: warehouse ? warehouse.get(npi) ?? { npi, prac: null, org: null, roles: null, leie: null, sam: null } : null,
      nppes: nppes.get(npi) ?? { checked: false },
      index,
      suppressed: suppressed.has(npi),
      exclusionsOk: exclusions.ok,
      hiddenOrgNpis,
    }),
  );
  for (const npi of parsed.invalid) results.push(invalidResult(npi));

  const summary = summarize(results, parsed.duplicates);
  audit(caller, surface, n, summary.flagged, warehouse ? 'ok' : 'partial');
  return {
    status: 200,
    body: {
      checked_at: new Date().toISOString(),
      summary,
      sources: {
        ndh: `CMS National Provider Directory bulk export, release ${CURRENT_RELEASE}`,
        nppes: 'NPPES NPI Registry API, queried live',
        oig_leie: `OIG LEIE${dates.oig_leie ? `, loaded ${dates.oig_leie}` : ', load date unknown'}; matched on NPI, which most LEIE records lack`,
        sam: `SAM.gov exclusions extract${dates.sam_exclusions ? `, loaded ${dates.sam_exclusions}` : ', load date unknown'}; matched on NPI`,
        endpoints: 'AINPI H50 NDH endpoint crosswalk and H51 EHR vendor endpoint files',
      },
      results,
      disclaimer: DISCLAIMER,
    },
  };
}
