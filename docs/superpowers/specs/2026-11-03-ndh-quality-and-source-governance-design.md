# NDH data quality rules and source governance

**Date:** 2026-11-03
**Status:** Design (approved in chat; awaiting implementation plan)
**Owner:** Eugene Vestel
**Related:** `analysis/measures.py` and `/api/v1/measures.json` (the measure series), `analysis/databricks_publish.py` (the release archive and share), `frontend/src/app/api/mcp/route.ts` (the MCP server), `.github/workflows/ndh-release-watch.yml`, `frontend/src/data/findings.ts` (pre-registration), the InLaw package (`pip install inlaw`, CC0, a thin Great Expectations wrapper maintained by a CMS engineer)

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

1. A rules package any party can run on the NDH bulk data on their own compute.
2. A per-release pass/fail record for every rule, published with the archive.
3. A curated, machine-readable log of source changes between releases.
4. A data contract for the bulk export, checked first on every new release.
5. A provenance record for every flattened column the archive publishes.
6. MCP tools that let an agent read all of the above.
7. A release step in which an agent drafts and a person approves.

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
- **A rule that can pass on an empty read.** Every rule carries a positive
  control, and a failed control is its own status, never a pass.
- **Two published numbers for one quantity.** Where a rule measures what a
  published measure measures, the measure remains the citable number.
- **An unattended model writing to the record.** Agents draft; a person merges.
- **An NPI in any of the new outputs.** Rules publish counts only.

## Constraints

- **Cost.** The Databricks bill was $13.78 for October. Rules run on DuckDB
  over the local parquet export (no cloud compute). Databricks spend is one
  small whole-table load per release per new table, the same pattern as
  `measures`. No BigQuery queries are added.
- **Installers have no Databricks.** Open-sharing recipients read through the
  `delta-sharing` client; Databricks-to-Databricks recipients get read-only
  tables. So results ship as data, and the rule engine must run outside
  Databricks.
- **Licence boundary.** The rules package is CC0 in its own directory with its
  own `LICENSE`, so it can move to a CMS repository unchanged. The rest of
  AINPI stays Apache-2.0.
- **InLaw compatibility.** Each rule is an `InLaw` subclass whose `run(engine,
  settings=None)` returns `True` or a message, so InLaw's own runner works on
  it. The spike installed InLaw 0.2.0, Great Expectations 1.24.1 and DuckDB 2.0
  (which rejects the `->` lambda; use `lambda x:`). Pin all three.
- **InLaw loads each result into pandas.** Rules aggregate in SQL and return
  one row.
- **Suppression.** No new output carries an NPI, so `analysis/suppression.py`
  has nothing to filter. The guard (`--check`) must still pass over the new
  files.
- **Pre-registration.** A new rule that is not an existing H-number gets one
  (H56 onward) in `findings.ts` before its first result is published.

## Decided (by the owner, in chat on 2026-11-03)

- Great Expectations through InLaw is the rule engine, run on DuckDB by us and
  on any engine by installers.
- Results are published as a table in the share and as JSON.
- A source-changes log, an ODCS data contract and a field-provenance map are in
  scope, with MCP tools over them.
- The release step is agent-drafted and human-approved.
- The rules are CC0. Where they live upstream waits on the CMS engineer's
  answer (a separate repository, or ported to Cypher for the Neo4j project).

## Components

### 1. Rules package: `ndh_quality/` (CC0)

A top-level directory with its own `LICENSE` (CC0 1.0), `README.md`,
`pyproject.toml` and `tests/`. One rule per file, `rule_<slug>.py`, following
the one-check-per-file convention of the CMS engineer's `sensible_data_checks`.

Each rule is an `InLaw` subclass with these class attributes:

| Attribute | Meaning |
|---|---|
| `rule_id` | Stable slug, e.g. `npi-check-digit` |
| `rule_version` | Integer, bumped whenever the SQL or threshold changes |
| `hypotheses` | H-numbers it implements, e.g. `["H9"]` |
| `measure` | The measure slug it overlaps, or `None` |
| `severity` | `gate`, `expect` or `monitor` (below) |
| `threshold` | The registered expectation, or `None` for `monitor` |
| `resources` | Parquet files it reads |

and one static method beyond InLaw's `run`:

`measure(engine, settings) -> dict` returns `{numerator, denominator,
control_rows, control_passed, detail}` from a single aggregate query. `run`
calls `measure`, applies the threshold through a Great Expectations
expectation, and returns `True` or a message containing the counts. The
runner (component 2) calls `measure` directly so it can record the numbers.

`settings["release_dir"]` points at one release's parquet directory
(`frontend/data/parquet-export/<release>/`). The package must also accept
NDJSON through DuckDB's `read_json` so a reader without our parquet export can
run it; the parquet path is primary.

