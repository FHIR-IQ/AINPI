# AINPI

Experimental explorer for the CMS National Provider Directory (NPD) public use files.

**Live:** <https://ainpi.vercel.app>

> **Work in progress.** AINPI is research/educational. Data may be incomplete, stale, or incorrect. Every number should be verified against primary sources before any business or clinical decision. See the [`/insights`](https://ainpi.vercel.app/insights) page for a full provenance analysis.

## What it does

CMS released the National Provider Directory as FHIR R4 NDJSON public use files from [directory.cms.gov](https://directory.cms.gov/) — 27.2M records across 6 resource types (Practitioner, PractitionerRole, Organization, OrganizationAffiliation, Location, Endpoint). AINPI:

1. **Ingests** the full 40.7 GB dataset into Google BigQuery (2.8 GB compressed zstd on disk, 27,200,569 rows loaded, 99.985% completeness vs CMS manifest)
2. **Serves** interactive exploration through a Next.js 14 app on Vercel, backed by Supabase Postgres for pre-aggregated metrics
3. **Analyzes** data provenance — which fields come from NPPES vs PECOS vs CEHRT vendor submissions, and where the self-attestation gaps are (CAQH is not in the NPD pipeline)

## Pages

| Path | What it is |
|---|---|
| [`/methodology`](https://ainpi.vercel.app/methodology) | Versioned audit methodology — DAMA DMBOK mapping, L0–L7 scoring, reproducibility commands |
| [`/findings`](https://ainpi.vercel.app/findings) | Pre-registered findings (H1–H27). Each states null hypothesis + denominator *before* numbers drop |
| [`/npd`](https://ainpi.vercel.app/npd) | Public search by NPI, name, organization, state, city |
| [`/data-quality`](https://ainpi.vercel.app/data-quality) | D3 dashboard: choropleth, sankey, knowledge graph, drill-down, validation |
| [`/insights`](https://ainpi.vercel.app/insights) | Provenance + variance analysis (NPD vs published org numbers) |
| [`/provider-search`](https://ainpi.vercel.app/provider-search) | Real-time search against live payer FHIR directories |
| [`/magic-scanner`](https://ainpi.vercel.app/magic-scanner) | AI-augmented provider discovery |

## Public URL contract

Static JSON, CDN-cached, safe to depend on across releases:

- [`/api/v1/stats.json`](https://ainpi.vercel.app/api/v1/stats.json) — site-wide counters, methodology version, commit SHA
- `/api/v1/findings/<slug>.json` — one per finding ([types](./frontend/src/lib/api-v1-types.ts))

Breaking changes bump the path (`/api/v2/`), not the shape in place.

## Roadmap

Public roadmap lives in [GitHub Issues](https://github.com/FHIR-IQ/AINPI/issues?q=is%3Aissue+is%3Aopen+label%3Aroadmap) tagged `roadmap`, grouped into three milestones:

| Milestone | Scope |
|---|---|
| [`v1.1`](https://github.com/FHIR-IQ/AINPI/milestone/1) | Data refinements on existing findings — phonetic name match, dual-board atlas, per-state drill-downs, methodology v1.0 prose |
| [`v1.2`](https://github.com/FHIR-IQ/AINPI/milestone/2) | New findings — H16 address geocoding, H17 USPS drift, H19/H20 state scale, weekly endpoint-crawl host |
| [`v2.0`](https://github.com/FHIR-IQ/AINPI/milestone/3) | Expansion beyond NPD's current 6 resources — blocked until CMS ships InsurancePlan / HealthcareService / Network / Verification |

Contributions welcome on any issue. File a new one using the [issue templates](https://github.com/FHIR-IQ/AINPI/issues/new/choose).

## Sibling repositories

| Repo | Scope |
|---|---|
| [`FHIR-IQ/ainpi-probe`](https://github.com/FHIR-IQ/ainpi-probe) | FHIR endpoint liveness crawler (L0–L7). Runs separately from the site so operators can audit the code that hits their endpoints. |
| [`FHIR-IQ/ainpi-examples`](https://github.com/FHIR-IQ/ainpi-examples) | Python + DuckDB usage examples for the `/api/v1/*` contract. |

## What's in this repo

```text
frontend/          Next.js 14 app — routes, API, charts, tests
pipeline/          DuckDB-over-Parquet validation pipeline (shard, edges, NPI Luhn, temporal)
docs/methodology/  Versioned methodology doc, rendered at /methodology
.github/           CI, CodeQL, dependabot, issue + PR templates, release workflow
```

## Architecture

```text
       ┌────────────────────────────────┐
       │ directory.cms.gov              │
       │ 6 NDJSON.zst files, 2.8 GB     │
       └──────────────┬─────────────────┘
                      │ scripts/ingest-cms-npd.ts
                      ▼
       ┌────────────────────────────────┐
       │ BigQuery (cms_npd dataset)     │
       │ resource:JSON + _* flat fields │
       │ 27.2M rows + 5 analytics views │
       └──────┬─────────────────────┬───┘
              │                     │
  live query  │                     │ scripts/sync-bq-to-supabase.ts
              │                     │  (nightly aggregation)
              ▼                     ▼
       ┌──────────────┐     ┌──────────────────┐
       │ Next.js API  │     │ Supabase Postgres│
       │ routes       │◄────┤ Prisma ORM       │
       │ on Vercel    │     │ pre-agg metrics  │
       └──────┬───────┘     │ user auth        │
              │             └──────────────────┘
              ▼
       ┌────────────────────────────────┐
       │ React + D3 dashboard           │
       │ FilterContext cross-filtering  │
       └────────────────────────────────┘
```

**Why this split:** BigQuery costs <$1/mo to hold 40 GB of FHIR JSON and gives free-tier-friendly analytics. Supabase is where the app's hot-path queries and auth data live. Pre-aggregations are synced nightly so the dashboard doesn't hit BigQuery on every page load.

## Quickstart

```bash
cd frontend
npm install
cp .env.example .env.local   # fill in Supabase + GCP values
npm run db:push              # push Prisma schema to Supabase
npm run dev                  # http://localhost:3000
```

To reload the NPD warehouse (only needed when CMS publishes a new release):

```bash
npm run bq:setup     # Create dataset + tables + views (idempotent)
npm run bq:ingest    # Download from directory.cms.gov, stream into BigQuery
npm run bq:sync      # Aggregate BigQuery → Supabase metrics
```

## Testing

```bash
npm run test         # Vitest — 62 unit tests
npm run test:e2e     # Playwright — 15 E2E specs
```

Covers FHIR reference extraction, API parameter parsing, validation contract, filter context hierarchy, NPI/URL regex, BigQuery schema, dashboard dropdown interactions, and search.

## Documentation

- [CLAUDE.md](./CLAUDE.md) — Architecture + developer reference
- [DATABASE_SETUP.md](./DATABASE_SETUP.md) — Supabase + Prisma + BigQuery setup walkthrough

## Key references

- [CMS National Provider Directory](https://directory.cms.gov/)
- [HTE Data Release Specifications](https://github.com/ftrotter-gov/HTE_data_release_specifications)
- [NDH FHIR IG v2.0.0](https://build.fhir.org/ig/HL7/fhir-us-ndh/)
