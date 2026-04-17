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
│   │   ├── app/              Routes (pages + API)
│   │   ├── components/       Shared UI (Navbar, WipBanner, charts/)
│   │   ├── contexts/         FilterContext for cross-chart filtering
│   │   ├── lib/              bigquery.ts, prisma.ts, auth.ts, api.ts
│   │   └── utils/supabase/   SSR-safe Supabase clients
│   ├── scripts/              BigQuery setup, ingestion, sync scripts
│   ├── prisma/               Supabase schema + seed scripts
│   ├── tests/                Vitest unit tests
│   └── e2e/                  Playwright tests
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

## Domain Context

- **NPD** (CMS National Provider Directory): 2026-04-09 public use release, 6 FHIR R4 resource types: Practitioner, PractitionerRole, Organization, OrganizationAffiliation, Location, Endpoint. Distributed as NDJSON compressed with zstd from directory.cms.gov
- **NDH IG** (National Directory of Healthcare, HL7): FHIR implementation guide that NPD adheres to — <https://build.fhir.org/ig/HL7/fhir-us-ndh/>
- **NPPES**: National Plan and Provider Enumeration System — upstream source of ~90% of Practitioner/Organization fields. Self-attested, no enforcement.
- **PECOS**: Medicare enrollment; enriches NPPES with Medicare-enrolled provider data
- **CAQH**: Commercial-payer credentialing source. Currently **not** in the NPD ingestion pipeline. See `/insights` for full provenance analysis.
- **NPI**: National Provider Identifier — 10-digit CMS-issued ID
- **NUCC Taxonomy**: 900+ specialty classification codes
