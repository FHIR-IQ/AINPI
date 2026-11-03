# NDH data quality rules and source governance

**Date:** 2026-11-03
**Status:** Design (approved in chat; awaiting implementation plan)
**Owner:** Eugene Vestel
**Related:** `analysis/measures.py` and `/api/v1/measures.json` (the measure series), `analysis/databricks_publish.py` (the release archive and share), `frontend/src/app/api/mcp/route.ts` (the MCP server), `.github/workflows/ndh-release-watch.yml`, `frontend/src/data/findings.ts` (pre-registration), the InLaw package (`pip install inlaw`, CC0, a thin Great Expectations wrapper maintained by a CMS engineer)

## Revision after expert review (2026-11-03)

An independent review ("ship with changes") changed the design in nine places.
The sections below are edited to match; this list is the summary.

1. **Gates never block archiving a release.** CMS deletes each release when the
   next one lands, so a release where CMS broke something is the one most worth
   keeping. The raw partition load is never blocked. A new `pipeline` severity
   (our own read failed: a table or field came back empty or null where the
   previous release had values) blocks only derived outputs. Source-quality
   rules, including H6-H8 referential integrity, are `expect`.
2. **Results are always published**, failures included.
3. **Results are append-safe.** Rows are keyed on (release_date, rule_id,
   rule_version) and merged into the committed file, never regenerated;
   superseded versions are marked, not deleted, like `measures` restatements.
4. **Positive controls are field-level**, compared with the previous release,
   because every silent zero in this project's history was a field going
   empty, not a table.
5. **v1 is DuckDB-only**, over AINPI parquet or the Delta Sharing archive read
   into Arrow. No claim of running on any engine or on raw NDJSON.
6. **Each rule states how it relates to its H-number** (`implements`,
   `partial`, `related`); only `implements` rows carry the H-number's
   threshold.
7. **A full-scan structural fingerprint replaces the sampled contract in v1.**
8. **Measure pairing checks definitions first** and uses per-measure
   tolerances in the measure's own unit.
9. **Each result row records which input it read** (`input_fingerprint`).

**v1 (the first slice):** the `ndh_quality/` package with five rules, the
runner writing a merged, versioned `dq-results.json`, `source_changes.yaml`
published as JSON, and the fingerprint diff. **Deferred:** the ODCS contract,
`field_provenance.yaml`, the Databricks tables, the MCP tools, the publish
gate, and measure pairing beyond `endpoint-org-linkage` and
`npi-validation-failures`. Deferred components are kept below, marked, so the
later phases are already designed.

## Why this exists

Most of the defects this project has found in the CMS National Provider
Directory (NPD) bulk export are not bad values. They are metadata failures
upstream:

- The NPI identifier system URL changed in 2026-05-08, and the taxonomy coding
  system changed in 2026-08-20 to a ValueSet canonical in a field FHIR defines
  as a CodeSystem. Code written for one release returned zero rows on the next
  without raising an error.
- CMS re-minted every Endpoint and Location id in 2026-05-08 and again in
  2026-08-20, with no crosswalk.
- `meta.lastUpdated` holds the export date, not the date anyone checked a value,
  and no field records where a value came from.
- The accepting-new-patients extension carries one code on every record.

Each one turned a check into a false finding until someone noticed. The fixes
live in code comments and in `CLAUDE.md` prose. Nothing records them as data,
so neither an installer of the archive nor an agent querying it can ask "did
the source change, or did the providers?"

The checks themselves are also scripts. Each pre-registered finding computes a
numerator and denominator against BigQuery and writes JSON. There is no common
rule format, no pass/fail record kept per release, and no way for someone else
to run the checks on their own copy.

A CMS engineer has asked on the NPD community Slack for "test driven
development for data quality" using Great Expectations through InLaw. A spike
on 2026-11-02 ported four AINPI checks to InLaw tests on DuckDB and ran them on
two releases: the approach works, and the spike caught a bug of its own (DuckDB
does not short-circuit `AND`, so a malformed NPI crashed the check-digit
expression until `try_cast` replaced `cast`).

