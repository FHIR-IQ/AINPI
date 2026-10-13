/**
 * marketplace-funnel: the Databricks Marketplace funnel section of the weekly
 * admin digest (/api/v1/admin/weekly-report).
 *
 * One SQL statement per digest run, aggregated in SQL, through the same
 * Statement API client the install poller uses (runStatement in
 * marketplace-install-poll.ts). It counts, per listing name, for the last 7
 * days and the 7 days before that:
 *
 *   views    = VIEW_LISTING events in system.marketplace.listing_funnel_events
 *   requests = REQUEST_DATA events in system.marketplace.listing_access_events
 *   installs = GET_DATA events in system.marketplace.listing_access_events
 *
 * Column names and event_type values are the ones in the Databricks
 * Marketplace system-table reference (listing_funnel_events: listing_name,
 * event_type, event_date, among others; listing_access_events: the same plus
 * the consumer_* columns). These are event counts, not distinct consumers: a
 * consumer who mounts the share twice counts twice.
 *
 * Counts only. The statement selects no consumer column, and the renderers
 * read only listing_name and the three counts from each row, so even a result
 * that carried consumer_email or consumer_name could not put them in the
 * digest. Both guards are pinned by tests/lib/marketplace-funnel.test.ts.
 *
 * Outcomes are kept apart so a quiet week is not confused with a broken read:
 *   not_configured: DATABRICKS_* env unset, nothing is queried
 *   unavailable:    the statement failed; the digest still sends and says why
 *   ok, rows = []:  the query ran and found no events in 14 days
 *
 * The DATABRICKS_TOKEN needs SELECT on listing_funnel_events as well as
 * listing_access_events. Without it the section reads "funnel unavailable"
 * with the permission error, which is the designed failure.
 *
 * Cost: each digest wakes the serverless SQL warehouse once, which bills
 * roughly its 10-minute auto-stop minimum. Weekly, so about one extra wake a
 * week on top of the daily install poll.
 */
import {
  readPollConfig,
  runStatement,
  type RowsResult,
  type StatementDeps,
  type StatementQuery,
} from '@/lib/marketplace-install-poll';

const ROW_LIMIT = 500;
const REASON_MAX = 120;

export function buildFunnelQuery(): StatementQuery {
  const statement = `
WITH ev AS (
  SELECT listing_name, event_type, event_date
  FROM system.marketplace.listing_funnel_events
  WHERE event_type = 'VIEW_LISTING'
    AND event_date > date_sub(current_date(), 14)
  UNION ALL
  SELECT listing_name, event_type, event_date
  FROM system.marketplace.listing_access_events
  WHERE event_type IN ('REQUEST_DATA', 'GET_DATA')
    AND event_date > date_sub(current_date(), 14)
)
SELECT COALESCE(listing_name, '(unnamed listing)')                         AS listing_name,
       CASE WHEN event_date > date_sub(current_date(), 7) THEN 'current' ELSE 'prior' END AS period,
       SUM(CASE WHEN event_type = 'VIEW_LISTING' THEN 1 ELSE 0 END)        AS views,
       SUM(CASE WHEN event_type = 'REQUEST_DATA' THEN 1 ELSE 0 END)        AS requests,
       SUM(CASE WHEN event_type = 'GET_DATA' THEN 1 ELSE 0 END)            AS installs
FROM ev
GROUP BY 1, 2
ORDER BY 1, 2
LIMIT ${ROW_LIMIT}`.trim();
  return { statement, parameters: [] };
}

export interface FunnelCounts {
  views: number;
  requests: number;
  installs: number;
}

export interface FunnelListing {
  listingName: string;
  current: FunnelCounts;
  prior: FunnelCounts;
}

export type FunnelSection =
  | { status: 'not_configured' }
  | { status: 'unavailable'; reason: string }
  | { status: 'ok'; listings: FunnelListing[] };

const zero = (): FunnelCounts => ({ views: 0, requests: 0, installs: 0 });

