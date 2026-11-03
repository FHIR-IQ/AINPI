# Provider record portal and agent

**Date:** 2026-11-03 (revised the same day after review; see "Review applied")
**Status:** Design draft for owner review (nothing here is decided)
**Owner:** Eugene Vestel
**Related:** `frontend/src/app/api/provider-search/route.ts`, `frontend/src/lib/rate-limit.ts`, `frontend/src/lib/suppression.ts`, `frontend/src/lib/org-lookup.ts`, `docs/superpowers/specs/2026-11-03-ndh-quality-and-source-governance-design.md`

## Intent

A clinician, a practice manager or a plan's directory team enters an NPI, or a roster, and sees what each public source says about that provider: the National Provider Directory (NPD), NPPES, Medicare enrollment (PECOS, through the public CMS files), and the payer FHIR directories AINPI can query under their terms. Field by field, it shows agreement, disagreement, stale signals, where each value probably came from, and the owner of each record, with a link to where the record is fixed.

AINPI cannot fix source data and has no write access to any source. The portal makes disagreement visible and routes the provider to the record's owner. Phase 2 (provider-owned updates pushed to sources) is listed with the conditions it needs; none holds today.

**Nothing is built until a two-slide test shows pull.** Week 0 is a local script and two slides. Everything after that is conditional.

## Personas and PULL

Two personas are tested in parallel, because the regulatory duty sits with plans and the daily work sits with practices. Neither has shown pull yet.

**Persona A: the practice coordinator.** The credentialing coordinator or practice manager at a group of roughly 5 to 100 clinicians. This person answers each plan's directory attestation requests, keeps CAQH current, and takes the calls when a patient arrives at an address a directory still lists.

- **Project.** Keep the group's roster accurate across every plan directory the group is listed in, and answer each plan's verification request on time.
- **Unavoidable.** Weak today. The No Surprises Act puts the 90-day verification duty on plans and asks providers to submit updates. CMS-4214-P is proposed, not final, and its 90-day rule starts 2028-01-01. Nothing makes this person's need unavoidable in 2026 beyond the plans' existing requests.
- **List.** Each plan's provider portal; CAQH ProView re-attestation; NPPES updates through CMS Identity and Access (I&A); PECOS; spreadsheets; paid roster services. Plans already route many requests to one or two fan-out points (CAQH attestation, NPPES), which weakens the Limitation below. Which plans do this is not verified here and should be asked in the test.
- **Limitations.** No view shows what each plan's FHIR directory actually publishes, so a fix in one place can leave the error in others, and the coordinator cannot tell which upstream record a wrong value came from.

**Persona B: a plan's provider-data or directory-operations lead.** The person accountable for the plan's directory accuracy and for answering CMS on it.

- **Project.** Run the 90-day verification cycle and, if CMS-4214-P is finalized, the reconciliation of the plan's records against the NPD.
- **Unavoidable.** CMS-4214-P (Federal Register document 2026-21420, comments close 2026-12-15) proposes 90-day verification of every MA listing from 2028-01-01, names CMS data sources including the NPD as an accepted verification method for the 90-day cycle (not yet for the annual accuracy score), publishes plan accuracy scores from CY2029, and anticipates a process for plans to reconcile NPD data against their records. That is a dated driver, and the plan is the party with budget.
- **List.** Roster intake from groups, CAQH data, outbound verification calls, vendor directory-verification services.
- **Limitations.** To test, not assumed: whether a public, method-documented NPD-versus-NPPES-versus-plan diff adds anything to what they already buy.

**Two-slide test (week 0, before any build).** Slide 1 is one real roster's diff, produced by a local script for one consenting group (or, for persona B, the plan's own published FHIR directory against the NPD for a sample of its PA network). Slide 2 is the fix routing, with lineage. Show it to five coordinators and five plan contacts who are not existing contacts. Unpaid design partnerships are not pull. Pull is any of them asking to run their full roster or network, and the build below starts only then.

**Day-one retention action, observable.** The user downloads the worklist for their roster. The follow-up action is a re-run at day 7 that shows the NPPES change they made, because the NPPES registry API reflects updates well before the next NPD release (roughly quarterly). A fix-link click is counted (source and field, no NPI) but is not the retention signal, since a click is not a fix.

**Who pays (hypothesis for the slide test, not a decision).**

