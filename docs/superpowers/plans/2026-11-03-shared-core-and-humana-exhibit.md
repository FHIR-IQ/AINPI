# Shared cross-source core and the Humana exhibit: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the $0 local core the scorecard, the provider view and plan reconciliation all share (NPPES monthly loader, normalization and lineage module, per-release cross-source facts table, payer sampler), then use it to re-run the Humana comparison properly as the exhibit for the CMS-4214-P comment.

**Architecture:** Python scripts in `analysis/`, local DuckDB over parquet, no BigQuery and no Databricks. Per-NPI outputs stay in gitignored `analysis/data/`; only counts are committed. The facts table is the one join every later product reads.

**Tech Stack:** Python 3.12, DuckDB, pyarrow, curl (subprocess, never urllib), pytest.

**Spec:** `docs/superpowers/specs/2026-11-03-directory-scorecard-design.md`, `docs/superpowers/specs/2026-11-03-provider-portal-design.md`, and section 2 ("Build once") and section 3 (resolutions 2, 3, 4, 6, 10) of `.private/strategy/2026-11-03-roadmap.md`. Resolutions there override the individual designs.

## Global Constraints

- No BigQuery, no Databricks. Payer calls use `curl` via subprocess (Python's TLS stack fails against WAF-fronted payer endpoints).
- Payers in v1: Humana (`?identifier=<NPI>`) and UHC via Optum FLEX (`https://flex.optum.com/fhirpublic/R4`). Cigna out; Molina out until registered.
- Sampler caps: 2 requests per second, 1,500 requests per payer per run, 60-minute run timeout. Target 300 found per payer per run.
- The draw excludes NPIs in force on the suppression list (`analysis/suppression.py` reader). Logs and committed files carry counts only, never an NPI.
- Per-NPI outputs go under `analysis/data/` (gitignored). Payer `value_norm` never leaves `analysis/data/`.
- Lineage rule: agreement counts only across independent sources. NPD equal to NPPES is "consistent with its upstream", not agreement. v1 marks are grey and amber only; no green.
- Comparisons with payers always use the NPD role Location, not the practitioner address (roadmap resolution 10).
- The NPPES download (the monthly full replacement file from download.cms.gov, about 1 GB zipped) is announced to the owner with its file name and size before it runs.
- Input files are checked for the macOS `dataless` flag before reading.

## Review Focus

1. **The NPPES monthly file is replaced mid-month or the page lists two files**: the loader picks the full replacement file by name pattern, not the weekly increments, and records which. Test in Task 1.
2. **A payer returns 200 with an empty bundle versus a non-JSON error page**: "not listed" and "lookup failed" are different outcomes and are counted separately. Test in Task 4.
3. **A practitioner with several NPD role locations**: ZIP agreement is true if any NPD role-location ZIP equals any payer location ZIP; the 2026-10-28 demo's overstated disagreement came from comparing only the practitioner address. Test in Task 3.
4. **A suppressed NPI drawn by the sampler**: excluded before any request is made. Test in Task 4.
5. **NPPES snapshot older than the release**: the loader's positive control fails if `MAX(enumeration_date)` is more than 45 days before the NPPES file's own date. Test in Task 1.

---

### Task 1: NPPES monthly loader

**Files:** Create `analysis/nppes_monthly.py`, `analysis/tests/test_nppes_monthly.py`. Output `analysis/data/nppes/<YYYY-MM>/nppes.parquet` and a committed `frontend/public/api/v1/nppes-load.json` (file name, size, rows, `max_enumeration_date`, loaded_at).

**Interfaces:** Produces `pick_full_file(listing_html: str) -> str` (the `NPPES_Data_Dissemination_<Month>_<Year>_V2.zip` link, never `_Weekly`), `load(zip_path: Path, out_dir: Path) -> dict` (streams the main CSV into parquet with columns `npi, entity_type, last_name, first_name, org_name, practice_line1, practice_city, practice_state, practice_zip5, practice_phone10, primary_taxonomy, deactivation_date, enumeration_date, last_update_date`), and `control(summary: dict, file_month: str) -> bool`.

- [ ] **Step 1: Tests:** `pick_full_file` on a fixture listing with a monthly and two weekly links returns the monthly; `load` on a 5-row fixture CSV (latin-1 encoded, one row with a 9-digit ZIP) gives `practice_zip5` of 5 digits and `practice_phone10` normalized by the phones-helper rule (strip non-digits, drop a leading 1 from 11 digits, require 10); `control` fails when `max_enumeration_date` is 60 days before the file month.
- [ ] **Step 2:** FAIL. **Step 3:** implement; read utf-8-sig and fall back to latin-1 (CLAUDE.md: CMS encodings vary). **Step 4:** PASS. **Step 5:** commit.

### Task 2: Normalization and lineage module

**Files:** Create `analysis/xsource_norm.py`, `analysis/tests/test_xsource_norm.py`.

**Interfaces:** Produces `zip5(v) -> str | None`, `phone10(v) -> str | None`, `taxonomy(code) -> str | None` (validated through `analysis/nucc_taxonomy.py`), `LINEAGE: dict[str, list[str]]` (`npd -> ['nppes', 'pecos']`, `nppes -> []`, `pecos -> []`, `humana -> ['unknown']`, `optum_flex -> ['unknown']`), and `relation(a: str, b: str) -> str` returning `upstream` when one source derives from the other, `independent` when neither does, `unknown` when either lineage is unknown.

- [ ] **Step 1: Tests:** `relation('npd', 'nppes') == 'upstream'`; `relation('nppes', 'pecos') == 'independent'`; `relation('npd', 'humana') == 'unknown'`; ZIP and phone edge cases (`'15206-1234'`, `'1 (412) 345-5134'`, `'345-5134'` → `None`).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit.

### Task 3: Per-release facts table

**Files:** Create `analysis/xsource_facts.py`, `analysis/tests/test_xsource_facts.py`. Output `analysis/data/xsource/<release>/facts.parquet`.

**Interfaces:**
- Consumes: Task 1 parquet, Task 2 functions, `frontend/data/parquet-export/<release>/` (practitioner, practitioner_role, location).
- Produces: `build(release: str, nppes_month: str, states: list[str]) -> Path` writing rows `(npi, source, lineage, fhir_element, field, value_norm, observed_at, rule_version)` for fields `zip5`, `phone10`, `taxonomy` from NPD role Locations (`fhir_element = 'PractitionerRole.location->Location.address'`), the NPD practitioner address (`'Practitioner.address(physical)'`), and NPPES. `compare(facts, npi_set, payer_rows) -> dict` returns per field `{agree, disagree, one_sided, by_relation}` counts, where `agree` is any-to-any on normalized values.
- Note: the local 2026-10-07 `location.parquet` was an iCloud placeholder on 2026-10-28. If `dataless`, stop and tell the owner to open the folder in Finder ("Download Now") rather than reading around it.

- [ ] **Step 1: Tests:** a practitioner with role locations in ZIPs 15206 and 15213 and a payer location in 15213 → `zip5` agree; a practitioner whose only NPD match is the practitioner address → that comparison labelled `Practitioner.address(physical)` and counted separately; NPD and NPPES equal → `by_relation['upstream']`, not agreement.
- [ ] **Step 2:** FAIL. **Step 3:** implement with DuckDB. **Step 4:** PASS. **Step 5:** commit.

### Task 4: Payer sampler

**Files:** Create `analysis/payer_sample.py`, `analysis/tests/test_payer_sample.py`. Output per-NPI results to `analysis/data/payer-sample/<payer>/<date>.parquet`; counts to stdout.

**Interfaces:** Produces `draw(release: str, state: str, n: int, seed: int, suppressed: set[str]) -> list[str]` (active practitioners with an NPD role in the state, hashed order, suppressed removed before return), `lookup_humana(npi) -> PayerResult` and `lookup_optum(npi) -> PayerResult` where `PayerResult = {status: 'listed'|'not_listed'|'lookup_failed', zips: set, phones: set}` (Humana: `Practitioner?identifier=<npi>` then `PractitionerRole?practitioner=Practitioner/<id>&_include=PractitionerRole:location&_count=50`), and `run(payer, release, state, target_found=300, max_requests=1500, rps=2.0) -> dict` (counts only).

- [ ] **Step 1: Tests** (no network; inject a fake `curl` callable): an empty bundle → `not_listed`; HTML body → `lookup_failed`; the request counter stops at `max_requests`; a suppressed NPI is never passed to the fake; the rate limiter sleeps at least `1/rps` between calls (inject a fake clock).
- [ ] **Step 2:** FAIL. **Step 3:** implement; seed drawn at run time, written into the gitignored output and printed. **Step 4:** PASS. **Step 5:** commit.

### Task 5: Humana exhibit for the CMS-4214-P comment

**Files:** Create `analysis/exhibit_humana_2026_11.py`. Output `docs/methodology/runs/2026-11-0X-humana-ndh-comparison.md` and `.private/policy/2026-11-cms-4214-p-exhibit.md` (the exhibit text for the comment).

- [ ] **Step 1:** Announce the NPPES file name and size to the owner, then run Task 1's loader for the current month.
- [ ] **Step 2:** `facts.build('2026-10-07', '<month>', ['PA'])`.
- [ ] **Step 3:** `payer_sample.run('humana', '2026-10-07', 'PA')`; record found count, requests, failures.
- [ ] **Step 4:** Compare with role Locations. Report per field: agree, disagree, one-sided, with a 95% interval on each share (Wilson), the three-way pattern (payer differs from NPD and NPPES that agree with each other; sources disagree otherwise), and the share of NPD changes between 2026-08-20 and 2026-10-07 that are export artifacts. Counts only.
- [ ] **Step 5:** Write the run doc and the exhibit. The exhibit states method, n, intervals, what the comparison cannot show (which source is right), and that Humana's terms were read on a stated date (Task 6 of the scorecard plan, or read them now and archive under `docs/sources/payer-terms/`). Run the anti-slop linter and the copy-reviewer agent on both. Commit the run doc; the exhibit stays in `.private/` until the owner submits the comment.