This design makes AINPI's checks portable rules, keeps their results as a
history across releases, records source changes and field provenance as data,
and exposes all three to agents.

## Goals

v1:

1. A rules package anyone can run with DuckDB on their own machine, over
   AINPI's parquet layout or the archive.
2. A per-release result record for every rule, always published, append-safe.
3. A curated, machine-readable log of source changes between releases.
4. A full-scan structural fingerprint of each release, diffed against the
   previous one.
5. A release step in which an agent drafts and a person approves.

Later:

6. A data contract for the bulk export (ODCS v3.2.0).
7. A provenance record for every flattened column the archive publishes.
8. The results, changes and provenance as tables in the share.
9. MCP tools that let an agent read all of the above.

## Non-goals

- Running a metadata catalog (OpenMetadata, DataHub or similar). The contract
  and the JSON files are what such a catalog would ingest; operating one is not
  this project's job until an installer asks for it.
- Databricks anomaly detection or data profiling on our tables. Quarterly
  releases are too sparse for learned thresholds, and both bill our compute.
- DQX or Soda as the rule engine. DQX is Beta, Spark-only and under a
  Databricks licence; Soda Core moved to the Elastic License in 2026. Either
  conflicts with a CC0 package for CMS. An optional DQX rule export for
  installers on Databricks can follow later.
- Cross-source audits (OIG LEIE, SAM, claims, payer directories, vendor files).
  They stay as findings. This design covers rules over the NDH files alone.
- A new public web page. The JSON files, the share and the MCP tools are the
  interface for v1.

## Anti-goals (this fails even if it runs)

- **A rule whose expected value was learned from the current data.** A profiler
  or an LLM would accept 14.6% endpoint linkage as normal. Every expected value
  comes from a pre-registered hypothesis or is marked `monitor` with no
  threshold.
- **A rule that can pass on an empty read.** Every rule carries a field-level
  positive control, and a failed control is its own status, never a pass.
- **A quality result that stops a release being archived.** CMS deletes each
  release; the archive load is never gated.
- **Two published numbers for one quantity.** Where a rule measures what a
  published measure measures, the measure remains the citable number.
- **An unattended model writing to the record.** Agents draft; a person merges.
- **An NPI in any of the new outputs.** Rules publish counts only.

## Constraints

- **Cost.** The Databricks bill was $13.78 for October. Rules run on DuckDB
  over the local parquet export (no cloud compute). v1 adds no Databricks or
  BigQuery use; later share tables are one small whole-table load per release
  each, the same pattern as `measures`.
- **Installers have no Databricks.** Open-sharing recipients read through the
  `delta-sharing` client; Databricks-to-Databricks recipients get read-only
  tables. So results ship as data, and the rule engine must run outside
  Databricks.
- **Licence boundary.** The rules package is CC0 in its own directory with its
  own `LICENSE`, so it can move to a CMS repository unchanged. The rest of
  AINPI stays Apache-2.0.
- **InLaw compatibility.** Each rule is an `InLaw` subclass whose `run(engine,
  settings=None)` returns `True` or a message, so InLaw's own runner works on
  it. Pins are in component 1.
- **InLaw loads each result into pandas.** Rules aggregate in SQL and return
  one row.
- **Suppression.** No new output carries an NPI, so `analysis/suppression.py`
  has nothing to filter. The guard (`--check`) must still pass over the new
  files.
- **Pre-registration.** A new rule that is not an existing H-number gets one
  (H56 onward) in `findings.ts` before its first result is published.

## Decided (by the owner, in chat on 2026-11-03)

- Great Expectations through InLaw is the rule engine. v1 runs it on DuckDB
  only (revision 5); other engines are a later port if asked.
- Results are published as JSON, and later as a table in the share.
- A source-changes log is in v1. An ODCS data contract, a field-provenance map
  and MCP tools are in scope as later phases.
