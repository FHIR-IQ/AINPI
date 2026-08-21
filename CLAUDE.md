# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AINPI is an experimental exploration of the CMS National Provider Directory (NPD) public use files (2026-05-08 release; April 2026-04-09 also archived). It ingests the 21.7M-record FHIR R4 dataset from directory.cms.gov into Google BigQuery, serves interactive exploration via a Next.js 14 app on Vercel, and backs the app with Supabase Postgres for session-scoped state.

Live: <https://ainpi.dev>

**Scope note**: This is a research/educational project. Every page shows a WIP banner; every number should be verified against primary sources before any decision.

## Repository Structure

```text
AINPI/
├── frontend/                 Primary active app (Next.js 14 App Router)
│   ├── src/
│   │   ├── app/              Routes (pages + API, including /api/v1/*)
│   │   ├── components/       Shared UI (Navbar, WipBanner, Footer, charts/)
│   │   ├── contexts/         FilterContext for cross-chart filtering
│   │   ├── data/findings.ts  Pre-registration catalog (H1–H52 → 39 findings; some bundle multiple H#s)
│   │   ├── lib/              bigquery.ts, prisma.ts, auth.ts, api-v1-types.ts, load-api-v1.ts, hub-feed.ts, homepage-data.ts, og.tsx, load-npi-cohort.ts, landscape-types.ts, pa-rural-types.ts
│   │   └── utils/supabase/   SSR-safe Supabase clients
│   ├── public/api/v1/        Static JSON contract (stats.json, findings/<slug>.json)
│   ├── scripts/              BigQuery setup, ingestion, sync scripts
│   ├── prisma/               Supabase schema + seed scripts
│   ├── tests/                Vitest unit tests
│   └── e2e/                  Playwright tests
├── analysis/                 Python scripts per hypothesis (h9, h10_h13, h18, etc.) — outputs to frontend/public/api/v1/
│   ├── fhir_identifiers.py   Four-way NPI extractor; every new FHIR parser must use it
│   ├── harvest_payer_directory.py  Pulls a whole payer FHIR directory to analysis/data/ (gitignored)
│   └── tests/                pytest unit tests (h26, ndh_manifest, fast-ingest flatteners, NPI extractor)
├── crawler/                  Local mirror of FHIR-IQ/ainpi-probe endpoint liveness crawler
├── docs/methodology/         Versioned methodology doc (index.md rendered at /methodology) + version-log.md (YAML frontmatter of past versions; surfaced by hub-feed timeline) + runs/ (per-run provenance docs)
├── docs/briefings/           State-meeting briefing markdown (rendered at /briefings/<state>)
├── docs/articles/            Long-form articles (filename `YYYY-MM-DD-<slug>.md`; rendered at /articles/<slug> via dynamic route)
├── docs/reports/             Release-update markdown (one .md per dated update; rendered at /reports/<slug> via hand-written page.tsx per release)
├── docs/superpowers/         Spec-driven-dev workspace: specs/<date>-<topic>-design.md + plans/<date>-<topic>.md
├── .github/                  Workflows (CI, CodeQL, gitleaks, weekly-refresh, release), gitleaks-baseline.json
└── CLAUDE.md, README.md, DATABASE_SETUP.md, vercel.json, .mcp.json
```

## Stack

- **Frontend**: Next.js 14 App Router, React 18, TypeScript, Tailwind. **The design system is deliberate, not scaffold defaults** — `frontend/tailwind.config.ts` defines a warm archival-paper neutral ramp (`paper` `#faf8f5`, `ink` `#171310`, `signal` `#a8321c`, `primary.600` `#08519c` matching the map ramp), a serif/sans/mono trio wired as CSS variables from `next/font/google`, a tightened type scale with negative letter-spacing, 2-3px radii, and hairlines in place of shadows. `globals.css` carries the tokens plus `.eyebrow`, `.lede`, `.measure` (68ch), `.stat*` and `.rise`. New UI should use these rather than reintroducing default Tailwind blue-gray, rounded-lg and drop-shadows. Chart ramps must stay colorblind- and greyscale-safe (the treemap ramp was changed off red-green for this reason)
- **Data warehouse**: Google BigQuery (`thematic-fort-453901-t7.cms_npd`) — holds 21.7M FHIR resources (May 2026-05-08 release; April 2026-04-09 also archived)
- **App database**: Supabase Postgres (project `hspqvcoinujtfodreqaf`, pooler region `aws-1-us-east-2`) — holds pre-aggregated NPD metrics, user auth, magic-scan results, subscribers, report downloads
- **ORM**: Prisma (against Supabase only; BigQuery is accessed via `@google-cloud/bigquery` SDK)
- **Visualizations**: D3.js (+ topojson-client for US choropleth), dynamic `next/dynamic` imports so D3 stays out of SSR
- **Testing**: Vitest (frontend) + Playwright E2E (frontend) + pytest (`analysis/tests/`, pure-function unit tests for h26)
- **Methodology version**: `0.7.2-draft` (see `docs/methodology/index.md`; historical versions in `docs/methodology/version-log.md`)
- **Hosting**: Vercel
- **Auth for BigQuery in production**: service account key JSON loaded from `GCP_SERVICE_ACCOUNT_KEY` env var
- **GCP cost controls (load-bearing — always follow before adding paid-service usage)**: This project enforces a hard-cap architecture for any paid API. Existing controls: (1) a `$10/mo` budget alert (`6d1efd94-3b35-4aeb-af19-bb38f3bbb03f`) emails at 50/90/100%, (2) the budget publishes to `projects/thematic-fort-453901-t7/topics/billing-alerts`, (3) `infrastructure/kill-billing-function/` deploys a Cloud Function that auto-disables billing when cost ≥ budget (see its README), (4) every BigQuery query defaults to `maximum_bytes_billed=100 GB` (~$0.50). Use `DEFAULT_MAX_BYTES_BILLED` from `frontend/src/lib/bigquery.ts` (TS) or `bq_job_config()` from `analysis/claims_sources/_cohorts.py` (Python) on any new BQ work. **All Maps/Places APIs are disabled at the project level** — do not re-enable without a deliberate, documented need.

  **Architecture review checklist — run before adding any production route that hits a paid service:**
  1. **Per-call cost at projected traffic.** Calculate cost-per-1,000-requests for the worst-case query path. If >$1, hard-cap or cache before launch.
  2. **Storage-layer fit for the query pattern.** BigQuery tables MUST be clustered on the column you filter by (see Clustering section under BigQuery Schema). An unclustered table full-scans on every query — a single hot-path route with no clustering + no cap can produce hundreds of dollars of charges in days.
  3. **Caching layer.** Vercel `force-static` or `revalidate` for data that updates ≤ daily. Response caching for repeated lookups of the same key.
  4. **Hard cap on traffic spikes.** Either a per-query `maximum_bytes_billed`, a per-day quota, or a rate limit on the route.
  5. **Disable unused paid APIs at the project level** so accidental enablement (e.g., via a tutorial, a tool, or AI assistant) can't trigger spend.

## Common Commands

All commands run from `frontend/` unless noted.

```bash
npm run dev                   # Next.js dev server
npm run build                 # prisma generate + next build
npm run lint                  # ESLint
npm run test                  # Vitest (run mode)
npm run test:watch            # Vitest watch
npm run test:coverage         # Vitest with coverage
npm run test:e2e              # Playwright
npm run test:e2e:ui           # Playwright UI mode
npm run report:pdf            # tsx scripts/generate-report-pdf.ts

# Single test / single case
npx vitest run tests/lib/hub-feed.lead.test.ts
npx vitest run -t "falls back to latest published"
npx playwright test e2e/findings-hub.spec.ts

# Python analysis (from repo root, not frontend/)
set -a; source analysis/.env; set +a
python3 analysis/h43_practitioner_phone.py
python3 -m pytest analysis/tests/            # 161 pure-function unit tests

# Supabase/Prisma
npm run db:generate           # prisma generate
npm run db:push               # prisma db push (no migration files)
npm run db:migrate            # prisma migrate dev
npm run db:studio             # Prisma Studio GUI
npm run db:seed               # tsx prisma/seed.ts

# BigQuery / CMS NPD ingestion
npm run bq:setup              # Create dataset + tables + views
npm run bq:ingest             # Download + ingest all 6 NDJSON files
npm run bq:sync               # Aggregate BigQuery → Supabase metrics
```

Prisma reads env vars from `.env`; tooling expects you to keep `.env.local` authoritative and run `cp .env.local .env` before Prisma commands.

## Pages

