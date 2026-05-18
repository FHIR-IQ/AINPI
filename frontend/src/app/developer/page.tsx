import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'AINPI for developers — API, schemas, examples',
  description:
    'Public AINPI APIs for building on top: stable /api/v1 JSON contract, NPI lookup, cross-source provider search across NDH + NPPES + 4 payer FHIR directories. Apache-2.0, no auth, no rate limit today.',
  openGraph: {
    title: 'AINPI for developers',
    description:
      'Stable JSON contract, NPI lookup, cross-source search. Apache-2.0, no auth.',
    url: 'https://ainpi.dev/developer',
    type: 'article',
  },
};

interface Endpoint {
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  /** Stability tier shown next to the path. */
  tier: 'stable' | 'experimental' | 'static';
  exampleCurl?: string;
  /** Optional snippet of the response shape. Kept compact, not full schema. */
  exampleResponse?: string;
  /** Where the type lives in the repo. */
  schemaRef?: string;
}

const STATIC_API: Endpoint[] = [
  {
    method: 'GET',
    path: '/api/v1/stats.json',
    summary: 'Site-wide counters: release date, methodology version, total resources, findings tally.',
    tier: 'static',
    exampleCurl: 'curl -s https://ainpi.dev/api/v1/stats.json | jq',
    exampleResponse: `{
  "release_date": "2026-05-08",
  "methodology_version": "0.6.0-draft",
  "commit_sha": "f09c02d",
  "counters": {
    "resources_processed": 21693735,
    "npis_checked": 10853455,
    "npis_flagged": 8115,
    "findings_published": 12
  }
}`,
    schemaRef: 'frontend/src/lib/api-v1-types.ts:ApiV1Stats',
  },
  {
    method: 'GET',
    path: '/api/v1/findings/<slug>.json',
    summary: 'Per-finding detail: headline, numerator, denominator, chart payload, notes. One file per H-series slug.',
    tier: 'static',
    exampleCurl: 'curl -s https://ainpi.dev/api/v1/findings/pii-exposure-ndh.json | jq',
    exampleResponse: `{
  "slug": "pii-exposure-ndh",
  "title": "Social Security Numbers exposed in the NDH bulk export",
  "hypotheses": ["H27"],
  "status": "published",
  "release_date": "2026-05-08",
  "headline": "41 of 50 flagged Practitioner resources …",
  "numerator": 41,
  "denominator": 7441211,
  "chart": { "type": "bar", "data": [...] }
}`,
    schemaRef: 'frontend/src/lib/api-v1-types.ts:ApiV1Finding',
  },
  {
    method: 'GET',
    path: '/api/v1/states/<state>.json',
    summary: 'State-scoped view: VA, PA, OH (and growing). Denominators, state-vs-national findings table, verify-yourself sample NPIs.',
    tier: 'static',
    exampleCurl: 'curl -s https://ainpi.dev/api/v1/states/va.json | jq',
    schemaRef: 'frontend/src/lib/api-v1-types.ts:ApiV1State',
  },
  {
    method: 'GET',
    path: '/api/v1/states/va-cohort-critical.csv',
    summary: 'Federally-excluded VA-resident NPIs (LEIE or SAM, score ≥ 1.5) with per-NPI verification URLs (LEIE / SAM / NPPES).',
    tier: 'static',
    exampleCurl: 'curl -s https://ainpi.dev/api/v1/states/va-cohort-critical.csv',
  },
  {
    method: 'GET',
    path: '/api/v1/manifest.json',
    summary: 'Discovery manifest — every published finding URL + state slice URL + schema reference. The list AI agents and crawlers should poll.',
    tier: 'static',
    exampleCurl: 'curl -s https://ainpi.dev/api/v1/manifest.json | jq',
  },
];

