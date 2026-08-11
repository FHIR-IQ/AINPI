# PA provider crosswalk: cross-referencing directories across payers and health systems

Design spec. Status: draft, not yet implemented.

## The problem

AINPI currently holds one view of provider reality: the CMS National Provider Directory, which is an aggregate of what providers self-attested to NPPES plus PECOS enrollment. It is national, free, and stale. Nobody maintains it as an operational system, because nobody is punished when it is wrong.

Meanwhile two other tiers of directory exist, both more current, neither public in the same way:

- **Payer network directories** answer "is this provider in-network, and where do they practice for this plan". Payers are legally required to publish these through a public FHIR API.
- **Health system directories** answer "does this clinician practice here right now". These are the freshest data in the system, and they are the least accessible.

The valuable object is not any one of these. It is the **disagreement between them**, per NPI, which is exactly what nobody publishes and exactly what the ghost-network problem consists of.

## What was verified, 2026-08-11

Everything below was probed directly rather than read from documentation.

| Target | Finding |
| --- | --- |
| Capital BlueCross `providerdirectory-api.capbluecross.com/r4` | **Live, public, no auth.** FHIR 4.0.1, PDex Plan-Net. Advertises Endpoint, HealthcareService, InsurancePlan, Location, Organization, OrganizationAffiliation, Practitioner, PractitionerRole. |
| Capital BlueCross search capability | `family=` works. **`identifier=` (NPI) rejected**, `address-state` rejected, `_include` rejected. Bare queries rejected with "A valid search parameter was not provided." |
| Capital BlueCross payload | **NPI is present** in `identifier[]` under `http://hl7.org/fhir/sid/us-npi`, and specialty is coded to `http://nucc.org/provider-taxonomy`. |
| Capital BlueCross enumeration | `_lastUpdated=gt2020-01-01` → **67,225 Practitioners**. `page=N` links work. Page size capped at **20** regardless of `_count`. `$export` unsupported. |
| UPMC Health Plan `apis.upmchp.com/fhir/r4` | This is the **Patient Access API**, not the provider directory: SMART-on-FHIR OAuth2, resources Patient / ExplanationOfBenefit / Coverage / Organization / Practitioner / Procedure / Group. The 401 on Practitioner search is correct behavior. |
| UPMC Health Plan provider directory | **Not discoverable.** The published API documentation page contains no occurrence of "Provider Directory", and no plausible base URL resolved. Not yet a compliance claim — see H49 protocol. |
| UPMC health system `providers.upmc.com` | Kyruus-backed, results server-rendered, only availability slots served as JSON (`/api/searchservice-v9/upmc/slots`). Behind **Akamai Bot Manager** (randomized sensor POST path). |
| `providers.upmc.com/robots.txt` | `User-agent: *` → `Disallow: /`, with a named allowlist for search-engine crawlers only, `Crawl-delay: 5`. |

## We are not going to scrape UPMC

The request included scraping the UPMC directory. We should not, and the reason is not squeamishness:

1. `providers.upmc.com/robots.txt` disallows all agents except named search engines. Ignoring that is a deliberate act, not an oversight, and this project's entire credibility rests on being the party that plays it straight.
2. It is behind Akamai Bot Manager. Any harvester becomes an evasion arms race, which is both fragile and exactly the "detection evasion" posture we refuse elsewhere.
3. It is unnecessary. **UPMC's physicians appear in UPMC Health Plan's network directory and in every other payer directory that contracts with UPMC.** The payer tier is a legitimate, legally-mandated window onto the same clinicians.

Where a health system's roster genuinely cannot be reached through the payer tier, the answer is a data-sharing conversation with that system, not a crawler. That is a slower path and a real limitation; it should be stated in the methodology rather than engineered around.

## The access asymmetry, and why it drives the architecture

| Tier | Freshness | Legal access | Join key |
| --- | --- | --- | --- |
| A. Federal (NPPES, NDH, PECOS, LEIE/SAM) | Poor, self-attested | Fully open bulk | NPI, native |
| B. Payer directories | 30-day update duty under CMS-9115-F | **Mandated public, no auth** | NPI present in payload, often **not searchable** |
| C. Health systems | Best | None. Bot-protected, robots-disallowed | No NPI published at all |

The single most consequential technical fact is in row B: **NPI is in the payload but frequently not a supported search parameter.** Capital BlueCross rejects it; Cigna already rejects it (documented in H26). That kills targeted per-NPI lookup as an architecture. You cannot ask a payer "tell me about NPI 1234567890".

Therefore the system must **bulk-harvest each payer directory and index by NPI locally**. That single constraint determines Phases 2 and 3.

## Architecture

```
per-payer harvest (HTTP, polite, curl)
        │  enumerate via _lastUpdated, page through, raw NDJSON
        ▼
BigQuery  payer_directory.*        partitioned by harvest_date, clustered by _npi
        │  Practitioner / PractitionerRole / Location / Organization
        ▼
crosswalk builder                  normalize name, address, phone, taxonomy
        │  one row per (npi, source, harvest_date) + resolved master
        ▼
discrepancy engine                 per-NPI agreement scoring across sources
        │
        ▼
/api/v1 static JSON  →  force-static PA portal pages
```

