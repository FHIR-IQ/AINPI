/**
 * vercel-analytics — minimal wrapper over the Vercel Web Analytics REST API.
 *
 * Used by /api/v1/admin/weekly-report to attach a 7-day traffic overview
 * to the cron-fired admin digest.
 *
 * Required env (set with `vercel env add VERCEL_API_TOKEN production` etc):
 *   VERCEL_API_TOKEN     personal/team token with read access to analytics
 *   VERCEL_TEAM_ID       slug or ID, e.g. "team_xxx" or "aks129s-projects"
 *   VERCEL_PROJECT_ID    project ID, e.g. "prj_xxx" (find via `vercel inspect`)
 *
 * Falls back to a "dashboard link only" payload when env is incomplete or
 * the API errors — never throws. The weekly-report handler renders both
 * shapes.
 *
 * Vercel Web Analytics REST API reference:
 *   GET /v1/web-analytics/views     pageviews aggregated by day
 *   GET /v1/web-analytics/visitors  unique visitors
 *   GET /v1/web-analytics/top-pages top pages by views
 *
 * All endpoints accept: `since`, `until` (ms epoch), `teamId`, `projectId`.
 * On non-200 response we log + return a degraded payload so the email
 * still goes out with whatever fragments we did manage to load.
 */

const API = 'https://api.vercel.com';
const DASHBOARD_URL =
  process.env.VERCEL_DASHBOARD_URL ||
  'https://vercel.com/aks129s-projects/ainpi/analytics';

export interface AnalyticsSummary {
  /** True if VERCEL_API_TOKEN + VERCEL_PROJECT_ID were set. */
  configured: boolean;
  /** True if the API actually responded with data. */
  ok: boolean;
  windowDays: number;
  totals: {
    pageviews: number | null;
    visitors: number | null;
  };
  /** Day-by-day rows, oldest first. */
  series: Array<{
    date: string; // YYYY-MM-DD UTC
    views: number;
    visitors: number;
  }>;
  /** Top pages by views over the window. */
  topPages: Array<{ path: string; views: number }>;
  /** Top referrers over the window. */
  topReferrers: Array<{ source: string; views: number }>;
  /** Underlying dashboard link — always populated for fallback. */
  dashboardUrl: string;
  /** Best-effort note for the maintainer if the fetch degraded. */
  note?: string;
}

function emptySummary(windowDays: number, note?: string): AnalyticsSummary {
  return {
    configured: !!(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID),
    ok: false,
    windowDays,
    totals: { pageviews: null, visitors: null },
    series: [],
    topPages: [],
    topReferrers: [],
    dashboardUrl: DASHBOARD_URL,
    note,
  };
}

async function fetchJson(
  path: string,
  params: Record<string, string | number>,
): Promise<unknown> {
  const token = process.env.VERCEL_API_TOKEN!;
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Vercel API ${res.status}: ${body.slice(0, 200)}`);
  }
  return await res.json();
}

/**
 * Fetch the rolling-7-day traffic summary. Default window is 7 days.
 * `since` / `until` are ms epoch; we compute them from `windowDays`.
 */
export async function fetchAnalyticsSummary(
  windowDays = 7,
): Promise<AnalyticsSummary> {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    return emptySummary(
      windowDays,
      'VERCEL_API_TOKEN or VERCEL_PROJECT_ID not set; falling back to dashboard link only. Set with `vercel env add` in frontend/.',
    );
  }

  const until = Date.now();
  const since = until - windowDays * 24 * 60 * 60 * 1000;
  const baseParams: Record<string, string | number> = {
    projectId,
    since,
    until,
  };
  if (teamId) baseParams.teamId = teamId;

  // Try every endpoint independently. Each can degrade without failing
  // the whole report.
  const [viewsRes, visitorsRes, pagesRes, refRes] = await Promise.allSettled([
    fetchJson('/v1/web-analytics/views', { ...baseParams, granularity: 'day' }),
    fetchJson('/v1/web-analytics/visitors', { ...baseParams, granularity: 'day' }),
    fetchJson('/v1/web-analytics/top-pages', { ...baseParams, limit: 10 }),
    fetchJson('/v1/web-analytics/top-referrers', { ...baseParams, limit: 10 }),
  ]);

  const summary = emptySummary(windowDays);
  summary.configured = true;

  // Views: API typically returns { data: [{ date, count }, ...] }
  // The shape isn't fully documented for all plan tiers, so we coerce
  // permissively and log if anything is off.
  type Row = { date?: string; count?: number; views?: number; visitors?: number; ts?: number };
  const safeRows = (r: unknown): Row[] => {
    if (Array.isArray(r)) return r as Row[];
    if (r && typeof r === 'object') {
      const maybe = (r as { data?: unknown; result?: unknown; series?: unknown });
      if (Array.isArray(maybe.data)) return maybe.data as Row[];
      if (Array.isArray(maybe.result)) return maybe.result as Row[];
      if (Array.isArray(maybe.series)) return maybe.series as Row[];
    }
    return [];
  };

  let viewsTotal = 0;
  let visitorsTotal = 0;
  const dailyViews = new Map<string, number>();
  const dailyVisitors = new Map<string, number>();

  if (viewsRes.status === 'fulfilled') {
    for (const row of safeRows(viewsRes.value)) {
      const date = row.date || (row.ts ? new Date(row.ts).toISOString().slice(0, 10) : '');
      const n = Number(row.count ?? row.views ?? 0);
      if (date) dailyViews.set(date, (dailyViews.get(date) ?? 0) + n);
      viewsTotal += n;
    }
  } else {
    summary.note = `views fetch failed: ${viewsRes.reason instanceof Error ? viewsRes.reason.message : String(viewsRes.reason)}`;
  }
  if (visitorsRes.status === 'fulfilled') {
    for (const row of safeRows(visitorsRes.value)) {
      const date = row.date || (row.ts ? new Date(row.ts).toISOString().slice(0, 10) : '');
      const n = Number(row.count ?? row.visitors ?? 0);
      if (date) dailyVisitors.set(date, (dailyVisitors.get(date) ?? 0) + n);
      visitorsTotal += n;
    }
  }

  const allDates = new Set<string>([
    ...dailyViews.keys(),
    ...dailyVisitors.keys(),
  ]);
  summary.series = [...allDates]
    .sort()
    .map((date) => ({
      date,
      views: dailyViews.get(date) ?? 0,
      visitors: dailyVisitors.get(date) ?? 0,
    }));
  summary.totals.pageviews = summary.series.length > 0 ? viewsTotal : null;
  summary.totals.visitors = summary.series.length > 0 ? visitorsTotal : null;

  // Top pages — shape varies; we accept { path, count } | { page, views } | { name, count }.
  if (pagesRes.status === 'fulfilled') {
    type Page = { path?: string; page?: string; url?: string; name?: string; count?: number; views?: number };
    for (const row of safeRows(pagesRes.value) as Page[]) {
      const path = row.path || row.page || row.url || row.name || '';
      const n = Number(row.count ?? row.views ?? 0);
      if (path) summary.topPages.push({ path, views: n });
    }
  }
  if (refRes.status === 'fulfilled') {
    type Ref = { source?: string; referrer?: string; host?: string; name?: string; count?: number; views?: number };
    for (const row of safeRows(refRes.value) as Ref[]) {
      const source = row.source || row.referrer || row.host || row.name || '';
      const n = Number(row.count ?? row.views ?? 0);
      if (source) summary.topReferrers.push({ source, views: n });
    }
  }

  summary.ok = summary.series.length > 0 || summary.topPages.length > 0;
  return summary;
}