- Free: single-NPI lookups, anonymous, rate-limited.
- Paid, groups: saved roster monitoring with a scheduled re-check against NPPES and the reachable payers, and an alert when a field changes or a new disagreement appears.
- Paid, plans and vendors: bulk reconcile of a plan network against the NPD and NPPES per release, with the method and lineage labels, delivered as a file. This is the CMS-4214-P reconciliation use.
- No paid tier carries a payer's live directory response until that payer's terms have been read and allow it (see "Payer terms").

## Goals

1. One NPI in, one field-by-field comparison out, in under 10 seconds, with every source's reach status and lineage shown.
2. For each disagreement or stale signal: the record owner and a deep link to its update path.
3. Rosters run in the browser as a loop over single lookups, with a downloadable worklist.
4. Zero BigQuery on the live path in v1, and a marginal cost under a few dollars a month with hard caps.

## Non-goals

- Writing to any source in v1. No submission on a provider's behalf, no stored credentials.
- A login or account for single-NPI lookup.
- New per-NPI pages. Results are not URLs and are not crawlable as pages. (The v1 NDH extract is a published file like the existing per-NPI CSVs; see "Identity and privacy".)
- Scheduling availability (a later phase; API access and terms unverified).
- Scoring or ranking organizations on this page.
- A hosted model in v1.
- States other than the test state in v1.

## Anti-goals (this fails even if it runs)

- **A green mark on an empty read.** `provider-search` already returns `matched | not_found | error | skipped` per source. A source that timed out (Capital BlueCross returned 503 on every path on 2026-10-28) shows as "not reached", never as agreement. This is the silent-zero failure the quality spec guards against.
- **A green mark on a circular read.** The NPD draws largely on NPPES and PECOS, and payers may fill their directories from CAQH, NPPES or group rosters. NPD equal to NPPES is expected by lineage and says nothing about the real world: a stale NPPES address copied into the NPD shows up twice. Agreement is counted only across sources that are independent of each other or of unknown lineage. A value that matches its own upstream is labelled "consistent with its upstream (NPPES)", not "agrees".
- **A disagreement manufactured by comparing the wrong element.** Each NPD value is labelled with the FHIR element it came from (Practitioner physical address, PractitionerRole Location, Organization). An unpublished 2026-10-28 spot check overstated ZIP disagreement because only the practitioner address was compared; the FHI-84 billing-versus-physical address issue is the same trap.
- **A disagreement manufactured by comparing free text.** Organization names from three sources rarely match exactly. v1 shows affiliation side by side with no mark.
- **Calling an export artifact "stale".** NPD `meta.lastUpdated` is the export date, not a verification date. Release-to-release NPD changes are mostly the export changing (35.3% of 215,013 PA practitioners lost at least one phone between 2026-08-20 and 2026-10-07), so the portal never infers provider staleness from them.
- **A "correct value" AINPI cannot know.** The tool never proposes which value is right.
- **A suppressed NPI that renders.** See "Identity and privacy".

## First-principles choices

**Precompute the NDH side once per release, for one state.** The live comparison would otherwise need practitioner (clustered on `_npi`, cheap), practitioner_role (clustered on `_practitioner_id`, cheap), and then organization by `_id` and location by `_id`, neither of which is the cluster key, so each call scans columns of a 2M-row and a 2.5M-row table. That cost was never measured and is likely several times the $0.0002 first assumed. A per-release extract for the test state removes BigQuery from the live path. PA is about 225,413 active practitioners, small enough to ship.

The extract is built locally with DuckDB over the existing parquet export (`frontend/data/parquet-export/`), at no BigQuery cost: per practitioner NPI, the Practitioner physical address ZIP5, first line and phone, and for each active role the organization name and NPI, plus the role Location ZIP5, first line and phone, each labelled with its element. If the export is missing, the fallback is one capped BigQuery build under `bq_job_config()` (practitioner filtered on `_state` is not the cluster key, so a full column scan plus two joins; estimate about $0.15 per release, to measure with `--dry_run` before running).

It is published as gzip shards keyed by the last two digits of the NPI (100 shards, a few hundred KB each), and the route reads one shard per lookup from the CDN, the way `src/lib/org-lookup.ts` reads the H50/H51 CSVs: fetch the CDN URL, index in module scope with a 6-hour TTL, and treat a failed fetch as an error, never as "not found". It cannot be read from the filesystem inside the lambda, because `outputFileTracingExcludes` strips `public/api/v1/findings/**` and `public/api/v1/states/**`.

An NPI outside the test state shows the NDH column as "not available for this state in v1", never as missing.

