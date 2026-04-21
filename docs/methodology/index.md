---
title: AINPI methodology
version: 0.6.0-draft
status: findings-landed
last_updated: 2026-04-21
---

# AINPI methodology

> **Status: `0.2.0-draft`.** All six pre-registered findings (H1–H22 bundled into 6 slugs) have landed real numbers against the 2026-04-09 NPD release. Analyses are reproducible from the scripts in `analysis/`. The methodology prose below is still a working document — expect formalization before `1.0.0`. Until `1.0.0`, treat any single headline as provisional and read it alongside the notes on the corresponding `/findings/<slug>` page.

AINPI audits the CMS National Provider Directory (NPD) bulk public-use release against its own structural requirements, its referential integrity, its endpoint liveness, and its temporal freshness. Every check is reproducible from a clean checkout; every finding is emitted as a FHIR `VerificationResult`.

---

## 1. Data source

- **Artifact:** CMS NPD local bulk export, `directory.cms.gov`, as `zstd`-compressed NDJSON files following the HTE data-release specifications.
- **Vintage:** *(pinned per release — fill checksum, file count, uncompressed size, resource counts)*
- **Resources processed:** Practitioner, PractitionerRole, Organization, OrganizationAffiliation, Location, Endpoint.
- **NDH IG version pinned:** *(see `build.fhir.org/ig/HL7/fhir-us-ndh/` — fill current pinned version)*

Dependent external sources:

- **NPPES monthly dissemination file** — for NPI existence / name / taxonomy agreement
- **NUCC taxonomy** — current quarterly code set
- **US Core 6.1.0** and **R4 4.0.1** — profile dependencies used by the NDH IG

---

## 2. Quality dimensions (DAMA DMBOK)

Each check maps to one of the six DAMA DMBOK data-quality dimensions and to a FHIR-native measurement.

| Dimension | AINPI measurement | FHIR signal |
|---|---|---|
| **Completeness** | Must-support element population by resource type | Cardinality against profile; `dataAbsentReason` share |
| **Validity** | Structural + profile-aware validation (HAPI) | `OperationOutcome.issue.severity` |
| **Accuracy** | NPI / NUCC / name agreement with authoritative sources | `VerificationResult.validationType`, `validationProcess` |
| **Consistency** | Cross-reference resolution; same NPI across Practitioner/Organization | Reference resolution + identifier de-duplication |
| **Uniqueness** | Duplicate detection (Practitioner by NPI; Organization by normalized name + address) | Identifier equality + fuzzy match |
| **Timeliness** | `meta.lastUpdated` distribution vs 30-day / 90-day thresholds | `meta.lastUpdated` CDF |

---

## 3. Pipeline

```
  NPD zstd NDJSON (raw)
        │
        ▼
  [0] shard by resourceType  →  Parquet (one file per resource)
        │
        ▼
  [1] structural validation  →  pydantic pass
        │                        HAPI profile-aware pass
        ▼
  [2] edge extraction        →  (sourceId, sourceType, refPath, targetType, targetId)
        │
        ▼
  [3] referential integrity  →  dangling / orphan / cycle reports
        │
        ▼
  [4] identity checks        →  NPI Luhn, NPPES join, NUCC validity, name agreement
        │
        ▼
  [5] endpoint liveness      →  ainpi-probe L0–L7 scoring (separate repo)
        │
        ▼
  [6] temporal analysis      →  meta.lastUpdated CDF vs thresholds
        │
        ▼
  findings/ (VerificationResult NDJSON + Parquet)
```

*(Each stage will link to its source file in `pipeline/` once the scaffold lands.)*

---

## 4. Structural validation

Two-tier pipeline. The first tier runs in Python against `fhir.resources` (pydantic v2) for a fast schema pass and drops records that fail basic FHIR R4 structure. The second tier runs the **HAPI FHIR Validator CLI** pinned to NDH `1.0.0`, US Core `6.1.0`, and R4 `4.0.1`, with a local terminology server to avoid `tx.fhir.org` rate limits.

Failures are bucketed into stable categories so downstream dashboards can pivot:

- `STRUCT` — fails basic FHIR structural validation
- `CARD` — cardinality violation against NDH profile
- `FP-INV` — invariant failure
- `MS-COV` — must-support element missing or empty
- `BIND-REQ` — required ValueSet binding violation
- `BIND-EXT` — extensible binding violation
- `REF-FMT` — Reference string malformed
- `REF-RES` — Reference does not resolve within the bundle
- `SLICE` — profile slice assignment failure
- `EXT-UNK` — unknown or disallowed extension

Each failure is emitted as one row to `out/structural/issues.parquet` with `(resource_id, resource_type, bucket, path, message, severity)`.

---

## 5. Referential integrity

A single streaming pass over the Parquet shards emits every `Reference` and `Reference.identifier` as a tuple:

```
(sourceId, sourceType, refPath, targetType, targetId, targetIdentifierSystem, targetIdentifierValue)
```

Stored in `out/edges.parquet`. DuckDB queries then compute:

- **Dangling literal references** — the `Reference` string points at a target that doesn't exist in the dump
- **Dangling logical references** — an NPI or other identifier is present in `Reference.identifier` but no matching resource exists
- **Orphans** — Practitioner with no PractitionerRole; Endpoint with no referrer
- **Cycles** — in `Organization.partOf` and `Location.partOf` chains
- **Fan-out errors** — identical telecom replicated across many PractitionerRoles under one Organization

NDH-specific rules (reported separately, not as hard failures):