const LIVE_API: Endpoint[] = [
  {
    method: 'GET',
    path: '/api/npd/search?npi=<10-digit>',
    summary: 'NDH-only profile lookup by NPI. Returns Practitioner with name, gender, qualifications, addresses.',
    tier: 'stable',
    exampleCurl: 'curl -s "https://ainpi.dev/api/npd/search?npi=1306378096" | jq',
    exampleResponse: `{
  "type": "provider_profile",
  "data": { "practitioner": { "npi": "1306378096", "family_name": "...", "given_name": "...", "qualifications": [...] } },
  "source": "cms_npd",
  "release_date": "2026-05-08"
}`,
  },
  {
    method: 'GET',
    path: '/api/npd/search?family=<name>&state=<XX>',
    summary: 'Name-based NDH search across Practitioner + Organization + Location.',
    tier: 'stable',
    exampleCurl: 'curl -s "https://ainpi.dev/api/npd/search?family=smith&state=VA"',
  },
  {
    method: 'POST',
    path: '/api/provider-search',
    summary: 'Cross-source merged search across NDH (BigQuery) + NPPES + Humana + Cigna + UnitedHealthcare + Molina. Returns a normalized payload with per-source response times and disagreement points.',
    tier: 'stable',
    exampleCurl: `curl -sX POST https://ainpi.dev/api/provider-search \\
  -H "Content-Type: application/json" \\
  -d '{"npi":"1306378096"}' | jq`,
    exampleResponse: `{
  "ok": true,
  "summary": { "sourcesQueried": 6, "matched": 2, "totalMs": 2562 },
  "results": [
    { "sourceId": "ndh", "category": "directory", "matchCount": 1, "practitioners": [...] },
    { "sourceId": "nppes", "category": "authoritative", ... }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/npd/data-quality?view=<summary|states|specialties|endpoints>',
    summary: 'Pre-aggregated data quality breakdown sourced from Supabase (synced from BigQuery weekly).',
    tier: 'stable',
    exampleCurl:
      'curl -s "https://ainpi.dev/api/npd/data-quality?view=summary" | jq',
  },
  {
    method: 'GET',
    path: '/api/npd/validation',
    summary: 'Live BigQuery vs source-manifest reconciliation. Reports per-resource expected/actual/delta + completeness.',
    tier: 'stable',
    exampleCurl: 'curl -s https://ainpi.dev/api/npd/validation | jq',
  },
];

const SDKS = [
  {
    name: 'Python',
    code: `import requests
stats = requests.get("https://ainpi.dev/api/v1/stats.json").json()
print(stats["counters"]["resources_processed"], "resources at", stats["release_date"])

# Lookup an NPI
r = requests.get("https://ainpi.dev/api/npd/search", params={"npi": "1306378096"})
print(r.json()["data"]["practitioner"]["family_name"])`,
  },
  {
    name: 'TypeScript / Node',
    code: `import type { ApiV1Stats } from "@ainpi/types"; // optional, vendored from the repo

const stats: ApiV1Stats = await fetch("https://ainpi.dev/api/v1/stats.json").then(r => r.json());
console.log(stats.counters.resources_processed, "resources");

// Cross-source merged search
const res = await fetch("https://ainpi.dev/api/provider-search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ npi: "1306378096" }),
});`,
  },
  {
    name: 'Anthropic Claude tool / function-call',
    code: `// Define ainpi_lookup_npi as a Claude tool. The model returns provenance-rich
// answers without confabulating.
const tools = [{
  name: "ainpi_lookup_npi",
  description: "Look up a 10-digit NPI in the AINPI cross-source merged registry.",
  input_schema: {
    type: "object",
    properties: { npi: { type: "string", pattern: "^\\\\d{10}$" } },
    required: ["npi"],
  },
}];

// Tool handler:
async function handle(npi: string) {
  const r = await fetch("https://ainpi.dev/api/provider-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ npi }),
  });
  return await r.json();
}`,
  },
];

function EndpointCard({ ep }: { ep: Endpoint }) {
  const tierColor =
    ep.tier === 'static'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : ep.tier === 'stable'
        ? 'bg-blue-100 text-blue-800 border-blue-200'
        : 'bg-amber-100 text-amber-800 border-amber-200';

  return (
    <div className="bg-white border rounded-lg p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="font-mono text-xs font-bold uppercase rounded bg-gray-900 text-white px-2 py-1">
          {ep.method}
        </span>
        <code className="font-mono text-sm sm:text-base text-gray-900 break-all">
          {ep.path}
        </code>
        <span
          className={`ml-auto text-[10px] uppercase tracking-wider font-semibold rounded-full border px-2.5 py-0.5 ${tierColor}`}
        >
          {ep.tier}
        </span>
      </div>
      <p className="text-sm text-gray-700 mb-3">{ep.summary}</p>
      {ep.exampleCurl && (
        <pre className="text-[12px] sm:text-xs bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto mb-3">
          <code>{ep.exampleCurl}</code>
        </pre>
      )}
      {ep.exampleResponse && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-600 hover:text-gray-900 mb-2">
            Example response
          </summary>
          <pre className="text-[12px] bg-gray-50 border rounded p-3 overflow-x-auto text-gray-800">
            <code>{ep.exampleResponse}</code>
          </pre>
        </details>
      )}
      {ep.schemaRef && (
        <p className="text-xs text-gray-500 mt-3">
          Schema:{' '}
          <a
            className="font-mono text-primary-600 hover:underline"
            href={`https://github.com/FHIR-IQ/AINPI/blob/main/${ep.schemaRef.split(':')[0]}`}
          >
            {ep.schemaRef}
          </a>
        </p>
      )}
    </div>
  );
}

