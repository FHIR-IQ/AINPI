# NDH data quality first slice: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1 of the data-quality design: a CC0 rules package with five rules, a runner that merges append-safe results into `dq-results.json`, a curated source-changes log, a full-scan structural fingerprint diff, and the release-diff report.

**Architecture:** `ndh_quality/` is a self-contained CC0 Python package (InLaw rules over DuckDB, no imports from `analysis/`). `analysis/` scripts call it: `dq_run.py` writes results, `ndh_fingerprint.py` fingerprints a release, `dq_release_diff.py` compares two releases, `source_changes.py` publishes the curated log. Everything runs locally over `frontend/data/parquet-export/<release>/`; CI runs unit tests and schema validation only.

**Tech Stack:** Python 3.13, InLaw 0.2.0, Great Expectations 1.x, DuckDB 2.0 line, duckdb_engine, SQLAlchemy 2, PyYAML, pytest.

**Spec:** `docs/superpowers/specs/2026-11-03-ndh-quality-and-source-governance-design.md` (read the "Revision after expert review" section first; the appendix holds the spike SQL).

## Global Constraints

- `ndh_quality/` is CC0 1.0 with its own `LICENSE`; it never imports from `analysis/` or `frontend/`.
- Python 3.13 for `ndh_quality` (InLaw 0.2.0 declares 3.10 to 3.13). Pins: `inlaw==0.2.0`, `great-expectations>=1,<2`, `duckdb>=2,<3`, `duckdb_engine`, `sqlalchemy>=2`.
- DuckDB 2.0 rejects `x -> expr` lambdas: write `lambda x: expr`. Cast digits with `try_cast`, never `cast` (DuckDB does not short-circuit `AND`).
- Rules aggregate in SQL and return one row (InLaw loads results into pandas).
- No output contains an NPI or any matched value. Counts, URLs and codes only.
- Results are always published, failures included. A `pipeline` failure exits non-zero after writing. Nothing in this plan gates the Databricks archive load.
- Severity values: `pipeline`, `expect`, `monitor`. Status values: `pass`, `fail`, `control_failed`, `error`, `recorded`.
- Results key: (`release_date`, `rule_id`, `rule_version`). Merge, never regenerate; a re-run with a changed `input_fingerprint` supersedes.
- Field control floor: control fails if the count is 0 or below 50% of the previous release's count.
- No BigQuery, no Databricks, no network in any step except `pip install`.
- Prose: no em dashes; plain direct sentences.

## Review Focus

1. **An input file is an iCloud placeholder** (macOS `dataless` flag): the runner and fingerprinter must stop with the path named before reading, never hang. Test in Task 6 and Task 8.
2. **The flattened `_npi` and H9 disagree on 2026-08-20** (the measure has 4 failing of 11,607,656; the spike found 0): `measure_agrees` must come out `false` with both values recorded, not be smoothed away. Test in Task 6 with these exact numbers.
3. **A release present in `dq-results.json` but missing locally**: re-running for another release must keep its rows untouched. Test in Task 6.
4. **The previous release is absent** (first run): the field control applies the non-zero test only and `control_previous` is null. Test in Task 1.
5. **A renamed field** (e.g. `_connection_type` present but every value null, or the column missing): the rule reports `control_failed`, never `pass` or a crash. Test in Tasks 2 to 4.

---

### Task 1: Package skeleton and rule base

**Files:**
- Create: `ndh_quality/LICENSE` (CC0 1.0 full text), `ndh_quality/pyproject.toml`, `ndh_quality/ndh_quality/__init__.py`, `ndh_quality/ndh_quality/base.py`, `ndh_quality/ndh_quality/rules/__init__.py`, `ndh_quality/tests/conftest.py`, `ndh_quality/tests/test_base.py`, `ndh_quality/CHANGELOG.md`