- The release step is agent-drafted and human-approved.
- The rules are CC0. Where they live upstream waits on the CMS engineer's
  answer (a separate repository, or ported to Cypher for the Neo4j project).
- The expert review's changes are adopted (revision list above).

## Components

### 1. Rules package: `ndh_quality/` (CC0, v1)

A top-level directory with its own `LICENSE` (CC0 1.0), `README.md`,
`pyproject.toml`, a CLI entry point (`ndh-quality run --release-dir <dir>`) and
`tests/`. One rule per file, `rule_<slug>.py`, following the one-check-per-file
convention of the CMS engineer's `sensible_data_checks`. No imports from
`analysis/`, so the directory can move.

**Pins.** Python 3.13 (InLaw 0.2.0 declares 3.10 to 3.13), `inlaw==0.2.0`,
`great-expectations>=1,<2` as InLaw requires, `duckdb` pinned to the 2.0 line
(which rejects the `->` lambda; use `lambda x:`), `duckdb_engine`,
`sqlalchemy>=2`.

**Input scope (revision 5).** Rules read AINPI's flattened parquet layout: a
directory of `<resource>.parquet` files carrying the `_*` columns. Two ways to
get one: AINPI's own export, or the Delta Sharing archive read into Arrow with
`delta-sharing` and written to parquet. The README gives the exact commands
for both, and says that CMS serves only the latest export, so history comes
from the archive. Raw NDJSON is not supported in v1; it would need the
flatteners ported into the package.

Each rule is an `InLaw` subclass with these class attributes:

| Attribute | Meaning |
|---|---|
| `rule_id` | Stable slug, e.g. `npi-check-digit` |
| `rule_version` | Integer. Bumped when the SQL, the threshold or the control changes. A threshold change is a new pre-registration, so always a new version |
| `hypotheses` | H-numbers it relates to |
| `relation` | `implements`, `partial` or `related` (revision 6) |
| `measure` | Paired measure slug, or `None` |
| `severity` | `pipeline`, `expect` or `monitor` |
| `threshold` | `{op, value, source_text}` from the registered text, or `None` |
| `control` | The field-level control: what is counted, and the floor |
| `resources` | Parquet files it reads |

