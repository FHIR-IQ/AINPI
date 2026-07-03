# Query the federal provider directory in 30 seconds

AINPI publishes the CMS National Provider Directory (NDH) releases as
flattened parquet. Each file carries the full FHIR resource as a JSON string
plus extracted `_*` columns for the fields most queries touch, using the same
extraction logic as the AINPI BigQuery pipeline, so numbers here reproduce
the published findings.

What you get that the raw CMS files do not give you:

1. **A release archive.** directory.cms.gov serves only the latest release;
   this dataset keeps every release AINPI has ingested (2026-04-09 and
   2026-05-08 so far), so release-over-release comparison is a join.
2. **No download-and-ingest step.** DuckDB reads the parquet over HTTP
   directly. The raw path is: download 2-5 GB of zst NDJSON, decompress to
   ~35 GB, parse FHIR JSON. This path is one query.
3. **Pre-joined exclusions.** `exclusions/high_risk_cohort.parquet` is the
   LEIE + SAM + NPPES-deactivation cross-check per NPI, with signal reasons
   and dates.

## Setup

Install [DuckDB](https://duckdb.org/) (a single binary), then:

```sql
-- Point at the dataset (hosted on HuggingFace).
-- DuckDB reads hf:// and https:// parquet paths natively.
SELECT count(*) FROM 'hf://datasets/DATASET_PATH/2026-05-08/practitioner.parquet';
```

Replace `DATASET_PATH` with the published dataset path (see the dataset card).
Working locally against your own export from the AINPI repo works the same
way with a filesystem path:

```sql
SELECT count(*) FROM 'frontend/data/parquet-export/2026-05-08/practitioner.parquet';
```

## Schema

Six tables per release, matching the AINPI BigQuery schema (see the AINPI
repo's CLAUDE.md for the full column list):

| Table | Extracted columns |
|---|---|
| `practitioner` | `_id, _npi, _family_name, _given_name, _state, _city, _postal_code, _gender, _active` |
| `organization` | `_id, _npi, _name, _state, _city, _org_type, _active` |
| `location` | `_id, _name, _state, _city, _postal_code, _status, _managing_org_id` |
| `endpoint` | `_id, _connection_type, _status, _address, _name, _managing_org_id` |
| `practitioner_role` | `_id, _practitioner_id, _org_id, _specialty_code, _specialty_display, _location_ids, _active` |
| `organization_affiliation` | `_id, _org_id, _participating_org_id, _active` |

Every table also carries `resource`: the complete original FHIR JSON as a
string. Anything not extracted is one `json_extract_string(resource, '$...')`
away.

Reference strings (`_practitioner_id`, `_org_id`, `_managing_org_id`) hold
full FHIR references like `Practitioner/Practitioner-1234567890`; join by
reconstructing the reference from the target's `_id`:

```sql
JOIN organization o ON pr._org_id = 'Organization/' || o._id
```

## Worked examples

Each `.sql` file in this directory reproduces a published AINPI finding, so
you can verify the numbers yourself:

| File | Reproduces | Published finding |
|---|---|---|
| `01_release_census.sql` | Resource counts per release and the April-to-May shift | the release-baseline table |
| `02_org_duplication.sql` | 70.6% of org NPIs map to more than one Organization resource | H14/H15 |
| `03_endpoint_split.sql` | 8.4% FHIR-REST vs 91.6% Direct Trust messaging | H28 |
| `04_phone_channels.sql` | 7.2M phones, 2.9M faxes, zero emails | H43 per-system counts |
| `05_exclusion_cohort.sql` | Signals and dates for the high-risk cohort | H23/H24/H25 |

Run one:

```bash
duckdb -c ".read examples/duckdb/02_org_duplication.sql"
```

## Fair use

The underlying data is public (CMS NDH public use files, OIG LEIE, SAM.gov
Public Extract). The parquet conversion and extraction code are Apache-2.0.
Signals in the exclusions table are data-quality flags, not investigative
findings; verify against the primary sources (linked from
<https://ainpi.dev/npi>) before acting on any row.
