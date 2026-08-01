# AINPI

Open audit of the CMS National Provider Directory (NPD) public use files.

**Live:** <https://ainpi.dev>

> **Work in progress.** AINPI is research and educational work. Data may be
> incomplete, stale, or wrong. Verify every number against primary sources
> before any business or clinical decision. The [`/insights`](https://ainpi.dev/insights)
> page carries the full provenance analysis.

## What it does

CMS publishes the National Provider Directory as FHIR R4 NDJSON files at
[directory.cms.gov](https://directory.cms.gov/): 21.7M records across 6 resource
types (Practitioner, PractitionerRole, Organization, OrganizationAffiliation,
Location, Endpoint) in the 2026-05-08 release. AINPI does three things with it.

1. **Ingests** the dataset into BigQuery and runs 31 pre-registered findings
   (H1 to H46). Some audit the directory itself. Others cross-check it against
   federal claims data: Medicaid spending, Medicare Part B and Part D, Open
   Payments, DMEPOS, and nursing-home ownership. 17 findings carry numbers
   today. 14 are registered and waiting.
2. **Publishes** every result as a static JSON file on a stable URL, with the
   null hypothesis and denominator registered before the numbers land.
3. **Cross-audits** federal exclusion lists (OIG LEIE and SAM.gov) against the
   directory. This closes 3 of the 4 federal database checks in 42 CFR
   455.436. SSA-DMF stays restricted-access.

Each finding states what was measured, what it does not cover, and how to
reproduce it. Where a result contradicts the registered prior, the page says so.

## Recent findings

- **H46, 2026-08-01.** CMS lists a Medicaid provider directory for 32 of 51
  jurisdictions. Five of those listed URLs do not resolve, so 27 of 51 have a
  catalogued directory the public can open.
- **H45, 2026-07-13.** Registered: the per-state gap between FHIR endpoints
  published through certified EHR vendors and what the NDH carries.
- **H43, 2026-06-09.** 99.98% of active practitioners carry a phone on the
  Practitioner record. The PractitionerRole to Location traversal returns
  nothing, which rejected the registered prior.
- **H44, 2026-06-25.** Of the 9 endpoint-metadata fields the HTE submission spec
  collects, 5 have no home in the NDH FHIR profile. Across all 114,071
  FHIR-REST endpoints, no record uses the extensions that could carry the rest.
- **H40, 2026-05-22.** 194 federally-excluded NPIs billed Medicare Part B in the
  full window. Of 4 strict post-exclusion candidates, primary-source checks
  confirmed 1 and rejected 3 as SAM-NPI join errors.

## Pages

| Path | What it is |
|---|---|
| [`/`](https://ainpi.dev/) | Landscape treemap. Every state and specialty cell scored on 6 audit dimensions. |
| [`/map`](https://ainpi.dev/map) | US choropleth of federally-excluded NPIs per state. |
| [`/findings`](https://ainpi.dev/findings) | All 31 findings. Each registers its null hypothesis and denominator before numbers drop. |
| [`/npi`](https://ainpi.dev/npi) | Per-NPI report cards for the high-risk cohort, with primary-source verify links. |
| [`/states`](https://ainpi.dev/states) | Per-state audit slices. All 50 states and DC. |
| [`/for-state-medicaid`](https://ainpi.dev/for-state-medicaid) | Per-state pages written for Medicaid CMOs. Count and action first. |
| [`/methodology`](https://ainpi.dev/methodology) | Versioned methodology: DAMA DMBOK mapping, L0 to L7 scoring, reproduction commands. |
| [`/data-sources`](https://ainpi.dev/data-sources) | Every dataset AINPI ingests, considers, or rejects, with license and refresh cadence. |
| [`/developer`](https://ainpi.dev/developer) | API docs, code samples, and the MCP server. |
| [`/data-quality`](https://ainpi.dev/data-quality) | D3 dashboard: choropleth, sankey, knowledge graph, drill-down, validation. |
| [`/insights`](https://ainpi.dev/insights) | Provenance and variance analysis against published org numbers. |
| [`/provider-search`](https://ainpi.dev/provider-search) | Live cross-source search across the NDH, NPPES, and 4 payer FHIR directories. |
| [`/npd`](https://ainpi.dev/npd) | Public search by NPI, name, organization, state, city. |

## Public URL contract

Static JSON, CDN-cached, safe to depend on across releases:

- [`/api/v1/manifest.json`](https://ainpi.dev/api/v1/manifest.json) discovery
  index: every finding and state URL, plus AI-agent tool schemas
- [`/api/v1/stats.json`](https://ainpi.dev/api/v1/stats.json) site-wide
  counters, methodology version, commit SHA
- `/api/v1/findings/<slug>.json` one per finding
  ([types](./frontend/src/lib/api-v1-types.ts))
- `/api/v1/states/<state>.json` per-state slice, 50 states and DC

Breaking changes bump the path to `/api/v2/`. The shape never changes in place.

An MCP server at `https://ainpi.dev/api/mcp` exposes the same data as 5 tools.

## Open data

Both ingested NDH releases are published as flattened parquet using the same
extraction logic as the BigQuery tables, so numbers reproduce. directory.cms.gov
serves only the latest release, so the archive is the only way to diff one
release against another. Worked DuckDB examples that reproduce published
findings live in [`examples/duckdb/`](./examples/duckdb).

## What is in this repo

```text
frontend/          Next.js 14 app: routes, API, charts, tests
analysis/          Python compute scripts, one per finding, output to /api/v1
crawler/           FHIR endpoint liveness crawler
docs/methodology/  Versioned methodology, rendered at /methodology
docs/reports/      Release updates, rendered at /reports/<slug>
docs/articles/     Long-form articles, rendered at /articles/<slug>
examples/duckdb/   SQL that reproduces published findings against the parquet
.github/           CI, CodeQL, secret scanning, weekly refresh, release
```

## Architecture

```text
       ┌────────────────────────────────┐
       │ directory.cms.gov              │
       │ manifest.json to 6 NDJSON.zst  │
       └──────────────┬─────────────────┘
                      │ analysis/fast_ingest_ndh.py
                      ▼
       ┌────────────────────────────────┐
       │ BigQuery (cms_npd dataset)     │
       │ resource:JSON + _* flat fields │
       │ 21.7M rows + 5 analytics views │
       └──────┬─────────────────────┬───┘
              │                     │
  analysis/   │                     │ scripts/sync-bq-to-supabase.ts
  h*.py       │                     │
              ▼                     ▼
       ┌──────────────┐     ┌──────────────────┐
       │ static JSON  │     │ Supabase Postgres│
       │ /api/v1/*    │     │ Prisma ORM       │
       │ on Vercel    │     │ pre-agg metrics  │
       └──────┬───────┘     └──────────────────┘
              │
              ▼
       ┌────────────────────────────────┐
       │ React + D3, static pages       │
       └────────────────────────────────┘
```

**Why this split.** BigQuery holds 40 GB of FHIR JSON for under $1 a month and
every query runs under a hard byte cap. Findings compute offline and publish as
static JSON, so a page view never triggers a paid query. Supabase holds auth and
pre-aggregated metrics.

## Quickstart

```bash
cd frontend
npm install
cp .env.example .env.local   # fill in Supabase + GCP values
npm run db:push              # push Prisma schema to Supabase
npm run dev                  # http://localhost:3000
```

To reload the warehouse, which is only needed when CMS publishes a release:

```bash
python analysis/fast_ingest_ndh.py --print-manifest-only   # check for a new release
python analysis/fast_ingest_ndh.py                         # download and load
npm run bq:sync                                            # aggregate to Supabase
```

## Testing

```bash
npm run test         # Vitest, 175 unit tests
npm run test:e2e     # Playwright, 5 specs
```

Covers FHIR reference extraction, API parameter parsing, the validation
contract, filter-context hierarchy, NPI and URL regex, BigQuery schema, the
findings-hub data layer, and search.

## Documentation

- [CLAUDE.md](./CLAUDE.md) architecture and developer reference
- [DATABASE_SETUP.md](./DATABASE_SETUP.md) Supabase, Prisma, and BigQuery setup

## Sibling repositories

| Repo | Scope |
|---|---|
| [`FHIR-IQ/ainpi-probe`](https://github.com/FHIR-IQ/ainpi-probe) | FHIR endpoint liveness crawler (L0 to L7). Runs separately from the site so operators can audit the code that hits their endpoints. |
| [`FHIR-IQ/ainpi-examples`](https://github.com/FHIR-IQ/ainpi-examples) | Python and DuckDB examples for the `/api/v1/*` contract. |

## Key references

- [CMS National Provider Directory](https://directory.cms.gov/)
- [HTE Data Release Specifications](https://github.com/ftrotter-gov/HTE_data_release_specifications)
- [NDH FHIR IG STU1 v1.0.0](https://hl7.org/fhir/us/ndh/STU1/), the published
  spec. The [STU2 CI build](https://build.fhir.org/ig/HL7/fhir-us-ndh/) tracks
  upcoming changes and is not a stable reference.
