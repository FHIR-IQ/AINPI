/**
 * marketplace-funnel: the Databricks Marketplace funnel section of the weekly
 * admin digest (/api/v1/admin/weekly-report).
 *
 * One SQL statement per digest run, aggregated in SQL, through the same
 * Statement API client the install poller uses (runStatement in
 * marketplace-install-poll.ts). It counts, per listing name, for the last 7
 * days and the 7 days before that:
 *
 *   views     = VIEW_LISTING events in system.marketplace.listing_funnel_events
 *   requests  = REQUEST_DATA events in system.marketplace.listing_access_events
 *   installs  = GET_DATA events in system.marketplace.listing_access_events
 *   started / completed / abandoned / failed
 *             = START_ / COMPLETE_ / ABANDON_ / FAIL_GET_DATA events in
 *               listing_funnel_events (the get-data funnel)
 *
 * Column names and event_type values were confirmed against the live tables
 * on 2026-10-13 (listing_funnel_events: listing_id, listing_name, event_type,
 * event_time, event_date, plus cloud/region and account ids). These are event
 * counts, not distinct consumers: a consumer who mounts the share twice
 * counts twice.
 *
 * Positive control. The same statement appends one more row, period =
 * 'all_time', holding all-time VIEW_LISTING and GET_DATA counts across every
 * listing. It is an aggregate with no GROUP BY, so it returns exactly one row
 * even over empty tables, and it deliberately has no date filter: that full
 * scan is the control, not an oversight (the system tables hold tens of rows).
 * It is what tells a quiet fortnight apart from a token that cannot see the
 * tables at all:
 *   window empty, all-time > 0: "no events in the last 14 days (N views all time, ...)"
 *   window empty, all-time = 0: "no events visible: check the token can read ..."
 * A successful run that returns no rows at all is treated as the second case.
 *
 * Counts only. The statement selects no consumer column, and the renderers
 * read only listing_name and the named counts from each row, so even a result
 * that carried consumer email or name columns could not put them in the
 * digest. Both guards are pinned by tests/lib/marketplace-funnel.test.ts.
 *
 * Outcomes are kept apart so a quiet week is not confused with a broken read:
 *   not_configured: DATABRICKS_* env unset, nothing is queried
 *   unavailable:    the statement failed; the digest still sends and says why
 *   ok:             the query ran; see the positive control above
 *
 * The DATABRICKS_TOKEN needs SELECT on listing_funnel_events as well as
 * listing_access_events. Without it the section reads "funnel unavailable"
 * with the permission error, which is the designed failure.
 *
 * Cost: the digest cron runs Thursday 14:12 UTC, five minutes before the daily
 * 14:17 install poll, so on Thursdays both statements share one warehouse wake
 * (auto-stop is 5 minutes since 2026-10-12) instead of paying for two.
 *
 * Deadline: 40s. runStatement submits with wait_timeout 30s and gives each
 * request whatever is left of the deadline, so a 30s deadline would abort the
 * submit at the same instant Databricks returns PENDING on a cold warehouse,
 * leaving no statement_id to cancel. 40s leaves room for the PENDING response
 * and a few polls while staying under the route's maxDuration of 60.
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
  WHERE event_type IN ('VIEW_LISTING', 'START_GET_DATA', 'COMPLETE_GET_DATA', 'ABANDON_GET_DATA', 'FAIL_GET_DATA')
  UNION ALL
  SELECT listing_name, event_type, event_date
  FROM system.marketplace.listing_access_events
  WHERE event_type IN ('REQUEST_DATA', 'GET_DATA')
),
windowed AS (
  SELECT COALESCE(listing_name, '(unnamed listing)')                         AS listing_name,
         CASE WHEN event_date > date_sub(current_date(), 7) THEN 'current' ELSE 'prior' END AS period,
         SUM(CASE WHEN event_type = 'VIEW_LISTING' THEN 1 ELSE 0 END)        AS views,
         SUM(CASE WHEN event_type = 'REQUEST_DATA' THEN 1 ELSE 0 END)        AS requests,
         SUM(CASE WHEN event_type = 'GET_DATA' THEN 1 ELSE 0 END)            AS installs,
         SUM(CASE WHEN event_type = 'START_GET_DATA' THEN 1 ELSE 0 END)      AS started,
         SUM(CASE WHEN event_type = 'COMPLETE_GET_DATA' THEN 1 ELSE 0 END)   AS completed,
         SUM(CASE WHEN event_type = 'ABANDON_GET_DATA' THEN 1 ELSE 0 END)    AS abandoned,
         SUM(CASE WHEN event_type = 'FAIL_GET_DATA' THEN 1 ELSE 0 END)       AS failed
  FROM ev
  WHERE event_date > date_sub(current_date(), 14)
  GROUP BY 1, 2
),
all_time AS (
  SELECT CAST(NULL AS STRING)                                                      AS listing_name,
         'all_time'                                                                AS period,
         COALESCE(SUM(CASE WHEN event_type = 'VIEW_LISTING' THEN 1 ELSE 0 END), 0) AS views,
         0                                                                         AS requests,
         COALESCE(SUM(CASE WHEN event_type = 'GET_DATA' THEN 1 ELSE 0 END), 0)     AS installs,
         0 AS started, 0 AS completed, 0 AS abandoned, 0 AS failed
  FROM ev
)
SELECT listing_name, period, views, requests, installs, started, completed, abandoned, failed
FROM (
  SELECT * FROM all_time
  UNION ALL
  SELECT * FROM windowed
) u
ORDER BY CASE WHEN period = 'all_time' THEN 0 ELSE 1 END, listing_name, period
LIMIT ${ROW_LIMIT}`.trim();
  return { statement, parameters: [] };
}

export interface FunnelCounts {
  views: number;
  requests: number;
  installs: number;
  started: number;
  completed: number;
  abandoned: number;
  failed: number;
}

export interface FunnelListing {
  listingName: string;
  current: FunnelCounts;
  prior: FunnelCounts;
}

/** All-time totals across every listing: the positive control. */
export interface FunnelAllTime {
  views: number;
  installs: number;
}

