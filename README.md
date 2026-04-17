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
| [`/npd`](https://ainpi.vercel.app/npd) | Public search by NPI, name, organization, state, city |
| [`/data-quality`](https://ainpi.vercel.app/data-quality) | D3 dashboard: choropleth, sankey, knowledge graph, drill-down, validation |
| [`/insights`](https://ainpi.vercel.app/insights) | Provenance + variance analysis (NPD vs published org numbers) |
| [`/provider-search`](https://ainpi.vercel.app/provider-search) | Real-time search against live payer FHIR directories |
| [`/magic-scanner`](https://ainpi.vercel.app/magic-scanner) | AI-augmented provider discovery |

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