`measure(engine, settings, previous=None) -> dict` returns `{numerator,
denominator, control_count, control_previous, control_passed, detail}` from
one aggregate query. `run` (InLaw's interface) calls `measure`, applies the
threshold through a Great Expectations expectation, and returns `True` or a
message with the counts. The runner calls `measure` directly.

**Severity (revision 1):**

- `pipeline`: our own read failed. A required field's control count is zero,
  or falls below the floor relative to the previous release. A failure blocks
  only AINPI's derived outputs for that release. It never blocks loading the
  raw release into the archive.
- `expect`: a registered expectation about the source data. A failure is a
  finding: recorded, published, blocks nothing.
- `monitor`: no registered number; the value is recorded so change is visible.

**Field-level controls (revision 4).** Each rule counts the non-null inputs to
its numerator (for example rows with `_connection_type = 'hl7-fhir-rest'`, or
NPIs present) and compares the count with the previous release's. The
control fails if the count is zero, or below 50% of the previous release's
(the builder may tighten per rule). With no previous release, only the
non-zero test applies. A failed control sets status `control_failed`, never
`pass`.

**Thresholds.** Only `relation = implements` rows carry a threshold, taken
from the number the H-number's registered null hypothesis states in
`findings.ts` (H9 at least 99.9% valid; H6-H8 at least 99% resolvable). Where
the registered text gives no number, the rule is `monitor`. Registering a bar
later is a new pre-registration. A `fail` row means the registered expectation
does not hold for that release; the README says so in those words.

**v1 rule set (five rules):**

| Rule | Relation | Severity | Measure |
|---|---|---|---|
| `npi-check-digit` | implements H9 | expect | `npi-validation-failures` |
| `role-references-resolve` (practitioner and organization) | implements H6-H8 (role part) | expect | |
| `endpoint-types-present` | control only | pipeline | |
| `fhir-rest-endpoint-share` | implements H28 | monitor | `fhir-rest-endpoint-share` |
| `endpoint-org-linkage` | implements H50 | monitor | `endpoint-org-linkage` |

Four come from the spike (SQL in the appendix, with both fixes it needed).
The spike checked its check-digit SQL against `analysis/h9_npi_luhn.py` on
202,004 values (200,000 sampled 2026-10-07 practitioner NPIs, 2,000 of them
with the check digit incremented, and three malformed strings) with zero
disagreements; that comparison becomes a test.

**Later rules** (designed, not in v1), with their honest relation:
`location-managing-org-resolves` and `affiliation-orgs-resolve` (implements
H6-H8); `taxonomy-nucc-valid` (related to H10-H12, which registered agreement
with NPPES, not NUCC validity; needs the NUCC code set shipped in the package
with its version pinned); `role-specialty-agreement` (implements H13);
`last-updated-recency` (implements H18's registered "majority within 90
days"); `ssn-pattern-absent` (implements H27; counts and JSON locations only,
never a matched value, with H27's control that the `qualification` array is
present); `practitioner-phone-present` (partial H43: Practitioner record
only). `practitioner-npi-unique` is dropped: practitioner ids are
`Practitioner-<NPI>`, so it is close to a tautology. The accepting-new-patients
rule needs a new H-number and a threshold from the owner.

**Tests** (`ndh_quality/tests/`, pytest, no network): per rule, DuckDB
fixtures built in memory: passing, failing, empty table, and full table with
the input field empty or renamed (the last two must give `control_failed`).
Plus the H9 comparison.

### 2. Runner and results: `analysis/dq_run.py`, `dq-results.json` (v1)

`python3 analysis/dq_run.py --release 2026-10-07` (repeatable) runs every
rule's `measure` against that release and the previous one present, and
**merges** the rows into `frontend/public/api/v1/dq-results.json` (revision
3). It never drops rows for releases it did not run. Before reading, it checks
every input file for the macOS `dataless` flag and stops with the path named.

Key: (`release_date`, `rule_id`, `rule_version`). Re-running a version that
already has a row overwrites that row only if `input_fingerprint` is
unchanged; otherwise the old row is kept with `superseded_by` set and the new
row added, following the `restated` / `as_published_*` pattern in
`measures.json`.

Row fields:

| Field | Meaning |
|---|---|
| `release_date`, `rule_id`, `rule_version` | key |
| `hypotheses`, `relation`, `severity` | from the rule |
| `numerator`, `denominator`, `value` | `value` = numerator / denominator, or the count |
| `threshold` | `{op, value, source_text}` or `null` |
| `control_count`, `control_previous`, `control_passed` | the field-level control |
| `status` | `pass`, `fail`, `control_failed`, `error`, `recorded` (monitor) |
| `measure`, `measure_value`, `measure_agrees` | `true`, `false`, `no_point`, `not_paired` |
| `input_fingerprint` | per input file: row count, byte size, and the export's git sha (revision 9) |
| `engine`, `git_sha`, `run_at` | provenance of the run |
| `superseded_by` | `null`, or the `rule_version` that replaced this row |
| `detail` | short text, never an NPI |

The file carries `schema_version`, and its schema is registered in
`analysis/contract_schemas.py` so `validate_contract.py` checks it in CI.

**Results are always published (revision 2)**, failures included. A
`pipeline` failure makes the runner exit non-zero after writing, which stops
the owner's local chain before derived outputs; it does not withhold results.

**Measure agreement (revision 8).** Pairing is v1 only for
`endpoint-org-linkage` and `npi-validation-failures`. A pair compares values
only when the measure's definition for that release (its `definitions` entry
in `measures.json`, matched by the definition in force on that release date)
matches the rule's numerator and denominator; otherwise `not_paired`. The
tolerance is per measure, in the measure's own unit, with an absolute and a
relative part (exact for counts). A disagreement is written into the release
diff (component 7) for the owner, who opens the issue; the runner opens
nothing. The measure stays the citable number.

