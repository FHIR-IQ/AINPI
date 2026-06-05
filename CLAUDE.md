# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AINPI is an experimental exploration of the CMS National Provider Directory (NPD) public use files (2026-05-08 release; April 2026-04-09 also archived). It ingests the 21.7M-record FHIR R4 dataset from directory.cms.gov into Google BigQuery, serves interactive exploration via a Next.js 14 app on Vercel, and backs the app with Supabase Postgres for session-scoped state.

Live: <https://ainpi.vercel.app>

**Scope note**: This is a research/educational project. Every page shows a WIP banner; every number should be verified against primary sources before any decision.

## Repository Structure

```text
AINPI/
├── frontend/                 Primary active app (Next.js 14 App Router)
│   ├── src/
│   │   ├── app/              Routes (pages + API, including /api/v1/*)
│   │   ├── components/       Shared UI (Navbar, WipBanner, Footer, charts/)
│   │   ├── contexts/         FilterContext for cross-chart filtering
│   │   ├── data/findings.ts  Pre-registration catalog (H1–H42 → 27 slugs; some bundle multiple H#s)
│   │   ├── lib/              bigquery.ts, prisma.ts, auth.ts, api-v1-types.ts, load-api-v1.ts, hub-feed.ts, homepage-data.ts
│   │   └── utils/supabase/   SSR-safe Supabase clients
│   ├── public/api/v1/        Static JSON contract (stats.json, findings/<slug>.json)
│   ├── scripts/              BigQuery setup, ingestion, sync scripts
│   ├── prisma/               Supabase schema + seed scripts
│   ├── tests/                Vitest unit tests
│   └── e2e/                  Playwright tests
├── analysis/                 Python scripts per hypothesis (h9, h10_h13, h18, etc.) — outputs to frontend/public/api/v1/
│   └── tests/                pytest unit tests (currently h26 only)
├── pipeline/                 DuckDB-over-Parquet scaffold (shard, edges, Luhn, lastUpdated)
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

- **Frontend**: Next.js 14 App Router, React 18, TypeScript, Tailwind
- **Data warehouse**: Google BigQuery (`thematic-fort-453901-t7.cms_npd`) — holds 21.7M FHIR resources (May 2026-05-08 release; April 2026-04-09 also archived)
- **App database**: Supabase Postgres (project `hspqvcoinujtfodreqaf`, pooler region `aws-1-us-east-2`) — holds pre-aggregated NPD metrics, user auth, magic-scan results, subscribers, report downloads
- **ORM**: Prisma (against Supabase only; BigQuery is accessed via `@google-cloud/bigquery` SDK)
- **Visualizations**: D3.js (+ topojson-client for US choropleth), dynamic `next/dynamic` imports so D3 stays out of SSR
- **Testing**: Vitest (frontend) + Playwright E2E (frontend) + pytest (`analysis/tests/`, pure-function unit tests for h26)
- **Methodology version**: `0.7.0-draft` (see `docs/methodology/index.md`; historical versions in `docs/methodology/version-log.md`)
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
npm run test:e2e              # Playwright
npm run test:e2e:ui           # Playwright UI mode

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

- `/` — Map-first homepage. Interactive US choropleth (3-style theme switcher: Light cards / Dark dashboard / Minimal map) with click-to-side-panel state detail. Below the map: slim `<HomepageLatestStrip lead={...} />` line teasing the latest finding + linking to `/findings`. Server component composes `MapHomepage` + `HomepageLatestStrip` from `loadHomepageMapData()` + `loadHubFeed()` at build time.
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
- `/briefings/va` — Markdown-rendered Virginia case study (most-developed of the per-state worked examples). Sourced from `docs/briefings/2026-05-04-virginia-state-medicaid.md` via `loadMarkdown` + `MarkdownPage` (same pattern as `/faq`). Pulls together the § 455.436 framework, VA-specific data quality numbers, the 125-NPI federally-excluded cohort, the H26 4-payer cross-reference, and Stage B roadmap. **Public-good research framing — never represented as produced for, prepared for, or guided by any state agency.**
- `/smd-revalidation` — Citable methodology landing page mapping AINPI to the 5 elements of the CMS State Medicaid Director letter. Anchored in 42 CFR § 455.436 federal database checks (NPPES + LEIE + SAM + SSA-DMF). Includes copy-paste citation language for state response submissions.
- `/faq`, `/privacy`, `/security` — Policy pages sourced from `docs/*.md` via `next/mdx`-style markdown reads.
- `/subscribe` — Resend-backed email signup; POST to `/api/v1/subscribe`. Fires a realtime admin alert on every new signup (see Admin notifications).
- `/download`, `/report` — Report picker (4 reports today) with email gate → `/api/v1/download-report` streams a Playwright-generated PDF of `/report` (or redirects to a web report). Fires a realtime admin alert on every download.
- `/provider-search` — Real-time cross-source merged search: NDH (BigQuery) + NPPES NPI Registry + 4 payer FHIR directories (Humana, Cigna, UHC via Optum FLEX, Molina via Sapphire360). Returns per-source results so disagreements are visible side-by-side.
- `/magic-scanner` — AI-powered (Anthropic / OpenAI / Perplexity) provider discovery + NPPES staleness check
- `/reports/<slug>` — Subscriber release updates. Currently: `/reports/2026-05-22-update` (H40 confirmed-case + SAM-NPI false-positive QA finding), `/reports/2026-05-14-update` (claims-side cross-audit H29–H36), `/reports/2026-05-08-update` (NDH May release ingested; dark `<ReleaseTeaser />` + viral video link), `/reports/2026-05-update` (SMD-revalidation push). Each release is a hand-written `page.tsx` at `frontend/src/app/reports/<slug>/page.tsx` rendering `docs/reports/<slug>.md` via `loadMarkdown` + `<ReactMarkdown>`. New reports must register in `frontend/src/data/reports.ts` AND get their own `page.tsx` AND the markdown source.
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
| `/api/v1/manifest.json` | `analysis/build_manifest.py` | Discovery index — every published finding URL + state slice URL + schema ref + AI-agent tool schemas (lookup_npi, cross_source_search, get_finding, get_state_audit) |
| `/api/v1/findings/<slug>.json` | `analysis/h*.py` scripts | `ApiV1Finding` in same file |
| `/api/v1/states/<state>.json` | `analysis/state_findings.py <state>` | state-scoped payload consumed by `loadStateFindings(state)`. All 50 + DC published. |
| `/api/v1/states/va-cohort-critical.csv` | `analysis/build_va_briefing.py` | 131 federally-excluded VA NPIs (May release; was 125 in April) + LEIE/SAM/NPPES verification URLs |
| `/api/v1/states/va-briefing-summary.json` | `analysis/build_va_briefing.py` | Consolidated VA briefing payload (findings + cohort breakdown + H26 results in one fetch) |

Server Components read these via `loadStats()` / `loadFinding(slug)` in `frontend/src/lib/load-api-v1.ts` (filesystem reads at build time; no round-trip). External consumers hit the same files over HTTP.

**Findings-hub data layer** (`frontend/src/lib/hub-feed.ts`): `loadHubFeed()` aggregates 4 timeline sources — published findings (from `FINDINGS`), web-format reports under `/reports/*` (from `REPORTS`), articles (filesystem scan of `docs/articles/*.md`), and methodology version bumps (YAML frontmatter in `docs/methodology/version-log.md`) — into one typed `HubFeed` `{ lead, timeline, catalog }`. Lead selection: `FINDINGS.find(f => f.featured)` first, fall back to latest published. Timeline trimmed to 10 with the lead excluded. Catalog = every finding sorted by updated date desc. Both the `/findings` hub page and the homepage Latest strip consume the same `HubFeed`.

The writable `/api/v1/` endpoints (`subscribe`, `download-report`) are Next.js route handlers — the static JSON files sit in `public/` and take precedence over same-named routes, so never name a route handler `stats/route.ts`.

## Pre-registration workflow (H1–H42)

Each hypothesis in the check catalog is registered **before** numbers drop. Current range: **H1–H42**.

- H1–H28 — original directory-side audit (NDH-side checks).
- H29–H36 — claims-side cross-audit (Medicaid spending, Medicare Part B/D, Open Payments, DMEPOS, nursing-home ownership, NDH completeness).
- H37–H39 — PECOS-as-authoritative-source workstream (taxonomy mismatch, behavioral-health subset, multi-state enrollments).
- H40 — published 2026-05-22. Per-(NPI, HCPCS, place-of-service) cross-audit of federally-excluded NPIs billing Medicare Part B. Source: CMS Medicare Physician & Other Practitioners by Provider AND Service file (~3 GB, CY 2023). **Result: 194 NPIs full-window, 4 strict-post-exclusion candidates → 1 confirmed (Eduardo Miranda, MD, ~$880K CY 2023 billing 8 years post-LEIE-exclusion), 3 SAM-NPI-join false positives caught by primary-source verification.** Compute script: `analysis/claims_sources/medicare_partb_by_hcpcs.py`. Provenance doc: `docs/methodology/runs/2026-05-22-h40-h41-h42-baseline.md`.
- H42 — published 2026-05-22. Telehealth-dominant filter on H40. **Result: null hypothesis supported** (zero NPIs at ≥80% telehealth-HCPCS threshold). Honest headline names two competing readings (screening working vs cohort too small).
- H41 — pre-registered, deferred. Two-pass over the H40 source file + BQ NPPES taxonomy query stalled at the iterator mid-run on first attempt. Switch to `bq query --format=csv > /tmp/nppes.csv` upfront before retrying. Compute script ships in `analysis/h41_specialty_drift.py` but is unpublished.

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
| `practitioner` | `_id, _npi, _family_name, _given_name, _state, _city, _postal_code, _gender, _active` |
| `organization` | `_id, _npi, _name, _state, _city, _org_type, _active` |
| `location` | `_id, _name, _state, _city, _postal_code, _status, _managing_org_id` |
| `endpoint` | `_id, _connection_type, _status, _address, _name, _managing_org_id` |
| `practitioner_role` | `_id, _practitioner_id, _org_id, _specialty_code, _specialty_display, _location_ids, _active` |
| `organization_affiliation` | `_id, _org_id, _participating_org_id, _active` |

**FHIR reference format**: `_practitioner_id` / `_org_id` / `_managing_org_id` hold full reference strings like `Practitioner/Practitioner-1234567890` or `Organization/Organization-1518732023`. Cross-resource JOINs reconstruct the reference from the target's `_id`, e.g.:

```sql
JOIN organization o ON pr._org_id = CONCAT('Organization/', o._id)
```

**Views** (see `scripts/recreate-views.ts`): `v_provider_by_state`, `v_provider_by_specialty`, `v_endpoint_by_type`, `v_org_by_state`, `v_data_quality_summary`.

### Known data quality baseline

Measured on the 2026-05-08 release after ingestion via `analysis/fast_ingest_ndh.py` (bq load):

```text
Resource                       April-09     May-08         Δ
practitioner                  7,441,213   7,441,211       flat
organization                  3,603,262   3,414,375    −5.2%
location                      3,494,239   1,362,869    −61%
endpoint                      5,043,524   1,360,585    −73%
practitioner_role             7,178,732   7,028,001    −2.1%
organization_affiliation        439,599   1,086,694    +147%
TOTAL                        27,200,569  21,693,735    −20%
```

Significant compositional shift in the May release: Endpoint and Location dropped sharply (CMS appears to have deduped multi-address rows), while OrganizationAffiliation more than doubled. Two source-side schema changes broke ingestion until the extractor was patched: NPI identifier system URL changed from `http://hl7.org/fhir/sid/us-npi` to `http://terminology.hl7.org/NamingSystem/npi`, and `PractitionerRole.specialty` codes shifted from CMS Medicare format (`14-50`) to NUCC taxonomy codes (`207R00000X`).

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

When changing the cron cadence, edit `vercel.json#crons[0].schedule`. The endpoint can also be hit manually for testing with `curl -H "Authorization: Bearer ${CRON_SECRET}" https://ainpi.vercel.app/api/v1/admin/weekly-report`.

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

- **Vitest**: 62 tests covering FHIR reference extraction, API parameter parsing, data-quality API contract, validation API, filter context hierarchy, NPI/URL regex, BigQuery schema validation
- **Playwright (dev)**: `frontend/e2e/data-quality.spec.ts` + `npd-search.spec.ts` — structural assertions, run via `npm run test:e2e` (boots local dev server)
- **Playwright (prod)**: `frontend/e2e/accuracy-2026-05-08.spec.ts` (24 assertions) — production smoke that pins every published number to the May release. Run with `PLAYWRIGHT_BASE_URL="https://ainpi.vercel.app" npx playwright test --config=playwright.prod.config.ts accuracy-2026-05-08.spec.ts` (the prod config skips webServer boot so it doesn't fight other dev servers on port 3000)

Run dev tests in CI: `npm run test && npm run test:e2e`.

## Deployment Notes

- `vercel.json` at repo root points builds to `frontend/` (`buildCommand: "cd frontend && npm run build"`, `outputDirectory: "frontend/.next"`)
- `.vercelignore` excludes `frontend/data/` (the downloaded NDJSON files, 2.8 GB compressed)
- All Vercel env vars mirror the local `.env.local`, with `GCP_SERVICE_ACCOUNT_KEY` being critical for production BigQuery access
- Dynamic routes: `npd/*` API routes export `dynamic = 'force-dynamic'` so stale edge-cached data doesn't poison live-data endpoints
- **Vercel 250 MB lambda size limit** (`frontend/next.config.js` → `experimental.outputFileTracingExcludes`). `public/api/v1/` is ~345 MB (per-state H37/H38/H39 CSVs + the 508K/256K-row PECOS detail files). Next.js's output-file tracer was over-including the entire tree in every serverless function bundle. The fix excludes `public/api/v1/findings/**` and `public/api/v1/states/**` from all lambdas — safe because the loaders only read these at build time for static page generation, and at runtime Vercel's CDN static handler serves the JSON/CSV directly without ever touching the lambda. **If you add a new route that imports `load-api-v1.ts`, `homepage-data.ts`, or `hub-feed.ts`, verify it's still `force-static` and that its `.nft.json` doesn't reference the big trees** (`grep -c 'public/api/v1/states' .next/server/app/<route>.js.nft.json` should be 0). If you ever need to serve these dynamically from a lambda, you'll need to refactor — not just remove the exclusion.
- **CodeQL stored-XSS pattern (recurring)**: CodeQL flags any dynamic value flowing from filesystem/static data into an anchor `href` — even when the source is a `findings.ts` slug or a `docs/articles/` filename (both authored-by-us, never user input) and the consumer is `next/link` (which sanitizes). Fix pattern: **constant-prefix + allowlist validator**. See `safeCtaHref` in `frontend/src/components/findings-hub/LeadStory.tsx` and `ARTICLES_GITHUB_URL` constant in `frontend/src/app/articles/[slug]/page.tsx`. Both fixes carry inline JSDoc explaining the false-positive context so future maintainers don't undo them.

## CI / CD workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push/PR to main | `npm ci` → `prisma generate` → `npm run lint` → `npm run test` (from `frontend/`) |
| `.github/workflows/codeql.yml` | push/PR + weekly | JS/TS + Python static analysis |
| `.github/workflows/gitleaks.yml` | push/PR | Secret scan using upstream gitleaks **binary** (v8.21.2) — NOT `gitleaks/gitleaks-action@v2` (that requires a paid org license). Baselines historical leaks via `.github/gitleaks-baseline.json`; any NEW finding fails the job. |
| `.github/workflows/anti-patterns.yml` | push/PR | AINPI-specific guardrails complementing gitleaks + CodeQL. Runs `.github/scripts/scan-anti-patterns.sh` on the PR diff. Catches: hardcoded `AIza…` Google API keys, embedded service-account JSON, Python BQ queries missing `bq_job_config()` cap, direct `new BigQuery(` outside the bounded helper, re-enabling deliberately-disabled Maps/Places APIs, and state-agency attribution language. Rules + remediation pointers in the script header. Add new rules there when a new policy is added to CLAUDE.md. |
| `.github/workflows/weekly-refresh.yml` | Mon 09:00 UTC + manual | Runs all `analysis/h*.py` scripts, regenerates `frontend/public/api/v1/*.json`, commits directly to `main`. Requires `GCP_SERVICE_ACCOUNT_KEY` secret (BQ jobUser + dataViewer on `cms_npd` and `bigquery-public-data.nppes`). |
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