- `/` — Provider data landscape homepage. Karpathy-style hierarchical treemap of every (state × specialty) cell scored across six audit dimensions (completeness, cross-source agreement, currency, endpoint reachability, federal integrity, specialty validity). Tile-by toggle (specialty / state); layer toggle across the six metrics with constant spatial layout; fullscreen mode that re-runs the D3 layout at viewport dimensions so labels stay legible. Cell click → side panel with per-NPI verify URLs (NPPES / LEIE / SAM). Server component reads `frontend/public/api/v1/landscape.json` via `loadLandscape()`. Cell data is currently a deterministic synthetic seed (`methodology_version: 0.7.1-draft-seed`); the weekly-refresh cron replaces with measured BQ values.
- `/map` — The prior US choropleth (federally-excluded NPIs per state). 3-style theme switcher, click-to-side-panel state detail. Composes `MapHomepage` from `loadHomepageMapData()`. Moved here from `/` in PR #115 when the landscape became the homepage; `/landscape` 308-redirects to `/` via `next.config.js` for prior external bookmarks.
- `/real-health-providers` — Policy brief mapping every § 6220 obligation of the REAL Health Providers Act (HR 7148, signed 2026-02-03) to the existing AINPI signal that measures it. Decomposes accuracy into six independently citable dimensions; ships copy-paste citation language for submitters to the 2028 CMS scoring-methodology RFC.
- `/pecos` — PECOS-as-authoritative-source landing page. Cross-references the H37–H39 findings (PROVIDER_TYPE vs NPPES taxonomy disagreement, behavioral-health subset, multi-state enrollments).
- `/for-state-medicaid` — Index of CMO-facing per-state explainers for the state Medicaid CMO listserve audience. Per-state pages at `/for-state-medicaid/<state>`. Count-and-action lede framing (per CMO-audience convention), no H-numbers in the head, citation-ready for SMD-letter Elements 2 and 4.
- `/findings` — **Findings hub** (NOT a flat index). Three vertically-stacked sections: (1) `LeadStory` hero block — currently H40 with hero stats, LEIE/SAM/NPPES verify chips, CTA; data sourced from the finding marked `featured: true` in `findings.ts`. (2) `Timeline` — 10 most-recent items across 4 categories (Finding/Update/Article/Methodology) with color-coded category chips + status pills. (3) `FindingsCatalogTable` — sortable table of all findings (mobile card-stack below 640px) with `aria-sort` semantics. All three sourced from `loadHubFeed()` in `frontend/src/lib/hub-feed.ts`, which aggregates findings + reports + articles + methodology version-log into typed `HubFeed`. Components live under `frontend/src/components/findings-hub/`. Spec at `docs/superpowers/specs/2026-05-22-findings-hub-redesign-design.md`.
- `/findings/[slug]` — One finding per page. `force-static` + `generateStaticParams` over `allSlugs()`. Live headline/chart/notes from `loadFinding(slug)` reading `frontend/public/api/v1/findings/<slug>.json`. **Tier-1 follow-up:** apply the hub's hero + verify-chip pattern here too (currently chart-first; see roadmap in design spec).
- `/articles/[slug]` — Long-form articles rendered from `docs/articles/*.md` via dynamic route at `frontend/src/app/articles/[slug]/page.tsx`. Slug strips the `YYYY-MM-DD-` date prefix from the filename (`2026-05-22-eight-years-post-exclusion.md` → `/articles/eight-years-post-exclusion`). Currently one article (the Miranda confirmed-case Substack/LinkedIn piece).
- `/npd` — Public NPD search (NPI, name, org, state, city; no login). Reachable via Explore nav + hub timeline links.
- `/data-quality` — Interactive dashboard: KPIs, completeness heatmap, US choropleth, per-resource gauges, state bar chart, specialty treemap, endpoint sunburst, relationship stats, Sankey graph, force-directed knowledge graph, state→city drill-down via `StateDetailPanel`, data validation panel. All charts share a `FilterContext` for cross-filtering.
- `/insights` — Provenance & variance analysis. Interactive org comparison tool + narrative sections on NPPES-vs-PECOS-vs-CAQH sources, active-flag signal limitations, CAQH ingestion path. Pre-filled with UPMC.
- `/methodology` — Versioned audit methodology (DAMA DMBOK mapping, L0–L7 scoring, reproducibility). Sourced from `docs/methodology/index.md`.
- `/data-sources` — Citation-grade reference: every public dataset AINPI ingests, considers, or rejects (NPPES, PECOS, LEIE, SAM, NUCC, NDH IG, etc.) with primary-source URLs, license terms, refresh cadence, and the hypothesis each maps to. `force-static`.
- `/states` — Index of state-scoped audit slices. **All 50 states + DC now have a published JSON slice**; only VA / PA / OH currently carry the richer Medicaid-program narrative (program brand, agency, MCO list) in `frontend/src/data/states.ts` (`SEED_STATES`). The rest render the data-quality block + a "brief pending — open an issue" callout, driven by `ALL_STATE_NAMES` in the same file.
- `/states/[state]` — One state per page. `force-static` over `allStateCodes()` (51 codes). Renders denominators, state-vs-national findings table, "verify a sample yourself" block of NPIs (linked to NPPES Registry), citation language for the state's CMS response, and explicit limitations. Live data from `loadStateFindings(state)` which reads `frontend/public/api/v1/states/<state>.json`. Generated by `analysis/state_findings.py <state…>`. `/states/va` also renders an `McoExposurePanel` (H26 4-payer cross-reference).
- `/rural-health` — H48 national rural hospital baseline. State choropleth + sortable table, `RuralStateMap`. Reads `frontend/public/api/v1/rural-health.json`.
- `/states/[state]/connectivity` — **Connectivity ledger.** The whole chain for one state: practitioner → role → organization → location → endpoint → EHR vendor, with a funnel showing where it breaks, confidence bands, a D3 force graph of systems-to-endpoints-to-vendors, a health-system rollup, and a named work queue of organizations nothing public reaches. Generated by `analysis/state_connectivity.py <state>` into `states/<state>-connectivity.json`. Also carries a **layered county map** (`StateGeoMap`): six overlays (endpoint reach, affiliation, practitioners per 10k, behavioral-health share, age 65+, median income) over constant geometry, zoom and pan, and an organization point layer of 5,278 proportional circles filled where an endpoint is reachable. State-generic; PA is the only published slice today. `force-static`, `dynamicParams = false`. **Reuses the H50/H51/H47/H54 published artifacts rather than recomputing them**, so it cannot disagree with those findings. PA result: 227,727 active practitioners, 38.1% have any role, 19.3% reach an endpoint (50.3% of those with an affiliation).

  **Map rules that are easy to get wrong, all of them learned here:**
  - **Colour encodes a rate, never a count.** A choropleth of counts is a population map wearing a different hat.
  - **Missing is hatched, not pale.** A county with no practitioners must not share a colour with a county whose rate is zero. `null` and `0.0` mean different things and the payload keeps them apart.
  - **Quantile bins, not linear.** Montour County holds 4,001 practitioners per 10,000 residents because Geisinger is headquartered there. A linear ramp spends its entire range on that one county.
  - **Do not draw a histogram of equal-count bins.** The first legend did, and every bar came out identical by construction. It now plots one dot per county on a linear axis with the bin edges drawn over it, which shows the skew that forces the quantile choice.
  - **Semantic zoom.** All 5,278 points at state level is a mat of circles; the reveal threshold steps down with zoom, largest first.
  - Stroke widths and label sizes are divided by the zoom factor so hairlines stay hairlines.
- `/states/pa/rural-health` — H47 Pennsylvania hospital connectivity dashboard: FHIR endpoint publication, EHR vendor concentration, rural designation, county overlays for income and age. Reads `states/pa-rural-health.json` (+ `.csv`).
- `/npi` and `/npi/[npi]` — Per-NPI pages over the H23 high-risk cohort (10,000 rows from `high-risk-cohort-export.csv` via `load-npi-cohort.ts`). **Cost contract: `force-static`, `dynamicParams = false`, `generateStaticParams` over `allCohortNpis()`, and no runtime BigQuery.** An unknown NPI 404s rather than falling back to a live lookup; that is deliberate, because a live fallback on a crawled route is an unbounded BQ bill. Do not add one.
- `/payer-healthcare-service-survey` (+ `/results`) — Community-input survey from the CMS NPD weekly call on how payers ship FHIR `HealthcareService` resources. Feeds an AINPI recommendation back to that call.
- `/briefings/va` — Markdown-rendered Virginia case study (most-developed of the per-state worked examples). Sourced from `docs/briefings/2026-05-04-virginia-state-medicaid.md` via `loadMarkdown` + `MarkdownPage` (same pattern as `/faq`). Pulls together the § 455.436 framework, VA-specific data quality numbers, the 125-NPI federally-excluded cohort, the H26 4-payer cross-reference, and Stage B roadmap. **Public-good research framing — never represented as produced for, prepared for, or guided by any state agency.**
- `/smd-revalidation` — Citable methodology landing page mapping AINPI to the 5 elements of the CMS State Medicaid Director letter. Anchored in 42 CFR § 455.436 federal database checks (NPPES + LEIE + SAM + SSA-DMF). Includes copy-paste citation language for state response submissions.
- `/faq`, `/privacy`, `/security` — Policy pages sourced from `docs/*.md` via `next/mdx`-style markdown reads.
- `/subscribe` — Resend-backed email signup; POST to `/api/v1/subscribe`. Fires a realtime admin alert on every new signup (see Admin notifications).
- `/download`, `/report` — Report picker (4 reports today) with email gate → `/api/v1/download-report` streams a Playwright-generated PDF of `/report` (or redirects to a web report). Fires a realtime admin alert on every download.
- `/provider-search` — Real-time cross-source merged search: NDH (BigQuery) + NPPES NPI Registry + 4 payer FHIR directories (Humana, Cigna, UHC via Optum FLEX, Molina via Sapphire360). Returns per-source results so disagreements are visible side-by-side.
- `/magic-scanner` — AI-powered (Anthropic / OpenAI / Perplexity) provider discovery + NPPES staleness check
- `/reports/<slug>` — Subscriber release updates, latest `2026-08-17-update`. **`frontend/src/data/reports.ts` is the authoritative list**; don't maintain a count or a range here, both go stale silently. Each release is a hand-written `page.tsx` at `frontend/src/app/reports/<slug>/page.tsx` rendering `docs/reports/<slug>.md` via `loadMarkdown` + `<ReactMarkdown>`. New reports need all three: the `reports.ts` entry, the `page.tsx`, and the markdown source. **Only one report carries `badge: 'NEW'`** — demote the previous one in the same commit, or the picker shows two.
  - **Two reports written for a general reader** (`2026-08-16-update`, `2026-08-17-update`) drop the H-numbers and the FHIR vocabulary entirely: "web address" not "endpoint", "where they work" not "PractitionerRole". They lint at 0.65-0.76 on `slop_lint.py` against a 1.22 baseline for the earlier house style. Copy their voice for anything aimed past the standards community.
- `/developer` — API docs for external consumers: stable `/api/v1` contract, live `/api/npd/*` + `/api/provider-search`, code samples (Python / TypeScript / Anthropic Claude tool definitions), license + AI-use-rights guidance.
- `/video/2026-05-08-update/` — Static asset: 48-sec viral data video (7 scenes) from the Claude Design handoff. Vendored HTML + JSX + Babel-in-browser bundle; OG/Twitter tags wired so X/LinkedIn share previews render rich.

## API Routes