**No URL per result.** A POST with the NPI in the body, `Cache-Control: no-store`, a `noindex` page.

**Do not refactor before pull.** `provider-search/route.ts` already holds the NPPES and payer fetchers. The week-0 script calls them as they are (or their public endpoints directly). Extracting adapters into `src/lib/sources/` happens only if the build goes ahead.

**The v1 explanation is deterministic.** The diff is structured, so the explanation is a template keyed by (field, source, disagreement type). It is cheap, testable and cannot invent facts. No hosted model.

**Per field, not per provider.** One score hides which record to fix. Marks are agree (independent sources), consistent with upstream, disagree, missing, not reached, not compared (side-by-side fields), not available (outside the test state).

**Pick payers from contracts, not from code.** The adapters that exist (Humana, UHC via Optum FLEX, Molina, Cigna) miss the regional plans most groups in a state contract with; in the 2026-10-28 demo, 95 of 500 random active PA practitioners with an NPD role were listed at Humana. v1 payers are chosen from the test group's actual contracts, and the page says plainly that most of a typical group's plans are not queried.

## Week 0 (the only committed work)

A local script (Python or TypeScript, offline apart from the free public APIs) that takes one consenting group's NPI list and produces slide 1:

- NDH values from the DuckDB extract.
- NPPES from the registry API (version 2.1), including `last_updated` and `certification_date`.
- CMS enrollment from the published `findings/pecos-org-crosswalk-pa.csv` (group PAC ID and legal name, practice address, specialty).
- The payers the group contracts with whose public FHIR directory can be queried by NPI, after reading their terms.
- The comparison rules below, with lineage labels.

Slide 2 is the routing table with lineage. No route, no page, no refactor, no deployment. Output stays local and is not committed.

## Build, only if the test shows pull

**Components and data flow.**

```text
browser (/my-record, noindex)
  ├─ roster: browser loop over single lookups (concurrency 2, per-key quota)
  └─ POST /api/provider-record {npi}
       ├─ enforceRateLimit(shape 'provider-record', own daily ceiling)   rate-limit.ts
       ├─ suppression check (suppressionScope)                            suppression.ts
       ├─ sources (parallel, 6 s timeout each, no retries)
       │    ndh            CDN shard of the per-release extract (test state only)
       │    nppes          npiregistry.cms.hhs.gov/api (version 2.1)
       │    cms-enrollment published PA crosswalk, CDN, module-scope index
       │    payers         only those cleared in the terms table; max 2
       │                   concurrent outbound calls per payer
       ├─ record-compare.ts (pure) → FieldComparison[]
       ├─ fix-routes.ts (static table) → owner, lineage, link, template
       └─ JSON response, Cache-Control: no-store
```

**Fields compared in v1.**

- Legal name.
- Taxonomy: all NPPES slots and the whole `qualification` array, never position 0.
- Practice address: ZIP5 plus normalized first line, against each NPD element with its label.
- Practice phone: normalized with the `phones_per_practitioner` rule (digits only, drop a leading 1, exactly 10).
- Active status.
- Organization affiliation: shown side by side (NDH role organization, CMS enrollment group, payer role organization), no mark. A mark is allowed only on an exact organization NPI or PAC ID match, never on a name.

**Payer matching.** A payer matched by NPI is the normal case. Cigna rejects NPI search (`Cigna does not support NPI search`, `provider-search/route.ts` line 435), so it needs NPPES first and then a name search post-filtered by NPI, a sequential step that risks the 10-second goal and misses common surnames. Cigna is out of v1 unless the test group contracts with it, and then it carries its own "name-matched, lower confidence" mark.

**Staleness signals that are real.** NPPES `last_updated`; NPPES `certification_date`, which is the provider's own attestation in NPPES and the closest thing to a native "verified" signal (the field was present on records returned by the registry API on 2026-11-03; that it means the attestation date is to be confirmed against CMS documentation before the page relies on it); NPPES deactivation; an NPD release date older than the NPPES update. The page shows the NPD release date (2026-10-07), which lags NPPES by design. The CMS revalidation due date is out of v1: it comes from CMS's separate Revalidation Due Date List, not the Doctors and Clinicians file, and would need its own adapter.

**Routing and lineage table (`src/data/fix-routes.ts`).**

