/**
 * vercel-analytics — minimal wrapper over the Vercel Web Analytics REST API.
 *
 * Used by /api/v1/admin/weekly-report to attach a 7-day traffic overview
 * to the cron-fired admin digest.
 *
 * Required env (set with `vercel env add VERCEL_API_TOKEN production` etc):
 *   VERCEL_API_TOKEN     personal/team token with read access to analytics
 *   VERCEL_TEAM_ID       slug or ID, e.g. "team_xxx" or "aks129s-projects"
 *   VERCEL_PROJECT_ID    project ID for the single-project fetcher; ignored
 *                        by fetchAllProjectsAnalytics() which discovers
 *                        every project the token can read.
 *
 * Falls back to a "dashboard link only" payload when env is incomplete or
 * the API errors — never throws. The weekly-report handler renders both
 * shapes.
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

/** Per-project summary — same shape as AnalyticsSummary + identity fields. */
export interface ProjectAnalyticsSummary extends AnalyticsSummary {
  projectId: string;
  projectName: string;
}

/** Cross-project rollup returned by fetchAllProjectsAnalytics. */
export interface AllProjectsAnalytics {
  /** True if VERCEL_API_TOKEN was set. */
  configured: boolean;
  /** True if at least one project returned non-empty data. */
  ok: boolean;
  windowDays: number;
  /** Total projects discovered, regardless of whether analytics is enabled. */
  projectsDiscovered: number;
  /** Projects whose analytics fetch returned non-empty data, sorted by pageviews desc. */
  projects: ProjectAnalyticsSummary[];
  /** Project names where analytics was disabled or returned no data. */
  emptyProjects: string[];
  /** Aggregate totals across `projects`. */
  totals: {
    pageviews: number;
    visitors: number;
  };
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

// ----- Shape coercion -------------------------------------------------------

type Row = { date?: string; count?: number; views?: number; visitors?: number; ts?: number };

function safeRows(r: unknown): Row[] {
  if (Array.isArray(r)) return r as Row[];
  if (r && typeof r === 'object') {
    const maybe = r as { data?: unknown; result?: unknown; series?: unknown };
    if (Array.isArray(maybe.data)) return maybe.data as Row[];
    if (Array.isArray(maybe.result)) return maybe.result as Row[];
    if (Array.isArray(maybe.series)) return maybe.series as Row[];
  }
  return [];
}

// ----- Core per-project fetch ----------------------------------------------

/**
 * Fetch the 4 analytics endpoints for a specific projectId. Returns an
 * AnalyticsSummary populated as far as the API allowed. Never throws —
 * errors land in `.note` and `.ok=false`.
 */
async function fetchProjectAnalytics(
  projectId: string,
  windowDays: number,
): Promise<AnalyticsSummary> {
  const teamId = process.env.VERCEL_TEAM_ID;
  const until = Date.now();
  const since = until - windowDays * 24 * 60 * 60 * 1000;
  const baseParams: Record<string, string | number> = { projectId, since, until };
  if (teamId) baseParams.teamId = teamId;

  const [viewsRes, visitorsRes, pagesRes, refRes] = await Promise.allSettled([
    fetchJson('/v1/web-analytics/views', { ...baseParams, granularity: 'day' }),
    fetchJson('/v1/web-analytics/visitors', { ...baseParams, granularity: 'day' }),
    fetchJson('/v1/web-analytics/top-pages', { ...baseParams, limit: 10 }),
    fetchJson('/v1/web-analytics/top-referrers', { ...baseParams, limit: 10 }),
  ]);

  const summary = emptySummary(windowDays);
  summary.configured = true;

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

  const allDates = new Set<string>([...dailyViews.keys(), ...dailyVisitors.keys()]);
  summary.series = [...allDates]
    .sort()
    .map((date) => ({ date, views: dailyViews.get(date) ?? 0, visitors: dailyVisitors.get(date) ?? 0 }));
  summary.totals.pageviews = summary.series.length > 0 ? viewsTotal : null;
  summary.totals.visitors = summary.series.length > 0 ? visitorsTotal : null;

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

// ----- Public single-project wrapper (back-compat) --------------------------

/**
 * Fetch the rolling-7-day traffic summary for a single project — the one
 * named in VERCEL_PROJECT_ID. Kept for back-compat; the weekly-report
 * handler now uses fetchAllProjectsAnalytics() instead.
 */
export async function fetchAnalyticsSummary(
  windowDays = 7,
): Promise<AnalyticsSummary> {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;

  if (!token || !projectId) {
    return emptySummary(
      windowDays,
      'VERCEL_API_TOKEN or VERCEL_PROJECT_ID not set; falling back to dashboard link only.',
    );
  }
  try {
    return await fetchProjectAnalytics(projectId, windowDays);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return emptySummary(windowDays, `single-project fetch failed: ${msg}`);
  }
}

// ----- All-projects discovery + fetch --------------------------------------

interface VercelProject {
  id: string;
  name: string;
  analytics?: unknown;
}

async function listAllProjects(): Promise<VercelProject[]> {
  const teamId = process.env.VERCEL_TEAM_ID;
  const out: VercelProject[] = [];
  let until: number | undefined;
  // Vercel /v9/projects pagination: 100 per page; `pagination.next` is the
  // older cursor we feed back as `until`. Stop when there's no next cursor
  // or after 5 pages (safety net for a runaway loop).
  for (let page = 0; page < 5; page++) {
    const params: Record<string, string | number> = { limit: 100 };
    if (teamId) params.teamId = teamId;
    if (until) params.until = until;
    const data = (await fetchJson('/v9/projects', params)) as {
      projects?: VercelProject[];
      pagination?: { next?: number | null };
    };
    const projects = Array.isArray(data?.projects) ? data.projects : [];
    out.push(...projects);
    const next = data?.pagination?.next;
    if (!next) break;
    until = next;
  }
  return out;
}

/**
 * Discover every project the VERCEL_API_TOKEN can read, fetch the 7-day
 * analytics window for each, and return them sorted by pageviews desc.
 *
 * Projects where analytics is disabled or the API returns no rows are
 * tallied in `emptyProjects` and excluded from the main list. The function
 * never throws — top-level failures degrade to a "configured=false" payload
 * so the weekly email still ships.
 */
export async function fetchAllProjectsAnalytics(
  windowDays = 7,
): Promise<AllProjectsAnalytics> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) {
    return {
      configured: false,
      ok: false,
      windowDays,
      projectsDiscovered: 0,
      projects: [],
      emptyProjects: [],
      totals: { pageviews: 0, visitors: 0 },
      note: 'VERCEL_API_TOKEN not set; falling back to dashboard link only.',
    };
  }