**Interfaces:**
- Produces:
  - `base.parquet_source(release_dir: str | Path, resource: str) -> str`: returns `read_parquet('<dir>/<resource>.parquet')`.
  - `base.assert_not_dataless(paths: Iterable[Path]) -> None`: raises `RuntimeError` naming the first path whose `os.stat(p).st_flags & 0x40000000` (SF_DATALESS) is set; no-op where `st_flags` is absent.
  - `base.field_control(count: int, previous: int | None, floor: float = 0.5) -> bool`.
  - `base.evaluate(threshold: dict | None, value: float | None, control_passed: bool, severity: str) -> str`: returns a status. Order: control first (`control_failed`), then `monitor` gives `recorded`, then threshold `{op, value}` with op in `>=`, `<=`, `<`, `>`, `==`.
  - `class NdhRule(InLaw)`: class attributes `rule_id: str`, `rule_version: int`, `hypotheses: list[str]`, `relation: str` (`implements` | `partial` | `related` | `control`), `measure: str | None`, `severity: str`, `threshold: dict | None`, `resources: list[str]`; abstract `measure_sql(settings) -> str` returning one row with columns `numerator, denominator, control_count, detail`; `measure(engine, settings, previous=None) -> dict` running it and adding `value`, `control_previous`, `control_passed`; `run(engine, settings=None) -> bool | str` (InLaw's interface) applying the threshold through a Great Expectations expectation on the one-row result and returning `True` or a message with the counts.
  - `base.open_engine() -> sqlalchemy.Engine` for `duckdb:///:memory:`.
  - `conftest.py` fixture `release_dir(tmp_path)` factory: `make_release(tables: dict[str, list[dict]]) -> Path` writing each table to `<resource>.parquet` with DuckDB.

- [ ] **Step 1: Write failing tests** in `ndh_quality/tests/test_base.py`:
  - `test_field_control_rejects_zero`: `field_control(0, None) is False`.
  - `test_field_control_first_run_nonzero_passes`: `field_control(5, None) is True`.
  - `test_field_control_floor`: `field_control(49, 100) is False`, `field_control(50, 100) is True`.
  - `test_evaluate_order`: `evaluate({'op': '>=', 'value': 0.999}, 1.0, False, 'expect') == 'control_failed'`; `evaluate(None, 0.14, True, 'monitor') == 'recorded'`; `evaluate({'op': '>=', 'value': 0.999}, 0.998, True, 'expect') == 'fail'`; `... 0.9995 ... == 'pass'`.
  - `test_assert_not_dataless_names_path`: monkeypatch `os.stat` to return an object with `st_flags = 0x40000000`; `pytest.raises(RuntimeError, match='dataless')` and the message contains the path.
- [ ] **Step 2:** `cd ndh_quality && python3.13 -m pytest tests/test_base.py -q` → FAIL (module missing).
- [ ] **Step 3:** Implement `base.py`, `pyproject.toml` (project name `ndh-quality`, version `0.1.0`, `requires-python = ">=3.10,<3.14"`, the pins above, `pytest` in an optional `test` extra, console script `ndh-quality = ndh_quality.cli:main`), `LICENSE`, empty `CHANGELOG.md` with a `0.1.0` heading.
- [ ] **Step 4:** `python3.13 -m pytest tests/test_base.py -q` → PASS.
- [ ] **Step 5:** `git add ndh_quality && git commit -m "ndh_quality: package skeleton and rule base (CC0)"`

### Task 2: Rule `npi-check-digit`

**Files:**
- Create: `ndh_quality/ndh_quality/rules/rule_npi_check_digit.py`, `ndh_quality/tests/test_rule_npi_check_digit.py`

**Interfaces:**
- Consumes: `NdhRule`, `parquet_source`, `release_dir` fixture (Task 1).
- Produces: `NpiCheckDigit` with `rule_id='npi-check-digit'`, `rule_version=1`, `hypotheses=['H9']`, `relation='partial'` (H9 also covers NPPES agreement), `measure='npi-validation-failures'`, `severity='expect'`, `threshold={'op': '>=', 'value': 0.999, 'source_text': 'NPI structural validity is ≥99.9%'}`, `resources=['practitioner', 'organization']`. Numerator = NPIs valid, denominator = NPIs present on practitioner plus organization; `control_count` = NPIs present.

- [ ] **Step 1: Write failing tests:**
  - `test_valid_npis_pass`: practitioner `_npi` `['1234567893']`, organization `[]` → status `pass`, `numerator == denominator == 1`.
  - `test_bad_check_digit_fails`: `['1234567893', '1234567894']` x 500 each → `value == 0.5`, status `fail`.
  - `test_malformed_counts_invalid_not_crash`: `['12345678ab', '123', '1234567893']` → `numerator == 1`, `denominator == 3`.
  - `test_empty_field_control_failed`: practitioner rows with `_npi` all null → status `control_failed`.
  - `test_matches_h9_python`: generate 2,000 NPIs with valid check digits from a fixed seed (compute the digit with the Luhn rule on `80840` + 9 digits, implemented in the test itself), corrupt 200 by incrementing the last digit, append `'123'`, `'abcdefghij'`, `'12345678ab'`; assert the rule's `numerator` equals the count the test's own Python Luhn reports (the package must not import `analysis/`).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement with the appendix's check-digit SQL, wrapped in `coalesce(..., false)`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `ndh_quality: npi-check-digit rule`.

### Task 3: Rule `role-references-resolve`

**Files:** Create `rules/rule_role_references_resolve.py`, `tests/test_rule_role_references_resolve.py`.

**Interfaces:** Produces `RoleReferencesResolve`: `rule_id='role-references-resolve'`, `rule_version=1`, `hypotheses=['H6','H7','H8']`, `relation='partial'` (role references only), `severity='expect'`, `threshold={'op': '>=', 'value': 0.99, 'source_text': 'Cross-resource references resolve at ≥99% inside the bulk export.'}`, `resources=['practitioner_role','practitioner','organization']`. Numerator = references that resolve (practitioner refs plus non-null organization refs); denominator = those references; `control_count` = roles with a non-null `_practitioner_id`; `detail` gives dangling practitioner and organization counts separately.

- [ ] **Step 1: Tests:** all resolve → `pass`; 1 of 2 practitioner refs dangling → `value == 0.5`, `fail`, detail contains `dangling_practitioner=1`; null `_org_id` excluded from the denominator; `_practitioner_id` all null → `control_failed`.
- [ ] **Step 2:** FAIL. **Step 3:** implement from the appendix SQL. **Step 4:** PASS. **Step 5:** commit.

### Task 4: Endpoint rules

**Files:** Create `rules/rule_endpoint_types_present.py`, `rules/rule_fhir_rest_endpoint_share.py`, `rules/rule_endpoint_org_linkage.py`, and `tests/test_rules_endpoint.py`.

**Interfaces:** Produces:
- `EndpointTypesPresent`: `relation='control'`, `severity='pipeline'`, `hypotheses=[]`; numerator = count of distinct expected types present among `hl7-fhir-rest` and `direct-project`, denominator = 2; `control_count` = endpoint rows; status `pass` only when both present, else `fail`.
- `FhirRestEndpointShare`: `hypotheses=['H28']`, `relation='implements'`, `measure='fhir-rest-endpoint-share'`, `severity='monitor'`; numerator = `hl7-fhir-rest` rows, denominator = all endpoint rows; `control_count` = rows with non-null `_connection_type`.
- `EndpointOrgLinkage`: `hypotheses=['H50']`, `relation='implements'`, `measure='endpoint-org-linkage'`, `severity='monitor'`; numerator = FHIR REST endpoints whose `_managing_org_id` equals `'Organization/' || organization._id`; denominator = FHIR REST endpoints; `control_count` = FHIR REST endpoints; `detail` includes `with_reference=<n>`.

- [ ] **Step 1: Tests:** a fixture with 3 FHIR REST endpoints (one resolvable, one dangling, one null ref) and 2 Direct → linkage `numerator 1, denominator 3`, status `recorded`, detail `with_reference=2`; share `3/5`; types present `pass`. Second fixture with no Direct rows → types `fail`. Third fixture with `_connection_type` all null → all three `control_failed`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit.

### Task 5: CLI, rule registry, README

**Files:** Create `ndh_quality/ndh_quality/registry.py`, `ndh_quality/ndh_quality/cli.py`, `ndh_quality/README.md`, `ndh_quality/tests/test_cli.py`.

**Interfaces:**
- Produces: `registry.all_rules() -> list[type[NdhRule]]` (the five, sorted by `rule_id`); `registry.run_release(release_dir, previous_dir=None) -> list[dict]` (calls `assert_not_dataless` on every input file first, then `measure` for each rule, catching exceptions into status `error` with the message in `detail`); `cli.main(argv=None) -> int` for `ndh-quality run --release-dir DIR [--previous-dir DIR] [--json]`, printing one line per rule and returning 1 if any `pipeline` rule is not `pass`, else 0.

- [ ] **Step 1: Tests:** `test_cli_exit_codes` on a passing fixture → 0; on a fixture without Direct rows → 1; `test_rule_error_is_reported` with a missing `organization.parquet` → that rule's status `error`, others still run.
- [ ] **Step 2:** FAIL. **Step 3:** implement. README covers: what each rule measures; that a `fail` row means the registered expectation does not hold for that release; severities; how to get input (AINPI parquet export, or the Delta Sharing archive read with `delta-sharing` into Arrow and written to `<resource>.parquet`, with the exact commands); that CMS serves only the latest release; CC0. **Step 4:** PASS. **Step 5:** commit.

### Task 6: Runner `analysis/dq_run.py` and `dq-results.json`

**Files:**
- Create: `analysis/dq_run.py`, `analysis/tests/test_dq_run.py`
- Modify: `analysis/contract_schemas.py` (add `DQ_RESULTS_SCHEMA`, register as `"dq_results"`), `analysis/validate_contract.py` (`schema_pass` checks `API / "dq-results.json"` when present)

**Interfaces:**
- Consumes: `ndh_quality.registry.run_release` (Task 5).
- Produces:
  - `merge_results(existing: dict, new_rows: list[dict]) -> dict` (pure). Keeps rows for other releases untouched. Same key and same `input_fingerprint`: replace. Same key, different fingerprint: old row gets `superseded_by` = `"<rule_version>@<run_at>"`, new row appended.
  - `input_fingerprint(release_dir: Path, resources: list[str]) -> dict` mapping resource to `{rows, bytes}` plus `export_sha` read from `<release_dir>/_export.json` if present, else null.
  - `pair_measure(row: dict, measures: dict) -> dict` filling `measure_value` and `measure_agrees`: `not_paired` when the rule's `measure` is null or not one of `endpoint-org-linkage`, `npi-validation-failures`; `no_point` when the measure has no point for the release; else compares. `npi-validation-failures` is a failure share, so compare `1 - row.value` with exact counts: agree only if the failing count (`denominator - numerator`) equals the measure's `numerator`. `endpoint-org-linkage`: agree only if numerator and denominator both equal.
  - CLI: `python3 analysis/dq_run.py --release YYYY-MM-DD [--release ...]` writes `frontend/public/api/v1/dq-results.json` as `{"schema_version": 1, "generated_at": ..., "rows": [...]}` sorted by (`release_date`, `rule_id`, `rule_version`), each row carrying the fields in the spec's component 2 table plus `engine` (`duckdb <version>`), `git_sha`, `run_at`. Exits 1 after writing if any `pipeline` row for a requested release is not `pass`.
- [ ] **Step 1: Tests:**
  - `test_merge_keeps_unrun_releases`: existing has 2026-05-08 rows; merging 2026-10-07 rows leaves them byte-identical.
  - `test_merge_supersedes_on_changed_fingerprint` and `test_merge_replaces_on_same_fingerprint`.
  - `test_pair_npi_disagrees_2026_08_20`: row `numerator=11607656, denominator=11607656` against the measure point `numerator=4, denominator=11607656` → `measure_agrees == 'false'`, `measure_value` recorded.
  - `test_pair_linkage_agrees`: `16247 / 111259` against the 2026-10-07 point → `'true'`.
  - `test_unpaired_rule`: `measure=None` → `'not_paired'`.
  - `test_schema_valid`: a generated document validates against `SCHEMAS['dq_results']`.
- [ ] **Step 2:** `python -m pytest analysis/tests/test_dq_run.py -q` → FAIL.
- [ ] **Step 3:** Implement. `analysis/tests` runs on Python 3.12 in CI without InLaw, so `dq_run.py` imports `ndh_quality` only inside `main()`; the tested functions are pure.
- [ ] **Step 4:** PASS, and `python3 analysis/validate_contract.py` still passes.
- [ ] **Step 5:** commit `dq_run: append-safe results with measure pairing`.

### Task 7: Source-changes log

**Files:** Create `analysis/source_changes.yaml`, `analysis/source_changes.py`, `analysis/tests/test_source_changes.py`, `frontend/public/api/v1/source-changes.json` (generated).

**Interfaces:** Produces `load_entries(path) -> list[dict]`, `validate(entries) -> list[str]` (errors), and CLI `python3 analysis/source_changes.py` writing the JSON with `schema_version: 1`. Fields and `kind` values exactly as the spec's component 3 table.

- [ ] **Step 1: Tests:** every entry has all fields; `id` matches `^sc-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$`; `kind` in the allowed set; every `handled_by` path (the part before `:`) exists in the repo; entries with `first_release >= "2026-11-01"` have a non-empty `evidence_ref` citing a fingerprint diff line or a `dq-results` key; the committed JSON equals the generator output.
- [ ] **Step 2:** FAIL. **Step 3:** Seed the entries listed in the spec's component 3 from `CLAUDE.md` and the run docs (NPI identifier URL 2026-05-08; taxonomy system URL and ValueSet canonical 2026-08-20; role specialty to NUCC; Endpoint/Location id re-minting 2026-05-08 and 2026-08-20 with partial carry-over 2026-10-07; manifest key renumbering and eight files 2026-08-20; extension vocabulary replacement; `ein` organization records; single accepting-new-patients value; OIG LEIE blanks as `0` and eClinicalWorks endpoint list move as `kind: upstream-file`). Every `evidence` field cites a repo path or ainpi.dev URL; no figure that is not in a published file. **Step 4:** PASS. **Step 5:** commit.

### Task 8: Structural fingerprint and diff

**Files:** Create `analysis/ndh_fingerprint.py`, `analysis/tests/test_ndh_fingerprint.py`. Output `frontend/public/api/v1/fingerprints/<release>.json`.

**Interfaces:** Produces `fingerprint(release_dir: Path) -> dict` (per resource: `records`, `key_paths` {path: count}, `systems` {url: count} from every `system` key, `codes` {`connectionType`|`org_type`: {code: count}}, `id_patterns` {`npi`|`uuid`|`other`: count}); `diff(prev: dict, new: dict, moved_share: float = 0.2) -> list[dict]` returning `{resource, kind: appeared|vanished|moved, item, prev, new}`; CLI `fingerprint --release R` and `diff --prev R1 --new R2` (markdown to stdout). Paths are JSON key paths with array indices collapsed to `[]`. Implementation reads the parquet `resource` column with DuckDB (`json_tree` or equivalent), calls `assert_not_dataless`-equivalent logic first (copy the 10-line check; `analysis/` may import `ndh_quality`, but keep this script runnable on 3.12 by inlining it).

- [ ] **Step 1: Tests** on tiny fixture parquet: a path present in prev and absent in new → one `vanished`; a new `system` URL → `appeared`; a count change from 100 to 50 → `moved`; a placeholder file → error naming the path.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit.

### Task 9: Release diff report and checklist

**Files:** Create `analysis/dq_release_diff.py`, `analysis/tests/test_dq_release_diff.py`. Modify `analysis/ndh_release_check.py` (the issue body checklist) and its test.

**Interfaces:** Produces `report(prev: str, new: str, dq: dict, fp_diff: list[dict], measures: dict) -> str` (markdown sections: fingerprint changes, status changes, value moves beyond the measure's `ordinary_move` or 5 points, `control_failed` rows, `measure_agrees = false` rows). The release-watch issue checklist gains the four steps of the spec's component 8, in order, before any derived output is committed.

- [ ] **Step 1: Tests:** a status change pass→fail appears; a move under the threshold does not; `measure_agrees=false` rows are listed; the release-watch issue body contains `ndh_fingerprint.py` and `dq_run.py`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit.

### Task 10: CI job, backfill run, docs

**Files:** Modify `.github/workflows/ci.yml` (new job `ndh-quality-tests`: Python 3.13, `pip install -e ndh_quality[test]`, `python -m pytest ndh_quality/tests -q`), `CLAUDE.md` (a short section: the package, the runner, where results live, the never-gate-the-archive rule), `frontend/public/api/v1/manifest.json` via `analysis/build_manifest.py` if it lists `/api/v1` files. Create `docs/methodology/runs/2026-11-0X-dq-first-slice.md`.

- [ ] **Step 1:** Run `python3 analysis/ndh_fingerprint.py fingerprint --release` for 2026-05-08, 2026-08-20, 2026-10-07, then `diff` May→Aug and Aug→Oct. Expected: the diffs show the known changes (taxonomy system URL at Aug, the `ein` type collapse at Oct). If a known change is missing, the fingerprint is wrong: fix it before continuing.
- [ ] **Step 2:** `python3 analysis/dq_run.py --release 2026-05-08 --release 2026-08-20 --release 2026-10-07`. Expected for 2026-10-07: `npi-check-digit` 9,526,462 checked and 0 invalid; `endpoint-org-linkage` 16,247 of 111,259; role references pass. Expected for 2026-08-20: `npi-validation-failures` pairing `false` (0 against 4); record it, do not change the tolerance.
- [ ] **Step 3:** Investigate the 2026-08-20 NPI disagreement: find the 4 failing NPIs' records by counting (not printing) in the raw `resource` JSON versus `_npi`; write the explanation in the run doc. If the flattener drops malformed NPIs, add a source-changes or field note, not a fix in this plan.
- [ ] **Step 4:** `python3 analysis/suppression.py --check`, `python3 analysis/validate_contract.py`, `python -m pytest analysis/tests -q` → all pass.
- [ ] **Step 5:** Run the anti-slop linter on the run doc and README; commit `dq first slice: backfill three releases`.
