---
title: AINPI methodology
version: 0.7.2-draft
status: findings-landed
last_updated: 2026-06-09
---

# AINPI methodology

> **Status: `0.7.2-draft`.** 0.7.2 pre-registers **H43 — practitioner phone-number reachability** (`/findings/practitioner-phone-reachability`), which resolves practitioner → phone across three FHIR paths (`Practitioner.telecom`, `PractitionerRole.telecom`, and the referenced `Location.telecom`) and reports the any-path union alongside the on-record share; the compute script ships and live fill-rates land on the next weekly-refresh. Methodology bumped from 0.6.x to 0.7 after the claims-side cross-audit (H29–H36) shipped for all 50 states + DC + PR. 0.7.1 adds the **provider data landscape** (`/`) — a Karpathy-style hierarchical treemap of every (state × specialty) cell scored across six audit dimensions — and the **REAL Health Providers Act audit framework** (`/real-health-providers`), which maps each HR 7148 § 6220 obligation to the AINPI signal that measures it. The choropleth that was the homepage moved to `/map`. The original ten directory-side findings (H1–H28) still land against both the 2026-04-09 and 2026-05-08 NDH releases, with three of the four federal database checks under 42 CFR § 455.436 closed: NPPES (H10–H13), OIG LEIE (H24), SAM.gov (H25). H26 reaches 4 public payer FHIR endpoints; H27 independently verified the 2026-04-30 Washington Post SSN exposure (46 → 41 across releases; CMS partially scrubbed but did not eliminate). H29–H36 add claims-side cross-checks — Medicaid spending, Medicare Part B + Part D billing, NPPES-deactivated × billing, Open Payments × exclusion, DMEPOS supplier directory, nursing-home / hospice / HHA / hospital ownership disclosures, NDH completeness against material Medicare billers. H37–H39 pre-register the PECOS-as-authoritative-source workstream triggered by CMS's 2026 verification rules. Until `1.0.0`, treat any single headline as provisional and read it alongside the notes on the corresponding `/findings/<slug>` page.

## What's new since 0.6.0-draft

- **Methodology improvement #1 — strict post-exclusion attribution.** Earlier framings of "$8.5M Medicaid paid to excluded NPIs 2018–2024" captured pre-exclusion legitimate billing. The H23 cohort exporter now carries per-NPI `leie_excldate`, `sam_active_date`, `nppes_deactivation_date`, and downstream claims-side findings (H29 / H30a / H30b / H32) filter strictly post-exclusion as the regulatory headline. The full-window number stays as a sidecar field. Pattern: when federal exclusion takes effect, federal-program payment stops in the data — the directory still lists them.
- **Methodology improvement #2 — H35 Stage B via the CMS PPEF cross-walk.** First H35 release reported "0 demographic matches" — a structural null caused by joining on owner STATE, which is 100% empty for individual owners in CMS's All Owners files. Stage B introduces the CMS Medicare Fee-For-Service Public Provider Enrollment File (2.47M individual NPIs) as the cross-walk: PECOS_ASCT_CNTL_ID → NPI for Tier 1 confirmed matches; ENRLMT_ID → STATE_CD for Tier 2 demographic matches with a real geographic filter.
- **All-states claims-side cross-audit.** H29 / H30a / H30b / H31 / H32 refactored to stream each big source file ONCE and partition output across every state cohort. Same I/O cost as the original VA-only runs; 50× the coverage. Per-state CSVs at `/api/v1/states/<state>/h{29..32}-*.csv`.
- **Map-first homepage.** `/` is now an interactive US choropleth with a 3-style theme switcher and a 5-metric switcher. Click a state for an at-a-glance side panel with the cross-audit findings. Replaces the previous redirect to `/npd`.
- **CMO-facing per-state surface.** New `/for-state-medicaid/<state>` pages for the state Medicaid CMO listserve audience — count-and-action lede, no H-numbers, citation-ready for SMD-letter Elements 2 + 4. Index at `/for-state-medicaid`.

## PECOS as authoritative source (CMS 2026 verification rules)

CMS designated PECOS as the authoritative source for Medicare enrollment data. State Medicaid systems must demonstrate alignment with PECOS under the 2026 verification rules. The window between "discrepancy found" and "enrollment affected" tightens.

Three classes of misalignment matter:

1. **Taxonomy code disagreement** (PECOS PROVIDER_TYPE_CD vs NPPES NUCC taxonomy vs actual billing pattern). Behavioral-health wrong-taxonomy generates denials, not warnings. Recoupment risk for the entire window the wrong code was in place.
2. **Practice location currency.** Stale PECOS addresses survive partnership moves, retirements, and group-practice splits. Multi-enrollment NPIs (the same NPI enrolled in multiple states with conflicting addresses) are the most concrete signal.
3. **Ownership disclosure currency.** The 2023 CMS Disclosure of Ownership IFR requires disclosures be kept current. AINPI's H35 Stage B already cross-walks owner ASSOCIATE_IDs through PPEF; the PECOS-currency lens extends that to "ownership disclosure was last updated when."

AINPI pre-registers three findings on this workstream:

- **H37 — PECOS PROVIDER_TYPE vs NPPES taxonomy disagreement.** Per-NPI mismatch surfaced against the CMS Medicare ↔ NUCC taxonomy crosswalk. Per-state aggregate for SMD-response Element 3 (revalidation use).
- **H38 — Behavioral-health taxonomy misalignment.** Subset of H37 narrowed to behavioral-health NUCC codes (counselors, psychologists, LCSWs, MFTs). These are the highest-recoupment-risk providers under the 2026 rules; surfacing the misalignment cohort gives state PI offices and provider organizations the list to triage.
- **H39 — Multi-enrollment NPIs with conflicting state addresses.** Same NPI enrolled in multiple PECOS records with different `STATE_CD`. Indicates stale records, partnership-move staleness, or active multi-state practice — each requires distinct triage. Per-state CSVs published.

All three findings reuse the PPEF file already on disk for H35 Stage B; no new ingestion. The CMS Medicare ↔ NUCC taxonomy crosswalk used in H10–H13 is the same crosswalk H37 / H38 require.

AINPI audits the CMS National Provider Directory (NPD) bulk public-use release against its own structural requirements, its referential integrity, its endpoint liveness, and its temporal freshness. Every check is reproducible from a clean checkout; every finding is emitted as a FHIR `VerificationResult`.

---

## 1. Data source

- **Artifact:** CMS NPD local bulk export, `directory.cms.gov`, as `zstd`-compressed NDJSON files following the HTE data-release specifications.
- **Vintage:** *(pinned per release — fill checksum, file count, uncompressed size, resource counts)*
- **Resources processed:** Practitioner, PractitionerRole, Organization, OrganizationAffiliation, Location, Endpoint.
- **NDH IG version pinned:** **STU1 v1.0.0** (published at <https://hl7.org/fhir/us/ndh/STU1/>). The CI build at `build.fhir.org/ig/HL7/fhir-us-ndh/` is the STU2 work-in-progress, tracked for forward-looking analysis but not used as the conformance reference.

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
- User-Agent: `AINPI-DirectoryQualityBot/1.0 (+https://ainpi.dev/crawler; gene@fhiriq.com)`
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

All analysis code lives in `analysis/`. A clean-checkout reproduction:

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