```text
/api/npd/search              GET  — Search NPD by NPI, name, org, state, city
/api/npd/data-quality        GET  — Summary, state/specialty/endpoint breakdowns (defaults to ?release=2026-05-08)
/api/npd/state-detail        GET  — Drill-down: cities, top orgs/specialties within a state
/api/npd/relationships       GET  — Top-N org network overview + relationship stats
/api/npd/org-analysis        GET  — Interactive variance tool data (used by /insights)
/api/npd/validation          GET  — Source-file vs BigQuery counts, NPI/URL validity, orphan refs

/api/provider-search         POST — Cross-source merged search across NDH + NPPES + 4 payer FHIR directories
/api/magic-scanner           POST — AI-augmented provider discovery

/api/v1/subscribe            POST — Email signup. Fires sendSubscriptionAlert() to ADMIN_EMAIL.
/api/v1/download-report      POST — Report-download capture + redirect. Fires sendDownloadAlert().
/api/v1/subscribers/count    GET  — Public subscriber count for the Footer / hero ticker
/api/v1/admin/weekly-report  GET  — Cron-only digest. Authorization: Bearer ${CRON_SECRET}. Fetches Vercel Analytics 7-day traffic + subscriber/download stats.

/api/auth/login              POST — JWT login
/api/auth/register           POST — User registration
/api/practitioners/me        GET/PUT — Logged-in user profile
/api/practitioner-roles      GET/POST/PUT — Practitioner role CRUD
/api/providers               GET/POST — Provider CRUD
/api/demo/*                  Demo endpoints for NPPES comparison, FHIR export
```

All NPD routes that use `request.url` or query BigQuery are marked `export const dynamic = 'force-dynamic'` to defeat Vercel edge caching (critical for validation/state-detail, which hit live BQ).

**Source-side schema watch (May 2026-05-08 broke a TS extractor)**: the NDH May release changed the NPI identifier system URL from `http://hl7.org/fhir/sid/us-npi` → `http://terminology.hl7.org/NamingSystem/npi`. `pickIdentifier()` in `frontend/src/app/api/provider-search/route.ts` now matches either URL **plus** `type.coding[].code = "NPI"` as a fallback. Any new code that parses FHIR identifiers must use the same three-way match or it will silently lose every NPI from the May release.

## Public `/api/v1/*` JSON contract

Static files under `frontend/public/api/v1/` are the **stable public contract** — external consumers (docs, partner integrations, the `ainpi-examples` repo) depend on these URLs not changing shape. Breaking changes bump the path (`/api/v2/`), never the shape in place.

| Path | Generator | Schema |
| --- | --- | --- |
| `/api/v1/stats.json` | weekly-refresh workflow | `ApiV1Stats` in `frontend/src/lib/api-v1-types.ts` |
| `/api/v1/manifest.json` | `analysis/build_manifest.py` | Discovery index — every published finding URL + state slice URL + downloadable CSV + schema ref + AI-agent tool schemas (lookup_npi, cross_source_search, get_finding, get_state_audit). **Regenerated by `weekly-refresh.yml` (added 2026-08-16).** Before that nothing rebuilt it, so it silently drifted three months and ten findings behind while the workflow kept reporting success. If you add a finding or a CSV outside the weekly chain, run the script by hand. |
| `/api/v1/findings/<slug>.json` | `analysis/h*.py` scripts | `ApiV1Finding` in same file |
| `/api/v1/findings/endpoint-org-crosswalk.csv` | `analysis/h50_endpoint_org_linkage.py` | Resolved FHIR base URL → org (id, NPI, name, state) for the 19,334 endpoints carrying a managingOrganization. Doubles as a base-URL-to-NPI lookup. FHIR REST only. |
| `/api/v1/states/<state>.json` | `analysis/state_findings.py <state>` | state-scoped payload consumed by `loadStateFindings(state)`. All 50 + DC published. |
| `/api/v1/findings/pecos-org-crosswalk-<state>.csv` | `analysis/ingest_pecos_affiliations.py` | NPI → CMS-enrolled organization (PAC ID + legal name), practice address, specialty, category, Medicare assignment, telehealth, facility CCNs. PA only today. |
| `/api/v1/findings/role-gap-composition.json` + `-<state>.csv` | `analysis/h54_role_gap_composition.py` | Role coverage by NUCC category, plus per-NPI detail (`grouping`/`classification` omitted on purpose: derivable from `taxonomy_code`, and repeating them cost 13 MB of a 24 MB file). |
| `/api/v1/states/<state>-enrollment-endpoint.csv` | `analysis/h53_org_endpoint_resolution.py` | practitioner NPI → endpoint via the CMS-enrolled group. The only path that reaches a practitioner carrying no `PractitionerRole`. |
| `/api/v1/states/va-cohort-critical.csv` | `analysis/build_va_briefing.py` | 131 federally-excluded VA NPIs (May release; was 125 in April) + LEIE/SAM/NPPES verification URLs |
| `/api/v1/states/va-briefing-summary.json` | `analysis/build_va_briefing.py` | Consolidated VA briefing payload (findings + cohort breakdown + H26 results in one fetch) |

Server Components read these via `loadStats()` / `loadFinding(slug)` in `frontend/src/lib/load-api-v1.ts` (filesystem reads at build time; no round-trip). External consumers hit the same files over HTTP.

**Findings-hub data layer** (`frontend/src/lib/hub-feed.ts`): `loadHubFeed()` aggregates 4 timeline sources — published findings (from `FINDINGS`), web-format reports under `/reports/*` (from `REPORTS`), articles (filesystem scan of `docs/articles/*.md`), and methodology version bumps (YAML frontmatter in `docs/methodology/version-log.md`) — into one typed `HubFeed` `{ lead, timeline, catalog }`. Lead selection: `FINDINGS.find(f => f.featured)` first, fall back to latest published. Timeline trimmed to 10 with the lead excluded. Catalog = every finding sorted by updated date desc. Both the `/findings` hub page and the homepage Latest strip consume the same `HubFeed`.

The writable `/api/v1/` endpoints (`subscribe`, `download-report`) are Next.js route handlers — the static JSON files sit in `public/` and take precedence over same-named routes, so never name a route handler `stats/route.ts`.

## SEO, social and syndication

| Surface | File | Notes |
| --- | --- | --- |
| OG cards | `frontend/src/lib/og.tsx` + `opengraph-image.tsx` at `/`, `/findings`, `/findings/[slug]`, `/rural-health` | Shared renderer. The display font is fetched at build and **memoised in a module-level cache** — without it the build refetches the same font once per finding. Font failure falls back to `serif` rather than failing the build. |
| Structured data | `frontend/src/components/JsonLd.tsx` | `Dataset` (findings + both rural pages), `Organization`, `WebSite`, `Article`. |
| RSS | `frontend/src/app/feed.xml/route.ts` | `force-static`, built from `loadHubFeed()`. |
| Sitemaps | `sitemap.ts` (~10,200 URLs) and `sitemap-findings.xml/route.ts` (36 URLs) | Both submitted to Search Console. |
| Robots | `frontend/src/app/robots.ts` | |

**Dataset markup rules that are easy to get wrong:**

- `description` under 50 characters gets the dataset **dropped by Google entirely**. Every finding's `headline` currently clears this, but a terse new finding would not.
- `citation` means "a reference to another creative work". It is **not** the denominator. The denominator goes in `variableMeasured`; `citation` points at `/methodology`.
- `isBasedOn` defaults to the NDH bulk files. The rural datasets (H47, H48) derive from CMS Hospital General Information joined to USDA ERS, so they override it. Any non-NDH finding must too, or it misattributes provenance.
- `metadataBase` in the root layout is load-bearing: without it no OG image URL resolves.

**Two sitemaps on purpose.** `sitemap.xml` is ~10,200 URLs of which ~10,164 are per-NPI pages, so its coverage number cannot tell you whether the findings are indexed. `sitemap-findings.xml` lists only the Dataset-bearing pages so that subset reports separately. Listing a URL in both is allowed by the protocol.

**Google Dataset Search has no submission API or form.** It is crawl-driven off the Dataset markup. There is nothing to submit beyond the sitemap; markup quality is the whole lever. `sc-domain:ainpi.dev` is a verified domain property, and the local ADC token carries `webmasters.readonly`, so indexing status is readable with no extra auth (writes need a re-auth that would replace the ADC BigQuery depends on).

## Pre-registration workflow (H1–H52)

Each hypothesis in the check catalog is registered **before** numbers drop. Current range: **H1–H54** (40 findings; some bundle multiple H numbers). H41, H44 and H45 are registered but unpublished; H53 is the organization-to-endpoint resolver that feeds the connectivity ledger rather than a standalone finding page, so **H55 is the next free number** — check `FINDINGS` before assuming.