**Severity:**

- `gate`: a failure stops publication of that release's derived files. Only
  structural rules: positive controls on every table, the contract (component
  4), referential integrity.
- `expect`: a failure is recorded and published but does not stop anything.
  Most rules.
- `monitor`: no threshold; the value is recorded so a change between releases
  is visible.

**Thresholds (builder-check answer).** A rule's threshold is the number its
H-number's registered null hypothesis states in `findings.ts` (for example
H9 at least 99.9% valid, H6-H8 at least 99% resolvable, H14-H15 under 1%
duplicate). Where the registered text gives no number (H10-H12 "within
documented drift thresholds", H43, H50), the rule is `monitor`: it records the
value and changes nothing, and no one invents a bar. Registering a bar for
those later is a new pre-registration, not a code change. A `fail` row means
the registered expectation does not hold for that release; the README says so
in those words.

**First rule set** (the builder takes each threshold's exact wording from
`findings.ts`; severities below are revised by the threshold rule above):

| Rule | From | Severity | Measure |
|---|---|---|---|
| `table-nonempty` (one per resource) | positive control | gate | |
| `npi-check-digit` | H9 | expect | `npi-validation-failures` |
| `role-practitioner-resolves`, `role-organization-resolves` | H6-H8 | gate | |
| `location-managing-org-resolves`, `affiliation-orgs-resolve` | H6-H8 | expect | |
| `practitioner-taxonomy-valid`, `role-specialty-valid` | H10-H12 | expect | |
| `role-specialty-agreement` | H13 | expect | `role-specialty-agreement` |
| `practitioner-npi-unique` | H14-H15 | expect | |
| `last-updated-distinct-values` | H18 | monitor | |
| `ssn-pattern-absent` | H27 | expect | `ssn-exposures` |
| `fhir-rest-endpoint-share` | H28 | monitor | `fhir-rest-endpoint-share` |
| `endpoint-types-present` | positive control | gate | |
| `practitioner-phone-present` | H43 | monitor | none (narrower than the measure) |
| `endpoint-org-linkage` | H50 | monitor | `endpoint-org-linkage` |

`accepting-new-patients-varies` (the extension carries one value on every
record) is deferred: it would need a new H-number, a threshold the owner sets,
and a finding page, and the CMS-4214-P comment already reports the fact. Add it
in a later round.

The four spike rules (`npi-check-digit`, the two role-reference rules combined
in the spike, `endpoint-org-linkage`, `endpoint-types-present`) are the
starting code. The spike's files did not survive the session's temporary
folder; its SQL, with both fixes it needed, is in the appendix. The spike
checked its check-digit SQL against `analysis/h9_npi_luhn.py` on 202,004
values (200,000 sampled 2026-10-07 practitioner NPIs, 2,000 of them with the
check digit incremented, and three malformed strings) with zero
disagreements; that comparison becomes a test.

`ssn-pattern-absent` reads the raw `resource` column and must keep H27's rules:
it publishes counts and JSON locations only, never a matched value, and it
carries H27's control (the `qualification` array is still present).

`practitioner-phone-present` covers the Practitioner record only. H43's
three-path traversal needs Location telecom, and the local 2026-10-07 location
parquet is a cloud placeholder on the owner's machine (see Risks). The rule
says so in `detail`.

**Tests** (`ndh_quality/tests/`, pytest, no network): each rule gets three
DuckDB fixtures built in memory, a passing one, a failing one, and an empty
one. The empty one must produce `control_passed = false` and a non-pass
status. The check-digit rule also gets the comparison against the Python H9
implementation.

### 2. Runner and results: `analysis/dq_run.py`, `dq_results`

`python3 analysis/dq_run.py --release 2026-10-07` (repeatable flag; default
every release directory present except `_superseded`) runs every rule's
`measure` and writes:

- `analysis/data/dq/<release>.json` (gitignored working copy)
- `frontend/public/api/v1/dq-results.json`: every release, every rule
- `frontend/data/parquet-export/dq_results/dq_results.parquet` for the share

One row per (release, rule):

| Column | Type | Meaning |
|---|---|---|
| `release_date` | date | |
| `rule_id` | string | |
| `rule_version` | int | |
| `hypotheses` | string | pipe-joined |
| `severity` | string | gate / expect / monitor |
| `numerator`, `denominator` | bigint | `null` for a rule that counts only |
| `value` | double | numerator / denominator, or the count |
| `threshold` | string | as registered, `null` for monitor |
| `control_rows` | bigint | rows the positive control read |
| `control_passed` | boolean | |
| `status` | string | `pass`, `fail`, `control_failed`, `error`, `monitor` |
| `measure` | string | overlapping measure slug or `null` |
| `measure_value` | double | that measure's published value for the release |
| `measure_agrees` | string | `true`, `false`, `no_point`, or `not_paired` |
| `engine` | string | e.g. `duckdb 2.0.0` |
| `git_sha` | string | commit the rules ran from |
| `run_at` | timestamp | |
| `detail` | string | short text, never an NPI |

**Measure agreement.** Rules run on DuckDB over parquet; measures came from
BigQuery. Where both exist, `measure_agrees` compares them within a stated
tolerance (exact for counts; 0.05 points for shares, which the builder may
tighten). A disagreement is a finding about our own pipeline and opens an
issue. The measure stays the citable number. A rule is paired with a measure
only when the numerator and denominator are defined the same way (same
resource subset, same active filter); before pairing, the builder checks the
measure's `definitions` in `measures.json`. A rule that measures something
narrower or different has `measure = null` and `measure_agrees = not_paired`,
so a disagreement by construction never opens an issue.

**Where it runs (builder-check answer).** The parquet export exists only on the
owner's machine, so v1 runs locally, as an owner-run step, not in CI. It runs
after `export_parquet.py` and before `databricks_publish.py --load` for a
release. CI only validates the committed `dq-results.json`,
`source-changes.json` and `field-provenance.json` against their schemas
(through `analysis/validate_contract.py`) and runs the rule unit tests.

**Gate behaviour.** If any `gate` rule fails for a release, the runner writes
the results and then exits non-zero. A failed gate blocks two things only:
`databricks_publish.py --load` and `--share` for that release's partitions
(the publish script checks the release's `gate` rows in `dq_results` and
refuses), and committing that release's `dq-results.json`. BigQuery finding
JSONs and `measures.json` are not wired to it in v1.

**Which copy the results describe.** The rules read the parquet export. The
Databricks archive was loaded from the same parquet for every column except
the four practitioner and three organization address columns, which in the
archive still hold `address[0]` values by the owner's decision of 2026-10-27
(no reload). No first-set rule reads an address column, so `dq_results`
describes the archive as published. A rule that reads an address column must
set `detail` to say which rule its input used, and must not be added before
that is decided.

**Backfill.** Run for 2026-05-08, 2026-08-20 and 2026-10-07 from the existing
parquet. All three were re-exported on 2026-10-27 with the current extractor,
so their flattened columns are comparable.

**Share.** `dq_results` joins `SERIES_TABLES` in `databricks_publish.py`: one
file for every release, loaded whole with `CREATE OR REPLACE ... PARTITIONED BY
(release_date)`, like `measures`. Table comment: the severity meanings, that a
missing row means the rule was not run, and the measure-precedence rule.

### 3. Source-changes log: `analysis/source_changes.yaml`

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

Published as `frontend/public/api/v1/source-changes.json` and as a
`source_changes` table in the share (whole-table load). A test asserts every
entry's `handled_by` file exists.

### 4. Data contract: `contracts/ndh-bulk-export.odcs.yaml`

An Open Data Contract Standard (v3.1) document describing the bulk export as
AINPI relies on it: the manifest shape, the resource files, and for each
resource the elements the extractors read, the identifier and code systems
they accept, and the id behaviour across releases. It states what we observe
and depend on; it is not a claim about what CMS promises.

`analysis/ndh_contract_check.py` validates a release against it before any
rule runs: manifest keys resolve, every expected resource is present, expected
elements appear in a sample of records (a sample of 10,000 per resource is
enough to detect a removed or renamed element), and code-system URLs fall in
the accepted set. It writes its result as rows of `dq_results` with
`rule_id = contract-<check>` and severity `gate`. A contract failure is the
signal for a new source-changes entry.

The checker reads the parquet `resource` column or the raw NDJSON; it never
needs BigQuery.

### 5. Field provenance: `analysis/field_provenance.yaml`

One entry per flattened column the archive publishes (`_npi`, `_state`,
`_address_line`, `_specialty_codes`, ...):

| Field | Meaning |
|---|---|
| `table`, `column` | |
| `fhir_path` | The element(s) read, with cardinality from the NDH IG |
| `rule` | How one value is chosen, e.g. "first address typed physical or both, else use work, else first object" |
| `extractor` | File and function |
| `rule_since` | Date the current rule took effect |
| `previous_rules` | List of earlier rules with their date ranges |
| `notes` | Known traps, e.g. "pipe-joined; see `_specialty_code` for the first entry only" |

Each entry may carry a per-target override, because the copies differ: the
Databricks archive's practitioner and organization address columns still hold
`address[0]` values in all three partitions, while BigQuery and the parquet
export use the physical-address rule. The archive entry states that, and
points at the SQL already in the table comment (`PHYSICAL_ADDRESS_SQL`).

Published as `frontend/public/api/v1/field-provenance.json`. In Databricks,
`do_share()` writes each entry's archive variant as the column comment (it already re-applies
table comments every run, so this extends the same mechanism). A test asserts
every flattened column in the extractor output has an entry, so a new column
cannot ship without one.

