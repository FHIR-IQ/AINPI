# AINPI × Public Claims Data — Cross-Audit Plan

**Author:** Eugene Vestel (FHIR-IQ) · **Status:** Draft v0.1 · **Date:** 2026-05-14
**Scope:** Adding a claims-side audit layer to AINPI's directory-side findings, using only publicly downloadable, NPI-keyed datasets.

---

## 1. Why now

AINPI today is a directory audit. It joins the CMS National Provider Directory bulk export against three federal exclusion sources (OIG LEIE, SAM.gov, NPPES) and against a handful of payer FHIR provider directories. That work produces useful findings — H23 (the 8,115-NPI high-risk cohort), H24/H25 (LEIE and SAM exposures in NDH), H26 (payer-directory exposure), H27 (SSN exposure). But every one of these findings answers the same question: *who appears in the directory who shouldn't.* None of them answer: *who got paid.*

Three things changed in the last 90 days that make the claims-side audit possible without paying for restricted data:

1. **HHS published the Medicaid Provider Spending dataset** (2026-02-14, opendata.hhs.gov/datasets/medicaid-provider-spending). NPI-keyed, fee-for-service and managed care, 2018–2024, all 50 states + DC + territories. This is the first time provider-level Medicaid spending is publicly downloadable.
2. **Medicare Provider Utilization & Payment Data (Part B and Part D)** continues annual publication at NPI granularity on data.cms.gov.
3. **CMS Open Payments, Nursing Home Compare ownership data, and the Provider of Services file** are all publicly downloadable and NPI/CCN-joinable.

The audit-side question — *is the federal directory exposing or protecting state and consumer interests?* — gets sharper when the question becomes: *and what got paid against those directory records.*

The 2026-04-23 CMS State Medicaid Director letter explicitly asks states for "metrics to measure effectiveness and progress — *including links to any public-facing data or reporting*." Claims-side cross-audit is precisely the public-facing metric that strengthens a state's SMD response posture.

---

## 2. Inventory: what is actually public and NPI-keyed

Honest inventory matters here. "Medicaid claims data" is mostly *not* public at provider level. What follows is the subset that is.

### 2.1 Provider-NPI granular, publicly downloadable

| Dataset | Source | Cadence | Key fields | Join key |
| --- | --- | --- | --- | --- |
| **Medicaid Provider Spending** | opendata.hhs.gov | One-time release covering 2018–2024 (cadence TBD) | Billing NPI, Servicing NPI, HCPCS, month/year, beneficiaries, procedure count, paid amount | Billing NPI + Servicing NPI |
| **Medicare Physician & Other Practitioners — by Provider and Service** | data.cms.gov | Annual (latest: CY 2023) | NPI, HCPCS, place of service, service count, beneficiary count, allowed/payment amount | NPI |
| **Medicare Part D Prescribers — by Provider** | data.cms.gov | Annual | NPI, total claims, total drug cost, beneficiary count, opioid metrics | NPI |
| **CMS Open Payments (Sunshine Act)** | openpaymentsdata.cms.gov | Annual + quarterly refresh | Covered recipient NPI, manufacturer, payment type, amount, nature | NPI |
| **DMEPOS Supplier Directory** | data.cms.gov | Quarterly | NPI, supplier name, service area, accreditation | NPI |
| **Provider of Services (POS) File** | data.cms.gov | Quarterly | CCN, NPI, provider type, ownership, certification status | NPI + CCN |
| **Nursing Home Compare — Provider Information / Ownership** | data.cms.gov | Monthly | CCN, owner names, role, ownership percentage, dates | CCN → NPI cross-walk |
| **Hospice Compare / Home Health Compare** | data.cms.gov | Quarterly | CCN, provider details, ownership in some files | CCN → NPI cross-walk |
| **Medicare Inpatient/Outpatient Hospital Charge Data** | data.cms.gov | Annual | CCN, DRG/APC, charges, payments | CCN → NPI cross-walk |

### 2.2 Publicly downloadable, but aggregated above NPI

These get cited but aren't direct join targets:

- **T-MSIS Annual Reports** — state-aggregate Medicaid statistics, not provider-level.
- **Medicaid State Drug Utilization Data** — drug-by-state, no NPI.
- **HCUP-NIS / SID** — facility-aggregated.
- **State APCD public dashboards** — variable, mostly summary.