function toCount(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

/**
 * Pivot (listing, period) rows into one entry per listing. Reads only
 * listing_name, period, views, requests and installs; any other column in the
 * result is ignored by construction.
 */
export function toFunnelListings(rows: Record<string, string | null>[]): FunnelListing[] {
  const by = new Map<string, FunnelListing>();
  for (const r of rows) {
    const name = r.listing_name?.trim() || '(unnamed listing)';
    const period = r.period === 'prior' ? 'prior' : r.period === 'current' ? 'current' : null;
    if (!period) continue;
    const entry = by.get(name) ?? { listingName: name, current: zero(), prior: zero() };
    entry[period] = {
      views: entry[period].views + toCount(r.views),
      requests: entry[period].requests + toCount(r.requests),
      installs: entry[period].installs + toCount(r.installs),
    };
    by.set(name, entry);
  }
  return Array.from(by.values()).sort((a, b) => a.listingName.localeCompare(b.listingName));
}

export function shortReason(error: string): string {
  const s = error.replace(/\s+/g, ' ').trim();
  return s.length > REASON_MAX ? `${s.slice(0, REASON_MAX - 1)}…` : s;
}

export interface FunnelDeps extends StatementDeps {
  /** Injected for tests; defaults to runStatement against the configured warehouse. */
  run?: (query: StatementQuery) => Promise<RowsResult>;
}

/** Never throws: every failure becomes `unavailable` so the digest still sends. */
export async function loadMarketplaceFunnel(
  env: Record<string, string | undefined>,
  deps: FunnelDeps = {},
): Promise<FunnelSection> {
  const cfg = readPollConfig(env);
  if (!cfg) return { status: 'not_configured' };
  try {
    const query = buildFunnelQuery();
    const got = deps.run
      ? await deps.run(query)
      : await runStatement(cfg, query, { deadlineMs: 30_000, ...deps });
    if (!got.ok) return { status: 'unavailable', reason: shortReason(got.error) };
    return { status: 'ok', listings: toFunnelListings(got.rows) };
  } catch (err) {
    return { status: 'unavailable', reason: shortReason((err as Error)?.message ?? String(err)) };
  }
}

// ---------------------------------------------------------------------------
// Rendering

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function totals(listings: FunnelListing[], k: 'current' | 'prior'): FunnelCounts {
  return listings.reduce(
    (t, l) => ({
      views: t.views + l[k].views,
      requests: t.requests + l[k].requests,
      installs: t.installs + l[k].installs,
    }),
    zero(),
  );
}

function pair(cur: number, prior: number): string {
  return `${cur} (prior ${prior})`;
}

export function renderFunnelText(s: FunnelSection): string {
  const lines = ['MARKETPLACE FUNNEL (last 7 days vs prior 7 days, event counts)'];
  if (s.status === 'not_configured') {
    lines.push('  not configured (DATABRICKS_HOST / DATABRICKS_TOKEN / DATABRICKS_WAREHOUSE_ID unset)');
  } else if (s.status === 'unavailable') {
    lines.push(`  funnel unavailable: ${s.reason}`);
  } else if (s.listings.length === 0) {
    lines.push('  Query ran; no funnel events in the last 14 days.');
  } else {
    const t = totals(s.listings, 'current');
    const p = totals(s.listings, 'prior');
    lines.push(
      `  All listings   views ${pair(t.views, p.views)}  requests ${pair(t.requests, p.requests)}  installs ${pair(t.installs, p.installs)}`,
    );
    for (const l of s.listings) {
      lines.push(
        `  ${l.listingName}\n    views ${pair(l.current.views, l.prior.views)}  requests ${pair(l.current.requests, l.prior.requests)}  installs ${pair(l.current.installs, l.prior.installs)}`,
      );
    }
  }
  return lines.join('\n');
}

const H2 =
  'font-size: 14px; margin: 24px 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em; color: #374151;';
const NUM = 'padding:6px 6px;text-align:right;font-variant-numeric:tabular-nums;';

function cell(cur: number, prior: number): string {
  return `<td style="${NUM}"><span style="font-weight:600;">${cur}</span> <span style="color:#9ca3af;font-size:12px;">/ ${prior}</span></td>`;
}

export function renderFunnelHtml(s: FunnelSection): string {
  const head = `<h2 style="${H2}">Marketplace funnel</h2>
      <p style="margin:0 0 10px 0;font-size:12px;color:#6b7280;">Event counts per listing, last 7 days / prior 7 days. Views from listing_funnel_events (VIEW_LISTING); requests and installs from listing_access_events (REQUEST_DATA, GET_DATA). Counts only.</p>`;
  if (s.status === 'not_configured') {
    return `${head}<p style="margin:0 0 24px 0;font-size:13px;color:#6b7280;">not configured (DATABRICKS_* env vars unset)</p>`;
  }
  if (s.status === 'unavailable') {
    return `${head}<p style="margin:0 0 24px 0;font-size:13px;color:#b45309;">funnel unavailable: ${escHtml(s.reason)}</p>`;
  }
  if (s.listings.length === 0) {
    return `${head}<p style="margin:0 0 24px 0;font-size:13px;color:#6b7280;">Query ran; no funnel events in the last 14 days.</p>`;
  }
  const t = totals(s.listings, 'current');
  const p = totals(s.listings, 'prior');
  const rows = s.listings
    .map(
      (l) => `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:6px 6px;">${escHtml(l.listingName)}</td>
          ${cell(l.current.views, l.prior.views)}${cell(l.current.requests, l.prior.requests)}${cell(l.current.installs, l.prior.installs)}
        </tr>`,
    )
    .join('');
  return `${head}
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
        <thead><tr style="border-bottom:1px solid #e5e7eb;color:#6b7280;text-align:left;">
          <th style="padding:6px 6px;">Listing</th><th style="${NUM}">Views</th><th style="${NUM}">Requests</th><th style="${NUM}">Installs</th>
        </tr></thead>
        <tbody>${rows}
          <tr style="border-top:1px solid #e5e7eb;"><td style="padding:6px 6px;font-weight:600;">All listings</td>${cell(t.views, p.views)}${cell(t.requests, p.requests)}${cell(t.installs, p.installs)}</tr>
        </tbody>
      </table>`;
}