export type FunnelSection =
  | { status: 'not_configured' }
  | { status: 'unavailable'; reason: string }
  | { status: 'ok'; listings: FunnelListing[]; allTime: FunnelAllTime };

const COUNT_KEYS = [
  'views',
  'requests',
  'installs',
  'started',
  'completed',
  'abandoned',
  'failed',
] as const;

const zero = (): FunnelCounts => ({
  views: 0,
  requests: 0,
  installs: 0,
  started: 0,
  completed: 0,
  abandoned: 0,
  failed: 0,
});

function toCount(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function addCounts(a: FunnelCounts, b: FunnelCounts): FunnelCounts {
  const out = zero();
  for (const k of COUNT_KEYS) out[k] = a[k] + b[k];
  return out;
}

function rowCounts(r: Record<string, string | null>): FunnelCounts {
  const out = zero();
  for (const k of COUNT_KEYS) out[k] = toCount(r[k]);
  return out;
}

/**
 * Pivot (listing, period) rows into one entry per listing. Reads only
 * listing_name, period and the named count columns; any other column in the
 * result is ignored by construction. The 'all_time' control row is skipped.
 */
export function toFunnelListings(rows: Record<string, string | null>[]): FunnelListing[] {
  const by = new Map<string, FunnelListing>();
  for (const r of rows) {
    const period = r.period === 'prior' ? 'prior' : r.period === 'current' ? 'current' : null;
    if (!period) continue;
    const name = r.listing_name?.trim() || '(unnamed listing)';
    const entry = by.get(name) ?? { listingName: name, current: zero(), prior: zero() };
    entry[period] = addCounts(entry[period], rowCounts(r));
    by.set(name, entry);
  }
  return Array.from(by.values()).sort((a, b) => a.listingName.localeCompare(b.listingName));
}

/** Sum the 'all_time' control rows. No such row reads as zero, i.e. "not looking". */
export function toAllTime(rows: Record<string, string | null>[]): FunnelAllTime {
  const t: FunnelAllTime = { views: 0, installs: 0 };
  for (const r of rows) {
    if (r.period !== 'all_time') continue;
    t.views += toCount(r.views);
    t.installs += toCount(r.installs);
  }
  return t;
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
      : await runStatement(cfg, query, { deadlineMs: 40_000, ...deps });
    if (!got.ok) return { status: 'unavailable', reason: shortReason(got.error) };
    return { status: 'ok', listings: toFunnelListings(got.rows), allTime: toAllTime(got.rows) };
  } catch (err) {
    return { status: 'unavailable', reason: shortReason((err as Error)?.message ?? String(err)) };
  }
}

/**
 * The line shown when the 14-day window is empty. Tells a quiet fortnight
 * (the control sees history) apart from a read that sees nothing at all.
 */
export function emptyWindowMessage(allTime: FunnelAllTime): string {
  if (allTime.views > 0 || allTime.installs > 0) {
    return `no events in the last 14 days (${allTime.views} views all time, ${allTime.installs} installs all time)`;
  }
  return 'no events visible: check the token can read system.marketplace tables';
}

// ---------------------------------------------------------------------------
// Rendering

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function totals(listings: FunnelListing[], k: 'current' | 'prior'): FunnelCounts {
  return listings.reduce((t, l) => addCounts(t, l[k]), zero());
}

function pair(cur: number, prior: number): string {
  return `${cur} (prior ${prior})`;
}

