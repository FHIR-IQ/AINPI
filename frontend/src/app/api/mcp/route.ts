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
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextRequest } from 'next/server';
import { createMcpHandler } from 'mcp-handler';
import { bump, enforceRateLimit, type Caller, type LimitResult } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import {
  checkReportRate,
  getReport,
  resolveReporter,
  submitReport,
  type StoreResult,
} from '@/lib/interaction-report-store';
import { ISSUE_VOCABULARY, MAX_BODY_BYTES, problem } from '@/lib/interaction-report';
import { z } from 'zod';
import { FINDINGS, allSlugs } from '@/data/findings';
import { allStateCodes } from '@/data/states';
import { createOrgIndexLoader, lookupOrganization } from '@/lib/org-lookup';
import { getOrgSuppressedNpis, getSuppressedNpis } from '@/lib/suppression';

const BASE = 'https://ainpi.dev';

const DISCLAIMER =
  'Signals are data-quality flags from cross-checking public federal databases, ' +
  'not investigative findings. The SAM.gov NPI field has a documented ' +
  'false-positive history; verify any flag against the primary sources ' +
  '(NPPES Registry, OIG LEIE, SAM.gov) before acting.';

/**
 * The request's caller, set by guarded() around each MCP request so a tool can
 * act as the organization whose API key the connection carries.
 */
const requestCaller = new AsyncLocalStorage<{ caller: Caller; keyPresented: boolean; keyHeader: string | null }>();

/**
 * Fetch one of our own capped search routes as the MCP caller: forward the
 * caller's key so the route charges that key's quota rather than the
 * anonymous bucket of this lambda's outbound IP, which every keyless MCP user
 * shares.
 */