Four resource types are required, not one. A practitioner's practice address does not live on `Practitioner`; it lives on `Location`, reached via `PractitionerRole.location`. Harvesting only `Practitioner` yields names with no addresses and answers none of the interesting questions.

## Entity resolution

NPI is the join key wherever it exists. The hard cases are everything else.

- **Address.** The comparison unit should be a normalized tuple (street, city, state, ZIP5), not a string. H47 already established the discipline: `norm_county()` strips to alphanumerics because CMS writes `MC KEAN` and USDA writes `McKean`. The same class of bug will appear here as `STE 200` vs `Suite 200` vs `#200`.
- **Phone.** Reuse the normalization already encoded in `cms_npd.phones_per_practitioner`: strip non-digits, drop a leading 1 if 11 digits, require exactly 10, otherwise NULL and count as dropped.
- **Specialty.** Capital BlueCross codes to NUCC, which is the good case. Payers that publish marketing specialty strings need a crosswalk, and the CMS Medicare Provider and Supplier Taxonomy Crosswalk already used in H10–H13 is the bridge.
- **One-to-many is normal.** One NPI legitimately has many locations across many plans. The master record is not "the address"; it is the set of claimed addresses with per-source provenance and a disagreement flag.

Every stored row keeps `source_id`, `harvest_date`, `source_url`, and the resource's own `meta.lastUpdated`. A crosswalk without provenance is an opinion.

## Phases

**Phase 1 — PA payer directory census (H49).** For every payer operating in PA, locate the Provider Directory API and measure it: public? unauthenticated? PDex Plan-Net conformant? NPI in payload? NPI searchable? enumerable, and how? total practitioner count? This is publishable standing alone and is the first public measurement of whether CMS-9115-F is actually being complied with in one state.

The payer list must be pinned from a primary source (the PA DHS HealthChoices MCO list plus the CMS MA contract file), not assembled from memory. Absence must be reported as "not discoverable via protocol X" with the protocol stated, never as "non-compliant" — the UPMC Health Plan result above is precisely this case.

Script `analysis/h49_pa_payer_directory_census.py` → `findings/pa-payer-directory-census.json`.

**Phase 2 — Harvester.** One generic PDex Plan-Net harvester, config-driven per payer. Enumerate by `_lastUpdated`, follow `next` links, land raw NDJSON, load to BigQuery. Politeness is non-negotiable: identified User-Agent, rate limit at or below any published crawl-delay, honor robots.txt, and shell out to `curl` rather than urllib because Akamai-fronted endpoints WAF-block Python's TLS fingerprint (established in H26, re-confirmed in H46).

At 67,225 records and 20 per page, Capital BlueCross alone is ~3,400 requests, roughly an hour at 1 req/sec. That is the per-payer unit of work.

**Phase 3 — Crosswalk.** Build `pa_provider_crosswalk` keyed on NPI with one row per source claim, plus the resolved master. Reuse the substrate pattern already documented for `phones_per_practitioner`: extract once into a clustered helper, then let each downstream finding be a cheap join.

**Phase 4 — Discrepancy engine (H50).** Per NPI present in two or more sources, score agreement on address, phone, specialty and active status. Report exact match, normalized match, and conflict separately, because collapsing them hides where the normalization is doing the work. Headline metric: the share of PA NPIs where sources disagree on where the provider actually practices.

**Phase 5 — Portal.** PA provider pages showing every source side by side with disagreements highlighted and primary-source verify links per row. Must follow the `/npi` cost contract exactly: `force-static`, `dynamicParams = false`, `generateStaticParams`, **no runtime BigQuery**. A live per-NPI lookup on a crawled route is an unbounded BQ bill.

**Phase 6 — Generalize.** The payer registry is config, so a new state is new config rows plus a census run, not new code.

## Pre-registered hypotheses

H49 is the next free number; H44 and H45 are registered but unpublished.

- **H49** — PA payer Provider Directory API census. Null hypothesis: all PA payers subject to CMS-9115-F publish a conformant, unauthenticated Provider Directory API supporting NPI search.
- **H50** — Cross-source agreement for PA providers. Null hypothesis: where two sources describe the same NPI, they agree on practice address and phone.
- **H51** — Presence gap. Null hypothesis: the set of NPIs in PA payer networks is a subset of the NDH's PA practitioners.

Each registers in `findings.ts` before numbers exist, per the standing workflow.

## Cost controls

Harvesting is HTTP, not BigQuery, so the dominant marginal cost is storage and the crosswalk joins. Every BQ query uses `bq_job_config()` / `DEFAULT_MAX_BYTES_BILLED`. New tables are clustered on `_npi` because that is the only column the crosswalk filters on; an unclustered table here would full-scan on every join. Portal pages are static, so serving cost is zero.

## Risks

- **A payer changes its API.** Mitigated by the census being re-runnable and by pinning capability results per harvest date, so a capability regression is itself a finding.
- **Normalization overreach.** Aggressive address normalization can manufacture agreement that is not there. Report exact and normalized match separately so the effect is visible.
- **Directory scope confusion.** A payer directory is network-scoped. A provider absent from one payer's directory is not absent from practice. Every published number must name the denominator, per standing convention.
- **Legal posture drift.** The rule is: mandated-public APIs and open bulk files only. If a future source requires evading a bot manager or ignoring robots.txt, it is out of scope by policy, not by convenience.