function textLines(label: string, c: FunnelCounts, p: FunnelCounts, indent: string): string[] {
  return [
    `${indent}${label}`,
    `${indent}  views ${pair(c.views, p.views)}  requests ${pair(c.requests, p.requests)}  installs ${pair(c.installs, p.installs)}`,
    `${indent}  get-data funnel: started ${pair(c.started, p.started)}  completed ${pair(c.completed, p.completed)}  abandoned ${pair(c.abandoned, p.abandoned)}  failed ${pair(c.failed, p.failed)}`,
  ];
}

export function renderFunnelText(s: FunnelSection): string {
  const lines = ['MARKETPLACE FUNNEL (last 7 days vs prior 7 days, event counts)'];
  if (s.status === 'not_configured') {
    lines.push('  not configured (DATABRICKS_HOST / DATABRICKS_TOKEN / DATABRICKS_WAREHOUSE_ID unset)');
  } else if (s.status === 'unavailable') {
    lines.push(`  funnel unavailable: ${s.reason}`);
  } else if (s.listings.length === 0) {
    lines.push(`  ${emptyWindowMessage(s.allTime)}`);
  } else {
    lines.push(...textLines('All listings', totals(s.listings, 'current'), totals(s.listings, 'prior'), '  '));
    for (const l of s.listings) {
      lines.push(...textLines(l.listingName, l.current, l.prior, '  '));
    }
    lines.push(`  All time: ${s.allTime.views} views, ${s.allTime.installs} installs`);
  }
  return lines.join('\n');
}

const H2 =
  'font-size: 14px; margin: 24px 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em; color: #374151;';
const NUM = 'padding:6px 6px;text-align:right;font-variant-numeric:tabular-nums;';
const TABLE = 'width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;';

function cell(cur: number, prior: number): string {
  return `<td style="${NUM}"><span style="font-weight:600;">${cur}</span> <span style="color:#9ca3af;font-size:12px;">/ ${prior}</span></td>`;
}

type ColumnSpec = { label: string; key: keyof FunnelCounts }[];

function table(listings: FunnelListing[], cols: ColumnSpec): string {
  const t = totals(listings, 'current');
  const p = totals(listings, 'prior');
  const th = cols.map((c) => `<th style="${NUM}">${c.label}</th>`).join('');
  const rows = listings
    .map(
      (l) => `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:6px 6px;">${escHtml(l.listingName)}</td>
          ${cols.map((c) => cell(l.current[c.key], l.prior[c.key])).join('')}
        </tr>`,
    )
    .join('');
  return `<table style="${TABLE}">
        <thead><tr style="border-bottom:1px solid #e5e7eb;color:#6b7280;text-align:left;">
          <th style="padding:6px 6px;">Listing</th>${th}
        </tr></thead>
        <tbody>${rows}
          <tr style="border-top:1px solid #e5e7eb;"><td style="padding:6px 6px;font-weight:600;">All listings</td>${cols.map((c) => cell(t[c.key], p[c.key])).join('')}</tr>
        </tbody>
      </table>`;
}

const ACCESS_COLS: ColumnSpec = [
  { label: 'Views', key: 'views' },
  { label: 'Requests', key: 'requests' },
  { label: 'Installs', key: 'installs' },
];

const GET_DATA_COLS: ColumnSpec = [
  { label: 'Started', key: 'started' },
  { label: 'Completed', key: 'completed' },
  { label: 'Abandoned', key: 'abandoned' },
  { label: 'Failed', key: 'failed' },
];

export function renderFunnelHtml(s: FunnelSection): string {
  const head = `<h2 style="${H2}">Marketplace funnel</h2>
      <p style="margin:0 0 10px 0;font-size:12px;color:#6b7280;">Event counts per listing, last 7 days / prior 7 days. Views and the get-data funnel from listing_funnel_events (VIEW_LISTING; START_, COMPLETE_, ABANDON_, FAIL_GET_DATA); requests and installs from listing_access_events (REQUEST_DATA, GET_DATA). Counts only.</p>`;
  const note = (text: string, color = '#6b7280') =>
    `${head}<p style="margin:0 0 24px 0;font-size:13px;color:${color};">${escHtml(text)}</p>`;
  if (s.status === 'not_configured') {
    return note('not configured (DATABRICKS_* env vars unset)');
  }
  if (s.status === 'unavailable') {
    return note(`funnel unavailable: ${s.reason}`, '#b45309');
  }
  if (s.listings.length === 0) {
    const seen = s.allTime.views > 0 || s.allTime.installs > 0;
    return note(emptyWindowMessage(s.allTime), seen ? '#6b7280' : '#b45309');
  }
  return `${head}
      ${table(s.listings, ACCESS_COLS)}
      <p style="margin:0 0 6px 0;font-size:12px;color:#6b7280;">Get-data funnel (installs started, completed, abandoned, failed)</p>
      ${table(s.listings, GET_DATA_COLS)}
      <p style="margin:0 0 24px 0;font-size:12px;color:#6b7280;">All time: ${s.allTime.views} views, ${s.allTime.installs} installs</p>`;
}
