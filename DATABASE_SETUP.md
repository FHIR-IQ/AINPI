# Database Setup

AINPI uses two databases:

- **Supabase Postgres** (via Prisma) — app auth, user data, pre-aggregated NPD metrics
- **Google BigQuery** — the full 27.2M-row CMS NPD warehouse

This guide walks through both.

---

## 1. Supabase (app database)

Active project: `hspqvcoinujtfodreqaf` in region `aws-1-us-east-2`.

### 1.1 Get connection strings

From the Supabase dashboard → **Project Settings → Database → Connection string**:

```text
# Pooler (runtime):
postgresql://postgres.hspqvcoinujtfodreqaf:[PASSWORD]@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true

# Direct (migrations):
postgresql://postgres.hspqvcoinujtfodreqaf:[PASSWORD]@aws-1-us-east-2.pooler.supabase.com:5432/postgres
```

### 1.2 Add to `frontend/.env.local`

```bash
POSTGRES_PRISMA_URL="postgresql://postgres.hspqvcoinujtfodreqaf:...@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true"
POSTGRES_URL_NON_POOLING="postgresql://postgres.hspqvcoinujtfodreqaf:...@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
NEXT_PUBLIC_SUPABASE_URL="https://hspqvcoinujtfodreqaf.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
```

### 1.3 Push schema

Prisma reads from `.env`, not `.env.local`:

```bash
cd frontend
cp .env.local .env
npm run db:push          # Creates all tables, no migration files
```

Schema lives at `frontend/prisma/schema.prisma` and includes:

- **User-facing:** `Practitioner`, `PractitionerRole`, `SyncLog`, `Consent`
- **Directory discovery:** `ProviderDirectoryAPI`, `MagicScanResult`
- **NPD metrics (synced from BigQuery):** `NpdDataQualitySummary`, `NpdStateMetrics`, `NpdSpecialtyMetrics`, `NpdEndpointMetrics`, `NpdIngestionLog`

### 1.4 Seed demo data (optional)

```bash
npm run db:seed                          # 3 demo practitioners with roles
npx tsx prisma/seed-major-payer-apis.ts  # 5 major payer FHIR endpoints
```

---

## 2. BigQuery (NPD data warehouse)

Project: `thematic-fort-453901-t7`, dataset: `cms_npd`, location: `US`.

### 2.1 Install + authenticate gcloud

```bash
brew install --cask google-cloud-sdk
export PATH="/opt/homebrew/share/google-cloud-sdk/bin:$PATH"
gcloud auth application-default login
gcloud config set project thematic-fort-453901-t7
```

Also install `zstd` for decompressing the NDJSON files:

```bash
brew install zstd
```

### 2.2 Create the dataset and tables

```bash
cd frontend
npm run bq:setup
```

Creates 6 tables (`practitioner`, `organization`, `location`, `endpoint`, `practitioner_role`, `organization_affiliation`) using the flexible `resource:JSON + _* flat fields` schema pattern, plus 5 analytics views.

### 2.3 Download + ingest the CMS NPD files

```bash
npm run bq:ingest
```

Downloads the 6 NDJSON.zst files (~2.8 GB compressed total) from <https://directory.cms.gov> into `frontend/data/cms-npd/`, then streams them into BigQuery in 2,000-row batches.

For testing with a small sample:

```bash
npx tsx scripts/ingest-cms-npd.ts --resource Practitioner --sample 5000
```

### 2.4 Sync pre-aggregated metrics to Supabase

```bash
npm run bq:sync
```

Runs BigQuery aggregation queries and upserts the results into `NpdDataQualitySummary`, `NpdStateMetrics`, `NpdSpecialtyMetrics`, `NpdEndpointMetrics`. The dashboard at `/data-quality` reads from these Supabase tables for sub-second page loads.

---

## 3. Production Environment Variables (Vercel)

All variables from `frontend/.env.local` must be set in Vercel. Critical additions for production:

```text
GCP_PROJECT_ID=thematic-fort-453901-t7
BQ_DATASET_ID=cms_npd
GCP_SERVICE_ACCOUNT_KEY=<single-line JSON with bigquery.dataViewer + jobUser roles>
```

To create the service account key:

```bash
gcloud iam service-accounts create ainpi-bigquery --display-name="AINPI BigQuery Access"
gcloud projects add-iam-policy-binding thematic-fort-453901-t7 \
  --member="serviceAccount:ainpi-bigquery@thematic-fort-453901-t7.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer"
gcloud projects add-iam-policy-binding thematic-fort-453901-t7 \
  --member="serviceAccount:ainpi-bigquery@thematic-fort-453901-t7.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"
gcloud iam service-accounts keys create /tmp/ainpi-bq-key.json \
  --iam-account=ainpi-bigquery@thematic-fort-453901-t7.iam.gserviceaccount.com
cat /tmp/ainpi-bq-key.json | tr -d '\n' | vercel env add GCP_SERVICE_ACCOUNT_KEY production
```

In local dev `GCP_SERVICE_ACCOUNT_KEY` is unset and the BigQuery client falls back to `gcloud auth application-default login` credentials.

---

## 4. Verifying the Setup

After everything is loaded, hit the validation endpoint:

```bash
curl https://ainpi.vercel.app/api/npd/validation | jq '.resource_counts'
```

Expected completeness vs the CMS source manifest (2026-04-09 release):

```text
Resource                      Expected       Actual      Delta   Completeness
practitioner                 7,441,212    7,441,213         +1    100.000%
organization                 3,605,261    3,603,262     -1,999     99.945%
location                     3,494,239    3,494,239          0    100.000%
endpoint                     5,043,524    5,043,524          0    100.000%
practitioner_role            7,180,732    7,178,732     -2,000     99.972%
organization_affiliation       439,599      439,599          0    100.000%
TOTAL                       27,204,567   27,200,569     -3,998     99.985%
```

Small negative deltas (~0.015% total) are legitimate ingestion errors from malformed records or size-limit rejects. Dedup has already been applied to `practitioner` and `organization` (`CREATE OR REPLACE` with `ROW_NUMBER() OVER (PARTITION BY _id)` to guard against retry-during-streaming duplicates).

---

## 5. Troubleshooting

**Prisma: `Can't reach database server`**
Supabase paused the project after inactivity. Open the project in the dashboard and click Resume.

**Prisma: `Environment variable not found`**
You forgot `cp .env.local .env` before running a Prisma command.

**BigQuery: `Unrecognized name: <column>`**
Schema changed (e.g., `_managing_org_name` → `_managing_org_id`). Re-run `npm run bq:setup` and ensure `scripts/recreate-views.ts` has been run.

**Vercel function: `Search failed: ... Unclosed identifier literal`**
Don't use backticks in SQL strings — Vercel/webpack corrupts escaped backticks. Use plain `project.dataset.table` references; BigQuery accepts them even with hyphens.

**`SELECT DISTINCT` over a JSON column fails**
Cast to string with `TO_JSON_STRING(column)` or extract scalars with `JSON_EXTRACT_SCALAR(column, '$.path')`.