- H1–H28 — original directory-side audit (NDH-side checks).
- H29–H36 — claims-side cross-audit (Medicaid spending, Medicare Part B/D, Open Payments, DMEPOS, nursing-home ownership, NDH completeness).
- H37–H39 — PECOS-as-authoritative-source workstream (taxonomy mismatch, behavioral-health subset, multi-state enrollments).
- H40 — published 2026-05-22. Per-(NPI, HCPCS, place-of-service) cross-audit of federally-excluded NPIs billing Medicare Part B. Source: CMS Medicare Physician & Other Practitioners by Provider AND Service file (~3 GB, CY 2023). **Result: 194 NPIs full-window, 4 strict-post-exclusion candidates → 1 confirmed (Eduardo Miranda, MD, ~$880K CY 2023 billing 8 years post-LEIE-exclusion), 3 SAM-NPI-join false positives caught by primary-source verification.** Compute script: `analysis/claims_sources/medicare_partb_by_hcpcs.py`. Provenance doc: `docs/methodology/runs/2026-05-22-h40-h41-h42-baseline.md`.
- H42 — published 2026-05-22. Telehealth-dominant filter on H40. **Result: null hypothesis supported** (zero NPIs at ≥80% telehealth-HCPCS threshold). Honest headline names two competing readings (screening working vs cohort too small).
- H41 — pre-registered, deferred. Two-pass over the H40 source file + BQ NPPES taxonomy query stalled at the iterator mid-run on first attempt. Switch to `bq query --format=csv > /tmp/nppes.csv` upfront before retrying. Compute script ships in `analysis/h41_specialty_drift.py` but is unpublished.
- H43 — published 2026-06-09. Practitioner phone-number reachability across three FHIR paths (`Practitioner.telecom`, `PractitionerRole.telecom`, referenced `Location.telecom`). **Result rejected the pre-registered prior** (sparse `Practitioner.telecom`, NPPES-style): 7,195,270 of 7,196,385 active practitioners (99.98%) carry a phone directly on the Practitioner record; the traversal adds nothing; 1,115 have no phone on any path. On-record telecom is phone + fax only (email/url/location-phone empty — verify before relying). Compute: `analysis/h43_practitioner_phone.py`, runnable via the isolated `h43-refresh.yml` dispatch workflow or the weekly-refresh step. Provenance: `docs/methodology/runs/2026-06-09-h43-practitioner-phone.md`.
- H44 — **pre-registered, unpublished**. Endpoint metadata coverage vs the HTE submission spec (`ftrotter-gov/HTE_data_release_specifications`). Maps the spec's nine endpoint-metadata fields against the NDH STU1 Endpoint profile: only two have a structured home. Denominator is the FHIR-REST Endpoint subset (114,071 at 2026-05-08 per H28), not the 1.36M resource count. Compute: `analysis/h44_endpoint_metadata.py`, isolated in `h44-refresh.yml`.
- H45 — **pre-registered, unpublished, method revised**. CEHRT-published FHIR endpoints missing from the NDH, by state. The registered join was NPI-primary; a coverage study of the CEHRT scrape (287,916 orgs, 191 vendors) showed that assumption does not hold: 51.7% carry an NPI, but athenahealth alone supplies 139,159 of them, and excluding it the rate is 6.5% with 101 vendors publishing none. Any NPI-primary join must fall back to normalized name-plus-state.
- H46 — published 2026-08-01. State Medicaid provider-directory coverage and liveness across the 56 jurisdiction rows in `Enterprise-CMCS/SMA-Endpoint-Directory`, pinned at commit `8efa0c2d`. Compute: `analysis/h46_sma_directory_coverage.py`. **Probe with curl, not urllib**: Python's TLS stack produced false negatives on three state directories (Iowa, Rhode Island, West Virginia) that return 200 to curl. Two header rows in the source markdown must be excluded or they inflate the jurisdiction count.
- H47 — published 2026-08-04. Pennsylvania rural hospitals: FHIR endpoint publication and EHR concentration across all 187 CMS-listed PA hospitals. Compute: `analysis/pa_rural_health.py` (no BigQuery, five public files). Two bugs worth knowing: EHR vendors publish a **hierarchy**, so endpoint resolution must walk `Organization.partOf` to the brand-level org that carries `Organization.endpoint` (not doing so wrongly reported Epic as cross-linking almost nothing); and CMS writes county names as `MC KEAN` where USDA writes `McKean`, so joins go through `norm_county()`, which strips to alphanumerics.
- H48 — published 2026-08-04. National rural hospital baseline: 1,847 of 5,366 hospitals (34.4%) in nonmetro counties, against 13.8% of population. Compute: `analysis/rural_health_national.py`, which imports the shared helpers from `pa_rural_health.py`. Territories are excluded because ERS publishes no continuum code for them; 239 unmatched hospitals are reported per-state rather than silently dropped.
- H49 — published 2026-08-11. **The NDH carries no payer endpoints and no payer organization IDs.** Directly tests the expectation raised on the CMS NDH community call. Compute: `analysis/h49_ndh_payer_endpoints.py`, which reads the raw `resource` JSON rather than the flattened `_*` columns so a payer type could not be hidden by our own extractor. Includes a live control probe of a payer FHIR directory that does exist, to show the absence is in the NDH rather than in the world.
- H50 — published 2026-08-15. **Endpoint-to-organization linkage: 16.9%.** Only 19,334 of the 114,071 FHIR-REST Endpoint resources carry a resolvable `managingOrganization`. Presence and resolvability are counted separately, because "the reference is missing" and "the reference points at nothing" are different defects with different fixes; here the gap is almost entirely absence. Compute: `analysis/h50_endpoint_org_linkage.py`. Also publishes `findings/endpoint-org-crosswalk.csv`, a resolved base-URL-to-NPI lookup.
- H51 — published 2026-08-16. **76% of the endpoints the NDH cannot name are already named by the EHR vendors**, in public files: 71,857 of the 94,737 unattributed endpoints, 30,366 of them straight to an NPI, moving attribution from 16.9% to 79.9%. Compute: `analysis/h51_vendor_endpoint_attribution.py` over eight vendor publishers. **Index bundle entries by `fullUrl` as well as `Type/id`**: Epic references entries as `urn:uuid:`, and a resolver understanding only `Type/id` returns zero and does not error. That is the same failure that produced a wrong published claim about Epic in H47. Assert hierarchy roll-ups against the source org count; an early pass reported 105,562 sites against a 96,190 total.
- H54 — published 2026-08-16. **The role gap is a Medicare-billing gap.** Every coverage percentage this project publishes divides by the NDH's active Practitioner set, and nothing had checked what is in it. Across all 227,727 active PA practitioners joined to NPPES taxonomy, role coverage varies by two orders of magnitude between professions and tracks Medicare billing rather than clinical practice: 77.9% of advanced-practice clinicians and 69.8% of physicians carry a `PractitionerRole`, against 19.6% of therapists, 14.8% of behavioral-health providers, 4.7% of dentists, 2.7% of nurses and **1 of 12,995 pharmacy providers**. Compute: `analysis/h54_role_gap_composition.py`. **The registered prior was rejected**: the gap is not padded with non-record-holding NPIs (students, pharmacy, aides, transport, suppliers and facilities together are 5.2% of the set, worth about one point of coverage). Two things follow. Any directory-wide coverage number is really a statement about Medicare-billing specialties, and a consumer cannot tell a specialty with no digital presence from one the directory does not describe. It also predicts why the CMS-enrollment path adds so little: Medicare-enrolled clinicians already have roles.
- H52 — 2026-08-16. **Payer directories carry the practitioner-to-organization affiliation the NDH leaves empty.** The role gap, not the endpoint gap, is the NDH's binding constraint: 73% of active practitioners have no `PractitionerRole`, so no organization, so no endpoint path at any confidence. Medicare claims closed only 2.5% of it. Measured against the whole Capital BlueCross public FHIR directory (CMS-9115-F). Compute: `analysis/h52_payer_affiliation_gap.py`, fed by `analysis/harvest_payer_directory.py`. Provenance: `docs/methodology/runs/2026-08-16-h52-payer-affiliation-gap.md`. See "Harvesting payer FHIR directories" below for the source-side defects, which change the counts.

1. **Register** in `frontend/src/data/findings.ts`: slug, hypotheses list, null hypothesis, denominator, data source, audience implications. This is publishable on its own.
2. **Compute** via `analysis/<hN>_*.py` (BigQuery-driven) or `crawler/` (endpoint probes for H1–H5, H22). Each script emits a `frontend/public/api/v1/findings/<slug>.json` conforming to `ApiV1Finding`.
3. **Publish** by committing the JSON. The `/findings/[slug]` page automatically renders the live headline/chart/notes when the JSON exists; before that it shows the pre-registration-only view.

Hypothesis-to-slug mapping (check `FINDINGS` in `frontend/src/data/findings.ts` for authoritative list):

