# Provider directory scorecard

**Date:** 2026-11-03
**Status:** Design draft, revised after review (see "Review applied (2026-11-03)"), for owner review
**Owner:** Eugene Vestel
**Related:** `2026-11-03-ndh-quality-and-source-governance-design.md` (rules, `dq_results`, `source_changes.yaml`), `measures.json`, `analysis/landscape.py`, `analysis/state_connectivity.py`, `provider-search/route.ts`, `rate-limit.ts`, `suppression.py`

## Intent

Nobody can tell today whether a directory listing is right. The National Provider Directory (NPD), NPPES, CMS enrollment, payer FHIR directories (CMS-9115-F) and EHR vendor endpoint files each publish alone. Nobody publishes where they agree.

The scorecard publishes that comparison as static files, once per source refresh. v1 is one page: a row for the NPD, a row for NPPES against CMS enrollment, and a row per wired payer, each with field breakdowns, as-of dates, intervals and n. It does not say which value is true. It says which sources agree, where they disagree, and who owns the record that has to change.

Maps, health-system pages, rankings and per-NPI marks come later, and only after the persona below confirms the problem.

## Persona and PULL

**Primary persona: the provider-data compliance lead at a Medicare Advantage plan** (title varies: provider data management, network operations, directory compliance).

| | Evidence | Verified? |
|---|---|---|
| **Project** | Keep the plan directory accurate and prove it. | Role exists across MA plans; no named individual has confirmed this project to AINPI. |
| **Unavoidable, today** | The CMS-4214-P comment deadline, 2026-12-15 (Federal Register 2026-21420). The proposal would require 90-day verification of every MA listing from 2028-01-01, accept NPD as a verification source for that cycle (not yet for the annual accuracy score), publish plan accuracy scores from CY2029, and anticipates a process for plans to reconcile NPD data against their records. Until a final rule, this is a reason to comment, not a compliance date. | Rule text verified as summarized; the final rule could change it. |
| **Unavoidable, other** | No Surprises Act section 116 (PHS Act 2799A-5) requires 90-day directory verification by group health plans and health insurance issuers. Whether and how it reaches MA organizations, whose directory duties sit in 42 CFR 422, needs legal confirmation. Many MA organizations also sell commercial products that it does cover. | Applicability to MA: unverified, needs legal confirmation. |
| **List** | Provider attestation outreach, roster files from groups, credentialing-organization portals, call-based audits. | Generic industry practice; not confirmed with a named buyer. |
| **Limitations** | A plan sees its own data. It cannot see how its listings compare with NPD, NPPES and enrollment for the same NPIs, or how other plans compare, before CMS scores it. | Inference. Unverified until the week 0 test. |

The near-term driver is therefore stronger for a comment than for a purchase. That shapes the sequence: the CMS-4214-P comment is the first deliverable, and it is the reason to talk to compliance leads before building.

**Day-one retention action:** the lead downloads their own payer's field-level amber count table (counts by field and state of sampled NPIs whose payer value differs from two agreeing CMS sources, and of conflicts among the sources) and hands it to their attestation team as next month's priority list. The next monthly refresh replaces the table, and the lead comes back for it because the attestation cycle repeats. This is counts only in v1; a per-NPI worklist is Phase 4 and carries the suppression rules below.

**Secondary persona:** a health system's provider-data manager. Weaker Unavoidable: no rule scores them.

### Week 0: two-slide test before any code

1. Build both slides from the existing 2026-10-28 Humana demo (500 random active PA practitioners with an NPD role; 95 listed at Humana). Re-run the comparison by hand on those 95 with the comparability fix applied: the payer's role location compared with NPPES practice locations and enrollment practice locations, never with the practitioner's own address in NPD. Slide 1: Humana's row next to the NPD row and the NPPES-vs-enrollment row. Slide 2: the field breakdown as the three-way pattern defined below.
2. Show it to three compliance leads, at least one at each of two of the four wired payers (Humana, Cigna, UnitedHealthcare via Optum FLEX, Molina). The owner records each in `.private/` (not in the repo): name, plan, role, date, and answers to four questions: Is this your Project? What is your deadline? What have you tried (List)? Would this table change what your attestation team works on next month (Limitation)?
3. **Gate.** If two of three confirm the Limitation, build v1. If fewer do, ship only the CMS-4214-P comment and the availability probe, and stop.

Unpaid design partnerships do not count as pull.

## Goals, non-goals, anti-goals

**Goals (v1)**