**Where it runs.** Locally, as an owner-run step after `export_parquet.py`.
CI validates the committed JSON and runs the unit tests only.

**Which copy the results describe.** The rules read the parquet export, and
`input_fingerprint` records exactly which. The Databricks archive's
practitioner and organization address columns still hold `address[0]` values
(owner's decision of 2026-10-27, no reload); no v1 rule reads an address
column. When the archive is next loaded, `databricks_publish.py` records the
same fingerprint so the two can be compared rather than asserted equal.

**Backfill.** 2026-05-08, 2026-08-20 and 2026-10-07 from the parquet
re-exported on 2026-10-27.

**Share (deferred).** Later, `dq_results` joins `SERIES_TABLES` in
`databricks_publish.py`, loaded whole like `measures`.

### 3. Source-changes log: `analysis/source_changes.yaml` (v1)

Curated by hand and reviewed by pull request. One entry per change in the CMS
export that affected how it must be read:

| Field | Meaning |
|---|---|
| `id` | `sc-YYYY-MM-DD-<slug>` |
| `first_release` | First release carrying the change |
| `resource`, `element` | e.g. `Practitioner`, `identifier.system` |
| `kind` | `code-system`, `identifier`, `id-minting`, `vocabulary`, `file-layout`, `value-pattern`, `upstream-file` |
| `before`, `after` | Short literal description |
| `detected` | Date, and how (which check or run) |
| `impact` | What broke, and which published figures it touched |
| `handled_by` | File and function that now copes with it |
| `evidence` | Run doc or finding URL |
| `status` | `active` or `resolved` |

Seed entries, all already documented in `CLAUDE.md` or run docs: the NPI
identifier URL (2026-05-08); the taxonomy system URL and the ValueSet-as-system
problem (2026-08-20); `PractitionerRole.specialty` moving to NUCC; Endpoint and
Location id re-minting (2026-05-08 and 2026-08-20) and the partial carry-over at
2026-10-07; the manifest key renumbering and file count change (2026-08-20);
the extension vocabulary replacement; `ein` organization records; the single
accepting-new-patients value; and two upstream-file changes outside the NDH
that broke AINPI inputs (OIG LEIE blanks written as `0`; eClinicalWorks moving
its endpoint list). `kind: upstream-file` marks those two so they are not read
as NDH changes.

Published as `frontend/public/api/v1/source-changes.json` (later also a
`source_changes` table in the share, whole-table load). A test asserts every
entry's `handled_by` file exists.

### 4. Structural fingerprint diff: `analysis/ndh_fingerprint.py` (v1, replaces the sampled contract)

For each resource of a release, a full scan of the parquet `resource` column
in DuckDB records:

- every distinct JSON key path, with the count of records carrying it;
- every distinct `system` URL (identifier and coding), with counts;
- every distinct `Endpoint.connectionType` code and `Organization.type` code,
  with counts;
- record count and id-format pattern counts (`Type-<NPI>` against
  UUID-shaped).

Written to `analysis/data/dq/fingerprint-<release>.json` and committed to
`frontend/public/api/v1/fingerprints/<release>.json` (counts only, no values
beyond URLs and codes). `ndh_fingerprint.py diff <previous> <new>` lists paths
and systems that appeared, vanished, or moved more than a stated share. Each
listed change is a candidate source-changes entry. Nothing to maintain by hand:
the previous release is the baseline. This catches what a 10,000-record sample
would miss (payer-typed organizations were 997 of 2,058,500 at 2026-10-07).

A fingerprint diff blocks nothing. A diff with unexplained changes means the
release's derived files are not committed until each change has a
`source_changes.yaml` entry or is marked as expected in the diff review.

### 5. Data contract (later): `contracts/ndh-bulk-export.odcs.yaml`

Deferred. When written, target ODCS v3.2.0 (current; v3.1 is superseded), and
evaluate `datacontract-cli` (MIT, runs ODCS checks on DuckDB and Databricks)
before writing a custom checker. The fingerprint history from v1 is the
evidence the contract's accepted values come from. A contract is for parties
who run a catalog (OpenMetadata, DataHub) and want AINPI's expectations of the
export in a standard form.

### 6. Field provenance (later): `analysis/field_provenance.yaml`

Deferred. One entry per flattened column (`table`, `column`, `fhir_path` with
cardinality, `rule`, `extractor`, `rule_since`, `previous_rules`, `notes`),
with a per-target variant because the copies differ: the archive's address
columns hold `address[0]`; BigQuery and parquet use the physical-address rule.
Consider expressing it as ODCS `transformLogic` / `transformSourceObjects` in
the contract for AINPI's own archive rather than a separate file. When built,
`do_share()` writes the archive variant as each column comment, and a test
asserts every flattened column has an entry.

### 7. MCP tools (later)

Deferred: agents can fetch the JSON files in the meantime. When built, three
tools in `frontend/src/app/api/mcp/route.ts`, each over a static CDN file,
behind the existing rate limiter, with a failed fetch as a tool error:

- `get_quality_results(release?, rule_id?)`: default is the latest release's
  non-pass rows, `control_failed` first. Every response carries the severity
  meanings and the sentence that a paired measure is the citable number.
- `get_source_changes(release?, resource?)`.
- `get_field_provenance(table, column?, target?)` where `target` is
  `archive`, `bigquery` or `parquet`.

### 8. Release step with an agent (v1, manual)

When `ndh-release-watch.yml` opens its "New CMS NDH release" issue, the
checklist gains, after the ingest and parquet export, and before any derived
output is committed (the archive load is not waiting on any of this):

1. `ndh_fingerprint.py` for the new release, then `diff` against the previous.
2. `dq_run.py --release <new>`.
3. `analysis/dq_release_diff.py <previous> <new>`: a deterministic markdown
   report of the fingerprint diff, rules whose status changed, values that
   moved more than the measure's `ordinary_move` (or 5 points where none is
   set), `control_failed` rows and `measure_agrees = false` rows.