| Record | Owner | Derives from | Update path | Status |
| --- | --- | --- | --- | --- |
| NPI data (name, taxonomy, practice location, phone) | NPPES | provider self-attestation | nppes.cms.hhs.gov through CMS I&A; an I&A surrogate can act for an organization. The provider's NPPES attestation (`certification_date`) is the native "I checked this" signal | Verified public path |
| Medicare enrollment (group reassignment, practice location, specialty) | PECOS | provider enrollment filings | pecos.cms.hhs.gov through I&A, or CMS-855 forms | Verified public path |
| Credentialing profile | CAQH | provider self-attestation | ProView re-attestation | Path verified; cadence and deep-link terms to confirm |
| Plan directory listing | each payer | unknown per payer (CAQH, roster, NPPES or own data); marked unknown until verified | the payer's provider update page or roster process | Collected per payer; links checked quarterly |
| NPD | CMS | largely NPPES and PECOS | none found | See below |

Agreement between two sources is counted only when neither derives from the other in this table. Unknown lineage counts as independent and is labelled unknown.

**NPD update path: not found.** As of 2026-11-03 no provider-facing update or correction path for the NPD was found: web searches returned none, and the directory.cms.gov root rendered only a title. NPD disagreements route to NPPES and PECOS, and the page says so. The owner can ask on the NPD community call whether a provider path is planned. CMS's CY2026 MA directory memo says plan FHIR directory APIs will feed Medicare Plan Finder for CY2027, which raises the stakes of the payer record.

**Payer terms (a second table in `fix-routes.ts`).** One row per payer: the URL of its developer or API terms, whether registration is required, commercial-use status, and the date checked. CMS-9115-F obliges the payer to make the directory API public and says nothing about reuse terms (the same gap noted for Capital BlueCross). As of 2026-11-03 no row has been read; every payer is "terms not yet read". Rules: no payer call in any paid tier until its row says commercial use is allowed; no payer call in a roster loop until its terms are read; Molina is dropped from v1 unless AINPI registers on its developer portal (CLAUDE.md records the gateway answering without auth despite a registration-gated portal, which is not permission).

**Draft text.** Per disagreeing row: what each source says, the target form's field name, and the update path. The draft is prefilled with the provider's own entry if they typed one; otherwise it lists the candidate values with no default. AINPI never proposes which value is correct. The provider copies the text; nothing is sent.

**Identity and privacy.** Every value is already public, and `/provider-search` already exposes single lookups, so they need no login. Rosters need a free issued key (`ApiKey`, tier `free`) because they multiply outbound calls and ease enumeration. Logs record counts, source status and latency, never the NPI.

Suppression uses `suppressionScope()`, not only `getSuppressedNpis()`. A full-scope row (basis `nppes`, `ainpi_files`, `manual`) removes the practitioner from every source in the response, and from the NDH extract and the enrollment crosswalk. An `unverified` row filters practitioner results only and never organization results (`getOrgSuppressedNpis()` holds full-scope rows only), so an organization NPI shown in the affiliation field is not removed because of an unverified row. The NDH extract is a published per-NPI file with an `npi` column, so `suppression.py --apply` and `--check` cover it like the other per-NPI CSVs, and the live check on every lookup covers rows recorded since the last apply. `/my-record` and the extract are added to the "Routes audited for practitioner rows" table in `CLAUDE.md` when built.

**HIPAA.** It does not apply to v1. Directory data is not PHI, and AINPI is neither a covered entity nor a business associate. Holding provider-entered attestations for plans (Phase 2, open decision 4) would change the contract posture (vendor agreements, state directory laws) even without PHI.

**Tests (Vitest, `record-compare.ts`).**

- Source error is "not reached"; one-sided value is "missing".
- Taxonomy matched across all slots and the whole array.
- Address compared against each NPD element with its label.
- Circular read: NPD and NPPES both carry the same stale address, the payer differs. Expected: "disagree, upstream NPPES", with NPD marked "consistent with its upstream", not two of three agreeing.
- Affiliation by name returns "not compared"; by exact organization NPI may return agree.
- NPI outside the test state returns NDH "not available".
- Suppression: a full-scope suppressed practitioner returns not found from every source; an unverified-scope practitioner is filtered from practitioner results; an organization NPI in the affiliation field is not filtered by an unverified row.

## Cost model

| Item | Real marginal cost |
| --- | --- |
| NDH extract build, once per release | $0 with DuckDB over the local parquet export; about $0.15 if built in BigQuery under the cap (estimate, to measure with `--dry_run`) |
| Extract hosting | CDN static files, inside the existing Vercel plan |
| Single NPI lookup | One CDN shard read, NPPES and payer calls (free), function time of a few seconds inside the plan. No BigQuery |
| Roster of 25 | 25 single lookups from the browser, no long-running function |
| Model calls | none in v1 |