1. One static page with per-source, per-field scores, each with numerator, denominator, interval, as-of date and record owner.
2. Payer rows that state their product line, sample size, found n and interval, labelled as a sample.
3. A results history merged like `dq_results`, separating export changes from provider changes.
4. No new live route.

**Non-goals (v1)**

- State and county maps, health-system pages, the `get_scorecard` MCP tool (all deferred until the week 0 gate passes and v1 has users).
- Rankings of any kind. The word "ranking" is not used until at least 8 payers each clear the found-n minimum.
- Per-NPI marks on public pages (Phase 4).
- Fixing any source; AINPI routes a provider to the record's owner.
- A scheduling signal (Phase 3).
- The Databricks load of `scorecard_results`.
- Weekly NPPES increments. Monthly is enough for monthly scores.

**Anti-goals (this fails even if it runs)**

- **A green mark read as "verified."** AINPI cannot verify truth. The page never uses the word.
- **Copies counted as corroboration** (NPD-NPPES agreement is copy fidelity).
- **A defect scored against a party that does not own it.** In particular, NPPES and enrollment are never treated as the reference a payer is scored against.
- **One composite index.** It hides which field failed.
- **Two published numbers for one quantity.** Where a measure in `measures.json` exists, the scorecard shows that measure.
- **A comparison with no interval or no n.**

## First-principles reasoning

**1. Lineage before agreement.** Two sources agreeing is evidence only if neither copied the other. NPD draws from both NPPES and PECOS, so NPD is never a corroborating source; it is only the thing being scored.

| Source | Lineage class | Owner of the record |
|---|---|---|
| NPPES (monthly file) | `nppes` (self-attested) | Provider, through NPPES |
| NPD (NDH bulk export) | `nppes` and `pecos` (derived); never corroborates | CMS. A 2026-11-03 search found no documented provider update path; unverified. |
| CMS enrollment (Doctors and Clinicians file `mj5m-pzi6`, reassignment list) | `pecos` (enrollment act) | Provider or group, through PECOS |
| Payer FHIR directory | `payer` | Payer |
| Vendor endpoint files (H51) | `vendor` | Vendor and its customer |
| Bookable slot (Phase 3) | `scheduling` | Practice |

**Shared author.** NPPES and PECOS have different lineage as systems, but the same person often keys both: the provider's office staff. Agreement between them means "consistent across two CMS filings", not independent corroboration. The page says so wherever green appears.

**Mark tiers per (NPI, field):**

| Tier | Meaning |
|---|---|
| **Green: consistent across two CMS filings** | The normalized value matches in NPPES and CMS enrollment (and, in later phases, any further non-NPD source of different lineage) |
| **Grey: one filing** | Matches only within one lineage (NDH and NPPES), or one source holds it |
| **Amber: conflict** | Two comparable sources disagree |
| **Blank: not compared** | No comparable second source |

**Who can be green.** CMS enrollment (the Doctors and Clinicians file) covers Medicare-enrolled clinicians only. A green share over all active NPD practitioners would mostly measure Medicare enrollment and, across states, specialty mix. So the green share is computed only over practitioners present in both NPPES and enrollment; that coverage is published as its own number; and both are broken down by NUCC category through `nucc_taxonomy.py`. Green share is not the headline. The per-source table is.

Record-level green means practice ZIP, phone and specialty are all green. Published as counts only.

**2. Comparability before scoring.** The 2026-10-28 demo compared a practitioner's own address in NPD with a payer's location address and overstated ZIP disagreement (43 of 95 agreed). Every score states when two values count as comparable, and incomparable pairs are excluded from the denominator and counted separately.

**3. Coverage, findability and accuracy are separate numbers.** A payer that does not list an NPI may not contract with that provider, so findability is never an accuracy score. Humana supports `?identifier=` and Cigna only name search, so findability is labelled by method and not compared across them.

**4. Score the party that owns the data, and only where the evidence points at it.** A payer is scored on its public API and on listings where the two CMS sources agree with each other and the payer differs. Any other conflict is "sources disagree" and is attributed to nobody. NDH defects show on the NPD row. When health-system pages return, they show only what the system controls: its endpoints and its organization NPIs' NPPES and enrollment records, never aggregated individual NPPES self-attestations, which the clinician owns.

**5. Change has two causes.** Between 2026-08-20 and 2026-10-07, 35.3% of 215,013 PA practitioners lost at least one phone, mostly because the export changed. Every scorecard row carries `comparable_to_previous`, and a jump that coincides with an entry in `source_changes.yaml` links to it.

