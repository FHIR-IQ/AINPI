/**
 * vercel-analytics — list every team project that has Web Analytics enabled
 * and emit a per-project dashboard deep-link.
 *
 * **Why we don't fetch pageviews here**: Vercel does not publish a public
 * REST API for Web Analytics data. The OpenAPI spec at openapi.vercel.sh
 * has zero analytics endpoints across all 234 documented routes, and probing
 * speculative paths (/v1/web-analytics/*, /v1/insights/*, /v1/analytics/*)
 * returns 404 on Hobby, Pro, and Enterprise tokens. The data the dashboard
 * shows is fetched from internal vercel.com routes with cookie auth; those
 * are not stable or token-accessible.
 *
 * So this module does the next-best thing: discovers every project the
 * VERCEL_API_TOKEN can read, detects which ones have analytics enabled,
 * and produces a dashboard deep-link per project. The weekly admin email
 * renders one row per project — admins can click through.
 *
 * Required env:
 *   VERCEL_API_TOKEN     personal/team token (any tier — project list is free)
 *   VERCEL_TEAM_ID       slug or ID — optional but used for the dashboard URL
 *
 * Never throws — top-level failures yield `{ configured: false }`.
 */

const API = 'https://api.vercel.com';

export interface ProjectAnalyticsLink {
  projectId: string;
  projectName: string;
  /** True if Vercel reported a non-null `analytics` field on the project. */
  analyticsEnabled: boolean;
  /** Direct deep-link to the Analytics tab for this project. */
  dashboardUrl: string;
  /** First custom domain (for context in the email), if any. */
  primaryDomain: string | null;
  /** Last updated timestamp from Vercel (ms epoch). */
  updatedAt: number | null;
}

export interface AllProjectsAnalytics {
  /** True if VERCEL_API_TOKEN was set. */
  configured: boolean;
  /** True if project listing returned at least one project. */
  ok: boolean;
  /** Total projects discovered, regardless of analytics state. */
  projectsDiscovered: number;
  /** Projects with `analytics` populated, sorted by updatedAt desc. */
  projectsWithAnalytics: ProjectAnalyticsLink[];
  /** Projects without analytics, sorted by updatedAt desc. */
  projectsWithoutAnalytics: ProjectAnalyticsLink[];
  /** Best-effort note if the fetch degraded. */
  note?: string;
}

interface VercelProject {
  id: string;
  name: string;
  analytics?: unknown;
  updatedAt?: number;
  targets?: { production?: { aliasAssigned?: number; alias?: string[] } };
  alias?: { domain?: string }[];
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

async function listAllProjects(): Promise<VercelProject[]> {
  const teamId = process.env.VERCEL_TEAM_ID;
  const out: VercelProject[] = [];
  let until: number | undefined;
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

function teamSlug(): string {
  // Resolution priority: VERCEL_TEAM_SLUG if set (human-readable),
  // otherwise the team ID, otherwise a sensible default.
  return (
    process.env.VERCEL_TEAM_SLUG ||
    process.env.VERCEL_TEAM_ID ||
    'aks129s-projects'
  );
}

function dashboardUrlFor(projectName: string): string {
  // Vercel dashboard URLs are stable on the slug: /<team>/<project>/analytics.
  return `https://vercel.com/${teamSlug()}/${projectName}/analytics`;
}

function primaryDomain(p: VercelProject): string | null {
  const aliases = p.targets?.production?.alias;
  if (Array.isArray(aliases) && aliases.length > 0) return aliases[0];
  if (Array.isArray(p.alias) && p.alias.length > 0 && p.alias[0]?.domain) {
    return p.alias[0].domain;
  }
  return null;
}

function projectToLink(p: VercelProject): ProjectAnalyticsLink {
  return {
    projectId: p.id,
    projectName: p.name,
    analyticsEnabled: !!p.analytics,
    dashboardUrl: dashboardUrlFor(p.name),
    primaryDomain: primaryDomain(p),
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : null,
  };
}

/**
 * Discover every project the VERCEL_API_TOKEN can read, partition by
 * whether analytics is enabled, and produce dashboard deep-links.
 */
export async function fetchAllProjectsAnalytics(): Promise<AllProjectsAnalytics> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) {
    return {
      configured: false,
      ok: false,
      projectsDiscovered: 0,
      projectsWithAnalytics: [],
      projectsWithoutAnalytics: [],
      note: 'VERCEL_API_TOKEN not set; cannot enumerate projects.',
    };
  }
  let projects: VercelProject[] = [];
  try {
    projects = await listAllProjects();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      configured: true,
      ok: false,
      projectsDiscovered: 0,
      projectsWithAnalytics: [],
      projectsWithoutAnalytics: [],
      note: `project listing failed: ${msg}`,
    };
  }

  const links = projects.map(projectToLink);
  links.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  return {
    configured: true,
    ok: links.length > 0,
    projectsDiscovered: links.length,
    projectsWithAnalytics: links.filter((p) => p.analyticsEnabled),
    projectsWithoutAnalytics: links.filter((p) => !p.analyticsEnabled),
  };
}