async function fetchJsonAsCaller(url: string): Promise<unknown> {
  const key = requestCaller.getStore()?.keyHeader;
  const res = await fetch(url, {
    headers: { accept: 'application/json', ...(key ? { 'x-api-key': key } : {}) },
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

function storeResultToTool(r: StoreResult) {
  return {
    ...(r.status >= 400 ? { isError: true } : {}),
    content: [{ type: 'text' as const, text: JSON.stringify({ httpStatus: r.status, ...r.body }, null, 1) }],
  };
}

async function reporterOrError() {
  const ctx = requestCaller.getStore();
  if (!ctx) {
    return { error: storeResultToTool({ status: 503, body: { type: 'about:blank', title: 'Service Unavailable', status: 503, detail: 'Caller context unavailable. Retry.' } }) };
  }
  const r = await resolveReporter(ctx.caller, ctx.keyPresented, prisma);
  if ('status' in r) return { error: storeResultToTool(r) };
  const limited = await checkReportRate(r, Date.now(), bump);
  if (limited) return { error: storeResultToTool(limited) };
  return { reporter: r };
}

const VOCABULARY_TEXT = Object.entries(ISSUE_VOCABULARY)
  .map(([stage, codes]) => `${stage}: ${codes.join(', ')}`)
  .join('; ');

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

// Module-scope cache for lookup_organization: the H50 crosswalk (~3.3 MB) and
// the H51 vendor attribution file (~7.9 MB), fetched from the CDN, parsed
// once (~150 ms, ~33 MB heap) and held for six hours per warm instance.
const loadOrgIndex = createOrgIndexLoader({
  base: BASE,
  ttlMs: 6 * 60 * 60 * 1000,
  fetchText: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.text();
  },
});

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
        // A suppressed NPI (removal request) answers exactly as one that is
        // not in the cohort, even if a stale CDN copy of the CSV still has it.
        const suppressed = await getSuppressedNpis();
        const cohort = await loadCohort();
        const row = suppressed.has(npi) ? undefined : cohort.get(npi);
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
        if ((await getSuppressedNpis()).has(npi)) {
          // Same body /api/npd/search returns for an NPI not in the directory.
          const { CURRENT_RELEASE } = await import('@/lib/release');
          return text(
            JSON.stringify(
              {
                type: 'provider_profile',
                data: { practitioner: null, roles: [], endpoints: [], specialties: [] },
                source: 'cms_npd',
                release_date: CURRENT_RELEASE,
              },
              null,
              1,
            ),
          );
        }
        const data = await fetchJsonAsCaller(`${BASE}/api/npd/search?npi=${npi}`);
        return text(JSON.stringify(data, null, 1));
      },
    );

    server.tool(
      'lookup_organization',
      'Find the FHIR endpoints attributed to an organization NPI, with the organization ' +
        'name(s), state and EHR vendor. Two sources, labelled per endpoint: "ndh" is the ' +
        'NDH Endpoint resource naming this organization as its managingOrganization (CMS ' +
        'data); "vendor_file" is an EHR vendor\'s own published endpoint list naming it, ' +
        'which is the vendor\'s claim and not CMS data. Each vendor_file claim carries ' +
        'npis_on_url, how many NPIs the vendor lists beside that URL; above 10 ' +
        '(practice_wide_list: true) it is a practice-wide or brand-wide list, so the URL ' +
        'is not shown to serve this organization in particular. An NPI in neither source returns ' +
        'an explicit not-found result. Reads two published CSVs; no live database query.',
      { npi: z.string().regex(/^\d{10}$/).describe('10-digit organization NPI') },
      async ({ npi }) => {
        try {
          const { index, stale } = await loadOrgIndex();
          // Full scope only: a confirmed individual's NPI, even where a vendor
          // file lists it as an organization, gets the ordinary not-found
          // result. An unverified NPI never hides organization data.
          const view = (await getOrgSuppressedNpis()).has(npi)
            ? { ...index, ndhByNpi: new Map(), vendorByNpi: new Map() }
            : index;
          return text(JSON.stringify(lookupOrganization(view, npi, { stale }), null, 1));
        } catch (err) {
          // Never answer "not found" when the sources could not be read: an
          // empty index would make every NPI look like it has no endpoint.
          const msg = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text:
                  `lookup_organization could not load its source files (${msg}). ` +
                  'This is a temporary failure, not a "not found" result; retry later.',
              },
            ],
          };
        }
      },
    );

    server.tool(
      'search_organizations',
      'Find organizations in the NDH bulk export by name, optionally within one state. ' +
        'Returns NPI, name, type, state and city for up to 20 matches; pass an NPI to ' +
        'lookup_organization for its endpoints. Wraps the public /api/npd/search route.',
      {
        name: z.string().min(3).max(100).describe('Part of the organization name, e.g. "Geisinger"'),
        state: z.string().length(2).optional().describe('Two-letter state code, e.g. "PA"'),
      },
      async ({ name, state }) => {
        const qs = new URLSearchParams({ org: name, type: 'organization', limit: '20' });
        if (state) qs.set('state', state.toUpperCase());
        const data = await fetchJsonAsCaller(`${BASE}/api/npd/search?${qs}`);
        return text(JSON.stringify(data, null, 1));
      },
    );

    server.tool(
      'report_interaction',
      'Report how an exchange with another organization went, to the AINPI sandbox of the ' +
        'proposed NPD Endpoint Feedback API (v0.2). This is a test service, not an NPD API: ' +
        'reports are private to the reporting organization and deleted after 90 days. Requires ' +
        'an API key issued to an NPD MCP working group participant (https://ainpi.dev/npd-mcp), ' +
        'sent on the MCP connection as Authorization: Bearer <key>. The reporter is the key\'s ' +
        'organization, never a field in the report. Generate a new UUID v4 reportId per report ' +
        'and reuse it on retry. Never include patient data, secrets, tokens or raw payloads. ' +
        'Issue vocabulary (stage: codes): ' + VOCABULARY_TEXT + '. Code "other" is allowed with ' +
        'any stage and then needs a description.',
      {
        report: z
          .record(z.string(), z.unknown())
          .describe(
            'The report body exactly as POST /api/v1/interaction-reports takes it: schemaVersion "1.0", ' +
              'reportId, reporterRole, optional counterpartyReference / counterpartyFpi / endpointReference, ' +
              'interaction {startedAt, endedAt, optional fhirVersion, operation, resourceType, httpMethod, ' +
              'httpStatus}, outcome, optional rating 1-5, issues[].',
          ),
      },
      async ({ report }) => {
        const r = await reporterOrError();
        if ('error' in r) return r.error!;
        if (Buffer.byteLength(JSON.stringify(report), 'utf8') > MAX_BODY_BYTES) {
          return storeResultToTool({ status: 413, body: problem(413, 'The report exceeds the 256 KiB limit.') });
        }
        return storeResultToTool(await submitReport(r.reporter!, report, Date.now(), prisma));
      },
    );

    server.tool(
      'get_interaction_report',
      'Read the receipt of an interaction report your own organization submitted to the AINPI ' +
        'sandbox, by reportId. Another organization\'s report returns not found. Requires the same ' +
        'API key as report_interaction.',
      { reportId: z.string().describe('The UUID v4 reportId you submitted') },
      async ({ reportId }) => {
        const r = await reporterOrError();
        if ('error' in r) return r.error!;
        return storeResultToTool(await getReport(r.reporter!, reportId, Date.now(), prisma));
      },
    );
  },
  {
    serverInfo: { name: 'ainpi', version: '1.0.0' },
  },
  {
    basePath: '/api',
    // The legacy SSE transport runs tool calls from Redis callbacks outside
    // the request's AsyncLocalStorage context, so a report tool could act as
    // the wrong caller. Streamable HTTP only.
    disableSse: true,
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
 * human notices it looping. Every tool here reads CDN-served static files
 * (JSON, or CSVs cached in module scope, as `check_npi_cohort` and
 * `lookup_organization` do) except `lookup_npi`, which wraps the capped
 * /api/npd/search route, so the charge reflects the worst case rather than
 * the average. `lookup_organization` therefore needs no shape of its own.
 */
async function guarded(
  req: NextRequest,
  run: (r: NextRequest) => Promise<Response> | Response,
): Promise<Response> {
  const rl = await enforceRateLimit(req, { shape: 'mcp:lookup' });
  if (!rl.ok) return rl.response!;
  const keyHeader =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || req.headers.get('x-api-key') || null;
  const res = await requestCaller.run(
    { caller: rl.caller, keyPresented: Boolean(keyHeader), keyHeader },
    () => run(req),
  );
  return annotate(res, rl);
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