4. An agent (Claude Code, run by the owner) drafts `source_changes.yaml`
   entries, one GitHub issue per unexplained change, and the release-note
   paragraph. Each drafted entry cites the fingerprint diff line or the
   `dq-results` row behind it; a test asserts that every entry with
   `first_release` on or after 2026-11-01 carries such a citation.
5. The owner reviews and merges. Nothing the agent drafted is recorded until
   then. No model runs unattended in CI.

## Testing

- `ndh_quality/tests/`: per rule, passing, failing, empty-table and
  empty-field fixtures; the H9 comparison.
- `analysis/tests/`: `dq_run` merge semantics (rows for releases not run are
  kept; a changed `input_fingerprint` supersedes rather than overwrites); a
  `pipeline` failure exits non-zero after writing; `measure_agrees` logic;
  `source_changes.yaml` schema, `handled_by` existence and the citation rule;
  fingerprint and diff against a fixture with one vanished path and one new
  system URL.
- CI: `ndh_quality/tests` in the analysis job on Python 3.13 (no network);
  `validate_contract.py` covers `dq-results.json`.

## Cost

- Rules and fingerprints: local DuckDB, no cloud spend. The spike's four rules
  took about 16 minutes for two releases, almost all in reads of the role and
  organization files on an iCloud-synced disk; rules that share a table should
  share a read. The fingerprint is one scan of each `resource` column per
  release.
- No Databricks or BigQuery use in v1. Later share tables are a whole-table
  load per release each, cents against the measured $0.99 to $4.73 October
  jobs.

## Ownership and release of the package

