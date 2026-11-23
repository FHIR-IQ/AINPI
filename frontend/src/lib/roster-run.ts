/**
 * One roster verification, end to end, for a caller already identified:
 * tier limit, quota charge, sources, assembly, audit. Used by
 * POST /api/v1/roster/verify and the `verify_roster` MCP tool.
 */
import { prisma } from '@/lib/prisma';
import { CURRENT_RELEASE } from '@/lib/release';
import { enforceForCaller, type Caller } from '@/lib/rate-limit';
import { getSuppressedNpis } from '@/lib/suppression';
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
  type RosterResult,
  type RosterSummary,
} from '@/lib/roster';
import { fetchNppes, queryWarehouse } from '@/lib/roster-sources';

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

let tableDates: { at: number; value: Record<string, string> } | null = null;

/** When the exclusion tables were last loaded. Metadata only; cached 6 hours. */
async function exclusionDates(): Promise<Record<string, string>> {
  if (tableDates && Date.now() - tableDates.at < 6 * 3_600_000) return tableDates.value;
  try {
    const rows = await queryBigQuery<{ table_id: string; last_modified_time: number }>(
      `SELECT table_id, last_modified_time FROM \`${getProjectId()}.${getDatasetId()}.__TABLES__\`
       WHERE table_id IN ('oig_leie', 'sam_exclusions')`,
      undefined,
      { maximumBytesBilled: 10_000_000 },
    );
    const value: Record<string, string> = {};
    for (const r of rows) value[r.table_id] = new Date(Number(r.last_modified_time)).toISOString().slice(0, 10);
    tableDates = { at: Date.now(), value };
    return value;
  } catch {
    return {};
  }
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

  const suppressed = await getSuppressedNpis();
  const lookup = parsed.npis.filter((x) => !suppressed.has(x));
  const [warehouse, nppes, index, dates] = await Promise.all([
    queryWarehouse(lookup).catch(() => null),
    fetchNppes(lookup),
    loadOrgIndex().then((l) => l.index).catch(() => null),
    exclusionDates(),
  ]);

  const results: RosterResult[] = parsed.npis.map((npi) =>
    assemble({
      npi,
      row: warehouse ? warehouse.get(npi) ?? { npi, prac: null, org: null, roles: null, leie: null, sam: null } : null,
      nppes: nppes.get(npi) ?? { checked: false },
      index,
      suppressed: suppressed.has(npi),
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
        oig_leie: `OIG LEIE${dates.oig_leie ? `, loaded ${dates.oig_leie}` : ''}`,
        sam: `SAM.gov exclusions extract${dates.sam_exclusions ? `, loaded ${dates.sam_exclusions}` : ''}`,
        endpoints: 'AINPI H50 NDH endpoint crosswalk and H51 EHR vendor endpoint files',
      },
      results,
      disclaimer: DISCLAIMER,
    },
  };
}