export default function DeveloperPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-widest text-primary-600 font-mono mb-3">
            Build on AINPI
          </p>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-gray-900 mb-4">
            AINPI for developers
          </h1>
          <p className="text-lg text-gray-700 max-w-3xl">
            Every number on this site is reachable as JSON. Apache-2.0, no auth, no rate limit today.
            The static <code className="font-mono text-sm">/api/v1/*</code> tier is the stable
            contract — breaking changes bump to <code className="font-mono text-sm">/api/v2/</code>{' '}
            and never change shape in place. Live <code className="font-mono text-sm">/api/npd/*</code>{' '}
            and <code className="font-mono text-sm">/api/provider-search</code> are read-only against
            BigQuery + payer FHIR endpoints.
          </p>
        </header>

        {/* Quick start */}
        <section className="mb-14">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Quick start</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6">
            <a
              href="/api/v1/stats.json"
              className="block bg-white border rounded-lg p-5 hover:border-primary-400 transition"
            >
              <p className="font-mono text-xs text-primary-600 mb-1">/api/v1/stats.json</p>
              <p className="text-sm text-gray-700">Site-wide counters. Stable across releases.</p>
            </a>
            <a
              href="/api/v1/manifest.json"
              className="block bg-white border rounded-lg p-5 hover:border-primary-400 transition"
            >
              <p className="font-mono text-xs text-primary-600 mb-1">/api/v1/manifest.json</p>
              <p className="text-sm text-gray-700">Discovery — every finding + state slice URL.</p>
            </a>
            <a
              href="https://github.com/FHIR-IQ/AINPI/blob/main/frontend/src/lib/api-v1-types.ts"
              className="block bg-white border rounded-lg p-5 hover:border-primary-400 transition"
            >
              <p className="font-mono text-xs text-primary-600 mb-1">api-v1-types.ts</p>
              <p className="text-sm text-gray-700">TypeScript schema. Vendor or import.</p>
            </a>
          </div>
        </section>

        {/* Static contract */}
        <section className="mb-14">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              Static contract — <code className="font-mono text-base">/api/v1/*</code>
            </h2>
            <span className="text-xs uppercase tracking-wider text-emerald-700 font-semibold">
              stable
            </span>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Pre-rendered JSON files. Cache as long as you like. Refreshed weekly via the GitHub Actions
            cron and on every NDH release.
          </p>
          <div className="grid grid-cols-1 gap-3">
            {STATIC_API.map((ep) => (
              <EndpointCard key={ep.path} ep={ep} />
            ))}
          </div>
        </section>

        {/* Live API */}
        <section className="mb-14">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              Live API — <code className="font-mono text-base">/api/npd/*</code> +{' '}
              <code className="font-mono text-base">/api/provider-search</code>
            </h2>
            <span className="text-xs uppercase tracking-wider text-blue-700 font-semibold">
              stable, live
            </span>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Per-request reads against BigQuery (NDH) + NPPES + 4 payer FHIR directories. Median
            latency ~400ms; tail latency depends on which payers respond. No auth today.
          </p>
          <div className="grid grid-cols-1 gap-3">
            {LIVE_API.map((ep) => (
              <EndpointCard key={ep.path} ep={ep} />
            ))}
          </div>
        </section>

        {/* SDK snippets */}
        <section className="mb-14">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Code samples</h2>
          <div className="grid grid-cols-1 gap-4">
            {SDKS.map((s) => (
              <div key={s.name} className="bg-white border rounded-lg p-5">
                <p className="font-semibold text-gray-900 mb-3">{s.name}</p>
                <pre className="text-[12px] sm:text-xs bg-gray-900 text-gray-100 rounded p-4 overflow-x-auto">
                  <code>{s.code}</code>
                </pre>
              </div>
            ))}
          </div>
        </section>

        {/* AI agent / MCP */}
        <section className="mb-14 bg-white border rounded-lg p-6">
          <p className="text-xs uppercase tracking-widest font-mono text-primary-600 mb-2">
            For AI labs · MCP / function-calling
          </p>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            Wire AINPI into Claude / ChatGPT as a grounded provider-data tool
          </h2>
          <p className="text-sm text-gray-700 mb-4 max-w-3xl">
            Every endpoint returns provenance-rich payloads (release date, methodology version,
            commit SHA, source attribution per finding). That makes AINPI a low-confabulation source
            for &quot;is this provider real / active / federally excluded?&quot; queries inside an
            LLM tool surface.
          </p>
          <ul className="text-sm text-gray-700 space-y-2 mb-4">
            <li>
              <strong>Discovery:</strong>{' '}
              <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                /api/v1/manifest.json
              </code>{' '}
              — single GET returns every published finding URL + schema reference.
            </li>
            <li>
              <strong>NPI lookup tool:</strong>{' '}
              <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                GET /api/npd/search?npi=&lt;10-digit&gt;
              </code>{' '}
              — returns a single Practitioner profile with FHIR-friendly fields.
            </li>
            <li>
              <strong>Cross-source verification tool:</strong>{' '}
              <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                POST /api/provider-search
              </code>{' '}
              — returns per-source agreement / disagreement so the model can surface conflicts to
              the user instead of collapsing them.
            </li>
            <li>
              <strong>Federal-screening tool:</strong>{' '}
              <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                /api/v1/findings/oig-leie-exclusions.json
              </code>{' '}
              and{' '}
              <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                /api/v1/findings/sam-exclusions.json
              </code>{' '}
              — pre-joined LEIE + SAM cohorts. Use the headline number directly.
            </li>
          </ul>
          <p className="text-sm text-gray-700">
            A reference MCP server wrapping all five tools is on the roadmap. Until it ships, the
            REST endpoints above can be pasted directly into Claude tool definitions or OpenAI
            function-call schemas.
          </p>
        </section>

        {/* Use rights */}
        <section className="mb-14">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">License + use rights</h2>
          <ul className="text-sm text-gray-700 space-y-2 max-w-3xl">
            <li>
              <strong>Code:</strong> Apache-2.0. Fork freely.
            </li>
            <li>
              <strong>Data:</strong> Underlying CMS NDH bulk export is US federal-government public
              domain. AINPI&apos;s aggregated outputs are released under the same terms.
            </li>
            <li>
              <strong>Citation:</strong> Use{' '}
              <a
                className="text-primary-600 hover:underline"
                href="https://github.com/FHIR-IQ/AINPI/blob/main/CITATION.cff"
              >
                CITATION.cff
              </a>
              . Pin to a release tag for audit-grade reproducibility.
            </li>
            <li>
              <strong>AI inference + redistribution:</strong> OK to use AINPI numbers as grounded
              answers in an LLM, OK to redistribute the static{' '}
              <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                /api/v1/*
              </code>{' '}
              JSON, OK to embed in product UI. Attribution to AINPI / FHIR-IQ requested but not
              required.
            </li>
            <li>
              <strong>SSN values, individual PII:</strong>{' '}
              <em>not</em> redistributed by AINPI even though present in the public NDH file. Don&apos;t
              re-publish them downstream.
            </li>
          </ul>
        </section>

        {/* Status / SLA */}
        <section className="mb-14 bg-amber-50 border border-amber-200 rounded-lg p-5">
          <p className="text-xs uppercase tracking-widest font-mono text-amber-900 mb-2">
            Today&apos;s posture
          </p>
          <p className="text-sm text-amber-900">
            AINPI is a research project, not a production SaaS. No auth, no rate limit, no SLA.
            Numbers are recomputed weekly + on every NDH release; the static contract files are the
            stable surface. If you&apos;re building a paid product on top, file an issue at{' '}
            <a
              className="underline"
              href="https://github.com/FHIR-IQ/AINPI/issues"
            >
              github.com/FHIR-IQ/AINPI/issues
            </a>{' '}
            so we can size SLA work and rate-limiting policy.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