**Expected v1 volume** (only after pull): 3,000 lookups a month costs nothing measurable beyond the existing plan. The per-release job is one local DuckDB run plus a commit, added to the release checklist that `ndh-release-watch.yml` opens. No Databricks spend is added.

**Hard caps.**

- `provider-record` gets its own `ROUTE_COST` entry and its own daily ceiling (for example 5,000 lookups a day across all callers), below the global 300,000-unit breaker, so a crawl of this route cannot exhaust the shared budget.
- Anonymous tier: the existing per-caller daily units.
- Free key: a per-key daily quota sized for a few rosters a day.
- Outbound: 6 s timeout, no retries, at most 2 concurrent calls per payer from the route, so Vercel's shared egress does not get the site WAF-blocked.
- Because v1 has no BigQuery on the live path, this route cannot trip the GCP $10 budget and its auto-disable function, which would take every BigQuery route on ainpi.dev down with it. Any later move to a live BigQuery lookup must measure the full query set with `--dry_run` first and keep its own ceiling.

**Build order (about one to two weeks, only after pull).**
1. Extract builder (DuckDB) and shards for the test state, covered by `suppression.py`.
2. `src/lib/record-compare.ts` with the fixtures above.
3. `src/data/fix-routes.ts` with lineage and payer terms rows.
4. `POST /api/provider-record`, new shape and ceiling in `rate-limit.ts`, `no-store`, `suppressionScope()`.
5. `/my-record` page (`noindex`, WIP banner, the `/find` "audit, not a live directory" notice, coverage statement), browser roster loop behind a key, CSV worklist built in the browser.
6. Fix-link click counter (source and field only).

## Later (each gated on a paying persona)

- **MCP tool `compare_npi_sources`.** Deferred until single-NPI use shows pull. It would call the same module under the same limiter and suppression, letting a provider's own assistant explain the diff at the provider's model cost.
- **Adapter refactor into `src/lib/sources/`.** When a second consumer needs the adapters.
- **More states, more payers, an organization-NPI view** reusing H50/H51 through `lookup_organization`.
- **Phase 2, bidirectional.** What would have to be true:
  1. *Identity bound to the NPI.* Proofing of the clinician or a group's authorized official, linked to the NPI. I&A credentials cannot be shared, so AINPI cannot use a provider's login.
  2. *Delegated authority.* For NPPES, CMS's Electronic File Interchange lets an approved organization submit updates on providers' behalf with their agreement (NPPES FAQ; Federal Register, 2007-05-30, 72 FR No. 103). AINPI would need EFI organization status. For PECOS no public write API was found.
  3. *A signed attestation record.* Dated, provider-confirmed values in an append-only log, published in a form plans can consume (FHIR R4 `VerificationResult`; check the NDH IG STU1 profiling). AINPI would then hold provider-entered data, with retention, revocation and audit duties it does not have today.
  4. *Receiving ends.* Payer roster intake APIs and terms; an NPD update path (none found).
  5. *Liability* for a wrong pushed value.
- **Phase 3:** scheduling availability from a scheduling platform as a practice-location signal, subject to API access and terms (unverified).

## Risks

- **Pull may sit with plans, or nowhere.** That is why both personas are tested before anything is built.
- **Payer terms may forbid commercial reuse**, which would remove payers from every paid tier and leave the paid offer as NDH, NPPES and enrollment only.
- **Payer endpoints are flaky.** Shown as "not reached"; three failing weeks mark a payer degraded.
- **Coverage is thin.** Most of a group's plans are not queryable by NPI; the page says so.
- **Lineage is partly unknown.** Payer lineage stays "unknown" until verified, so some agreement may still be circular.
- **False disagreements** from normalization (suites, phone formats, group versus individual taxonomy). Fixture tests per rule; the page shows raw values.
- **Deep links rot.** `fix-routes.ts` carries a `checked` date; a weekly link check fails CI, not the page.
- **NPPES registry API limits** are undocumented as far as found.
- **Scope creep.** No saved rosters, reminders or accounts in v1; those are the paid hypothesis.

## Open decisions for the owner

