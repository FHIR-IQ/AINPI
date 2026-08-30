/**
 * AINPI MCP server: https://ainpi.dev/api/mcp (streamable HTTP).
 *
 * A thin, credential-free adapter over the public /api/v1 contract and the
 * existing public search routes, so AI agents (Claude, etc.) can query the
 * federal provider directory audit without scraping.
 *
 * COST CONTRACT: every tool below is an HTTP fetch of an ALREADY-PUBLIC
 * surface (CDN-served static JSON, or the existing public /api/npd/search
 * route). This server adds zero new BigQuery paths; anything expensive is
 * exactly as reachable with or without MCP. Static findings/states files
 * are fetched over HTTPS (not fs) because outputFileTracingExcludes strips
 * public/api/v1/** from lambda bundles: runtime fs reads would fail.
 *
 * Tool names match the schemas published in /api/v1/manifest.json.
 *
 * Connect (Claude Code):
 *   claude mcp add --transport http ainpi https://ainpi.dev/api/mcp
 */
import type { NextRequest } from 'next/server';
import { createMcpHandler } from 'mcp-handler';
import { enforceRateLimit, type LimitResult } from '@/lib/rate-limit';
import { z } from 'zod';
import { FINDINGS, allSlugs } from '@/data/findings';
import { allStateCodes } from '@/data/states';

const BASE = 'https://ainpi.dev';

const DISCLAIMER =
  'Signals are data-quality flags from cross-checking public federal databases, ' +
  'not investigative findings. The SAM.gov NPI field has a documented ' +
  'false-positive history; verify any flag against the primary sources ' +
  '(NPPES Registry, OIG LEIE, SAM.gov) before acting.';

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

// Module-scope cache: parsed high-risk cohort, fetched once per lambda
// instance from the CDN (~800 KB CSV).
let cohortCache: Map<string, Record<string, string>> | null = null;

async function loadCohort(): Promise<Map<string, Record<string, string>>> {
  if (cohortCache) return cohortCache;
  const res = await fetch(`${BASE}/api/v1/findings/high-risk-cohort-export.csv`);
  if (!res.ok) throw new Error(`cohort export returned ${res.status}`);
  const raw = await res.text();
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const header = lines[0].split(',');
  cohortCache = new Map();
  for (const line of lines.slice(1)) {
    // The export quotes only the name column; a light parse is sufficient.
    const cols: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) {
        cols.push(cur);
        cur = '';
      } else cur += ch;
    }
    cols.push(cur);
    const rec: Record<string, string> = {};
    header.forEach((k, i) => {
      rec[k] = cols[i] ?? '';
    });
    if (rec.npi) cohortCache.set(rec.npi, rec);
  }
  return cohortCache;
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'list_findings',
      'List every AINPI finding: slug, title, hypothesis numbers, and publication status. ' +
        'Use get_finding with a slug for the measured numbers.',
      {},
      async () => {
        const rows = FINDINGS.map((f) => ({
          slug: f.slug,
          title: f.title,
          hypotheses: f.hypotheses,
          status: f.status,
          url: `${BASE}/findings/${f.slug}`,
        }));
        return text(JSON.stringify(rows, null, 1));
      },
    );

    server.tool(
      'get_finding',
      'Read a published AINPI finding: headline, numerator/denominator, chart data, and ' +
        'methodology notes. Slugs come from list_findings.',
      { slug: z.string().describe('Finding slug, e.g. "endpoint-liveness"') },
      async ({ slug }) => {
        if (!allSlugs().includes(slug)) {
          return text(
            `Unknown slug "${slug}". Valid slugs: ${allSlugs().join(', ')}`,
          );
        }
        try {
          const data = await fetchJson(`${BASE}/api/v1/findings/${slug}.json`);
          return text(JSON.stringify(data, null, 1));
        } catch {
          const f = FINDINGS.find((x) => x.slug === slug);
          return text(
            JSON.stringify(
              {
                slug,
                status: f?.status ?? 'pre-registered',
                note: 'No published JSON yet; this finding is pre-registered only.',
                nullHypothesis: f?.nullHypothesis,
                denominator: f?.denominator,
              },
              null,
              1,
            ),
          );
        }
      },
    );

    server.tool(
      'get_state_audit',
      'Read the state-scoped audit slice for a US state: denominators, state-vs-national ' +
        'finding rates, and sample NPIs with primary-source verify URLs.',
      { state: z.string().length(2).describe('Two-letter state code, e.g. "VA"') },
      async ({ state }) => {
        const code = state.toUpperCase();
        if (!allStateCodes().includes(code)) {
          return text(`Unknown state "${state}". Use a two-letter US state code or DC.`);
        }
        const data = await fetchJson(
          `${BASE}/api/v1/states/${code.toLowerCase()}.json`,
        );
        return text(JSON.stringify(data, null, 1));
      },
    );

    server.tool(
      'check_npi_cohort',
      'Check whether an NPI appears in the AINPI high-risk cohort (federal exclusion and ' +
        'registry cross-checks) and return its signals, dates, and report-card URL. ' +
        DISCLAIMER,
      { npi: z.string().regex(/^\d{10}$/).describe('10-digit NPI') },
      async ({ npi }) => {
        const cohort = await loadCohort();
        const row = cohort.get(npi);
        if (!row) {
          return text(
            JSON.stringify(
              {
                npi,
                in_high_risk_cohort: false,
                note:
                  'Not in the current high-risk cohort. This is NOT a clean bill of ' +
                  'health by itself; it means none of the five cross-check signals ' +
                  'fired at the last weekly run. Use lookup_npi for the directory record.',
              },
              null,
              1,
            ),
          );
        }
        return text(
          JSON.stringify(
            {
              npi,
              in_high_risk_cohort: true,
              name: row.name,
              state: row.state,
              score: row.score,
              bucket: row.bucket,
              signals: (row.reasons ?? '').split('|').filter(Boolean),
              leie_exclusion_date: row.leie_excldate || null,
              sam_active_date: row.sam_active_date || null,
              nppes_deactivation_date: row.nppes_deactivation_date || null,
              report_card: `${BASE}/npi/${npi}`,
              disclaimer: DISCLAIMER,
            },
            null,
            1,
          ),
        );
      },
    );

    server.tool(
      'lookup_npi',
      'Look up a provider record by 10-digit NPI in the federal NDH bulk export ' +
        '(name, state, city, active flag, roles). Wraps the public /api/npd/search route.',
      { npi: z.string().regex(/^\d{10}$/).describe('10-digit NPI') },
      async ({ npi }) => {
        const data = await fetchJson(`${BASE}/api/npd/search?npi=${npi}`);
        return text(JSON.stringify(data, null, 1));
      },
    );
  },
  {
    serverInfo: { name: 'ainpi', version: '1.0.0' },
  },
  {
    basePath: '/api',
    verboseLogs: false,
    maxDuration: 60,
  },
);

