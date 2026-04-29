# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AINPI is an experimental exploration of the CMS National Provider Directory (NPD) public use files (2026-04-09 release). It ingests the 27.2M-record FHIR R4 dataset from directory.cms.gov into Google BigQuery, serves interactive exploration via a Next.js 14 app on Vercel, and backs the app with Supabase Postgres for session-scoped state.

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
│   │   ├── data/findings.ts  Pre-registration catalog (H1-H22 → slugs)
│   │   ├── lib/              bigquery.ts, prisma.ts, auth.ts, api-v1-types.ts, load-api-v1.ts
│   │   └── utils/supabase/   SSR-safe Supabase clients
│   ├── public/api/v1/        Static JSON contract (stats.json, findings/<slug>.json)
│   ├── scripts/              BigQuery setup, ingestion, sync scripts
│   ├── prisma/               Supabase schema + seed scripts
│   ├── tests/                Vitest unit tests
│   └── e2e/                  Playwright tests
├── analysis/                 Python scripts per hypothesis (h9, h10_h13, h18, etc.) — outputs to frontend/public/api/v1/
├── pipeline/                 DuckDB-over-Parquet scaffold (shard, edges, Luhn, lastUpdated)
├── crawler/                  Local mirror of FHIR-IQ/ainpi-probe endpoint liveness crawler
├── docs/methodology/         Versioned methodology doc, rendered at /methodology
├── .github/                  Workflows (CI, CodeQL, gitleaks, weekly-refresh, release), gitleaks-baseline.json
├── models/ + modules/        Legacy TypeScript FHIR core library (not actively maintained)
├── backend/                  Legacy Python FastAPI (deprecated)
├── web-app/                  Legacy alternate Next.js app (deprecated)
└── CLAUDE.md, README.md, DATABASE_SETUP.md, vercel.json, .mcp.json
```

## Stack

- **Frontend**: Next.js 14 App Router, React 18, TypeScript, Tailwind
- **Data warehouse**: Google BigQuery (`thematic-fort-453901-t7.cms_npd`) — holds full 27.2M FHIR resources
- **App database**: Supabase Postgres (project `hspqvcoinujtfodreqaf`, pooler region `aws-1-us-east-2`) — holds pre-aggregated NPD metrics, user auth, magic-scan results
- **ORM**: Prisma (against Supabase only; BigQuery is accessed via `@google-cloud/bigquery` SDK)
- **Visualizations**: D3.js (+ topojson-client for US choropleth), dynamic `next/dynamic` imports so D3 stays out of SSR
- **Testing**: Vitest (62 unit tests) + Playwright E2E
- **Hosting**: Vercel
- **Auth for BigQuery in production**: service account key JSON loaded from `GCP_SERVICE_ACCOUNT_KEY` env var

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

- `/` → redirects to `/npd`
- `/npd` — Public NPD search (NPI, name, org, state, city; no login)
- `/data-quality` — Interactive dashboard: KPIs, completeness heatmap, US choropleth, per-resource gauges, state bar chart, specialty treemap, endpoint sunburst, relationship stats, Sankey graph, force-directed knowledge graph, state→city drill-down via `StateDetailPanel`, data validation panel. All charts share a `FilterContext` for cross-filtering.
- `/insights` — Provenance & variance analysis. Interactive org comparison tool + narrative sections on NPPES-vs-PECOS-vs-CAQH sources, active-flag signal limitations, CAQH ingestion path. Pre-filled with UPMC.
- `/methodology` — Versioned audit methodology (DAMA DMBOK mapping, L0–L7 scoring, reproducibility). Sourced from `docs/methodology/index.md`.
- `/findings` — Index of pre-registered findings. Data in `frontend/src/data/findings.ts` (the **pre-registration record** — slug, hypotheses, null, denominator, audience implications). Live numbers hydrate from `/api/v1/findings/<slug>.json`.
- `/findings/[slug]` — One finding per page. `force-static` + `generateStaticParams` over `allSlugs()`; live headline/chart/notes come from `loadFinding(slug)`, which reads `frontend/public/api/v1/findings/<slug>.json` at build time.
- `/states` — Index of state-scoped audit slices. State catalog in `frontend/src/data/states.ts` (VA, PA, OH today). Built specifically for state Medicaid agencies responding to the 2026-04-23 CMS State Medicaid Director letter on provider revalidation.
- `/states/[state]` — One state per page. `force-static` over `allStateCodes()`. Renders denominators, state-vs-national findings table, "verify a sample yourself" block of NPIs (linked to NPPES Registry), citation language for the state's CMS response, and explicit limitations. Live data from `loadStateFindings(state)` which reads `frontend/public/api/v1/states/<state>.json`. Generated by `analysis/state_findings.py <state>`.
- `/smd-revalidation` — Citable methodology landing page mapping AINPI to the 5 elements of the CMS State Medicaid Director letter. Anchored in 42 CFR § 455.436 federal database checks (NPPES + LEIE + SAM + SSA-DMF). Includes copy-paste citation language for state response submissions.
- `/faq`, `/privacy`, `/security` — Policy pages sourced from `docs/*.md` via `next/mdx`-style markdown reads.
- `/subscribe` — Resend-backed email signup; POST to `/api/v1/subscribe`.
- `/download`, `/report` — PDF white paper flow: email gate → `/api/v1/download-report` streams a Playwright-generated PDF of `/report`.
- `/provider-search` — Real-time search against live payer FHIR directories (Humana, UnitedHealth, Aetna, BCBS, Cigna)
- `/magic-scanner` — AI-powered (Anthropic / OpenAI / Perplexity) provider discovery + NPPES staleness check

## API Routes

```text
/api/npd/search              GET  — Search NPD by NPI, name, org, state, city
/api/npd/data-quality        GET  — Summary, state/specialty/endpoint breakdowns
/api/npd/state-detail        GET  — Drill-down: cities, top orgs/specialties within a state
/api/npd/relationships       GET  — Top-N org network overview + relationship stats
/api/npd/org-analysis        GET  — Interactive variance tool data (used by /insights)
/api/npd/validation          GET  — Source-file vs BigQuery counts, NPI/URL validity, orphan refs

/api/provider-search         POST — Real-time payer FHIR directory search
/api/magic-scanner           POST — AI-augmented provider discovery

/api/auth/login              POST — JWT login
/api/auth/register           POST — User registration
/api/practitioners/me        GET/PUT — Logged-in user profile
/api/practitioner-roles      GET/POST/PUT — Practitioner role CRUD
/api/providers               GET/POST — Provider CRUD
/api/demo/*                  Demo endpoints for NPPES comparison, FHIR export
```

All NPD routes that use `request.url` or query BigQuery are marked `export const dynamic = 'force-dynamic'` to defeat Vercel edge caching (critical for validation/state-detail, which hit live BQ).

## Public `/api/v1/*` JSON contract

Static files under `frontend/public/api/v1/` are the **stable public contract** — external consumers (docs, partner integrations, the `ainpi-examples` repo) depend on these URLs not changing shape. Breaking changes bump the path (`/api/v2/`), never the shape in place.

| Path | Generator | Schema |
| --- | --- | --- |
| `/api/v1/stats.json` | weekly-refresh workflow | `ApiV1Stats` in `frontend/src/lib/api-v1-types.ts` |
| `/api/v1/findings/<slug>.json` | `analysis/h*.py` scripts | `ApiV1Finding` in same file |

Server Components read these via `loadStats()` / `loadFinding(slug)` in `frontend/src/lib/load-api-v1.ts` (filesystem reads at build time; no round-trip). External consumers hit the same files over HTTP.

The writable `/api/v1/` endpoints (`subscribe`, `download-report`) are Next.js route handlers — the static JSON files sit in `public/` and take precedence over same-named routes, so never name a route handler `stats/route.ts`.

## Pre-registration workflow (H1–H22)

Each hypothesis in the check catalog is registered **before** numbers drop:

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

H10–H13 apply the CMS Medicare Provider and Supplier Taxonomy Crosswalk (Oct 2025, downloaded fresh each run) to bridge NUCC ↔ CMS Medicare Specialty codes, and match against all 15 NPPES taxonomy slots with switch-aware logic (not just slot 1).

## BigQuery Schema (flexible FHIR-as-JSON pattern)

Each of the 6 resource tables stores the full FHIR resource as a `resource:JSON` column plus extracted flat `_*` fields for efficient querying. This avoids schema-drift failures when NDH extensions vary across records.

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

Measured on the 2026-04-09 release after ingestion + dedup:

```text
Resource                      Expected       Actual      Delta   Completeness
practitioner                 7,441,212    7,441,213         +1    100.000%
organization                 3,605,261    3,603,262     −1,999     99.945%
location                     3,494,239    3,494,239          0    100.000%
endpoint                     5,043,524    5,043,524          0    100.000%
practitioner_role            7,180,732    7,178,732     −2,000     99.972%
organization_affiliation       439,599      439,599          0    100.000%
TOTAL                       27,204,567   27,200,569     −3,998     99.985%
```

The ~4k delta is legitimate ingestion errors (malformed records, size limits), not duplicates. Dedup has already been applied to `practitioner` (removed 4.6M dups) and `organization` (383k dups) from retry-during-streaming.

## Supabase Prisma Schema (app database)

Key models (`frontend/prisma/schema.prisma`):

- **User-facing**: `Practitioner`, `PractitionerRole`, `SyncLog`, `Consent`
- **Provider directory discovery**: `ProviderDirectoryAPI`, `MagicScanResult`
- **NPD metrics (synced from BigQuery)**: `NpdDataQualitySummary`, `NpdStateMetrics`, `NpdSpecialtyMetrics`, `NpdEndpointMetrics`, `NpdIngestionLog`

## Authentication

JWT (7-day expiry) with bcryptjs-hashed passwords. Public pages (`/`, `/npd`, `/data-quality`, `/insights`, `/provider-search`, `/magic-scanner`, `/login`) do not require auth. Pages that need a token (`/dashboard`, `/demo`, `/audit-log`, `/providers/new`) no longer redirect — they render gracefully and only fetch authenticated data when a token exists.

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
```

## Testing

- **Vitest**: 62 tests covering FHIR reference extraction, API parameter parsing, data-quality API contract, validation API, filter context hierarchy, NPI/URL regex, BigQuery schema validation
- **Playwright**: 15 E2E specs for dashboard, search page, drill-down dropdowns, navigation

Run both in CI: `npm run test && npm run test:e2e`.

## Deployment Notes

- `vercel.json` at repo root points builds to `frontend/` (`buildCommand: "cd frontend && npm run build"`, `outputDirectory: "frontend/.next"`)
- `.vercelignore` excludes `frontend/data/` (the downloaded NDJSON files, 2.8 GB compressed) and legacy `backend/` / `web-app/`
- All Vercel env vars mirror the local `.env.local`, with `GCP_SERVICE_ACCOUNT_KEY` being critical for production BigQuery access
- Dynamic routes: `npd/*` API routes export `dynamic = 'force-dynamic'` so stale edge-cached data doesn't poison live-data endpoints

## CI / CD workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push/PR to main | `npm ci` → `prisma generate` → `npm run lint` → `npm run test` (from `frontend/`) |
| `.github/workflows/codeql.yml` | push/PR + weekly | JS/TS + Python static analysis |
| `.github/workflows/gitleaks.yml` | push/PR | Secret scan using upstream gitleaks **binary** (v8.21.2) — NOT `gitleaks/gitleaks-action@v2` (that requires a paid org license). Baselines historical leaks via `.github/gitleaks-baseline.json`; any NEW finding fails the job. |
| `.github/workflows/weekly-refresh.yml` | Mon 09:00 UTC + manual | Runs all `analysis/h*.py` scripts, regenerates `frontend/public/api/v1/*.json`, commits directly to `main`. Requires `GCP_SERVICE_ACCOUNT_KEY` secret (BQ jobUser + dataViewer on `cms_npd` and `bigquery-public-data.nppes`). |
| `.github/workflows/release.yml` | tag `v*` | Cuts GitHub release |

**Weekly-refresh pushes straight to main** (not a PR) because the org policy disallows Actions from opening PRs without a PAT, and refresh outputs are deterministic. If merge queue/signatures block the bot push, add `github-actions[bot]` to the ruleset bypass list — do not add a PAT.

## Branch protection on `main`

The `main` ruleset enforces (see `gh api repos/FHIR-IQ/AINPI/rules/branches/main`): `deletion`, `non_fast_forward`, `required_linear_history`, `required_deployments`, `required_signatures`, `merge_queue`, `code_scanning`, `code_quality`, `copilot_code_review`.

Practical consequences:

- Direct push to `main` is rejected even on fast-forward. Work in a branch and open a PR.
- Unsigned commits are rejected. Set up GPG or SSH signing (`git config commit.gpgsign true` + configured key).
- The merge-queue rule means "Merge pull request" in the UI is the only merge path; `gh pr merge --merge` without `--auto` will not bypass it.
- Copilot code review is a required signal — assign Copilot as reviewer from the PR sidebar if the queue stalls on `mergeStateStatus: BLOCKED`.

## Secrets management

- **App runtime secrets** live in Vercel. Add/update with `vercel env add <NAME> production` (and repeat for `preview` / `development`). Never commit to `.env.local` that will be pushed.
- **GitHub Actions secrets** (e.g. `GCP_SERVICE_ACCOUNT_KEY`) go via `gh secret set NAME < file.json` or the repo Settings UI.
- `google-github-actions/auth@v2.1.11+` writes the credential file to `$RUNNER_TEMP` (outside the workspace). A prior leak happened when `git add -A` scooped an earlier version's workspace file; `gha-creds-*.json` is now also `.gitignore`d as defense-in-depth.
- `.github/gitleaks-baseline.json` accepts known historical leaks in the repo history (all rotated). Regenerate via `gitleaks detect --report-format json --report-path .github/gitleaks-baseline.json` after any intentional new allowlist, then commit.

## Domain Context

- **NPD** (CMS National Provider Directory): 2026-04-09 public use release, 6 FHIR R4 resource types: Practitioner, PractitionerRole, Organization, OrganizationAffiliation, Location, Endpoint. Distributed as NDJSON compressed with zstd from directory.cms.gov
- **NDH IG** (National Directory of Healthcare, HL7): FHIR implementation guide that NPD adheres to — <https://build.fhir.org/ig/HL7/fhir-us-ndh/>
- **NPPES**: National Plan and Provider Enumeration System — upstream source of ~90% of Practitioner/Organization fields. Self-attested, no enforcement.
- **PECOS**: Medicare enrollment; enriches NPPES with Medicare-enrolled provider data
- **CAQH**: Commercial-payer credentialing source. Currently **not** in the NPD ingestion pipeline. See `/insights` for full provenance analysis.
- **NPI**: National Provider Identifier — 10-digit CMS-issued ID
- **NUCC Taxonomy**: 900+ specialty classification codes