- Every Endpoint should be referenced by at least one Organization or PractitionerRole
- PractitionerRole without a `location` reference is low-quality
- `HealthcareService.location` should intersect `PractitionerRole.location` for overlapping roles

---

## 6. Identity correctness

### NPI Luhn

Non-negotiable check. NPI is 10 digits, first digit 1 or 2, Luhn mod-10 on 14 digits after prepending the 80840 prefix. Expected pass rate is above 99.9% in the source; the failing cohort is the finding.

### NPPES join

NPI existence is resolved against the NPPES monthly full dissemination file (~950MB ZIP, 8.5M active NPIs, layout V.2 mandatory as of March 2026). The join is broadcast-loaded in DuckDB — never per-row API calls. Emit structured codes:

- `NPI_INVALID_STRUCTURE`
- `NPI_NOT_ENUMERATED`
- `NPI_DEACTIVATED`
- `NPI_TYPE_MISMATCH`

### Name agreement

Jaro-Winkler ≥ 0.85 after exact anti-join and after normalization (lowercase, strip credential suffixes, collapse whitespace).

### Address agreement

USPS standardization via a batch pass through the Census Geocoder (batch up to 10,000; returns lat/lon plus FIPS). Secondary-unit mismatches (Suite A vs Suite 100) are flagged `likely_same` rather than `mismatch` — these account for the majority of apparent disagreements.

### NUCC taxonomy

Current quarterly code set is loaded from `nucc.org`. The acceptable set is the union of active codes across the last 3 years (handles the NDH's trailing-edge usage). Checks:

- **Validity** — code present in the acceptable set
- **Cardinality level** — Grouping vs Classification vs Specialization, against profile bindings
- **Primary-specialty agreement** with NPPES

---

## 7. Endpoint liveness (`ainpi-probe`)

Scored L0 through L7 against every FHIR-REST `Endpoint.address` URL:

| Level | Check |
|---|---|
| L0 | DNS resolves |
| L1 | TCP connect |
| L2 | TLS handshake with certificate capture |
| L3 | HTTP response at base URL (any non-5xx). FHIR servers aren't required to answer at the bare base — only at `/metadata` — so 4xx at root is common and not a liveness failure. Status code is recorded. |
| L4 | Parseable `CapabilityStatement` at `/metadata` |
| L5 | `CapabilityStatement` conformance with `fhirVersion` declared + REST server mode |
| L6 | Valid `.well-known/smart-configuration` with PKCE S256 and required fields |
| L7 | Unauthenticated `Practitioner` search returns 200 or 401 |

**Crawl etiquette (non-negotiable):**

- 2–4 concurrent connections per host
- 1 request per second default
- User-Agent: `AINPI-DirectoryQualityBot/1.0 (+https://ainpi.vercel.app/crawler; gene@fhiriq.com)`
- Exponential backoff with jitter on 429 / 503
- 10-second connect timeout, 30-second read timeout
- Documented stable source IP so operators can whitelist

The crawler lives in the separate auditable repository `FHIR-IQ/ainpi-probe`.

---

## 8. Temporal analysis

`meta.lastUpdated` distribution across the dump, with CDFs against four thresholds:

- **30 days** — CMS-9115-F standard
- **90 days** — REAL Health Providers Act and No Surprises Act standard
- **365 days**
- **> 365 days**

Weekly snapshots enable churn analysis: week-over-week change in deactivated NPIs, new Organizations, endpoint churn, and `meta.lastUpdated` distribution shift.

---

## 9. Finding emission

Every check output is emitted as:

1. **A FHIR `VerificationResult`** written to `out/verification/<check-id>.ndjson` — the NDH IG already defines this; we use it as the quality event schema so the output is standards-native.
2. **A Parquet row** in `out/findings.parquet` with `(check_id, resource_id, resource_type, severity, bucket, value, threshold, release_date)` — pivoted by dashboards.
3. **A static JSON snapshot** at `public/api/v1/findings/<check-id>.json` — consumed by the web app's `/findings/[slug]` route.

---

## 10. Limitations

- **Not populated** vs **not supported**: FHIR data absence can mean either. AINPI defaults to reporting counts and lets the methodology disambiguate per-element.
- **Attestation claims are unverifiable at rest.** Phone and address accuracy require ground truth that isn't present in the bulk export; pair numeric findings with a stated intent to add phone-audit follow-up in a future release.
- **Graph-completeness distinction:** NPD is an aggregated-from-payers shard, not a canonical-authority record. Findings should describe which view they're measuring.
- **Dump vintage vs report vintage:** every finding names the release it was computed against. Running the same check against a different vintage will return different numbers.

---

## 11. Versioning

- Methodology version follows semver and is pinned in the front-matter of this file.
- Any change to a check's computation requires a minor bump and a note at the top of the affected finding page.
- Any change to a bucket taxonomy (STRUCT, CARD, etc.) requires a major bump.

---

## 12. Reproducibility

All pipeline code lives in the `pipeline/` directory. A clean-checkout reproduction will be:

```bash
# (commands finalize when pipeline scaffold lands)
git clone https://github.com/FHIR-IQ/AINPI
cd AINPI
make fetch            # pulls the pinned NPD release
make validate         # structural + profile-aware
make integrity        # edge extraction + referential integrity
make identity         # NPI / NPPES / NUCC / name
make liveness         # dispatches to ainpi-probe
make temporal         # lastUpdated CDFs
make findings         # emits VerificationResult + Parquet + JSON
```

Outputs are deterministic given the pinned release artifact and code at a given commit.