**6. Compute once, serve static.** Every source refreshes on a calendar (NPD roughly quarterly, NPPES monthly, payer samples monthly), so no reader request needs fresh compute.

**7. Sample size follows findability.** Agreement divides by NPIs found, not NPIs queried. In the 2026-10-28 demo Humana listed 95 of 500 (19%). A 400-NPI draw at 19% yields about 76 found, an interval of about plus or minus 11 points. So the sampler targets a found n and derives the query count from each payer's measured findability, then checks it against the request cap.

### What is reused, relabelled or replaced

| Existing | Treatment |
|---|---|
| `measures.json` NDH measures, `primer-scoreboard.json` | Reused as the NPD row. No recomputation. |
| `landscape.py` `cross_source_agreement` | **Fixed separately**, as a correctness change outside the scorecard: it counts NPI presence in the `nppes.npi_raw` snapshot (newest enumeration 2026-02-07), presence in a stale file, not agreement. It is a mislabel in a published metric and gets its own PR now. |
| `landscape.py` `currency_days_median` | Relabelled "days since export" in the same correctness PR: `meta.lastUpdated` holds the export date. |
| `landscape.py` `specialty_validity` | Unchanged in v1. |
| `pa-connectivity.json` `systems.rows` | Unchanged; it already names PA systems on endpoint reach. Not part of v1. |

## Score definitions (v1)

All rates: numerator over denominator, Wilson 95% interval. Minimum published n: 100 found NPIs for a payer field cell (about plus or minus 10 points at worst), below which the cell shows n and "too few to report" and the value is pooled over the quarter instead. No minimum ranks anything, because nothing is ranked.

| Score | Measures | Numerator | Denominator | Source | Refresh | Comparable when |
|---|---|---|---|---|---|---|
| `npd.conformance` | Rule pass rate | Passing rules | Rules run | `dq_results` | Per NPD release | Same `rule_version` |
| `npd.endpoint_attribution` | Endpoint names its org | H50 numerator | FHIR REST endpoints | `measures.json` | Per NPD release | Always (measure) |
| `npd_nppes.zip`, `.phone`, `.taxonomy` | Copy fidelity | Practitioners whose NPD value equals NPPES | Practitioners with a value in both | NPD parquet, NPPES monthly | NPD release x NPPES month | Practitioner address vs NPPES practice location, both physical |
| `cms.coverage` | Who can be compared | Practitioners in both NPPES and enrollment | Active NPD practitioners, by NUCC category | NPPES, DAC file | Monthly | Same category map version |
| `cms.zip`, `.phone` | Consistency across two CMS filings | Practitioners whose NPPES practice ZIP or phone equals any enrollment practice location | Practitioners present in both, by NUCC category | NPPES, DAC file | Monthly | Enrollment lists several locations; match any |
| `payer.availability` | API answers | Daily probes returning a valid FHIR response | Probes run | Probe log | Daily | Same probe query |
| `payer.findability` | NPI listed | Sample NPIs found | Sample NPIs queried | Payer API | Monthly | Same search method only |
| `payer.pattern.zip`, `.phone`, `.specialty` | Three-way disagreement pattern | Count per pattern (below) | Found NPIs with a comparable payer value | Payer API, NPPES, DAC | Monthly | Payer role location vs practice locations, never a home address |
| `payer.differs_from_cms` (`.zip`, `.phone`, `.specialty`) | Payer differs from two agreeing CMS sources | Found NPIs where NPPES and enrollment agree and the payer differs | Found NPIs where NPPES and enrollment agree and the payer has a comparable value | Same | Monthly | Same |

**Three-way patterns** for each found NPI and field: all three agree; payer differs from two agreeing CMS sources; payer agrees with NPPES only; payer agrees with enrollment only; all three differ; only one CMS comparator present. Only the second is attributed to the payer, and only under the label "payer differs from two agreeing CMS sources", never "payer inaccurate". The others are published as a neutral "sources disagree" or "not comparable" count. A payer holding a correct new address that both CMS filings have not caught up with will show as differing; the label says differs, and the page says CMS filings can be the stale side.

Normalization: ZIP5; phone as in the phones helper (digits only, drop leading 1, exactly 10); taxonomy as membership of the NPPES code set, using `nucc_taxonomy.py`.