### 6. MCP tools

Three new tools in `frontend/src/app/api/mcp/route.ts`, each reading a static
file from the CDN and indexed in module scope like `lookup_organization`:

- `get_quality_results(release?, rule_id?)`: rows from `dq-results.json`.
  With no arguments, the latest release's non-passing rules.
- `get_source_changes(release?, resource?)`: entries from
  `source-changes.json`.
- `get_field_provenance(table, column?)`: entries from
  `field-provenance.json`.

No warehouse query, so no cost at call time; they sit behind the existing rate
limiter. A failed file fetch is a tool error, never an empty answer. Tests
follow `frontend/tests/api/mcp-auth.test.ts`. The `/developer` page and
`manifest.json` list the three new files and tools.

### 7. Release step with an agent

When `ndh-release-watch.yml` opens its "New CMS NDH release" issue, the
checklist gains, after the ingest and parquet export:

1. Run `ndh_contract_check.py`, then `dq_run.py --release <new>`.
2. Run `analysis/dq_release_diff.py <previous> <new>` locally (it reads the
   committed `dq-results.json`, so it could also run in CI later), which
   writes a deterministic markdown comparison: contract failures, rules whose status
   changed, rules whose value moved more than the measure's `ordinary_move`
   (or 5 points where none is set), and `measure_agrees = false` rows.