/**
 * Rate limiting for the MCP surface.
 *
 * The `mcp-handler` package owns the request lifecycle, so the limiter runs as
 * a wrapper around the handler rather than inside each tool. That means one
 * charge per MCP request rather than per tool call, which is the right
 * granularity: a request is what an agent retries.
 *
 * Agents retry aggressively and without backoff when a call fails, so an
 * unprotected MCP endpoint is a worse exposure than a browser-facing route: no
 * human notices it looping. Every tool here reads CDN-served static JSON
 * except `lookup_npi`, which wraps the capped /api/npd/search route, so the
 * charge reflects the worst case rather than the average.
 */
async function guarded(
  req: NextRequest,
  run: (r: NextRequest) => Promise<Response> | Response,
): Promise<Response> {
  const rl = await enforceRateLimit(req, { shape: 'mcp:lookup' });
  if (!rl.ok) return rl.response!;
  return annotate(await run(req), rl);
}

/**
 * Put the tier and remaining budget on successful MCP responses.
 *
 * `withRateLimitHeaders` in the limiter takes a NextResponse, and mcp-handler
 * returns a plain streaming Response, so this is the same three headers
 * applied to what this route actually produces. /api/npd/search and
 * /api/npd/geo-search already advertise them; without this the MCP surface was
 * the only rate-limited route that told a caller nothing.
 *
 * That matters most for a bearer token. A caller who presents a key has no
 * other way to find out whether the server recognised it: the tool result for
 * a keyed request and an anonymous one is byte-identical, so a key that is
 * revoked, mistyped or sent under the wrong header looks exactly like one that
 * works, right up until the anonymous ceiling stops them.
 *
 * The body is passed through as a stream rather than buffered, because the
 * transport is server-sent events and reading it here would break streaming.
 */
function annotate(res: Response, rl: LimitResult): Response {
  const values: [string, string][] = [
    ['x-ratelimit-tier', rl.caller.tier.name],
    ['x-ratelimit-cost-units', String(rl.units)],
    ['x-ratelimit-limit-day', String(rl.caller.dailyUnitCap)],
  ];
  try {
    for (const [k, v] of values) res.headers.set(k, v);
    return res;
  } catch {
    // Some Response objects arrive with immutable headers. Rebuild around the
    // same body stream rather than giving up on the headers.
    const headers = new Headers(res.headers);
    for (const [k, v] of values) headers.set(k, v);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }
}

export async function GET(req: NextRequest) {
  return guarded(req, handler as unknown as (r: NextRequest) => Promise<Response>);
}
export async function POST(req: NextRequest) {
  return guarded(req, handler as unknown as (r: NextRequest) => Promise<Response>);
}
export async function DELETE(req: NextRequest) {
  return guarded(req, handler as unknown as (r: NextRequest) => Promise<Response>);
}