Deferred scores (not registered, not computed in v1): `green.share` over all active practitioners (deleted; replaced by `cms.coverage` and `cms.zip`/`.phone` by category), `system.green_share`, `system.endpoint_deterministic` (already published in the PA ledger).

**Payer sample.**

- **Frame.** Active NPD practitioners holding a role, minus every in-force suppressed NPI (read through the same reader `suppression.py` uses, so a removal request also removes the NPI from future draws). For each payer, stratified by the states where that payer sells the product line confirmed for its endpoint (for Humana, its MA states), to lift findability.
- **Size.** Target 300 found NPIs per payer per month. Queries = target / measured findability from the previous month (first month: the 2026-10-28 demo's 19% for Humana; a 100-NPI pilot for the others), capped at 1,500 requests per payer per run. At 19%, 1,500 queries yield about 285 found. If the cap binds, the run reports the shortfall and the quarter pools.
- **Seed.** Drawn at run time from a system random source, written to the gitignored run directory, and published with that month's results, so the draw is reproducible after publication and unpredictable before it.
- **Method.** curl (not urllib, per H26). A 503 counts against availability, never as "not found."

## Components and data flow

```text
NPD parquet, NPPES V2 monthly, DAC (national), payer samples, probe log
  -> analysis/scorecard.py (DuckDB, local)
  -> scorecard_results keyed (as_of, source, scope, score_id, score_version), merged
  -> public/api/v1/scorecard/summary.json, scorecard/payer-<id>-counts.csv, scorecard/history.json
  -> /scorecard (one static page)
```

1. **Source loader** `analysis/scorecard_sources.py`. Downloads the NPPES monthly V2 file (1,078 MB ZIP on 2026-11-02, per `download.cms.gov/nppes/NPI_Files.html`) and converts it to parquet, checking the downloaded size against the size the page lists so a truncated file fails. Pulls the national DAC and reassignment files through the catalog resolution in `ingest_pecos_affiliations.py`. This retires the stale BigQuery NPPES snapshot for scoring. The NPPES download is the first step of the monthly scorer run, not a separate chore; a zero-cost monthly Actions check (same pattern as `ndh-release-watch.yml`, no download) opens an issue when the NPPES files page lists a new monthly file, so the run does not depend on one person remembering it.
2. **Payer sampler** `analysis/payer_sample.py`. Reuses the curl-based payer queries in `analysis/h26_mco_exposure_va.py` (Humana identifier, Cigna name plus bundle filter, Optum FLEX, Molina). Hard caps: at most 2 requests per second per payer, 1,500 requests per payer per run, 60-minute timeout. Runs locally in v1. It prints counts only; per-NPI results go to the gitignored `analysis/data/scorecard/` and never to a log. Moving it to Actions requires an encrypted artifact for per-NPI results and a log check that no NPI is printed.
3. **Availability probe** `payer-probe.yml`. Daily, one metadata request and one `PractitionerRole?_count=1` query per payer (no NPI in the workflow), appended to a CSV. Actions minutes are free on this public repo. This is the one piece that ships even if the week 0 gate fails.
4. **Scorer** `analysis/scorecard.py`. DuckDB over local parquet. Emits `numerator, denominator, ci_low, ci_high, n_queried, n_found, as_of_by_source, comparable_to_previous, source_change_ids, owner_of_record, product_line`, merged into `scorecard/history.json` by key, as `dq_results` does. Every score carries a positive control: an empty comparison must fail, never score 100%.
5. **Page.** One `force-static` page, WIP banner, built from the JSON with `load-api-v1.ts`. Rows: NPD, NPPES vs enrollment (with coverage and NUCC breakdown), one per wired payer (product line, n queried, n found, interval, field patterns, download of the count CSV). Each row links its owner of record.
6. **Evidence.** Counts plus a "check one NPI" link to the existing `/provider-search`, which shows each source side by side. No stored per-NPI evidence in v1.
7. **Pre-registration.** Only scores that ship in v1 get an H-number: `cms.zip`/`.phone` and `payer.differs_from_cms`. CLAUDE.md lists H56 as the next free number; check `FINDINGS` before assigning. Availability, findability and copy fidelity are reported as descriptive measurements, not hypotheses.

**Hard gates before the first public payer value.**

1. Each payer's API terms of use are read and archived in the repo (`docs/sources/payer-terms/<payer>-<date>.md`, with the source URL and retrieval date).
2. Each endpoint's product line (MA, commercial, Medicaid, or a mix) is confirmed from the payer's own developer page and shown on the row. A row that is not MA is not framed around CMS-4214-P. The code comment in `provider-search/route.ts` describes Optum FLEX as covering "UHC commercial + MA + UHC Community Plan + OptumRx"; that is our note, not the payer's statement, and does not satisfy this gate.
3. Health-system pages, when they return, show only what the system controls (see principle 4).

**Suppression and privacy.** Scorecard files carry counts only. Suppressed NPIs are excluded from the draw, not only from outputs. If a later phase lists sample NPIs, they sit under NPI-valued keys so `suppression.py --apply` and `--check` catch them. HIPAA does not apply: AINPI is not a covered entity or business associate, and directory data is not protected health information.

**"Real time," honestly.** Nothing here is real time. Every number shows the as-of date of each source it reads. The freshest signal is payer availability (daily). A live answer exists for one NPI at a time, through `/provider-search`, and the page says so.

## Cost model

| Item | Basis | Cost |
|---|---|---|
| Scorer, loaders, sampler | Local DuckDB and curl on the owner's machine | $0 |
| Availability probe | GitHub Actions, public repo | $0 |
| Static page and JSON | A handful of files, under 1 MB | Under $0.005 per 1,000 views on Vercel's metered transfer |
| "Check one NPI" | Existing `/provider-search`. It calls `enforceRateLimit` with shape `provider-search`, priced at 30 units, which the code comment says covers BigQuery plus the outbound payer fetches. Anonymous tier: 120 units a minute and 2,000 a day per caller, so about 4 searches a minute and 66 a day. The daily breaker (300,000 units) caps all anonymous callers at about 10,000 searches a day. | Bounded by the existing limiter and breaker |
| Databricks | None in v1 | $0 |
| BigQuery | None added | $0 |

**Gap to close before the page links to `/provider-search`.** Nothing caps outbound requests per payer across all callers. At the breaker ceiling, about 10,000 searches a day could each fan out to every payer, which may exceed a payer's own rate limit on AINPI's behalf. Add a per-payer daily outbound cap in `provider-search/route.ts` (or link only the NPD and NPPES parts until it exists).

Hard caps: no new live route; sampler request caps and timeout; `scorecard/` capped at 10 MB by a CI size check.

## Sequence

- **Week 0 (no code).** Two-slide test from the Humana demo; payer terms and product-line gates researched; CMS-4214-P comment drafted with the method and the demo, for the owner to send before 2026-12-15. Landscape `cross_source_agreement` and `currency` correctness PR, independent of everything else.
- **Week 1, only if the gate passes (two of three leads).** NPPES and DAC loaders, payer sampler, scorer with positive controls, history file, the one page, the daily probe, H-number registration for the scores that ship, copy review and anti-slop lint.
- **If the gate fails.** The comment and the daily probe only.

**Later phases, each gated on v1 use**

- **Phase 2.** More payers (NPD's payer API bases, H49), state Medicaid directories (H46). State maps once a state cell can clear its minimum n. PA health-system pages limited to what systems control. The `get_scorecard` MCP tool once there is a consumer. Payer rankings only once at least 8 payers clear the found-n minimum. Optional Databricks load of `scorecard_results`.
- **Phase 3.** A scheduling platform's availability API as the strongest evidence: a bookable slot shows the practitioner practises there. Whether such an API and reuse terms exist is unverified; no work until the platform's terms are in hand.
- **Phase 4.** Provider-facing "check my record": per-NPI marks from sharded static files on zero-egress storage, each amber field routed to its owner. Suppression applies. Gated on payer-side pull having been shown.

## Risks

- **Green read as verified.** Tier wording ("consistent across two CMS filings"), the shared-author note, and a methodology note on the page.
- **Wrong fault attribution.** Only the "payer differs from two agreeing CMS sources" pattern is attributed, and labelled as differing, not wrong. Still contestable where both CMS filings are stale.
- **Comparability errors.** "Comparable when" plus counts of incomparable pairs.
- **Payer instability.** A 503 lowers availability; findability uses answered requests only.
- **Product-line mismatch.** An endpoint may be commercial or Medicaid, not MA. Gate 2 above.
- **Small samples.** Found-n minimum, quarterly pooling, interval and n on every cell.
- **Rule drift.** The final rule may differ; this is not CMS's accuracy score.
- **Goodhart.** The seed is unknown until the results are published.
- **One-person dependency.** The scorer and sampler run on the owner's machine; the NPPES step is part of the monthly run with an automated new-file reminder, and moving the sampler to Actions is specified above.

## Open decisions for the owner

1. **Named or anonymized payers.** Option A: name payers, with 14 days' notice and a right of reply before first publication. Option B: anonymized bands with self-lookup (a plan finds its own row). Recommendation: name payers on availability and findability, which are objective facts about a public API that a federal rule requires; name them on the "differs from two agreeing CMS sources" pattern only once their found n clears the minimum; give 14 days' notice and right of reply under either option. Keep PA health systems named only on endpoint reach, as the connectivity ledger already does. Never publish a "worst" list.
2. **Send the CMS-4214-P comment.** Drafted in week 0; the send is the owner's, due 2026-12-15.
3. **Target found n and request cap.** 300 found per payer per month under a 1,500-request cap, with quarterly pooling when the cap binds; or raise the cap for low-findability payers.
4. **Where the sampler runs.** Locally (no public logs, one-person dependency) or on Actions with encrypted per-NPI artifacts.
5. **Whether to link `/provider-search` from v1** before a per-payer outbound cap exists.
6. **Build order.** This revision builds v1 only after the week 0 gate passes (the review gated only the later expansions). Alternative: build v1 in parallel as the exhibit for the CMS-4214-P comment, accepting a week of work before pull is confirmed.

## Review applied (2026-11-03)

An expert review (verdict: ship with changes) was applied as follows.

**Applied**

- Payer sample arithmetic (critical). Checked: 400 x 19% is about 76 found, about plus or minus 11 points; 400 found at 19% needs about 2,100 queries, over the 1,500 cap. Removed payer rankings and the word "ranking" until 8 payers clear the minimum; minimum now set on found n (100 per cell); draw sized from measured findability toward 300 found; stratified by the payer's product-line states.
- Day-one retention and test order (critical). Two-slide test moved to week 0, before code, built from the 2026-10-28 Humana demo with the comparability fix applied by hand. Three leads to be named and recorded by the owner in `.private/`; this design does not invent names. Gate: two of three confirm the Limitation, or only the comment and probe ship. Retention action changed to downloading the payer's amber count table as the attestation team's next worklist, counts only.
- Payer scored against NPPES and enrollment (major). Replaced with the three-way pattern; only "payer differs from two agreeing CMS sources" is attributed, under that label; other conflicts are a neutral count.
- Green tier and enrollment coverage (major). Green share restricted to practitioners in both NPPES and enrollment, coverage published separately, both by NUCC category; shared-author note added; green renamed "consistent across two CMS filings"; not the headline.
- v1 scope (major). Cut to one static page plus the daily probe. Landscape mislabel split out as a standalone correctness PR.
- Reputation gates (major). Payer terms archived, product line confirmed and shown, health-system pages limited to what systems control: now hard gates. Naming recommendation tightened as suggested, with both options kept open.
- Suppression in the draw, counts-only logs, gitignored per-NPI results, HIPAA scope line (minor).
- Regulatory drivers separated; NSA applicability to MA marked as needing legal confirmation; the CMS-4214-P comment made the near-term deliverable (minor).
- Seed published with results, held out of git until then (minor).
- `/provider-search` cost checked in code: the payer fan-out is under the per-IP limiter (shape `provider-search`, 30 units) and the daily breaker, but no per-payer outbound cap exists; recorded as a gap and an open decision. NPPES monthly download made the first step of the monthly run, with a size check and an automated new-file reminder (minor).
- Cut list applied in full: county and 51-state maps, PA system pages and `system.green_share`, the MCP tool, `green.share` headline, rankings, the Databricks load, weekly NPPES increments and multiple pre-registrations all deferred or deleted; Phases 3 and 4 kept deferred with explicit gates.

**Corrected rather than copied**

- The review cited H54's figures (1 of 12,995 PA pharmacy providers, about 2.7% of nurses, about 70% of physicians) as enrollment coverage. Those are `PractitionerRole` coverage, not presence in the enrollment file. The conclusion still holds, because the DAC file covers Medicare-enrolled clinicians only, so the change was applied without quoting those figures as enrollment coverage. `cms.coverage` will measure the real number.

**Rejected**

- None outright. v1 is gated on the week 0 result as well as the later expansions, a stricter reading than the review asked for; listed as open decision 6. Two parts were reconciled rather than applied literally: the third reputation gate (health-system scope) is kept as the rule for when system pages return, since v1 has none; and the "amber-field list" retention action is a count table, not a per-NPI list, to stay consistent with counts-only v1 and the suppression rules.
