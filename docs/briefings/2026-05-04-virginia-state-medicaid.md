# State of Virginia briefing — provider directory data quality

**Meeting:** 2026-05-04 (briefing pinned to that meeting; numbers below refreshed for the 2026-05-08 NDH release on 2026-05-08)
**Convener:** AINPI (Eugene Vestel, FHIR-IQ)
**Audience:** Virginia Department of Medical Assistance Services (DMAS), Cardinal Care program integrity
**AINPI methodology version:** 0.6.0-draft
**NDH release pinned:** 2026-05-08 CMS National Provider Directory bulk export (April 2026-04-09 also archived)

---

## Urgent / critical findings

### H27 — Social Security Numbers exposed in the NDH bulk export

On **2026-04-30 the Washington Post reported** that the NDH bulk export AINPI ingests contains provider SSNs. CMS attributed the leak to "incorrect entries of provider or provider-representative-supplied information in the wrong places."

**AINPI independently verified and quantified this across both the April and May releases.** Scanning every Practitioner and Organization resource in `cms_npd` for the dashed SSN format `\d{3}-\d{2}-\d{4}`, after filtering international phone-format false positives:

| Release | Confirmed exposures | In qualification slot | In name.given | Org records |
| --- | ---: | ---: | ---: | ---: |
| 2026-04-09 (April) | 46 | 42 | 4 | 2 |
| 2026-05-08 (May) | **41** | 41 | 0 | 0 |

CMS partially scrubbed between releases (46 → 41) but did not eliminate. May per-state hot-spots: **IL 13, OH 6, AZ/CA/CO/MA/MN/NC/NY/OR/PA/PR/WA/WI 1 each** (Virginia is not directly affected in either release).

The detection regex is the dashed format only. Undashed 9-digit SSNs are out of scope (they collide with too many other 9-digit identifiers); true coverage is therefore a lower bound.

**This matters for the Virginia conversation even though no VA practitioners are flagged:**

1. It validates the AINPI methodology — we found the same exposure WaPo did, using the same public file, in BigQuery, in a single SQL pass.
2. It demonstrates that **directory-quality controls at the federal-publication step are missing today**. DMAS cannot rely on NDH as a clean upstream source without its own validation layer.
3. It strengthens the SMD-letter-response posture: AINPI provides the validation layer DMAS would otherwise need to build.

**Privacy posture:** AINPI publishes counts, JSON locations, NPIs (professional IDs), and state breakdowns. The SSN values themselves are not republished in our finding output, even though they remain in the public NDH bulk file CMS distributed. Remediation belongs to CMS NDH operations.

Source: <https://ainpi.dev/findings/pii-exposure-ndh> · <https://ainpi.dev/api/v1/findings/pii-exposure-ndh.json>

