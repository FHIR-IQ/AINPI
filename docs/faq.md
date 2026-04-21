---
title: Frequently asked questions
version: 0.2.0
last_updated: 2026-04-21
---

# Frequently asked questions

## What is AINPI?

AINPI is an open-source, reproducible audit of the CMS **National Provider Directory** (NPD) public-use FHIR bulk files. It measures whether the national directory is internally consistent, FHIR-conformant, technically reachable, and temporally current.

Six pre-registered findings are published at [/findings](/findings), each with a headline, null hypothesis, denominator, chart, and notes. Every number is reproducible from code in the public repository.

## Who built this?

Eugene Vestel, operating under [FHIR IQ](https://fhiriq.com). Contact: [gene@fhiriq.com](mailto:gene@fhiriq.com).

## Is AINPI affiliated with CMS or HHS?

No. AINPI is an independent open-source project. CMS publishes the raw public-use data at [directory.cms.gov](https://directory.cms.gov/); AINPI ingests, validates, and publishes findings against that artifact.

## What data does AINPI use?

- **CMS National Provider Directory, 2026-04-09 release** — 27.2M FHIR R4 resources across Practitioner, PractitionerRole, Organization, OrganizationAffiliation, Location, and Endpoint. Loaded into BigQuery.
- **NPPES monthly full dissemination file, 2026-02-09 update** — from the public BigQuery dataset `bigquery-public-data.nppes.npi_raw` (9.37M NPIs). Used for H10 (NPI match), H11 (name agreement), H13 (primary specialty agreement).
- **NUCC healthcare provider taxonomy v17.0** — from `bigquery-public-data.nppes.healthcare_provider_taxonomy_code_set_170`. Used for H12 (taxonomy validity).
- **Live FHIR endpoint probes** — the `FHIR-IQ/ainpi-probe` crawler hits each declared `Endpoint.address` URL in the NDH with polite rate limits (1 req/sec/host, named User-Agent, documented source IP). Used for H1–H5 and H22.

## How often is AINPI refreshed?

- **BigQuery-driven findings** (H6–H15, H18) re-run automatically every Monday 09:00 UTC via a GitHub Actions workflow and open a review PR with the diff.
- **FHIR endpoint crawl** (H1–H5, H22) runs out-of-band on a dedicated host (not a CI runner, which would be a bad neighbor). Cadence: monthly until the behavior stabilizes, then weekly.
- **Methodology + check catalog**: versioned in the repo. Any change bumps `methodology_version` in `/api/v1/stats.json`.

Each finding's JSON at `/api/v1/findings/<slug>.json` carries its `generated_at` timestamp and a `commit_sha` pinning the repo state that produced the numbers.

## Can I cite AINPI in academic or policy work?

Yes. Use the `CITATION.cff` file in the repository root for Zotero / reference managers, or follow this pattern:

> Vestel, E. *AINPI — open-source audit of the CMS National Provider Directory.* FHIR IQ. <https://ainpi.vercel.app>

Pin to a specific release (`v1.0.0`, `v0.9.0-preview`, etc.) for reproducibility.

## Is the data free to use? What's the license?

All code is **Apache-2.0**. Published findings and derived datasets are released under the same terms; see [LICENSE](https://github.com/FHIR-IQ/AINPI/blob/main/LICENSE) for details. Raw CMS NPD data is public-domain; AINPI's derived analyses, documentation, and methodology doc are Apache-2.0-licensed works.

## Can I contribute?

Yes — three shapes of contribution:

1. **Data quality bug reports** — you think a number disagrees with the source. File an issue using the [Data quality bug template](https://github.com/FHIR-IQ/AINPI/issues/new/choose).
2. **New metric proposals** — propose H23, H24, etc. Submit a [New metric proposal](https://github.com/FHIR-IQ/AINPI/issues/new/choose) before writing code so the null and methodology are public first.
3. **Code contributions** — PRs welcome. Read [CONTRIBUTING.md](https://github.com/FHIR-IQ/AINPI/blob/main/CONTRIBUTING.md) first.

## Why are some pages marked "Coming Soon"?

The `/provider-search` and `/magic-scanner` pages are exploratory prototypes, kept available for reference but not part of the AINPI v1.0.0 audit. They'll be refined or retired in future releases.

## How do I report a security issue?

Email [gene@fhiriq.com](mailto:gene@fhiriq.com) — see [/security](/security) for the full disclosure policy. Please do not file public GitHub issues for vulnerabilities.

## What's not in NPD?

The CMS NPD bulk export ships **6 of the 10 resources defined by the NDH FHIR Implementation Guide**. Four resources are absent:

- `HealthcareService`
- `InsurancePlan`
- `Network`
- `Verification`

Any analysis that depends on these resources cannot be performed from NPD alone. H8 (Organization-to-HealthcareService coverage) reports this gap directly. When CMS adds these resources to the public-use export, AINPI will re-run the affected checks.

## Where can I see the roadmap?

The public roadmap is tracked as [GitHub Issues](https://github.com/FHIR-IQ/AINPI/issues) with label `roadmap`. The methodology doc's Section 11 also lists version-bump triggers.

## Who is this for?

- **Provider-side data teams** auditing their own NPD footprint
- **Payer directory engineers** comparing their network's NPD presence to their internal records
- **Regulators, journalists, and academics** who need a reproducible, versioned reference for the NDH's actual state
- **Developers** building against FHIR provider-directory APIs