### 2.3 Out of scope (restricted access)

- **T-MSIS Analytic Files (TAF)** — requires DUA via ResDAC.
- **Medicare CCW research files** — DUA required.
- **CMS Preclusion List** — restricted to MA Part C and Part D plans.
- **SSA Death Master File (full)** — SSA § 1110 certification required.

These are out of scope for AINPI. State agencies that have procurement-cleared access to TAF or the Preclusion List can run their own joins; AINPI's contribution is what's verifiable from open data only.

---

## 3. Cross-audit matrix — where AINPI's existing keys hit claims data

The current AINPI universe has roughly 7.4M Practitioner NPIs and 2.0M Organization NPIs from the May NDH release, with these signals already attached:

- LEIE-excluded (H24) — 8,008 Practitioner + 998 Organization matches
- SAM-excluded (H25) — 3,765 active flags
- NPPES-deactivated — 260,551 NPIs
- NPPES-absent — 56,156 NPIs
- High-risk composite score ≥ 1.5 (H23) — 8,115 NPIs
- Luhn-fail — 2 NPIs

The cross-audit matrix asks: *what happens when each of these signals is joined to each public claims dataset?* Cells marked with a hypothesis number are the proposed findings in §4.

| AINPI signal | Medicaid Provider Spending | Medicare Part B | Medicare Part D | Open Payments | DMEPOS | POS | NH/Hospice/HH ownership |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LEIE-excluded | **H29** | **H30a** | **H30b** | **H32** | **H33** | low priority | **H35** |
| SAM-excluded | H29 | H30a | H30b | H32 | H33 | low priority | H35 |
| NPPES-deactivated | **H31** | H31 | H31 | informational | informational | **H34** | informational |
| High-risk cohort | low priority | informational | informational | informational | informational | informational | informational |
| Absent from NDH but billing | n/a | **H36** | informational | informational | informational | informational | informational |

---

## 4. Proposed findings (H29–H36)

Numbered to continue the existing AINPI catalog (H1–H28 are published). Each follows the existing pre-registration template: null hypothesis stated before data is queried, denominator pinned to a specific release tag of the source, methodology version recorded, results published as static JSON with `methodology_version`, `commit_sha`, `generated_at`.

### H29 — Federally excluded providers in the Medicaid Provider Spending dataset

**Null hypothesis:** Zero NPIs currently active on OIG LEIE or SAM.gov appear as Billing NPI or Servicing NPI in the HHS Medicaid Provider Spending dataset (2018–2024).

**Why it matters:** This is the loudest possible finding. It moves the question from "the directory contains excluded providers" (H24, H25) to "excluded providers were paid by Medicaid." Every match is a candidate § 455.436 audit referral for the state where the spending occurred. The fact that the HHS file aggregates fee-for-service and managed care means it catches MCO-side exposures that AINPI's H26 sweep currently misses because of authentication walls.

**Per-state slicing:** Each match attributes to a state via the underlying T-MSIS state code in the source file. State Medicaid PI units get a state-scoped CSV with NPI, exclusion source (LEIE/SAM), exclusion date, total Medicaid paid since exclusion, and verification URLs.

**Honest caveats (KFF policy watch, 2026-02-20):** Some "providers" in the HHS file are state or county health agencies, not individual practitioners. The matching logic filters these out via NPPES entity type. Some procedure codes encompass wide service ranges; aggregate spending totals are indicative, not diagnostic.

### H30 — Federally excluded providers in Medicare Part B (H30a) and Part D (H30b)

**Null hypothesis:** Zero currently-LEIE/SAM-excluded NPIs appear in the latest Medicare Physician & Other Practitioners file (CY 2023) or Medicare Part D Prescribers file.

**Why it matters:** Medicare is a separate program with separate enrollment, but LEIE exclusions bind across all federal programs (42 USC § 1320a-7). H30 cross-corroborates H29 and catches cases where a provider is excluded but still billing Medicare. Part D adds the prescribing dimension: an excluded prescriber writing reimbursed prescriptions.

### H31 — NPPES-deactivated providers with active billing across any public dataset

**Null hypothesis:** Zero NPPES-deactivated NPIs appear in Medicaid Provider Spending, Medicare Part B, or Medicare Part D for the calendar year matching or following the deactivation date.