  let allProjects: VercelProject[] = [];
  try {
    allProjects = await listAllProjects();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      configured: true,
      ok: false,
      windowDays,
      projectsDiscovered: 0,
      projects: [],
      emptyProjects: [],
      totals: { pageviews: 0, visitors: 0 },
      note: `project listing failed: ${msg}`,
    };
  }

  // Fetch per-project in parallel. We don't filter by `analytics` field
  // up front because the field shape varies across plan tiers and some
  // projects have analytics enabled implicitly; just try the API and
  // bucket the empty ones.
  const settled = await Promise.allSettled(
    allProjects.map(async (p): Promise<ProjectAnalyticsSummary> => {
      const s = await fetchProjectAnalytics(p.id, windowDays);
      return { ...s, projectId: p.id, projectName: p.name };
    }),
  );

  const projects: ProjectAnalyticsSummary[] = [];
  const emptyProjects: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const name = allProjects[i]?.name ?? allProjects[i]?.id ?? '(unknown)';
    if (r.status === 'fulfilled' && r.value.ok) {
      projects.push(r.value);
    } else {
      emptyProjects.push(name);
    }
  }

  projects.sort((a, b) => (b.totals.pageviews ?? 0) - (a.totals.pageviews ?? 0));

  const totals = projects.reduce(
    (acc, p) => ({
      pageviews: acc.pageviews + (p.totals.pageviews ?? 0),
      visitors: acc.visitors + (p.totals.visitors ?? 0),
    }),
    { pageviews: 0, visitors: 0 },
  );

  return {
    configured: true,
    ok: projects.length > 0,
    windowDays,
    projectsDiscovered: allProjects.length,
    projects,
    emptyProjects,
    totals,
  };
}
