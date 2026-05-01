# State of Virginia briefing — provider directory data quality

**Meeting:** 2026-05-04
**Convener:** AINPI (Eugene Vestel, FHIR-IQ)
**Audience:** Virginia Department of Medical Assistance Services (DMAS), Cardinal Care program integrity
**AINPI methodology version:** 0.5.0-draft
**NDH release pinned:** 2026-04-09 CMS National Provider Directory bulk export

---

## TL;DR

Of **141,660 Virginia-resident practitioners** in the federal NDH bulk export:

- **125 are federally excluded today** (active OIG LEIE or SAM.gov listing) and still appear in the directory — direct 42 CFR § 455.436 flags
- **4,657 are NPPES-deactivated** but still listed in NDH — secondary § 455.436 flags
- **42.5% of Virginia organizations are NPI duplicates** (35,348 excess of 83,163) — directory-quality concern
- **4 of those 125 federally excluded providers are listed in Cigna's public Practitioner directory today** — H26 methodology demonstration; the substantive VA-Medicaid version (Anthem HealthKeepers Plus, Aetna BH of VA, UHC Community Plan) is Stage B work

Every NPI cited in this briefing can be independently verified at:

- LEIE: <https://exclusions.oig.hhs.gov/>
- SAM.gov: <https://sam.gov/search/?index=ex>
- NPPES: <https://npiregistry.cms.hhs.gov/provider-view/{NPI}>

---

## 1. The regulatory frame: 42 CFR § 455.436

State Medicaid agencies are required to perform monthly federal database checks against:

| Database | Source | AINPI coverage |
| --- | --- | --- |
| **NPPES** | CMS, free public API | ✅ H10 — VA NPPES match rate 99.39%; 4,657 NPPES-deactivated-but-listed |
| **OIG LEIE** | HHS OIG, free CSV | ✅ H24 — joined to NDH practitioner._npi; weekly refresh in CI |
| **SAM.gov** | GSA Public Extract V2 | ✅ H25 — joined; HHS slice overlaps LEIE, OPM slice is net-new |
| **SSA Death Master File** | SSA, certification required | ❌ Out of scope — restricted access (42 USC § 1306c, Section 1110 certification) |

AINPI covers **3 of 4** federal database checks. The SSA-DMF leg is procurement-blocked at every state.

Reproducible against any release tag: `https://github.com/FHIR-IQ/AINPI/releases`. Citation: see `CITATION.cff`.

---

## 2. Virginia-specific data quality (live numbers)

Source: <https://ainpi.dev/states/va> (`/api/v1/states/va.json`)

| Resource | Count |
| --- | ---: |
| Practitioner | 141,660 |
| Organization | 83,163 |
| Location | 84,640 |

### NPI + taxonomy correctness (H10–H13)

- **140,794 of 141,660 (99.3887%)** Virginia practitioner NPIs match an active NPPES record
- **866 NPIs** are in NDH but missing from NPPES — potential ghost providers worth a sampled audit
- **4,657 NPPES-deactivated** providers are still listed in NDH — direct § 455.436 flag

### Organization duplicates (H14–H15)

- **83,163 Organization resources** in NDH for Virginia
- **47,815 unique NPIs** carry those resources
- **35,348 excess records (42.5045%)** — averaging 1.74 NDH records per real organization

### Temporal staleness (H18)

- **309,463 of 309,463 (100%)** VA-resident resources carry the release-day `meta.lastUpdated` — no internal staleness within the bulk

---

## 3. The federally excluded VA cohort (125 NPIs)

Source: `/api/v1/states/va-cohort-critical.csv` (downloadable, 125 rows with verification URLs)

Composite high-risk score breakdown (score >= 1.5 threshold):

| Reason combination | Count | Score | Share |
| --- | ---: | --- | ---: |
| `oig_excluded + sam_excluded` | 56 | 3.0 | 44.8% |
| `oig_excluded` only | 53 | 1.5 | 42.4% |
| `oig_excluded + sam_excluded + nppes_deactivated` | 13 | 3.8 | 10.4% |
| `oig_excluded + nppes_deactivated` | 2 | 2.3 | 1.6% |
| `sam_excluded + nppes_deactivated` | 1 | 2.3 | 0.8% |

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