3. An agent (Claude Code, run by the owner) reads the diff and drafts:
   new `source_changes.yaml` entries for contract failures, a GitHub issue per
   unexplained change, and the release-note paragraph.
4. The owner reviews and merges. Nothing the agent drafted is recorded until
   then.

No model runs unattended in CI: it would need an API key in the workflow and
would write to the record without review.

## Testing

- `ndh_quality/tests/`: pass, fail and empty fixtures per rule; the H9
  comparison.
- `analysis/tests/`: `dq_run` writes the documented schema; a failed gate exits
  non-zero after writing; `measure_agrees` logic; `source_changes.yaml` and
  `field_provenance.yaml` schema and coverage tests; contract checker against a
  fixture release with one removed element and one changed code system.
- `frontend/tests/`: the three MCP tools, including the failed-fetch error.
- CI: add `ndh_quality/tests` to the existing analysis job (no network).

## Cost

- Rules and contract: local DuckDB, no cloud spend. The spike's four rules took
  about 16 minutes for two releases on the owner's laptop, almost all of it in
  reads of the role and organization files. The builder should measure the
  full set and, if needed, have rules that share a table read it once.
- Share: three new small tables, each a whole-table load per release. Expect
  cents per release against the measured $0.99 to $4.73 for the October jobs.
- MCP tools: static files, no warehouse.

## Risks

- **Cloud placeholders.** Parts of `~/Documents` are offloaded by iCloud; on
  2026-10-28 `frontend/data/parquet-export/2026-10-07/location.parquet` was a
  placeholder, and reads of placeholders hang. The runner checks every input
  file for the `dataless` flag before reading and stops with the path named.
- **The measure and the rule disagree** because they run on different engines
  over different copies. That is the point of recording it, but the first run
  may surface several. Each is investigated, not tolerated by widening the
  tolerance.
- **Rule drift from the H-number.** A rule rewritten in SQL can quietly change
  what the H-number meant. `rule_version` plus the measure comparison catch
  most of it; the review of each rule's port checks the rest.
- **Upstream location of the package is undecided.** Keep `ndh_quality/`
  self-contained (no imports from `analysis/`) so it can move.

## Calls made in writing this (not decided by the owner)

- Local, owner-run execution in v1; CI validates files and runs unit tests
  only.
- A failed gate blocks the share load and the commit of that release's
  results, nothing else.
- Thresholds only where the registered text gives a number; otherwise
  `monitor`.
- `measure_agrees = not_paired` for rules that measure something different
  from the paired measure.
- The H56 accepting-new-patients rule is deferred.
- No archive reload; provenance describes each copy as it stands.

## Left to the builder

- Internal layout of `ndh_quality/` beyond one rule per file, and any shared
  helpers.
- Whether rules sharing a table share a read.
- Exact tolerances for `measure_agrees`, within the bound above.
- The contract's sample size, if 10,000 proves too small or too slow.
- Wording of table comments and the README.

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