- `endpoint-liveness` → H1–H5 (probe: `analysis/h1_h5_h22_full.py`)
- `npi-taxonomy-correctness` → H9–H13 (BQ: `analysis/h9_npi_luhn.py`, `analysis/h10_h13_with_crosswalk.py`)
- `temporal-staleness` → H18 (BQ: `analysis/h18_temporal.py`)
- `referential-integrity` → H6–H8 (BQ: `analysis/h6_h8_integrity.py`)
- `duplicate-detection` → H14–H15 (BQ: `analysis/h14_h15_duplicates.py`)
- `network-adequacy-gauge` → H22 (joins crawler results to Endpoint table)
- `high-risk-cohort` → H23 (BQ: `analysis/high_risk_cohort.py`) — composite per-NPI score combining 5 signals at v0.4.0: oig_excluded (1.5), sam_excluded (1.5), not_in_nppes (1.0), nppes_deactivated (0.8), luhn_fail (1.0). Closes 3 of 4 federal database checks per 42 CFR § 455.436; SSA-DMF remains restricted-access. Critical bucket = score ≥ 1.5 (LEIE or SAM excluded). Outputs `high-risk-cohort.json` + `high-risk-cohort-export.csv`. **Known data-quality caveat (surfaced by H40 QA, 2026-05-22): the cohort builder's SAM-NPI join treats any non-empty SAM `npi` field as a cohort-qualifying signal without cross-validating the SAM-row name against NPPES.** The SAM.gov Public Extract sometimes carries an NPI field that doesn't belong to the named excluded party (clerical errors at SAM, NPIs reused across records). Observed false-positive rate among H40's strict-post candidates: 3 of 4. Fix path (tracked as follow-up PR): add NPPES-name-match validation to the SAM join; downgrade non-matching rows to `bucket=needs-review` rather than `critical`. Until that fix lands, any audit-referral based on this cohort needs primary-source verification per row (the per-NPI LEIE/SAM/NPPES verify URLs on every cohort row are the mechanism — see the H40 provenance doc for the worked example).
- `oig-leie-exclusions` → H24 (ingest: `analysis/ingest_oig_leie.py`, BQ: `analysis/h24_oig_exclusions.py`) — joins OIG LEIE monthly file to NDH practitioner NPIs
- State-scoped slices → `analysis/state_findings.py <state>` writes `frontend/public/api/v1/states/<state>.json`
- `sam-exclusions` → H25 (ingest: `analysis/ingest_sam_exclusions.py`, BQ: `analysis/h25_sam_exclusions.py`) — joins SAM.gov Public Extract V2 to NDH practitioner NPIs. Independent from LEIE: HHS slice overlaps, OPM slice is net-new. Ingest defaults to `sample-data/SAM_Exclusions_Public_Extract_V2_*.CSV`; API path requires `SAM_GOV_API_KEY` from `analysis/.env.example`.
- `pii-exposure-ndh` → H27 (BQ: `analysis/h27_pii_exposure.py`) — independently verifies the 2026-04-30 Washington Post finding that the NDH bulk export contains provider SSNs. Scans `cms_npd.practitioner` + `cms_npd.organization` for `\d{3}-\d{2}-\d{4}` in `TO_JSON_STRING(resource)`, classifies hits by JSON location (`qualification[].identifier[].value` vs `name[].given[]`), filters intl-phone false positives. Privacy posture: publishes counts/locations/NPIs/state breakdown only; SSN values themselves are NOT republished in finding output despite being in the public NDH bulk file. April 2026-04-09: 46 confirmed exposures across 17 states. May 2026-05-08: 41 confirmed (CMS partially scrubbed but did not eliminate); IL still leads with 13. Undashed 9-digit SSNs are out of scope (collide with EINs / account IDs / claim IDs).
- `mco-exposure-va` → H26 (live FHIR: `analysis/h26_mco_exposure_va.py`) — joins the VA federally-excluded cohort (131 NPIs in May; 125 in April) to 4 publicly-queryable payer FHIR endpoints: Humana (`?identifier=`), Cigna (`?family=&given=` + post-filter Bundle by NPI in `identifier[]` since Cigna rejects identifier search), UnitedHealthcare via Optum FLEX `https://flex.optum.com/fhirpublic/R4` (covers UHC commercial + UHC Community Plan + OptumRx), and Molina via Azure APIM gateway `https://api.interop.molinahealthcare.com/providerdirectory` (Sapphire360 backend, no auth despite registration-gated dev portal). May result: 2 of 131 matched (both Cigna), down from 4 of 125 in April. 2 of 6 VA Medicaid MCOs (UHC Community Plan + Molina) are wired directly. Stage B fast-follow: Anthem HealthKeepers Plus (public `cms_mandate/mcd/` endpoint exists but returns 500s; Anthem only supports family/given/name search), Aetna BH of VA (OAuth at developerportal.aetna.com), Sentara, Virginia Premier. The script shells out to `curl` instead of `urllib` because Akamai-fronted endpoints (Humana) WAF-block Python's TLS fingerprint.
- `endpoint-url-validity` → H28 (BQ: `analysis/h28_endpoint_url_validity.py`) — partitions the 1.36M Endpoint resources by connectionType.code. 114K (8.4%) are hl7-fhir-rest URLs an integrator can GET; 1.25M (91.6%) are Direct Trust HISP messaging addresses. The right denominator for any "find FHIR endpoint by NPI" feature is the FHIR REST subset, not the resource count.
- `practitioner-phone-reachability` → H43 (BQ: `analysis/h43_practitioner_phone.py`) — resolves practitioner → phone across `Practitioner.telecom`, `PractitionerRole.telecom`, and the referenced `Location.telecom` (`PractitionerRole.location → Location`), unioned and intersected back to the active Practitioner set. Reports the any-path reachability vs the on-record share, plus the on-record telecom-system breakdown (phone/fax/email/url). Denominator is active Practitioner resources (~7.44M). Single capped scan of each of the three tables via `bq_job_config()`.
- `endpoint-metadata-coverage` → H44 (BQ: `analysis/h44_endpoint_metadata.py`) — pre-registered, unpublished
- `cehrt-endpoint-coverage-gap` → H45 — pre-registered, unpublished; see the NPI-coverage caveat above
- `state-medicaid-directory-coverage` → H46 (`analysis/h46_sma_directory_coverage.py`) — no BigQuery; curl probes against the pinned CMS directory-of-directories
- `pa-rural-hospital-connectivity` → H47 (`analysis/pa_rural_health.py`) — no BigQuery; writes `states/pa-rural-health.json` + `.csv`
- `rural-hospital-baseline` → H48 (`analysis/rural_health_national.py`) — no BigQuery; writes `rural-health.json`
- `ndh-payer-endpoints` → H49 (`analysis/h49_ndh_payer_endpoints.py`) — reads raw `resource` JSON, not the `_*` columns
- `endpoint-org-linkage` → H50 (`analysis/h50_endpoint_org_linkage.py`) — also writes `findings/endpoint-org-crosswalk.csv`
- `vendor-endpoint-attribution` → H51 (`analysis/h51_vendor_endpoint_attribution.py`) — eight public vendor endpoint files
- `payer-affiliation-gap` → H52 (`analysis/h52_payer_affiliation_gap.py`) — needs a harvest from `analysis/harvest_payer_directory.py` first
- `role-gap-composition` → H54 (`analysis/h54_role_gap_composition.py`) — NDH joined to `bigquery-public-data.nppes.npi_raw` and categorized via `analysis/nucc_taxonomy.py`

H10–H13 apply the CMS Medicare Provider and Supplier Taxonomy Crosswalk (Oct 2025, downloaded fresh each run) to bridge NUCC ↔ CMS Medicare Specialty codes, and match against all 15 NPPES taxonomy slots with switch-aware logic (not just slot 1).

## BigQuery Schema (flexible FHIR-as-JSON pattern)

Each of the 6 resource tables stores the full FHIR resource as a `resource:JSON` column plus extracted flat `_*` fields for efficient querying. This avoids schema-drift failures when NDH extensions vary across records.

**Clustering**: every table is clustered on its most-queried `_*` column. Production queries that filter on these cluster keys scan <100 MB; filtering on any other column scans the full table (10 GB+ for `practitioner`, smaller for the others). **Any new hot-path route filtering by a non-cluster-key column must either recluster the table on that column OR set a per-query `maximum_bytes_billed` cap** — see the GCP cost-control checklist in the Stack section.

| Table | Cluster key |
|---|---|
| `practitioner` | `_npi` |
| `organization` | `_npi` |
| `location` | `_managing_org_id` |
| `endpoint` | `_managing_org_id` |
| `practitioner_role` | `_practitioner_id` |
| `organization_affiliation` | `_org_id` |

| Table | Key extracted columns |
|---|---|
| `practitioner` | `_id, _npi, _family_name, _given_name, _state, _city, _postal_code, _address_line, _phone, _telecom, _gender, _active` |
| `organization` | `_id, _npi, _name, _state, _city, _address_line, _phone, _telecom, _org_type, _active` |
| `location` | `_id, _name, _state, _city, _postal_code, _address_line, _phone, _telecom, _position_lat, _position_lng, _status, _managing_org_id` |
| `endpoint` | `_id, _connection_type, _status, _address, _name, _managing_org_id` |
| `practitioner_role` | `_id, _practitioner_id, _org_id, _specialty_code, _specialty_display, _location_ids, _phone, _telecom, _active` |
| `organization_affiliation` | `_id, _org_id, _participating_org_id, _active` |

**Multi-valued flattened columns are pipe-joined**, matching the existing `_location_ids` convention. `_telecom` is `system:value` pairs in source order (`fax:4129148635|phone:4123197866`); `_address_line` joins `address.line` entries (`200 Old Pond Rd|Ste 107`). `_phone` is the first entry whose **system is `phone`**, not the first telecom entry, because fax frequently precedes phone in NDH records. Coverage on the 2026-05-08 release: practitioner `_phone` 99.98% (independently reproduces H43), organization 99.93%, practitioner_role 74.9%, location 0.0% (Location.telecom is empty in this release, as H43 also found). `location._position_lat/lng` is populated for 93.86% of locations, which is the only geo in the NDH.

**Adding a flattened column takes two steps, and skipping the first fails silently.** `bq load` runs with `--ignore_unknown_values`, so a new key emitted by the extractor is *discarded without error* unless the column already exists on the table. Run `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` first, then `analysis/backfill_flattened_columns.py` to populate it from the stored `resource` JSON without waiting for the next full ingest (~21 GB, ~$0.10 for all four tables). The extractors must also never raise: an exception in the Python transform aborts the whole file rather than being absorbed by `--max_bad_records`, so one malformed record would kill a 7.4M-row load. `analysis/tests/test_fast_ingest_flatteners.py` asserts every extractor degrades to `None` across 13 malformed shapes.

**FHIR reference format**: `_practitioner_id` / `_org_id` / `_managing_org_id` hold full reference strings like `Practitioner/Practitioner-1234567890` or `Organization/Organization-1518732023`. Cross-resource JOINs reconstruct the reference from the target's `_id`, e.g.:

```sql
JOIN organization o ON pr._org_id = CONCAT('Organization/', o._id)
```

**Views** (see `scripts/recreate-views.ts`): `v_provider_by_state`, `v_provider_by_specialty`, `v_endpoint_by_type`, `v_org_by_state`, `v_data_quality_summary`.

### Ingestion contract — manifest-driven

The NDH bulk export at `https://directory.cms.gov/downloads/` publishes a stable `manifest.json` that is the canonical indirection. Per Fred Trotter (CMS NDH team, 2026-06-05 Slack thread): the manifest is intended as the only URL downstream consumers need to poll — when its contents change, the new file URLs are in there. The goal is to never have to download a 5GB file just to find out that the 5GB needs re-downloading.

`analysis/ndh_manifest.py` fetches the manifest, resolves each NDH resource to its current dated download URL, and exposes the manifest-declared `compressed_bytes` so downstream consumers can integrity-check partial downloads. `analysis/fast_ingest_ndh.py` uses it; pass `--print-manifest-only` to dump the resolved URLs without running the full ingest. The legacy `frontend/scripts/ingest-cms-npd.ts` still works but is deprecated (hardcodes undated filenames, ~5-10x slower via streaming inserts).

### Materialized helper tables (substrate pattern)

When the same dimension of the raw FHIR resources is interrogated by multiple findings, pre-extract it once into a small clustered helper table partitioned by release, then run each finding as a cheap join against the helper instead of re-doing the heavy resource scan. Pays for itself the second time the question is asked; the storage cost is negligible compared to repeated re-extraction.

**Phones helper — `cms_npd.phones_per_practitioner`** (built by `analysis/build_phones_per_practitioner.py`).
Per-release row per practitioner with normalized phone arrays for each of the three resolution paths (`phones_p`, `phones_r`, `phones_l`) plus the union (`phones`) and an `invalid_dropped` count for telecom values that failed normalization. Partitioned by `release_date`, clustered by `practitioner_id`. ~15 GB scan per release build (~$0.08), idempotent within a release (DELETE + INSERT against the matching partition). Rebuilt once per NDH release via the dispatch-only `phones-helper-refresh.yml` workflow. Downstream consumers (H43 path-combo Venn, H44 phone-value agreement, future H45 phone-churn diff-since-last-release) query the helper instead of the raw resource tables.