Cross-referenced the 125 VA federally-excluded NPIs against 2 publicly-queryable payer FHIR provider directories:

| Payer | Search method | Queried | Matched |
| --- | --- | ---: | ---: |
| Humana | `?identifier=NPI` direct | 125 | 0 |
| Cigna | `?family=&given=` + post-filter | 125 | **4** |

The 4 Cigna matches (each NPI-confirmed via the Bundle's `identifier[]` array under `http://hl7.org/fhir/sid/us-npi`):

- 1710496161 — BURKHEAD, JASON (LEIE-excluded)
- 1750462008 — JACOBSEN, DANIEL (LEIE-excluded)
- 1801070313 — BREWER, STEVEN (LEIE-excluded)
- 1942523451 — WHATMOUGH, RACHELLE (LEIE-excluded)

Each is listed in Cigna's public Practitioner directory today. Cigna's directory aggregates commercial + Medicaid managed care lines.

**This is a methodology demonstration, not a comprehensive VA Medicaid MCO audit.** Neither Humana nor Cigna is a primary VA Medicaid carrier. The substantive cross-reference (Anthem HealthKeepers Plus, Aetna BH of VA, UHC Community Plan, Sentara, Molina, Virginia Premier) is Stage B work.

---

## 5. Stage B roadmap — what would close the substantive VA-Medicaid version

| Carrier | Status | What's needed |
| --- | --- | --- |
| Anthem HealthKeepers Plus (Anthem Medicaid in VA) | Endpoint discovered (Elevance TotalView `/registered/HealthKeepersInc/api/v1/fhir`) but auth-required | OAuth client registration via Elevance developer portal |
| Aetna Better Health of Virginia | Endpoint known but OAuth-required | Free dev account at developerportal.aetna.com + client credential |
| UHC Community Plan | Public URL drift; current URL DNS-fails | URL re-discovery via UHC interoperability page |
| Sentara Community Plan | API delayed per parent payer notice | Wait or reach out to Sentara |
| Molina Complete Care | Discovery not started | Probe public endpoints |
| Virginia Premier | Discovery not started | Probe public endpoints |

Estimated lift: ~half-day per carrier to register, store credentials in GitHub Actions secrets, and add a credentialed query path to the analysis pipeline. Then re-run H26 with the full 6-MCO denominator.

---

## 6. What DMAS can do tomorrow

1. **Pull the 125-NPI CSV** at <https://ainpi.dev/api/v1/states/va-cohort-critical.csv> — feed into the MMIS reconciliation queue.
2. **For each NPI**, run the 42 CFR § 455.436 verification triad (LEIE + SAM + NPPES) using the URLs in the CSV. Document the match in the provider's MMIS record per § 455.436(b)(1).
3. **For NPPES-deactivated providers** still appearing in NDH (4,657 statewide), evaluate whether they're contracted with any Cardinal Care MCO. If so, raise to the MCO under the directory accuracy provisions of § 438.602.
4. **Use the AINPI methodology** as one input in the DMAS response to the 2026-04-23 CMS State Medicaid Director letter on provider revalidation strategies — the framework is at <https://ainpi.dev/smd-revalidation>.

---

## 7. Citation language for DMAS use

> The Virginia Department of Medical Assistance Services has reviewed the AINPI framework (<https://github.com/FHIR-IQ/AINPI>, methodology version 0.5.0-draft, NDH release 2026-04-09) and is incorporating it as one of the inputs to a broader program-integrity strategy that includes monthly OIG LEIE and SAM.gov exclusion checks per 42 CFR § 455.436, MFCU coordination per 42 CFR § 1002, and managed-care directory oversight per 42 CFR § 438.602. The framework is independent, reproducible, and pinned to specific release tags for audit reproducibility.

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
A: Not yet. Stage B will, after we register OAuth clients with each parent payer's developer portal. ~half-day per carrier. The H26 finding is currently a methodology demonstration with Humana + Cigna only; it intentionally underclaims so we don't suggest coverage we don't have.

**Q: Who else is using this?**
A: AINPI is published at <https://ainpi.dev>, source at <https://github.com/FHIR-IQ/AINPI>. The repository is open. State Medicaid programs in Pennsylvania and Ohio are also catalogued (<https://ainpi.dev/states>) but Virginia has the most populated findings as of 2026-05-04.
