# AINPI

Experimental explorer for the CMS National Provider Directory (NPD) public use files.

**Live:** <https://ainpi.dev>

> **Work in progress.** AINPI is research/educational. Data may be incomplete, stale, or incorrect. Every number should be verified against primary sources before any business or clinical decision. See the [`/insights`](https://ainpi.dev/insights) page for a full provenance analysis.

## What it does

CMS released the National Provider Directory as FHIR R4 NDJSON public use files from [directory.cms.gov](https://directory.cms.gov/) — 21.7M records across 6 resource types (Practitioner, PractitionerRole, Organization, OrganizationAffiliation, Location, Endpoint) in the May 2026-05-08 release. AINPI:

1. **Ingests** the full dataset into Google BigQuery, then runs ~30 pre-registered findings (H1–H39) against both the directory itself and federal claims/payment data (Medicaid, Medicare Part B + Part D, NPPES-deactivated × billing, Open Payments, DMEPOS, nursing-home ownership disclosures)
2. **Serves** an interactive US choropleth at `/` with a 3-style theme switcher, plus per-state CMO-facing pages built for the state Medicaid Director-letter response window
3. **Cross-audits** federal exclusion lists (OIG LEIE + SAM.gov) against the directory, against MMIS-flagged providers, and against federal claims data — closing 3 of the 4 federal database checks the 2026-04-23 CMS State Medicaid Director letter requires (NPPES + LEIE + SAM; SSA-DMF stays restricted)

## What's new

- **2026-05-18 · PECOS-as-authoritative workstream (H37–H39).** CMS designated PECOS as authoritative for Medicare enrollment. State Medicaid systems must demonstrate alignment under the 2026 verification rules. AINPI pre-registered three findings: PECOS PROVIDER_TYPE vs NPPES NUCC taxonomy disagreement (H37), the behavioral-health subset (H38, highest recoupment risk), and multi-state-enrollment NPIs with conflicting addresses (H39). See [`/pecos`](https://ainpi.dev/pecos).
- **2026-05-17 · Map-first homepage.** `/` is now an interactive US choropleth with 3 selectable styles (Light cards / Dark dashboard / Minimal map). Click a state for an inline side panel with the 5 claims-side findings, CSV download, and primary-source NPI verification.
- **2026-05-15 · For state Medicaid CMOs.** New `/for-state-medicaid/<state>` per-state pages built for the state Medicaid CMO listserve audience. Count-and-action lede, no H-numbers, citation-ready for SMD-letter Elements 2 + 4.
- **2026-05-14 · Claims-side cross-audit shipped for all 50 states + DC + PR.** H29–H36 — Medicaid spending, Medicare Part B / Part D, NPPES-deactivated × billing, Open Payments, DMEPOS, nursing-home ownership (Stage B via the CMS PPEF cross-walk), NDH completeness. 99.99984% NDH completeness against material Medicare Part B billers.
- **2026-05-08 · NDH May release ingested.** First release-to-release deltas published. Endpoint −73%, Location −61%, OrgAffiliation +147% vs April. Two source-side schema breaks AINPI caught and patched.

## Pages

| Path | What it is |
|---|---|
| [`/`](https://ainpi.dev/) | Map-first homepage. Click any state for inline findings. 3-style theme switcher. |
| [`/for-state-medicaid`](https://ainpi.dev/for-state-medicaid) | Index of per-state CMO-facing pages. Forwardable for the SMD-letter response window. |
| [`/findings`](https://ainpi.dev/findings) | Pre-registered findings (H1–H39). Each states null hypothesis + denominator *before* numbers drop |
| [`/methodology`](https://ainpi.dev/methodology) | Versioned audit methodology — DAMA DMBOK mapping, L0–L7 scoring, reproducibility commands |
| [`/pecos`](https://ainpi.dev/pecos) | PECOS-as-authoritative-source brief — implications of the 2026 verification rules |
| [`/smd-revalidation`](https://ainpi.dev/smd-revalidation) | Citation-ready language for the 2026-05-23 SMD-letter response (Elements 1–5) |
| [`/data-quality`](https://ainpi.dev/data-quality) | D3 dashboard: choropleth, sankey, knowledge graph, drill-down, validation |
| [`/insights`](https://ainpi.dev/insights) | Provenance + variance analysis (NPD vs published org numbers) |
| [`/provider-search`](https://ainpi.dev/provider-search) | Real-time search against live payer FHIR directories |
| [`/magic-scanner`](https://ainpi.dev/magic-scanner) | AI-augmented provider discovery |
| [`/npd`](https://ainpi.dev/npd) | Public search by NPI, name, organization, state, city |

## Public URL contract

Static JSON, CDN-cached, safe to depend on across releases:

- [`/api/v1/stats.json`](https://ainpi.dev/api/v1/stats.json) — site-wide counters, methodology version, commit SHA
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
- [NDH FHIR IG STU1 v1.0.0 (published)](https://hl7.org/fhir/us/ndh/STU1/) · [STU2 CI build](https://build.fhir.org/ig/HL7/fhir-us-ndh/) (tracked for upcoming changes; not authoritative)