The owner triages `control_failed` rows and `measure_agrees = false` rows from
the release diff. The CC0 package is versioned with git tags (`ndh-quality-vX.Y.Z`)
and a `CHANGELOG.md`; a rule's `rule_version` bump is a changelog entry. If
the CMS engineer adopts it upstream, the package moves and AINPI depends on
the released version.

## Risks

- **Cloud placeholders.** Parts of `~/Documents` are offloaded by iCloud; on
  2026-10-28 `frontend/data/parquet-export/2026-10-07/location.parquet` was a
  placeholder, and reads hang. The runner checks the `dataless` flag first.
- **Rule drift from the H-number.** `relation` makes partial ports explicit;
  `rule_version` and the measure comparison catch silent drift.
- **The measure and the rule disagree** on a paired quantity: investigated,
  never absorbed by widening the tolerance.
- **Upstream location undecided.** `ndh_quality/` stays self-contained.

## Calls made in writing this (not decided by the owner)

- Local, owner-run execution in v1; CI validates files and runs unit tests.
- Archive loads are never blocked; `pipeline` failures block derived outputs
  only; results always published.
- Thresholds only for `implements` rules whose registered text gives a number.
- `not_paired` where definitions differ; pairing in v1 for two measures only.
- The accepting-new-patients rule is deferred.
- No archive reload; `input_fingerprint` records which copy a result read.
- Fingerprint diff in v1; ODCS contract, provenance, share tables and MCP
  tools later.

## Left to the builder

- Internal layout of `ndh_quality/` beyond one rule per file.
- Whether rules sharing a table share a read.
- Per-measure tolerances, within the stated form.
- The fingerprint's "moved more than a stated share" threshold.
- Wording of the README and changelog.

## Appendix: the spike's SQL (2026-11-02)

Run through InLaw 0.2.0 on DuckDB 2.0 over
`frontend/data/parquet-export/<release>/*.parquet`. Results on 2026-10-07:
9,526,462 NPIs checked (all 7,481,907 practitioners plus the 2,044,555
organizations carrying an NPI), 0 invalid, matching H9's published
`npi-validity-summary.json`; no dangling role references; 16,247 of 111,259
FHIR REST endpoints (14.6%) name an organization in the file, 16,353 carry a
reference. On 2026-08-20: 16,262 of 110,973 (14.7%).

NPI check digit. Two fixes were needed: `try_cast`, because DuckDB does not
short-circuit `AND` and `cast` raised on a non-digit; and `lambda i:`, because
DuckDB 2.0 rejects the `i ->` lambda.

```sql
regexp_full_match(npi, '[0-9]{10}') and
(10 - (24 + list_sum(list_transform(range(1, 10), lambda i:
   case when i % 2 = 1
        then (try_cast(substr(npi, i, 1) as int) * 2) // 10
           + (try_cast(substr(npi, i, 1) as int) * 2) % 10
        else try_cast(substr(npi, i, 1) as int) end))) % 10) % 10
= try_cast(substr(npi, 10, 1) as int)
```

Wrap it in `coalesce(..., false)` so a malformed value counts as invalid.

Role references:

```sql
with r as (select _practitioner_id, _org_id from practitioner_role),
     p as (select 'Practitioner/' || _id ref from practitioner),
     o as (select 'Organization/' || _id ref from organization)
select count(*) roles,
       count(r._org_id) with_org_ref,
       count(*) filter (where p.ref is null) dangling_practitioner,
       count(*) filter (where r._org_id is not null and o.ref is null) dangling_org
from r left join p on r._practitioner_id = p.ref
       left join o on r._org_id = o.ref
```

Endpoint linkage (presence and resolvability counted separately, as H50 does):

```sql
with e as (select _managing_org_id m from endpoint
           where _connection_type = 'hl7-fhir-rest'),
     o as (select 'Organization/' || _id ref from organization)
select count(*) fhir_rest, count(m) with_reference, count(o.ref) resolvable
from e left join o on e.m = o.ref
```

Endpoint types present: counts of `_connection_type = 'hl7-fhir-rest'` and
`'direct-project'`, each required to be at least 1.