1. **Public rankings: named or anonymized.** (a) Name payers and health systems with measured rates and method: strongest pressure, invites dispute, needs corrections and a reply window. (b) Anonymize with self-lookup: lower risk, weaker signal. **Recommendation:** name payers at the directory level, because publishing a directory API is a regulatory obligation and AINPI already names payers in H26, with a published method and a 30-day reply window before first publication; show health systems through self-lookup until a per-system result clears a minimum sample. This page does not rank either way.
2. Whether the week-0 test runs for both personas, or persona B only (where the dated driver and the budget sit).
3. Which payers to read terms for first, and whether to register on the Molina portal or drop it.
4. Whether AINPI should ever hold provider-entered attestations, given the privacy, liability and contract posture change; and whether to pursue NPPES EFI organization status, the first concrete step toward Phase 2.
5. Whether a PA-only v1 is acceptable if the first consenting group is elsewhere (the extract is state-scoped; another state is one more local build).
6. The paid-tier shape and price points, after the slide test.
7. Route name (`/my-record` is a placeholder).

## Review applied (2026-11-03)

An expert review returned "ship with changes". Changes made:

- **Circular agreement (critical).** Added lineage to the routing table, counted agreement only across independent or unknown-lineage sources, added the "consistent with its upstream" mark and the circular-read anti-goal, removed the prefilled "correct value", and added the stale-NPD-and-NPPES fixture.
- **Weak pull (critical).** Two personas tested in parallel (practice coordinator and plan directory-ops lead, with CMS-4214-P's reconciliation process as the plan's dated driver). The day-one action is now a worklist download and a day-7 re-run against NPPES. Added a who-pays hypothesis.
- **Cost and the kill switch (major).** Removed BigQuery from the live path: the NDH side is a per-release DuckDB extract for the test state, served as CDN shards. The route gets its own daily ceiling below the global breaker.
- **Build before test (major).** Week 0 is now a local script and two slides; the build happens only on pull. Rosters are a browser loop over single lookups.
- **Third-party terms (major).** Added a payer terms table, kept payers out of paid tiers and roster loops until terms are read, dropped Molina unless registered, capped outbound concurrency at 2 per payer.
- **Cigna and coverage (major).** Cigna out of v1 unless the test group contracts with it, then marked "name-matched, lower confidence". Payers are picked from the group's contracts, and the page states coverage.
- **Suppression scope (minor).** Named `suppressionScope()` and `getOrgSuppressedNpis()`; added the three scope fixtures; the extract is covered by `suppression.py`.
- **Affiliation and revalidation (minor).** Affiliation is side by side with no mark except on exact organization NPI or PAC ID. Revalidation due date dropped from v1 and attributed to the Revalidation Due Date List.
- **HIPAA and NPPES attestation (minor).** Added the HIPAA line. Added NPPES `certification_date` as the native verified signal; it was present in the registry API response on 2026-11-03, and its meaning is still to be confirmed.
- **Function duration and model (minor).** No server-side roster endpoint; hosted model rewrite cut, so old open decision 2 is closed as "no".
- **Cut list.** Applied in full: hosted model rewrite, server-side roster endpoint, adapter refactor, prefilled correct value, name-based affiliation marks, Cigna by default, live BigQuery NDH lookup, Phase 1.5 and Phase 2 work all moved behind pull or a paying persona.

One tension resolved by choice: the review both cut the MCP tool and suggested it cover explanation. The tool is deferred until pull; v1 explanation is templates only.

No finding was rejected. The critique's facts were checked against the code: Cigna's NPI rejection is at `provider-search/route.ts` line 435, the breaker is 300,000 units in `rate-limit.ts`, `suppressionScope()` and `getOrgSuppressedNpis()` exist in `suppression.ts`, and the PA enrollment crosswalk is published. The review's examples of plans routing attestation to CAQH or NPPES were not verified and are not named here.

## Sources

- CMS-4214-P, Federal Register document 2026-21420 (comment period closes 2026-12-15).
- No Surprises Act provider directory requirements (Public Health Service Act section 2799A-5).
- CMS, CY2026 Technical Implementation Guide, MA provider directory memo, 2025-11-07: <https://www.cms.gov/files/document/cy2026-technical-implementation-guide-ma-provider-directory-memo-11072025-final-pdf.pdf>
- NPPES FAQ (EFI submissions on behalf of providers): <https://www.hhs.gov/guidance/sites/default/files/hhs-guidance-documents/CMS/NPPES-Frequently-Asked-Questions.010220_v2.pdf>
- NPI Registry API: <https://npiregistry.cms.hhs.gov/api-page>