Original reporting: [Washington Post, 2026-04-30](https://www.washingtonpost.com/health/2026/04/30/medicare-portal-social-security-numbers-exposed/) · [Becker's Hospital Review summary](https://www.beckershospitalreview.com/quality/hospital-physician-relationships/cms-medicare-provider-directory-released-social-security-numbers-washington-post/)

---

## TL;DR

Of **130,127 Virginia-resident practitioners** in the May 2026-05-08 federal NDH bulk export (down from 141,660 in April after CMS dedup):

- **131 are federally excluded today** (active OIG LEIE or SAM.gov listing) and still appear in the directory — direct 42 CFR § 455.436 flags (was 125 in April)
- **4,090 are NPPES-deactivated** but still listed in NDH — secondary § 455.436 flags (was 4,657 in April)
- **40.80% of Virginia organizations are NPI duplicates** (27,458 excess of 67,291) — directory-quality concern (was 42.5% in April)
- **2 of those 131 are listed in Cigna's public Practitioner directory today; 0 in Humana's, 0 in UnitedHealthcare's, 0 in Molina Complete Care's** — across the 4 payer FHIR directories that publish unauthenticated NPI search (was 4 of 125 in April; movement is in the right direction). The substantive Anthem HealthKeepers Plus, Aetna BH of VA, Sentara, and Virginia Premier coverage is Stage B work

Every NPI cited in this briefing can be independently verified at:

- LEIE: <https://exclusions.oig.hhs.gov/>
- SAM.gov: <https://sam.gov/search/?index=ex>
- NPPES: <https://npiregistry.cms.hhs.gov/provider-view/{NPI}>

---

## 1. The regulatory frame: 42 CFR § 455.436

State Medicaid agencies are required to perform monthly federal database checks against:

| Database | Source | AINPI coverage |
| --- | --- | --- |
| **NPPES** | CMS, free public API | ✅ H10 — VA NPPES match rate 99.50% (May); 4,090 NPPES-deactivated-but-listed |
| **OIG LEIE** | HHS OIG, free CSV | ✅ H24 — joined to NDH practitioner._npi; weekly refresh in CI |
| **SAM.gov** | GSA Public Extract V2 | ✅ H25 — joined; HHS slice overlaps LEIE, OPM slice is net-new |
| **SSA Death Master File** | SSA, certification required | ❌ Out of scope — restricted access (42 USC § 1306c, Section 1110 certification) |

AINPI covers **3 of 4** federal database checks. The SSA-DMF leg is procurement-blocked at every state.

Reproducible against any release tag: `https://github.com/FHIR-IQ/AINPI/releases`. Citation: see `CITATION.cff`.

---

## 2. Virginia-specific data quality (live numbers)

Source: <https://ainpi.dev/states/va> (`/api/v1/states/va.json`)

| Resource | April 2026-04-09 | May 2026-05-08 |
| --- | ---: | ---: |
| Practitioner | 141,660 | **130,127** |
| Organization | 83,163 | **67,291** |
| Location | 84,640 | **34,157** |

### NPI + taxonomy correctness (H10–H13)

- **129,470 of 130,127 (99.4951%)** Virginia practitioner NPIs match an active NPPES record (May)
- **657 NPIs** are in NDH but missing from NPPES — potential ghost providers worth a sampled audit (was 866 in April)
- **4,090 NPPES-deactivated** providers are still listed in NDH — direct § 455.436 flag (was 4,657 in April)

### Organization duplicates (H14–H15)

- **67,291 Organization resources** in NDH for Virginia
- **39,833 unique NPIs** carry those resources
- **27,458 excess records (40.8049%)** — averaging 1.69 NDH records per real organization (was 1.74 in April)

### Temporal staleness (H18)

- **231,575 of 231,575 (100%)** VA-resident resources carry the release-day `meta.lastUpdated` — no internal staleness within the bulk

---

## 3. The federally excluded VA cohort (131 NPIs in May 2026-05-08)

Source: `/api/v1/states/va-cohort-critical.csv` (downloadable, 131 rows with verification URLs)

Composite high-risk score breakdown (score >= 1.5 threshold), May 2026-05-08:

| Reason combination | Count | Score | Share |
| --- | ---: | --- | ---: |
| `oig_excluded + sam_excluded` | 64 | 3.0 | 48.85% |
| `oig_excluded` only | 50 | 1.5 | 38.17% |
| `nppes_deactivated + oig_excluded + sam_excluded` | 14 | 3.8 | 10.69% |
| `nppes_deactivated + oig_excluded` | 1 | 2.3 | 0.76% |
| `nppes_deactivated + sam_excluded` | 1 | 2.3 | 0.76% |
| `sam_excluded` only | 1 | 1.5 | 0.76% |

### Verification samples — the 10 highest-scoring NPIs

Each is triple-flagged (OIG LEIE active + SAM.gov active + NPPES deactivated). State PI staff can verify each in the three federal portals listed above.

| NPI | Name (cohort export) | Score | Reasons |
| --- | --- | ---: | --- |
| 1013125830 | ARONSOHN, MICHAEL | 3.8 | oig + sam + nppes_deactivated |
| 1013136605 | VELURI, RAVI | 3.8 | oig + sam + nppes_deactivated |
| 1083627376 | COWLING, LAWRENCE | 3.8 | oig + sam + nppes_deactivated |
| 1184683120 | MADDEN, WILLIS | 3.8 | oig + sam + nppes_deactivated |
| 1194927277 | HONEYCUTT, SHARON | 3.8 | oig + sam + nppes_deactivated |
| 1265531388 | PUJOL, JACKIE | 3.8 | oig + sam + nppes_deactivated |
| 1487766077 | PARKES, ALVIN | 3.8 | oig + sam + nppes_deactivated |
| 1548272495 | FASANO, ANTHONY | 3.8 | oig + sam + nppes_deactivated |
| 1558315341 | ELLISON, WALDO | 3.8 | oig + sam + nppes_deactivated |
| 1619056124 | MORGAN, DAVID | 3.8 | oig + sam + nppes_deactivated |

**Each match is a data-quality and triage flag, not a fraud determination.** Investigation, hearing rights, and reinstatement claims belong to the excluding agency (OIG / agency-specific debarring official) and to DMAS.

---

## 4. Payer directory exposure — H26 methodology demonstration

Source: <https://ainpi.dev/findings/mco-exposure-va>

Cross-referenced the 131 VA federally-excluded NPIs (May 2026-05-08) against 4 publicly-queryable payer FHIR provider directories:

| Payer | Endpoint | Search method | Queried | Matched (May) | Matched (April) |
| --- | --- | --- | ---: | ---: | ---: |
| Humana | `https://fhir.humana.com/api` | `?identifier=NPI` | 131 | 0 | 0 |
| Cigna | `https://fhir.cigna.com/ProviderDirectory/v1` | `?family=&given=` + post-filter | 131 | **2** | 4 |
| UnitedHealthcare | `https://flex.optum.com/fhirpublic/R4` (Optum FLEX, covers UHC commercial + UHC Community Plan + OptumRx) | `?identifier=NPI` | 131 | 0 | 0 |
| Molina Complete Care | `https://api.interop.molinahealthcare.com/providerdirectory` (Azure APIM gateway → Sapphire360 backend) | `?identifier=NPI` | 131 | 0 | 0 |

The 2 May Cigna matches (each NPI-confirmed via the Bundle's `identifier[]` array):

- 1710496161 — BURKHEAD, JASON (LEIE-excluded)
- 1801070313 — BREWER, STEVEN (LEIE-excluded)

Each is listed in Cigna's public Practitioner directory as of 2026-05-08. Cigna's directory aggregates commercial + Medicaid managed care lines. Two NPIs that matched in April (JACOBSEN, WHATMOUGH) are no longer surfaced in May — movement is in the right direction; the floor is not zero.

**Three of those four zeroes are themselves meaningful negatives:**

- **UHC** serves a consolidated tree across UHC commercial + UHC Medicare Advantage + **UHC Community Plan (Medicaid)** + OptumRx in ~1,400 InsurancePlans. None of the 125 appear there.
- **Molina** is one of the six VA Medicaid MCOs DMAS contracts with directly. None of the 125 appear in their public directory either.
- **Humana** is a multi-line carrier (commercial + MA + small Medicaid presence). None.

So as of 2026-05-08, the only public payer-directory exposure surface in our 4-carrier sweep is **Cigna's 2 NPIs**, down from 4 in the April release.

**This still under-covers the VA Medicaid landscape.** Anthem HealthKeepers Plus (the largest Cardinal Care MCO), Aetna BH of VA, Sentara Community Plan, and Virginia Premier remain Stage B work. Anthem's public Medicaid endpoint at `cms_mandate/mcd/` exists but returns HTTP 500 on every Practitioner query as of 2026-05-08 (Elevance server bug).

---

## 5. Stage B roadmap — what would close the substantive VA-Medicaid version

| Carrier | Status | What's needed |
| --- | --- | --- |
| Anthem HealthKeepers Plus (Anthem Medicaid in VA) | Public PDex endpoint exists at `https://totalview.healthos.elevancehealth.com/resources/unregistered/api/v1/fhir/cms_mandate/mcd/` but returns HTTP 500 on every Practitioner query (Elevance server bug, still failing 2026-05-08). Authenticated brand endpoints exist at `/resources/registered/HealthKeepersInc/api/v1/fhir` but require OAuth. | Wait for Elevance to fix the 500s, or register OAuth client. Search must use `family/given/name` per their CapabilityStatement (no `identifier` support); name+filter path like Cigna |
| Aetna Better Health of Virginia | Endpoint known but OAuth-required | Free dev account at developerportal.aetna.com + client credential |
| UHC Community Plan | **Now covered** via the consolidated Optum FLEX endpoint (`https://flex.optum.com/fhirpublic/R4`); 0 of 131 matched in May | — |
| Molina Complete Care | **Now covered** via Azure APIM gateway (`https://api.interop.molinahealthcare.com/providerdirectory`); 0 of 131 matched in May. Dev-portal registration was needed to discover the gateway URL but the gateway itself accepts unauthenticated FHIR queries | — |
| Sentara Community Plan | API delayed per parent payer notice | Wait or reach out to Sentara |
| Virginia Premier | Discovery not started | Probe public endpoints |

Estimated lift: ~half-day per carrier to register, store credentials in GitHub Actions secrets, and add a credentialed query path to the analysis pipeline. Then re-run H26 with the full 6-MCO denominator.

---

## 6. What DMAS can do tomorrow

1. **Pull the 131-NPI CSV** at <https://ainpi.dev/api/v1/states/va-cohort-critical.csv> — feed into the MMIS reconciliation queue.
2. **For each NPI**, run the 42 CFR § 455.436 verification triad (LEIE + SAM + NPPES) using the URLs in the CSV. Document the match in the provider's MMIS record per § 455.436(b)(1).
3. **For NPPES-deactivated providers** still appearing in NDH (4,090 statewide in May, down from 4,657 in April), evaluate whether they're contracted with any Cardinal Care MCO. If so, raise to the MCO under the directory accuracy provisions of § 438.602.
4. **Use the AINPI methodology** as one input in the DMAS response to the 2026-04-23 CMS State Medicaid Director letter on provider revalidation strategies — the framework is at <https://ainpi.dev/smd-revalidation>.

---

## 6b. Coming next — claims-side cross-audit (Phase 1, June 2026)

Virginia is the Phase 1 pilot state for the AINPI × public claims data cross-audit (pre-registered 2026-05-14; roadmap at <https://ainpi.dev/smd-revalidation/cross-audit-roadmap>). The first deliverable joins this same 131-NPI cohort against the HHS Medicaid Provider Spending dataset (2018–2024, NPI-keyed, public) and answers: **which of these federally excluded providers were paid by Virginia Medicaid, when, and for what.**

What DMAS can expect:

- **`/api/v1/states/va/h29-excluded-paid.csv`** in June 2026 — one row per excluded NPI paid by VA Medicaid, with `paid_amount_post_exclusion`, `claim_count_post_exclusion`, `top_hcpcs_codes`, and the directory-side context (entity type, NPPES status, NDH active flag, exclusion source + date) anchoring the spending headline.
- **DMAS gets a 5-business-day review courtesy** on the VA-attributed rows before each refresh publishes. This is a pilot-relationship operational courtesy; it doesn't gate publication of the aggregate VA number.
- **`/api/v1/states/va/h31-deactivated-paid.csv`** — same join shape against NPPES-deactivated providers (statewide ~4,090 today).
- **`/api/v1/states/va/h35-nh-ownership-flags.csv`** — nursing-home, hospice, home-health facilities operating in VA whose listed owners appear on federal exclusion lists.

The pre-registration is itself an Element 2 deliverable today: DMAS can cite the forthcoming claims-side metrics as "public-facing data or reporting" in its SMD response, with the methodology pinned at <https://ainpi.dev/findings/excluded-paid-by-medicaid> (pre-registered) and the per-row schema at <https://ainpi.dev/smd-revalidation/cross-audit-roadmap#10b-virginia-pilot-scope-decided-2026-05-14>.

---

## 7. Citation language for DMAS use

> The Virginia Department of Medical Assistance Services has reviewed the AINPI framework (<https://github.com/FHIR-IQ/AINPI>, methodology version 0.6.0-draft, NDH release 2026-05-08) and is incorporating it as one of the inputs to a broader program-integrity strategy that includes monthly OIG LEIE and SAM.gov exclusion checks per 42 CFR § 455.436, MFCU coordination per 42 CFR § 1002, and managed-care directory oversight per 42 CFR § 438.602. The framework is independent, reproducible, and pinned to specific release tags for audit reproducibility.

For Zotero / EndNote import: <https://github.com/FHIR-IQ/AINPI/blob/main/CITATION.cff>

For a permanent reference, pin to the latest release tag: <https://github.com/FHIR-IQ/AINPI/releases>.

---

## 8. Live URLs

| Page | URL |
| --- | --- |
| Virginia state findings | <https://ainpi.dev/states/va> |
| H26 MCO exposure finding | <https://ainpi.dev/findings/mco-exposure-va> |
| AINPI methodology | <https://ainpi.dev/methodology> |
| § 455.436 framework | <https://ainpi.dev/smd-revalidation> |
| All findings index | <https://ainpi.dev/findings> |
| Public stats counter | <https://ainpi.dev/api/v1/stats.json> |

| Data | URL |
| --- | --- |
| VA findings JSON | <https://ainpi.dev/api/v1/states/va.json> |
| VA cohort CSV (125 NPIs) | <https://ainpi.dev/api/v1/states/va-cohort-critical.csv> |
| VA briefing summary JSON | <https://ainpi.dev/api/v1/states/va-briefing-summary.json> |
| H26 finding | <https://ainpi.dev/api/v1/findings/mco-exposure-va.json> |
| H26 detail (samples) | <https://ainpi.dev/api/v1/findings/mco-exposure-va-detail.json> |
| H23 cohort export CSV | <https://ainpi.dev/api/v1/findings/high-risk-cohort-export.csv> |

---

## 9. Anticipated Q&A

**Q: How can we verify these federally excluded providers are actually still listed?**
A: Each NPI in the CSV links to NPPES Registry, the LEIE search portal, and SAM.gov search. Pull a sample of 5–10 and cross-check.

**Q: Are these fraud determinations?**
A: No. Each match is a data-quality and triage flag. Investigation, hearing rights, and reinstatement claims belong to the excluding agency and DMAS.

**Q: How fresh is the LEIE / SAM data?**
A: Both are refreshed weekly by the AINPI weekly-refresh GitHub Action. LEIE pulls UPDATED.csv from oig.hhs.gov/exclusions/downloadables. SAM pulls the V2 monthly extract.

**Q: What's the difference between the LEIE finding (H24) and the SAM finding (H25)?**
A: SAM aggregates HHS LEIE + OPM FEHBP debarment + DOJ + EPA + others into one feed. The HHS slice substantially overlaps LEIE. The OPM slice (FEHBP debarment under 5 USC 8902a) is **net-new federal-screening signal not visible from LEIE alone** — that's where the value is.

**Q: Can we use this in our SMD-letter response?**
A: Yes — the framework is pinnable to release tags for audit reproducibility, and the citation language above is ready to paste. <https://ainpi.dev/smd-revalidation> is the methodology landing page mapped to the 5 elements of the SMD letter.

**Q: What about the Anthem HealthKeepers Plus, Aetna BH of VA, and UHC Community Plan providers — does AINPI cover them too?**
A: Two of six are covered as of 2026-05-02:

- **UHC Community Plan**: covered via Optum's consolidated public FHIR endpoint (`https://flex.optum.com/fhirpublic/R4` — covers UHC commercial + UHC Community Plan + OptumRx in one tree of ~1,400 InsurancePlans). 0 of 125 federally excluded VA NPIs matched.
- **Molina Complete Care**: covered via the Azure APIM gateway (`https://api.interop.molinahealthcare.com/providerdirectory`, Sapphire360 backend, no auth required despite the registration-gated dev portal). 0 of 125 matched.

The remaining four:

- **Anthem HealthKeepers Plus** (largest VA Medicaid MCO): public endpoint exists at `cms_mandate/mcd/` but returns HTTP 500 on every Practitioner query (Elevance server bug, 2026-05-02).
- **Aetna BH of VA**: requires OAuth at developerportal.aetna.com.
- **Sentara Community Plan / Virginia Premier**: no public endpoint discovered.

Stage B closes the remaining gaps.

**Q: Who else is using this?**
A: AINPI is published at <https://ainpi.dev>, source at <https://github.com/FHIR-IQ/AINPI>. The repository is open. State Medicaid programs in Pennsylvania and Ohio are also catalogued (<https://ainpi.dev/states>) but Virginia has the most populated findings as of 2026-05-04.