**Why it matters:** NPPES deactivation should mean the provider is no longer in practice. Billing after deactivation is either a data quality problem (NPI reused or misattributed) or evidence of work being done under a closed identifier — both are state PI flags.

### H32 — Federally excluded NPIs receiving industry payments (Open Payments)

**Null hypothesis:** Zero LEIE/SAM-excluded NPIs appear as covered recipients in CMS Open Payments for the year of exclusion or later.

**Why it matters:** This is the consumer-facing angle. Pharmaceutical and device manufacturers report payments to physicians and teaching hospitals under the Sunshine Act. If a manufacturer is paying a federally excluded provider, that's an industry-side compliance gap worth surfacing. Open Payments is already public and individually searchable; AINPI's contribution is the systematic cross-join with exclusion lists, which has not been published.

### H33 — DMEPOS suppliers on federal exclusion lists

**Null hypothesis:** Zero NPIs in the current CMS DMEPOS Supplier Directory appear on LEIE or SAM exclusion lists.

**Why it matters:** DMEPOS has historically been the highest-fraud category in Medicare. CMS imposed moratoria in multiple states (most recently Florida, March 2026). Cross-checking the active supplier directory against exclusions is a direct state and federal PI signal.

### H34 — NPPES-deactivated providers active in Medicare Provider of Services file

**Null hypothesis:** Zero NPPES-deactivated NPIs appear in the current Medicare Provider of Services file as actively certified.

**Why it matters:** Internal CMS contradiction — POS says they're enrolled, NPPES says they're deactivated. This is a federal data quality finding that should never be true.

### H35 — Nursing Home, Hospice, and Home Health owners and operators on exclusion lists

**Null hypothesis:** Zero owners listed in CMS Nursing Home Compare ownership data, Hospice Compare, or Home Health Compare appear on LEIE or SAM exclusion lists.

**Why it matters:** Highest-impact finding for vulnerable populations. Nursing home ownership transparency was specifically expanded by the CMS Disclosure of Ownership and Additional Disclosable Parties Interim Final Rule (2023) precisely to surface concerning ownership structures. Cross-referencing this against federal exclusion lists is what the rule was designed to enable. State survey agencies have direct authority to act on matches. Consumer-facing search ("is the nursing home for my parent owned by someone with sanctions?") becomes possible.

### H36 — High-volume Medicare billers absent from NDH

**Null hypothesis:** The NDH is exhaustive — no NPI with material Medicare Part B billing in CY 2023 is missing from the May NDH bulk export.

**Why it matters:** Directory completeness gap. The NDH is meant to be the federal source of truth on provider identity. Material billers absent from NDH are a directory-side failure of the federal system, distinct from H10 (NPPES match rate) and worth surfacing.

---

## 5. Phased rollout

### Phase 1 — 4 to 6 weeks (June 2026)

- **H29** (LEIE/SAM × Medicaid Provider Spending) — single highest-impact finding, single new dataset to ingest.
- **H30a/b** (LEIE/SAM × Medicare Part B and Part D) — reuses existing exclusion infrastructure; new ingestion is straightforward CSV.
- **H33** (DMEPOS × exclusions) — small file, fast turnaround.

Deliverables: pre-registration PRs in the AINPI repo for each hypothesis, ingestion modules under `analysis/claims_sources/`, finding pages at `/findings/<slug>`, state-scoped CSV slices.

### Phase 2 — 6 to 12 weeks (July–August 2026)

- **H31** (NPPES-deactivated × any billing) — requires careful date-matching logic (deactivation date vs claim date).
- **H32** (Open Payments × exclusions) — annual file is large but join is straightforward.
- **H35** (Nursing Home / Hospice / Home Health ownership × exclusions) — most legally and ethically sensitive finding; requires the most careful pre-registration and the strongest disclaimer language.

### Phase 3 — 12+ weeks (Q4 2026)

- **H34** (POS × NPPES-deactivated) — internal CMS contradiction finding.
- **H36** (NDH completeness gap) — most computationally expensive (full join across NDH + Medicare Part B universes).
- Additional per-state worked examples surfaced as research deepens.

---

## 6. State Medicaid value

For each finding, the deliverable that matters to a state PI office is a per-state CSV with verification URLs:

- `/api/v1/states/<state>/h29-excluded-paid.csv` — every LEIE/SAM-excluded NPI that was paid by the state's Medicaid program during the exclusion period, with paid amounts and verification URLs.
- `/api/v1/states/<state>/h31-deactivated-paid.csv` — NPPES-deactivated NPIs with billing activity after deactivation.
- `/api/v1/states/<state>/h35-nh-ownership-flags.csv` — nursing facilities operating in the state with owners on federal exclusion lists.

These files feed directly into MMIS reconciliation, state survey agency referrals, and state Attorney General / MFCU coordination — the same workflow established for the existing 131-NPI Virginia cohort, extended to claims-side signals.

Citation language for state SMD responses will be updated on `/smd-revalidation` to explicitly reference the new findings as "metrics with public-facing data" for Element 2 of the strategy submission.

---

## 7. Consumer value

The audit shouldn't only serve state agencies. Three consumer-facing surfaces fall out of these findings:

- **"Was my provider paid by Medicaid while federally excluded?"** — searchable per-NPI page tied to H29.
- **"Who owns this nursing home?"** — searchable per-CCN page surfacing the ownership × exclusion cross-check from H35.
- **"Does my doctor have industry payment patterns?"** — searchable per-NPI page tied to H32, with appropriate framing (Open Payments is not by itself a red flag).

These pages live alongside the existing `/npd` search and inherit the same UX. Same data quality flags, same anti-fraud-determination disclaimers.

---

## 8. What this is not

Bright lines, written for the record before findings drop:

- **Not fraud determinations.** Every flag is a data quality and triage signal. Investigation, hearing rights, and program-integrity action belong to the relevant state and federal agencies.
- **Not republished PII.** The Medicaid Provider Spending file does not contain SSNs, dates of birth, or beneficiary identifiers; that stays out of AINPI by construction. The H27 pattern applies: count and locate, never republish.
- **Not derived from restricted data.** TAF, full DMF, and the Preclusion List are out of scope. AINPI's contribution is what's verifiable from public sources only.
- **Not state-comparative ranking.** T-MSIS data quality varies materially by state (CMS DQ Atlas lists six states with unusable total-spending data and 16 of high concern for CY 2024). State-aggregate comparisons require methodology that this plan does not propose. Findings are presented per-state, not ranked.
- **Not a No Surprises Act compliance check.** Different regulatory frame, different data, different scope.

---

## 9. Technical architecture

Reuse what exists:

