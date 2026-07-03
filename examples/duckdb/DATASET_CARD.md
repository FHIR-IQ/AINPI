---
license: apache-2.0
tags:
  - healthcare
  - fhir
  - cms
  - provider-directory
  - medicare
pretty_name: CMS National Provider Directory (NDH) — release archive, flattened parquet
---

# CMS National Provider Directory — release archive (flattened parquet)

The CMS National Provider Directory (NDH) bulk export, converted to
query-ready parquet, one directory per release. Published by
[AINPI](https://ainpi.dev), the open audit of the federal provider directory.

## Why this exists

directory.cms.gov serves only the **latest** release as 2–5 GB zst-compressed
NDJSON per resource. This dataset gives you:

1. **A release archive** — every release AINPI has ingested stays here, so
   release-over-release comparison is a join, not an archaeology project.
2. **A 30-second query path** — DuckDB reads these files over `hf://` paths
   directly; no download, decompress, or FHIR parsing step.
3. **Pre-joined exclusions** — `exclusions/high_risk_cohort.parquet` is the
   OIG LEIE + SAM.gov + NPPES-deactivation cross-check per NPI.

## Layout

```
2026-04-09/   practitioner, practitioner_role, organization,
              organization_affiliation, location, endpoint   (.parquet)
2026-05-08/   same six tables
exclusions/   high_risk_cohort.parquet
```

Each table row carries the complete original FHIR resource as a JSON string
(`resource`) plus extracted `_*` columns for the commonly-queried fields.
Extraction logic is identical to the AINPI BigQuery pipeline
([`analysis/fast_ingest_ndh.py`](https://github.com/FHIR-IQ/AINPI/blob/main/analysis/fast_ingest_ndh.py)),
so numbers computed here reproduce the published findings at
[ainpi.dev/findings](https://ainpi.dev/findings).

## Quick start

```sql
-- DuckDB, no setup:
SELECT _state, count(*) AS practitioners
FROM 'hf://datasets/DATASET_PATH/2026-05-08/practitioner.parquet'
WHERE _active
GROUP BY _state ORDER BY practitioners DESC LIMIT 10;
```

Worked examples that reproduce published findings (org-NPI duplication,
endpoint connection-type split, telecom channels, exclusion signals) live in
the AINPI repo:
[`examples/duckdb/`](https://github.com/FHIR-IQ/AINPI/tree/main/examples/duckdb).

## Row counts

| Table | 2026-04-09 | 2026-05-08 |
|---|---:|---:|
| practitioner | 7,441,212 | 7,441,211 |
| practitioner_role | 7,180,732 | 7,028,001 |
| organization | 3,605,261 | 3,414,375 |
| location | 3,494,239 | 1,362,869 |
| endpoint | 5,043,524 | 1,360,585 |
| organization_affiliation | 439,599 | 1,086,694 |

Counts are of the published CMS files as-is (zero parse errors in
conversion). They differ from AINPI's historical April BigQuery-load numbers
by ~0.03% on organization and practitioner_role; the original April load used
a legacy streaming ingester that dropped a small number of rows, and these
parquet files are the more faithful record.

The sharp Endpoint (−73%) and Location (−61%) drops in May are a CMS-side
packaging change (multi-address dedup), not data loss; see the
[release notes](https://ainpi.dev/reports/2026-05-08-update).

## Caveats

- **Source fidelity**: rows are the CMS bulk export as published, including
  its errors. AINPI's findings catalog documents the known data-quality
  issues per release.
- **Exclusions table**: signals are data-quality flags from cross-checking
  public federal databases, **not investigative findings**. The SAM.gov NPI
  field has a documented false-positive history. Verify any row against the
  primary sources (per-NPI verify links at
  [ainpi.dev/npi](https://ainpi.dev/npi)) before acting on it.
- **License**: underlying data is public (CMS NDH public use files, OIG
  LEIE, SAM.gov Public Extract). Conversion code and this packaging are
  Apache-2.0.

## Provenance

- Source: <https://directory.cms.gov/> (NDH bulk export, zstd NDJSON)
- Converter: [`analysis/export_parquet.py`](https://github.com/FHIR-IQ/AINPI/blob/main/analysis/export_parquet.py)
- Audit + methodology: <https://ainpi.dev/methodology>
- Maintainer: Eugene Vestel, FHIR IQ — gene@fhiriq.com