Phone normalization rules (encoded in the SQL): strip every non-digit character, drop a leading `1` if the result is 11 digits, require exactly 10 digits after. Anything else collapses to NULL and contributes to `invalid_dropped` instead of `phones`. Garbage-in-garbage-out is explicit, not hidden.

### Resolving organizations into health systems (`analysis/org_systems.py`)

A health system is not one organization. UPMC is a hospital operator, a health plan, and a physician group filed under a different legal name, each holding its own organization NPI. The directory records the leaves and mostly not the tree.

**Do not group by `OrganizationAffiliation` connected components.** This was tried and rejected. The resources carry `organization`, `participatingOrganization` and `active` and **no `code`**, so an edge never states what the relationship is. Ranking PA hubs by out-degree shows what the edges mostly are: Eckerd 577, Thrifty Payless 534, CVS 444, Rite Aid 342, Thrift Drug 245, Giant 139, Weis Markets 120 — retail pharmacy corporate structure. Connected components then merge unrelated organizations through shared hubs: taking them produced a 160-org "UPMC" cluster containing Corry Memorial Hospital, and handed 7,308 UPMC practitioners an athenahealth URL belonging to an ambulatory surgery centre. The graph is reported as a measured description, never used for grouping.

Grouping is best-evidence-first instead: **NPPES `is_organization_subpart` + `parent_organization_lbn`** (CMS's own corporate subpart-to-parent link, so it states what it means; 5,894 PA org NPIs but only 309 of those that hold PA practitioners), then **brand-name** inference for the rest, labelled as inference. `parent_organization_tin` is available and deliberately not selected: it is a tax ID, it is not needed to group, and republishing it is not a posture this project takes.

**A system does not have "an endpoint".** Collect every endpoint found anywhere in a system with the member carrying it; never pick the first. UPMC publishes an Epic endpoint for its physicians and separate athenahealth endpoints for individual surgery centres.

Known open gap: no public federal source links UPMC's physician group to UPMC. Not the affiliation resource, not NPPES subparts, not the vendor files (which name brands). That is a concrete ask, not something to infer around.

### CMS enrollment as a practitioner-to-organization source (`analysis/ingest_pecos_affiliations.py`)

Four public CMS files carry the affiliation edge the NDH leaves empty, with no harvest and no credentials. All four are resolved through a catalog rather than hardcoded, because the download URLs carry a content hash that rotates on every refresh.

| File | Gives |
| --- | --- |
| Doctors and Clinicians National Downloadable File (`mj5m-pzi6`) | NPI → `org_pac_id` + group legal name, practice address, phone, primary specialty, telehealth flag, Medicare assignment |
| Facility Affiliation Data (`27ea-46a8`) | NPI → facility CCN by facility type |
| Revalidation Reassignment List | Individual NPI → group PAC ID; reassignment is the enrollment act that creates the employment link |
| PPEF Enrollment Extract | NPI → CMS provider type, the category |

**PAC ID is the public stand-in for the tax ID.** A claim carries an NPI and a TIN, and the TIN is what groups billing under one legal entity. TIN is not public. The PECOS Associate Control ID is: one per legal entity, published, stable across enrollments. NPPES does carry `parent_organization_tin` and this project deliberately does not read or republish it.

**An empty `org_pac_id` is a finding, not a missing value.** A solo practitioner has no group. Counting them as an unclosed gap overstates the problem.

**Encoding is inconsistent across these files** and there is no way to tell from the response. Read utf-8-sig first and fall back to latin-1; getting it wrong raises partway through a 400 MB file and looks exactly like a truncated download.

**Per-NPI CSVs do not scale to 51 states.** Pennsylvania alone adds ~40 MB across the enrollment crosswalk, the composition detail and the enrollment-endpoint map, against a `public/api/v1/` tree that is already ~345 MB. Publishing all 51 would add roughly 2 GB to the repo. PA is the worked example on purpose; before extending, either trim to summary JSON per state or move the per-NPI detail out of git.

**Measured yield, so nobody re-runs this expecting more.** PA: 95,054 clinicians with a group, 74,405 of them present in the NDH, but only **2,614 of the 140,911 role-gap practitioners (1.9%)** gain a net-new affiliation. H54 explains why: Medicare-enrolled clinicians are already the ones the NDH gives roles to. The value is not gap closure, it is the second opinion on organization identity for practitioners whose directory organization resolves to nothing, which adds 1,047 endpoint-reaching practitioners in PA, 623 of them carrying no `PractitionerRole` at all.

### Categorizing NPIs (`analysis/nucc_taxonomy.py`)

Shared module mapping a NUCC taxonomy code to grouping, classification, section (Individual / Non-Individual) and a coarse reporting `category`. Any new work that needs to know what kind of provider an NPI belongs to must use it rather than pattern-matching specialty strings.

It deliberately does **not** decide which categories "should" reach an endpoint. That is an empirical question, and answering it by assertion bakes an opinion into a denominator. Callers measure reach per category and report it.

The NUCC release version in the filename (`nucc_taxonomy_261.csv`) is `<two-digit year><release number>`, two per year. The loader tries a window of versions newest-first, because a hardcoded version silently 404s six months after it is written. A 404 from that host can return an HTML body with a success-looking status, so the loader validates the header shape rather than trusting the status code.

### Harvesting payer FHIR directories (`analysis/harvest_payer_directory.py`)

Payer directories published under CMS-9115-F carry `PractitionerRole` densely, which is the affiliation edge the NDH leaves empty (H52). The harvester pulls a whole directory to gitignored NDJSON under `analysis/data/payer/<slug>/`, resumable, with failed pages recorded in the checkpoint so a short run can be told apart from a complete one.

**Every one of these was measured against Capital BlueCross, and every one silently corrupts a naive harvest.**

- **Use curl, not urllib.** Same lesson as H26 and H46. Python's TLS stack fails against WAF-fronted payer endpoints and local TLS interception.
- **`_count` is not honoured.** The page stride is fixed at 20 distinct resources whatever you ask for. Sizing a run from `_count` under-fetches with no error. Pagination ends at page 112,975 for `PractitionerRole`; the next page returns empty.
- **`PractitionerRole` ids are not unique.** Every logical role is served **twice under one id**: one copy names the payer as the `organization`, the other names the real practice. Verified 140 of 140 ids sampled across the full page range. So `Bundle.total` double-counts (2,259,490 entries ≈ 1.13M logical roles), and **deduplicating on `id` discards the only useful organization half the time**. The harvester dedupes on (id, content-hash) and counts both. FHIR R4 requires resource ids to be unique per type on a server, so report this back rather than working around it silently.
- **Never append to a shared `.gz`.** A run killed mid-write leaves a truncated gzip member, and everything appended after it is unreachable on read. Each run writes its own `.partNNNN.ndjson.gz`; read them via `read_resources()`.
- **Throughput saturates near 8 workers** (measured: 1.05 / 3.11 / 3.63 / 4.25 req/s at 1 / 4 / 8 / 12 workers, with latency climbing 0.95s → 2.21s). Sustained rate over a long run settles near 1.2 pages/s. A full `PractitionerRole` sweep is ~20 hours, so H52 fetches roles by `practitioner=` for the gap cohort only (`--roles-for-ids`), ~25,000 requests instead of ~113,000.

**NPI extraction is now centralized in `analysis/fhir_identifiers.py`, and new parsers must use it.** The NPI is marked four different ways and three of them return nothing to a parser reading only `identifier.system`: the May 2026 NDH URL change, `identifier.type.coding[]` (Capital BlueCross `Practitioner`), and no coded marker at all with only `assigner.display = "CMS"` (Capital BlueCross `Organization`). Each failure returns an empty list rather than raising, so nothing downstream notices — a first pass here read 2,000 practitioners and reported zero NPIs. The `assigner_hint=True` fallback is opt-in and requires a valid check digit, because the same organizations carry 10-digit NCPDP identifiers and 3 of 59 sampled passed Luhn; callers must report coded and inferred counts separately.

### Known data quality baseline

**The warehouse is loaded with 2026-08-20.** `analysis/release.py` holds `CURRENT_RELEASE`; bump it in the same commit as a reload. Before any reload run `analysis/release_snapshot.py --release <outgoing>`: the tables carry no release column and `fast_ingest_ndh.py` loads with `--replace`, so the outgoing release is otherwise unrecoverable. Snapshots live in `analysis/release-snapshots/` (tracked, not under the gitignored `analysis/data/`).

```text
Resource                        May-08      Aug-20         Δ
practitioner                 7,441,211   7,373,232    −0.9%
organization                 3,414,375   4,402,671    +28.9%
location                     1,362,869   2,535,686    +86.1%
endpoint                     1,360,585   1,128,169    −17.1%
practitioner_role            7,028,001  16,545,158   +135.4%
organization_affiliation     1,086,694     483,992    −55.5%
TOTAL                       21,693,735  32,468,908    +49.7%
```

**The 2026-08-20 release is the largest change since this project started measuring, and it broke three things.** The manifest renumbered every key (`Practitioner_2026-05-07_2128.ndjson` → `06-Practitioner.ndjson`), which resolved nothing under the old `startswith(f"{resource}_")` matcher and blocked ingestion entirely; `parse_release_date` crashed because the new keys carry no date and it received a dict; and the export went from six files to eight. See `analysis/ndh_manifest.py` for the whole-stem regex that now accepts all three key formats, including the boundary that stops `Organization` matching `08-OrganizationAffiliation.ndjson`.

What moved, measured (`/api/v1/release-deltas.json`, `/api/v1/role-gap-delta.json`):

- **PractitionerRole more than doubled** (active 3,952,445 → 10,806,327) and national role coverage moved only 27% → 31.4%, PA 38.1% → 43.7%. Most new records went to practitioners who already had one: roles per covered practitioner went ~2.0 → 4.67. A doubling of records is not a doubling of coverage, and the headline count hides which happened.
- **Every profession improved, most at the bottom.** PA pharmacy 1 → 526 practitioners with a role, dental 4.7% → 13.3%, behavioral health 14.8% → 22.9%, against advanced practice 77.9% → 82.0%. The Medicare-billing gradient H54 found is still there and much smaller.
- **`Organization.partOf` went from 0% to 100% resolvable.** May had 148,834 references to unpublished parents; Aug has 140,017 references, 43,551 targets, none dangling. Anything built around that field being useless needs rebuilding, and anyone told it was broken deserves the correction.
- **Payer identity arrived, reachability did not.** 27 organizations now carry a `pay` type that did not exist, owning 233 health plans, and none of them carries an endpoint (H49, H55).
- **Endpoint attribution regressed**, 16.9% → 14.7% (H50). Total FHIR REST also fell, so some is removal rather than lost names. Reported rather than buried.
- Half the Organization file is now `ein` tax records (2,199,519 of 4,402,671), up from 41.4%.

Earlier source-side schema changes that still bite: the NPI identifier system URL changed from `http://hl7.org/fhir/sid/us-npi` to `http://terminology.hl7.org/NamingSystem/npi` in May, and `PractitionerRole.specialty` shifted from CMS Medicare format (`14-50`) to NUCC taxonomy codes (`207R00000X`).

**32 analysis scripts still hardcode a release-date string literal.** `analysis/release.py` exists to end that; H28, H50 and H54 import from it. Migrate the rest when touching them.

## Supabase Prisma Schema (app database)

Key models (`frontend/prisma/schema.prisma`):

- **User-facing**: `Practitioner`, `PractitionerRole`, `SyncLog`, `Consent`
- **Provider directory discovery**: `ProviderDirectoryAPI`, `MagicScanResult`
- **NPD metrics (synced from BigQuery)**: `NpdDataQualitySummary`, `NpdStateMetrics`, `NpdSpecialtyMetrics`, `NpdEndpointMetrics`, `NpdIngestionLog`

## Authentication

JWT (7-day expiry) with bcryptjs-hashed passwords. Public pages (`/`, `/npd`, `/data-quality`, `/insights`, `/provider-search`, `/magic-scanner`, `/login`) do not require auth. Pages that need a token (`/dashboard`, `/demo`, `/audit-log`, `/providers/new`) no longer redirect — they render gracefully and only fetch authenticated data when a token exists.

## Admin notifications + analytics

Two-layer admin-visibility stack, all keyed off `ADMIN_EMAIL` (default `gene@fhiriq.com`):

1. **Realtime alerts** via `frontend/src/lib/admin-email.ts`:
   - `sendSubscriptionAlert()` fires from `/api/v1/subscribe` on every newly-created subscriber (re-subscribes don't re-alert). Also fires from `/api/v1/download-report` when `alsoSubscribe: true` produces a new subscriber row.
   - `sendDownloadAlert()` fires from `/api/v1/download-report` on every successful download capture.
   - Both are fire-and-forget (`void ...`) so the response doesn't block on SMTP. Errors are logged, never thrown. Skipped if `RESEND_API_KEY` is unset.
2. **Weekly digest** at `/api/v1/admin/weekly-report` — Vercel Cron Thursday 13:42 UTC. Combines subscriber + download stats from Supabase with a **project listing** for every project the `VERCEL_API_TOKEN` can read. Each project gets a deep-link button to its Vercel Analytics dashboard. Wrapper in `frontend/src/lib/vercel-analytics.ts`.

**Important: Vercel has no public Web Analytics REST API.** Confirmed against `openapi.vercel.sh` (zero analytics endpoints across 234 documented routes) and direct probing — every guess at `/v1/web-analytics/*`, `/v1/insights/*`, `/v1/analytics/*` returns 404. The dashboard fetches from internal `vercel.com/api/web/insights/*` routes with cookie auth, which are not stable or token-accessible. **Don't reinvent the broken fetch.** The cron renders dashboard deep-links instead; pageview/visitor numbers have to be read in-browser. If Vercel ships a public analytics API later, that's a new function in `vercel-analytics.ts` — not a fix to the old broken paths.

When changing the cron cadence, edit `vercel.json#crons[0].schedule`. The endpoint can also be hit manually for testing with `curl -H "Authorization: Bearer ${CRON_SECRET}" https://ainpi.dev/api/v1/admin/weekly-report`.

### Subscriber newsletters (`frontend/scripts/send-YYYY-MM-DD-update.ts`)

One hand-written send script per release. Each new one copies the previous (same CLI shape) and rewrites `buildBody()`.

**Two review gates before any send or publish. Both are required, and they catch different things:**

1. **`anti-slop-writing` skill** (global, `~/.claude/skills/anti-slop-writing/`) — form plus generic claim discipline. Run its linter on the draft: `python3 ~/.claude/skills/anti-slop-writing/scripts/slop_lint.py <file>` (add `--diff before after` to report a rewrite delta). Analytical mode is the default for reports and newsletters. Read the flagged spans rather than chasing the score: passive voice with no known actor and "never resolves" describing behavior are legitimate. Baselines measured 2026-08-01: report 1.22, newsletter 1.09, both in the "edited" band.
2. **`copy-reviewer` subagent** — project-specific fact checking the linter cannot do: every number verified against `frontend/public/api/v1/findings/*.json`, plus vague-attribution and overclaim checks.

Known false positive: the `— Eugene Vestel, FHIR IQ` byline at the foot of every `docs/reports/*.md` uses an em dash and trips the linter. It is consistent across the whole series; do not change it in one report alone.

**Corrections must be traced back to the generator.** When a fact is corrected in one surface, grep `analysis/` for the script that produces it and fix it there too. A QHIN count was corrected in a PDF and kept shipping wrong on the live site for weeks, because the fix landed on the deliverable and never reached `analysis/pa_rural_health.py`, which regenerates the published JSON. Prefer deleting a brittle number over updating it: counts of rolling-designation lists (QHINs, TEFCA participants, certified vendors) go stale silently, and the surrounding claim rarely depends on them.

**Careful with `git grep` when auditing published text for names.** The finding CSVs contain real provider names, so searches for people or organizations hit legitimate data (`KADY`, `KATY`, and `THE CHICAGO LIGHTHOUSE FOR PEOPLE WHO ARE BLIND` all match naive patterns). Scope such greps to `'*.ts' '*.tsx' '*.py' '*.md'` rather than the whole tree.

Hard conventions that prevent duplicate / accidental sends:

- **Dry-run by default; `--confirm` required to send.** `--email <addr>` targets one address (no DB hit); `--limit N` targets the first N subscribers. 250ms throttle between sends.
- **In-blast dedup is mandatory.** The recipient list is collapsed case/whitespace-insensitively before sending so the same mailbox can never get two copies in one run (`email` is `@unique` in Postgres but that is case-sensitive). Carry the `seenNorm` Set filter forward into every new send script.
- **One `--confirm` per campaign.** There is no sent-log table; re-running `--confirm` re-sends to everyone. Send once, verify the `sent=N failed=0` line, do not re-run.
- **Publish + deploy the report/finding pages BEFORE the full blast** so subscriber clicks don't 404 (poll the linked URLs for `200` on production first — see the 2026-06-02 timing lesson).

## Required Environment Variables (`frontend/.env.local`)

```text
# Supabase Postgres
POSTGRES_PRISMA_URL          Pooler URL (pgbouncer=true, port 6543)
POSTGRES_URL_NON_POOLING     Direct URL (port 5432) — used by Prisma migrate
NEXT_PUBLIC_SUPABASE_URL     https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   sb_publishable_...

# BigQuery
GCP_PROJECT_ID               thematic-fort-453901-t7
BQ_DATASET_ID                cms_npd
GCP_SERVICE_ACCOUNT_KEY      JSON-encoded service account key (production only)
# Local dev falls back to Application Default Credentials (`gcloud auth application-default login`)

# Auth
JWT_SECRET                   For login tokens

# AI providers (optional, for magic-scanner + provider-search)
ANTHROPIC_API_KEY
OPENAI_API_KEY
PERPLEXITY_API_KEY
AI_PROVIDER                  anthropic | openai | perplexity

# Email + admin notifications (Resend)
RESEND_API_KEY               sk_xxx — required for subscribe welcome, download thanks, admin alerts, weekly digest
RESEND_FROM_ADDRESS          'AINPI <reports@ainpi.dev>' (ainpi.dev domain verified on Resend; ainpi.com is NOT)
ADMIN_EMAIL                  gene@fhiriq.com — where admin alerts + weekly digest land
CRON_SECRET                  Shared secret Vercel Cron injects as Bearer auth for /api/v1/admin/weekly-report

# Vercel Analytics (for the weekly admin digest's project list + deep-links)
VERCEL_API_TOKEN             User-generated at https://vercel.com/account/tokens. Used to list every project the user has access to (/v9/projects). Does NOT enable live pageview/visitor numbers — Vercel has no public Web Analytics REST API.
VERCEL_PROJECT_ID            prj_lNspRMthCJiD4iv77DFooZhLHGkd (kept for backwards compat with single-project helper; not used by the multi-project weekly digest)
VERCEL_TEAM_ID               team_F3iDzgf6olA4mjXfKAeEB1In
VERCEL_TEAM_SLUG             aks129s-projects (human-readable slug used in dashboard deep-link URLs; falls back to VERCEL_TEAM_ID if unset)

# Optional release-override for the BigQuery→Supabase sync
NPD_RELEASE_DATE             Defaults to 2026-05-08 in scripts/sync-bq-to-supabase.ts
```

`analysis/` Python scripts read their own env from `analysis/.env` (gitignored). Copy `analysis/.env.example` and `set -a; source analysis/.env; set +a` before running. Currently holds `SAM_API_KEY` for the SAM.gov ingestion scaffold.

`./.private/` is a gitignored workspace for strategy and competitive-positioning docs. Don't reference it in shipped code, public docs, commit messages, or PR descriptions.

## Testing

- **Vitest**: 175 tests across 25 files under `frontend/tests/` (api/, components/, data/, ingestion/, lib/) covering FHIR reference extraction, API parameter parsing, data-quality API contract, validation API, hub-feed aggregation, findings-hub components, NPI/URL regex, BigQuery schema validation. Run one file with `npx vitest run tests/lib/hub-feed.lead.test.ts`, one case with `-t "<name>"`.
- **Playwright (dev)**: `data-quality`, `npd-search`, `findings-hub`, `map-homepage` specs — structural assertions, run via `npm run test:e2e` (boots local dev server)
- **Playwright (prod)**: `frontend/e2e/accuracy-2026-05-08.spec.ts` (24 assertions) — production smoke that pins every published number to the May release. Run with `PLAYWRIGHT_BASE_URL="https://ainpi.dev" npx playwright test --config=playwright.prod.config.ts accuracy-2026-05-08.spec.ts` (the prod config skips webServer boot so it doesn't fight other dev servers on port 3000)

Run dev tests in CI: `npm run test && npm run test:e2e`.

## Deployment Notes

- `vercel.json` at repo root points builds to `frontend/` (`buildCommand: "cd frontend && npm run build"`, `outputDirectory: "frontend/.next"`)
- `.vercelignore` excludes `frontend/data/` (the downloaded NDJSON files, 2.8 GB compressed)
- All Vercel env vars mirror the local `.env.local`, with `GCP_SERVICE_ACCOUNT_KEY` being critical for production BigQuery access
- Dynamic routes: `npd/*` API routes export `dynamic = 'force-dynamic'` so stale edge-cached data doesn't poison live-data endpoints
- **Vercel 250 MB lambda size limit** (`frontend/next.config.js` → `experimental.outputFileTracingExcludes`). `public/api/v1/` is ~345 MB (per-state H37/H38/H39 CSVs + the 508K/256K-row PECOS detail files). Next.js's output-file tracer was over-including the entire tree in every serverless function bundle. The fix excludes `public/api/v1/findings/**` and `public/api/v1/states/**` from all lambdas — safe because the loaders only read these at build time for static page generation, and at runtime Vercel's CDN static handler serves the JSON/CSV directly without ever touching the lambda. **If you add a new route that imports `load-api-v1.ts`, `homepage-data.ts`, or `hub-feed.ts`, verify it's still `force-static` and that its `.nft.json` doesn't reference the big trees** (`grep -c 'public/api/v1/states' .next/server/app/<route>.js.nft.json` should be 0). If you ever need to serve these dynamically from a lambda, you'll need to refactor — not just remove the exclusion.
- **CodeQL stored-XSS pattern (recurring)**: CodeQL flags any dynamic value flowing from filesystem/static data into an anchor `href` — even when the source is a `findings.ts` slug or a `docs/articles/` filename (both authored-by-us, never user input) and the consumer is `next/link` (which sanitizes). Fix pattern: **constant-prefix + allowlist validator**. See `safeCtaHref` in `frontend/src/components/findings-hub/LeadStory.tsx` and `ARTICLES_GITHUB_URL` constant in `frontend/src/app/articles/[slug]/page.tsx`. Both fixes carry inline JSDoc explaining the false-positive context so future maintainers don't undo them.
- **`vercel.json` headers are silently ignored for framework projects.** Vercel defers to the framework, so response headers must live in `frontend/next.config.js` → `async headers()`. A headers block in `vercel.json` will appear correct in the repo and do nothing in production. The only way to catch it is to check live response headers (`curl -sI https://ainpi.dev/api/v1/stats.json | grep -i cache-control`).
- **Verify a deploy by matching the commit SHA, not by listing order.** `vercel ls` ordering has repeatedly given wrong answers (a stale build read as current, a CDN-cached asset read as un-deployed). Query the Deployments API and match `meta.githubCommitSha` against `git rev-parse HEAD`, or poll for a URL that only exists in the new build. Add a cache-buster when re-fetching an asset you just changed.

## CI / CD workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push/PR to main | `npm ci` → `prisma generate` → `npm run lint` → `npm run test` (from `frontend/`) |
| `.github/workflows/codeql.yml` | push/PR + weekly | JS/TS + Python static analysis |
| `.github/workflows/gitleaks.yml` | push/PR | Secret scan using upstream gitleaks **binary** (v8.21.2) — NOT `gitleaks/gitleaks-action@v2` (that requires a paid org license). Baselines historical leaks via `.github/gitleaks-baseline.json`; any NEW finding fails the job. |
| `.github/workflows/anti-patterns.yml` | push/PR | AINPI-specific guardrails complementing gitleaks + CodeQL. Runs `.github/scripts/scan-anti-patterns.sh` on the PR diff. Catches: hardcoded `AIza…` Google API keys, embedded service-account JSON, Python BQ queries missing `bq_job_config()` cap, direct `new BigQuery(` outside the bounded helper, re-enabling deliberately-disabled Maps/Places APIs, and state-agency attribution language. Rules + remediation pointers in the script header. Add new rules there when a new policy is added to CLAUDE.md. |
| `.github/workflows/weekly-refresh.yml` | Mon 09:00 UTC + manual | Runs all `analysis/h*.py` scripts, regenerates `frontend/public/api/v1/*.json`, commits directly to `main`. Requires `GCP_SERVICE_ACCOUNT_KEY` secret (BQ jobUser + dataViewer on `cms_npd` and `bigquery-public-data.nppes`). **Note: this chain is fail-fast and sequential — one broken step (e.g. H24) skips everything after it.** Isolate any finding whose freshness matters into its own dispatch workflow (see `h43-refresh.yml`). |
| `.github/workflows/h43-refresh.yml` | manual (`workflow_dispatch`) | Standalone refresh for H43 only — runs `analysis/h43_practitioner_phone.py` and commits just `practitioner-phone-reachability.json` to `main`. Exists so the H43 number doesn't depend on the health of the full weekly chain. Same `GCP_SERVICE_ACCOUNT_KEY` secret. |
| `.github/workflows/h44-refresh.yml` | manual (`workflow_dispatch`) | Standalone refresh for H44 only, same isolation rationale as `h43-refresh.yml`. |
| `.github/workflows/phones-helper-refresh.yml` | manual (`workflow_dispatch`) | Rebuilds the `cms_npd.phones_per_practitioner` helper table once per NDH release (~15 GB scan, ~$0.08). Idempotent within a release via DELETE + INSERT against the matching partition. |
| `.github/workflows/release.yml` | tag `v*` | Cuts GitHub release |

**Vercel Cron** (in `vercel.json`, not GitHub Actions): `GET /api/v1/admin/weekly-report` fires weekly at **Thursday 13:42 UTC** (`42 13 * * 4`). Sends the consolidated admin digest — subscriber list, recent downloads, source mix, and a per-project Vercel Analytics dashboard deep-link list — to `ADMIN_EMAIL`. Auth via `Authorization: Bearer ${CRON_SECRET}` header. Cron-triggered requests are authorized by Vercel automatically.

**Weekly-refresh pushes straight to main** (not a PR) because the org policy disallows Actions from opening PRs without a PAT, and refresh outputs are deterministic. If merge queue/signatures block the bot push, add `github-actions[bot]` to the ruleset bypass list — do not add a PAT.

## Branch protection on `main`

Baseline protection only: `allow_force_pushes: false`, `allow_deletions: false`. No required reviews, signatures, linear history, or merge queue — this is a single-maintainer project and that level of process is friction without payoff. Direct push to `main` is still allowed.

If the stricter rules return in the future (merge queue, required signatures, copilot review), document them here so they aren't a surprise.

## Secrets management

- **App runtime secrets** live in Vercel. Add/update with `vercel env add <NAME> production` (and repeat for `preview` / `development`). Never commit to `.env.local` that will be pushed.
- **GitHub Actions secrets** (e.g. `GCP_SERVICE_ACCOUNT_KEY`) go via `gh secret set NAME < file.json` or the repo Settings UI.
- `google-github-actions/auth@v2.1.11+` writes the credential file to `$RUNNER_TEMP` (outside the workspace). A prior leak happened when `git add -A` scooped an earlier version's workspace file; `gha-creds-*.json` is now also `.gitignore`d as defense-in-depth.
- `.github/gitleaks-baseline.json` accepts known historical leaks in the repo history (all rotated). Regenerate via `gitleaks detect --report-format json --report-path .github/gitleaks-baseline.json` after any intentional new allowlist, then commit.

## Companion docs

- `docs/persona-walkthrough-2026-05-08.md` — captured 7-persona walkthrough of the production site (CMS publisher, industry vendor, health-system roster, individual provider, payer ops, startup/digital health, AI labs/MCP). Read this before touching the UI; it's the source of the highest-impact backlog items (per-payer scoreboard, MCP server, per-NPI history view, diff-since-last-release feed).
- `docs/reports/2026-05-08-update.md` + `docs/reports/2026-05-update.md` — markdown source for the two subscriber-facing release updates. Mirrored to `/reports/<slug>` pages with the `<ReleaseTeaser />` hero. New reports should register in `frontend/src/data/reports.ts` so they show up in the `/download` picker.
- `/tmp/ainpi-design/extracted/ai-npi/` — the Claude Design handoff bundle that produced the viral video. README + chat transcript explain the design intent; HTML/JSX are vendored into `frontend/public/video/2026-05-08-update/`. Don't render the prototype in a browser unless verifying — read the source directly.

## Domain Context

- **NPD** (CMS National Provider Directory): 2026-05-08 public use release (April 2026-04-09 also archived locally), 6 FHIR R4 resource types: Practitioner, PractitionerRole, Organization, OrganizationAffiliation, Location, Endpoint. Distributed as NDJSON compressed with zstd from directory.cms.gov
- **NDH IG** (National Directory of Healthcare, HL7): FHIR implementation guide that NPD adheres to. **Cite the published STU1** at <https://hl7.org/fhir/us/ndh/STU1/> (v1.0.0). The CI build at <https://build.fhir.org/ig/HL7/fhir-us-ndh/> is the STU2 work-in-progress — track it for upcoming changes but never link to it as the authoritative spec. Per Ming Dunajick (STU1 co-author, currently editing STU2) the ballot/CI URLs are not stable references.
- **NPPES**: National Plan and Provider Enumeration System — upstream source of ~90% of Practitioner/Organization fields. Self-attested, no enforcement.
- **PECOS**: Medicare enrollment; enriches NPPES with Medicare-enrolled provider data
- **CAQH**: Commercial-payer credentialing source. Currently **not** in the NPD ingestion pipeline. See `/insights` for full provenance analysis.
- **NPI**: National Provider Identifier — 10-digit CMS-issued ID
- **NUCC Taxonomy**: 900+ specialty classification codes