- NPI as universal join key (already AINPI's primary identifier).
- BigQuery infrastructure (already hosting NDH ingestion).
- Static JSON publishing contract (already serving `/api/v1/findings/<slug>.json`).
- Pre-registration template (`docs/findings/<slug>.md` with null hypothesis before query).
- Weekly refresh GitHub Actions cron.

Add:

- `analysis/claims_sources/medicaid_provider_spending.py` — ingestion + state-attribution logic.
- `analysis/claims_sources/medicare_partb.py`, `medicare_partd.py`, `open_payments.py`, `dmepos.py`, `pos.py`, `nh_compare_ownership.py`.
- Per-hypothesis SQL under `sql/findings/h29-h36/`.
- `api/v1/states/<state>/claims-cross.json` rollup endpoint.
- Refresh cadence config keyed to each source's publication rhythm (annual for Medicare files, quarterly for DMEPOS/POS/NH Compare, monthly for some NH ownership fields, currently-unknown for the HHS Medicaid Provider Spending file — explicit `last_known_release` tracking).

---

## 10. Decisions resolved 2026-05-14

The roadmap was reviewed and three decisions locked in. The other two stay open as ongoing operational questions.

1. **Per-NPI publication policy for spending outliers — DECIDED: amount with context.** Aggregate paid amount per excluded NPI is published, and every row carries the AINPI directory-side priors the reader needs to interpret the number — exclusion source (LEIE / SAM / both), exclusion effective date, NPPES deactivation status, NDH active flag, entity type. The existing H1–H28 findings act as the context layer: an H29 row is presented next to what AINPI already knows about that NPI's directory record, so the spending headline is never read in isolation. This matters because the source file mixes individual practitioners, state and county health agencies, and high-volume entity-NPIs that bill across wide procedure ranges — without the directory-side context, a paid-amount ranking would over-index on the entity-NPIs that aren't comparable to individual practitioners in the first place.

2. **First worked example — DECIDED: Virginia.** Virginia is the most-developed of the per-state worked examples for the cross-audit. The first state-scoped CSV ships at `/api/v1/states/va/h29-excluded-paid.csv`; subsequent refreshes ship per-state CSVs for all 51 jurisdictions concurrently. No state is co-author or recipient of the work — every output is independent public-good research derived from public federal data.

3. **Methodology pre-registration template extension — still open.** Claims-side findings need additional fields on top of the directory-side template: source dataset version, attribution rules for billing vs servicing NPI, date-range scope, entity-type filter applied. To be addressed when the first ingestion module ships in June.

4. **Disclosure timing — DECIDED: publish when available and high confidence; no pre-publication notice gate.** Findings ship the moment the ingestion module finishes a clean run against a pinned source release and the result has been internally cross-checked against the directory-side priors. This matches the transparency posture of the existing AINPI findings (H1–H28). No state agency receives prior notice or has gating rights over publication.

5. **Funding pathway — still open.** Phase 1 is feasible inside current FHIR-IQ time. Phase 2 and Phase 3 likely benefit from state contract revenue (state PI engagements citing AINPI findings) or foundation funding (RWJF, Arnold Ventures have funded comparable transparency work).

---

## 10b. Virginia worked-example scope (decided 2026-05-14)

Virginia is the most-developed of the per-state worked examples. The existing infrastructure makes this the lowest-friction first publish:

- **131-NPI cohort already enumerated.** `/api/v1/states/va-cohort-critical.csv` contains every VA-resident NPI currently active on LEIE or SAM. H29 joins this exact set against the HHS Medicaid Provider Spending dataset filtered to VA — no separate cohort construction needed.
- **Same H23 verification-URL convention.** The VA-cohort CSV format and verification-URL pattern from H23 (LEIE / SAM / NPPES portal links) carries forward to H29. Any state PI team that already worked with the H23 file format reads the H29 file without learning a new shape.
- **All 51 jurisdictions ship concurrently.** The Virginia version is the first published example, not a private deliverable. Subsequent refresh cycles ship per-state CSVs for every US state + DC + 5 territories on the same release cadence.

### What Virginia includes in the first cross-audit publish

| Deliverable | URL | When |
| --- | --- | --- |
| `/api/v1/states/va/h29-excluded-paid.csv` | Public + MMIS-ready format | June 2026, shipped concurrently with the all-states refresh |
| Updated `/briefings/va` | Cross-audit story added | June 2026 |
| Updated `/states/va` | Element 2 cross-audit panel | June 2026 |
| Citation language update on `/smd-revalidation` | Element 2 references the live VA cross-audit CSV | June 2026 |

### Per-row schema for `/api/v1/states/va/h29-excluded-paid.csv`

Anchoring the spending headline in AINPI's directory-side priors per decision 1 above:

| Column | Source | Purpose |
| --- | --- | --- |
| `npi` | HHS Medicaid Provider Spending | Join key |
| `entity_type` | NPPES | 1 (individual) vs 2 (organization). Read entity-2 rows with care — high-volume entity-NPIs span wide procedure ranges. |
| `name` | NPPES | Display |
| `nppes_active` | NPPES | true / false / deactivated_date |
| `ndh_active` | `cms_npd.practitioner._active` (2026-05-08 release) | true / false |
| `exclusion_source` | OIG LEIE + SAM.gov | `leie` / `sam` / `leie+sam` |
| `exclusion_effective_date` | OIG LEIE EXCLDATE / SAM ActiveDate | When the exclusion took effect |
| `paid_amount_post_exclusion` | HHS spending file, filtered to month/year ≥ exclusion_effective_date | The headline number, in context |
| `claim_count_post_exclusion` | HHS spending file | Count for readers who want the lower-bound signal |
| `top_hcpcs_codes` | HHS spending file | Top 3 procedure codes by paid amount — surfaces the wide-range entity-NPI case |
| `leie_lookup_url` | derived | `https://exclusions.oig.hhs.gov/` |
| `sam_lookup_url` | derived | `https://sam.gov/search/?index=ex` |
| `nppes_lookup_url` | derived | `https://npiregistry.cms.hhs.gov/provider-view/<npi>` |

The `paid_amount_post_exclusion` column is the H29 headline. Every other column is the context the reader needs to decide whether the headline is load-bearing or whether the row is a non-individual entity that mixes a wide procedure range into one NPI.

### Governance

Every state's per-row CSV publishes concurrently with the all-states refresh. No state agency receives prior notice and no state agency has gating rights over publication. The verification-URL convention (LEIE / SAM / NPPES portal links on every row) means any reader can independently verify any single row against the primary federal sources in 30 seconds.

---

## 10c. Methodology updates shipped post-decisions

Tracks improvements adopted after the 2026-05-14 decisions, with the why and the result-shape effect.

| Date | Improvement | Effect |
| --- | --- | --- |
| 2026-05-14 | **#1: Strict post-exclusion attribution.** H23 cohort exporter carries per-NPI `leie_excldate`, `sam_active_date`, `nppes_deactivation_date`. H29/H30a/H30b/H32 reframed with strict-post-exclusion as the regulatory headline and full-window as a sidecar field. | H29 0/28 strict (was 28 full-window $8.5M); H30a 0/8 strict; H30b 0/10 strict; H32 198/350 strict ($167K vs $3.8M full-window). The strict number is what § 455.436 actually asks. |
| 2026-05-14 | **#2: H35 Stage B — NPI-keyed match via PPEF + facility-state demographic match.** Owner ASSOCIATE_ID → NPI resolved through the CMS Medicare Fee-For-Service Public Provider Enrollment File (PPEF, 2026-04-01, 2.47M individual NPIs). Resolved NPI checked against LEIE.NPI ∪ SAM.npi (Tier 1, confirmed). Demographic match now uses facility STATE (resolved via PPEF ENRLMT_ID) because owner-side STATE is structurally 100% empty for individual owners in the All Owners files (Tier 2, candidate). | 0 confirmed-NPI nationally — exclusion forces Medicare revocation, so only 25 of 8,619 LEIE∪SAM-active NPIs remain in PPEF and none of those 25 are listed as owners. 1,779 candidate-demographic nationally / 17 in VA. The v1 "0 demographic matches" finding was a structural null caused by joining on empty owner-state — Stage B corrects this. |

---

## 11. Sequencing against the May 23 SMD deadline

The SMD letter deadline is 2026-05-23 (9 days from this draft). Phase 1 findings ship after the deadline. Two ways to make this plan useful to states writing their SMD response right now:

- **Publish this plan itself** as `/smd-revalidation/cross-audit-roadmap` so state agencies citing AINPI can reference forthcoming claims-side metrics in their Element 2 submission ("public-facing data or reporting"). This commits AINPI publicly to Phase 1 delivery and gives states cover to cite ongoing methodology expansion.
- **Pre-register H29 specifically by 2026-05-22** with null hypothesis, denominator, and source release tag stated before query. The finding itself drops in June, but the pre-registration is itself a methodology artifact a state can cite.

Both are no-cost in this 9-day window and meaningfully strengthen state SMD responses that adopt AINPI as one input.

---

## 12. References

- AINPI methodology: <https://ainpi.dev/methodology>
- AINPI SMD revalidation brief: <https://ainpi.dev/smd-revalidation>
- AINPI findings index: <https://ainpi.dev/findings>
- HHS Medicaid Provider Spending dataset: <https://opendata.hhs.gov/datasets/medicaid-provider-spending/>
- KFF policy watch on the HHS release (2026-02-20): <https://www.kff.org/medicaid/what-newly-released-medicaid-data-do-and-dont-tell-us/>
- Medicare Physician & Other Practitioners — by Provider and Service: <https://data.cms.gov/provider-summary-by-type-of-service>
- Medicare Part D Prescribers — by Provider: <https://data.cms.gov/provider-summary-by-type-of-service>
- CMS Open Payments: <https://openpaymentsdata.cms.gov/>
- DMEPOS Supplier Directory: <https://data.cms.gov/provider-data/dataset/dmepos-supplier-directory>
- Provider of Services file: <https://data.cms.gov/provider-characteristics>
- Nursing Home Compare ownership data: <https://data.cms.gov/provider-data/dataset/ownership-of-nursing-homes>
- 42 CFR § 455.436: <https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-C/part-455/subpart-E/section-455.436>
- 2026-04-23 CMS SMD letter: <https://www.medicaid.gov/sites/default/files/2026-04/smd-provider-revalidation-strategy-2026-04-23.pdf>
