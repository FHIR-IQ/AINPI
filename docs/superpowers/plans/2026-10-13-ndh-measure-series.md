# NDH measure series: implementation plan

**Date:** 2026-10-13
**Design:** `docs/superpowers/specs/2026-09-12-ndh-measure-series-design.md`
**Tracking:** FHI-24
**Status:** Slice 1 in this PR; slices 2 to 6 below are follow-ups.

## Goal

Move publication from one-release findings to measures: a named quantity with
a fixed definition and one point per CMS release, with definition breaks and
unreviewed moves recorded rather than drawn through.

## What slice 1 ships, and what it does not

Slice 1 builds the series from values already committed to this repository. It
runs no query. That makes it cheap and safe to ship ahead of the BigQuery work,
and it also limits what it can claim, so the limits are listed first.

**Every point is an as-published value, not a recomputation.** The design
requires each point to be computed with today's definition. Slice 1 cannot do
that without BigQuery. A May point here is what the May finding said when it
was published. Slice 3 recomputes it, and any difference becomes a restatement.

**`definition_version` is declared by hand, not derived.** The design derives it
from a hash of the measure's SQL. There is no SQL in slice 1, so each measure
declares its versions and the break between them, and `definition_hash` hashes
the declared numerator and denominator text. Slice 3 moves the hash onto the
SQL.

**The ordinary-move priors were set with both points already known.** The
plausibility guard depends on a prior declared before the numbers. For the ten
measures in slice 1 that was not possible, because both points existed before
the registry did. `measures.json` says so in its `note`. Every measure added
after this slice declares its prior before its first point.

### Files

| File | Change |
| --- | --- |
| `analysis/measures.py` | New. Registry of 10 measures plus the generator. |
| `analysis/release-snapshots/published/*.json` | New. Eight as-published finding payloads copied byte for byte from git history, with a README naming each source commit. |
| `analysis/tests/test_measures.py` | New. 29 pytest cases. |
| `frontend/public/api/v1/measures.json` | New file in the public contract. Additive. |
| `frontend/src/lib/api-v1-types.ts` | New `ApiV1Measures` type family. |
| `frontend/tests/lib/measures-contract.test.ts` | New. Checks the JSON against the type at runtime. |
| `.github/workflows/weekly-refresh.yml` | One step: run `measures.py` after `build_stats.py` and before `build_manifest.py`. |

### Why vendor the old findings

Each finding JSON is overwritten when the warehouse is reloaded, so the May
values survive only in git history. Reading git from the generator fails on a
shallow CI checkout, and parsing the values out of prose is how a number
drifts. Slice 1 therefore copies the eight payloads it needs into
`analysis/release-snapshots/published/<slug>@<sha>.json`, unedited. A reader
can check any one of them with `git show <sha>:frontend/public/api/v1/findings/<slug>.json`.

### Measures in slice 1

| Slug | 2026-05-08 | 2026-08-20 | Pair |
| --- | --- | --- | --- |
| `role-coverage-pa` | 86,816 / 227,727 | 100,918 / 230,837 | reviewed, comparable |
| `fhir-rest-endpoint-share` | 114,071 / 1,360,585 | 110,973 / 1,128,169 | comparable |
| `endpoint-org-linkage` (H50) | 19,334 / 114,071 | 16,262 / 110,973 | comparable |
| `vendor-filled-attribution` (H51) | 71,857 / 94,737 | 61,432 / 94,711 | **unreviewed** |
| `payer-directory-endpoints` (H49) | 1 / 114,071 | 1 / 110,973 | comparable |
| `ssn-exposures` (H27, count) | 41 | 0, with positive control | reviewed, comparable |
| `npi-validation-failures` (H9) | 2 / 10,853,455 | 4 / 11,607,656 | comparable |
| `role-specialty-agreement` (H13) | 206,603 / 2,270,482 (v1) | 5,759,067 / 5,759,162 (v2) | **break, not comparable** |
| `practitioner-phone-reachability` (H43) | 7,195,270 / 7,196,385 | 7,371,320 / 7,373,232 | comparable |
| `organization-coded-type` | 1,999,818 / 3,414,375 | 2,202,759 / 4,402,671 | **unreviewed** |

`role-specialty-agreement` also carries a restatement. The 2026-08-20 value was
first published on 2026-08-21 as 5,275,554 / 5,275,635, reading only the first
entry of each repeating specialty element. On 2026-08-28 it was restated to read
every entry. Both values are in the JSON.

The two `unreviewed` pairs are left unreviewed on purpose. The H51 move may come
from the vendor files, which are fetched at run time, as much as from the
directory. The organization-typing move tracks the growth of tax-entity
records. Neither has been checked, and the guard exists to say so.

### Candidates left out, and why

These are also listed in `measures.json` under `excluded_candidates`.

- **National role coverage.** No committed file carries the count of
  practitioners with a role for either release. Only rounded percentages appear,
  in prose.
- **`Organization.partOf` resolvability.** The May value is prose only. The
  August value is a percentage plus a prose detail string in
  `primer-scoreboard.json`.
- **Payer organizations with an endpoint.** May had no payer organization type,
  so it has no denominator. The August numerator is prose only.
- **Location phone coverage.** `ndh-column-coverage.json` has a rounded
  percentage and no numerator, for August only. Back-computing a count from a
  rounded percentage would invent one.

### Rules the generator enforces

Each rule has a pytest case.

1. A point's release is read from the source file itself. A source carrying a
   release outside the series is ignored.
2. A release with no source is listed under `omitted` with the reason. Nothing
   is interpolated or carried forward.
3. A ratio needs a positive denominator. A missing or zero denominator is an
   omission, never a zero.
4. A zero numerator needs a positive control. H27's control is a sentence in
   the finding's notes, so the generator checks that the sentence is still there
   and drops the point if it is not.
5. Two sources for one release raise an error unless one is declared a
   restatement.
6. `definition_version` may change only at a declared break. The pair across a
   break takes the break's `comparable_across_break`.
7. A move larger than the declared prior, with no break and no review, is
   `"unreviewed"`.
8. Snapshot extractors check that the category counts sum to the table row
   count before they use them.
9. The committed `measures.json` must equal the generator's output.
   `test_committed_measures_json_matches_the_generator` checks this, so a
   correction made by hand in the JSON fails the test. CI runs it on every
   push and PR through the `Analysis unit tests` job in `ci.yml` (FHI-40).

### Verification

```bash
python3 analysis/measures.py                    # writes measures.json; prints every point and omission
python3 -m pytest analysis/tests/ -q            # includes test_measures.py
python3 analysis/validate_contract.py
cd frontend && npx vitest run tests/lib/measures-contract.test.ts tests/lib/release.test.ts
cd frontend && npm run lint
```

### Rollout

The PR merges without a deploy dependency, because `measures.json` is a static
file nothing reads yet. The weekly refresh then runs `measures.py` after the
finding scripts. `measures.py` rewrites the file only when something other than
`generated_at` has changed, so the refresh adds no empty commits. The step is
`continue-on-error`, because the chain is fail-fast and a stale
`measures.json` costs less than a stranded finding refresh. It is not silent:
when it fails, the workflow commits the findings, then opens (or comments on)
an issue and fails the run.

**Required step before every reload, from this PR on.** Eight of the ten
measures read their 2026-08-20 point from a file the next reload overwrites:
seven current finding JSONs and `role-gap-delta.json`, matching the
`source.file` of each 2026-08-20 point in `measures.json`. The other two,
`fhir-rest-endpoint-share` and `organization-coded-type`, read the release
snapshots, which are not overwritten. If nobody copies those files
first, the generator omits 2026-08-20 on its next run, as its rules require,
and the series drops back to one point. `role-gap-delta.json` carries both
the May and August PA points, so regenerating it for the next release pair
drops May as well, and its new `from` side repeats August: registering the
vendored copy alongside the new file then raises "two sources for one
release" rather than omitting a point, so the vendored copy is registered
with `role_gap_delta_pa_side("before")` and reads only its own side (its
`"after"` side may also be declared a restatement). The README gives the exact
registry lines. In the same commit as
`release_snapshot.py --release <outgoing>`, copy those files into
`analysis/release-snapshots/published/` and register them as vendored sources.
`published/README.md` lists the steps. Slice 4 automates this with a
`measures.py --vendor-current` mode, or a hook in `release_snapshot.py`. Until
that lands, the step is manual and the reload checklist has to include it.

## Follow-ups, in the design's order of work

**Slice 2: preservation.** Reload the 2026-04-09 partition into the Delta
archive. The design treats this as blocking for everything else. It is listed
here, not in slice 1, because it writes to Databricks, which this PR must not
touch.

**Slice 3: views, partitioning, and the BigQuery measure pass.**

- Add `cms_npd.<resource>_current` views, repoint every `h*.py` at them, verify
  byte-identical outputs, and add the anti-pattern rule that bans base-table
  names outside `analysis/measures/`.
- Partition by `release_date`, and move `fast_ingest_ndh.py` to a
  partition-scoped replace.
- Re-export 2026-05-08 with the current extractor and backfill it.
- Write each measure as pinned SQL under `analysis/measures/`, run under
  `bq_job_config()`. Derive `definition_version` from the SQL hash.
- Recompute May under today's definitions, and publish as-published and
  recomputed values side by side as restatements.
- Add the measures the excluded list is waiting on: national role coverage,
  `partOf` resolvability, payer organizations with an endpoint, and location
  phone coverage.

**Slice 4: generator-side fixes found while building slice 1.**

- `measures.py --vendor-current` (or a hook in `release_snapshot.py`) that
  copies the outgoing release's source files into `published/` and registers
  them, so a reload cannot drop a point. Today this step is manual (see
  Rollout).
- `h27_pii_exposure.py`: emit the qualification-array control as a structured
  field, so the series no longer checks for a sentence in the notes.
- `primer_scoreboard.py`: emit numerator and denominator for every metric.
- `h9_npi_luhn.py`: already writes `npi-validity-summary.json`. No change needed;
  noted here because the H9 May point exists only because a pre-overwrite copy
  of the shared slug survived.

**Slice 5: public surface.**

- `/measures` index and `/measures/<slug>` pages: `force-static`,
  `generateStaticParams`, no runtime BigQuery. Check that `.nft.json` does not
  reference `public/api/v1/findings/**` or `states/**`. Show the table first;
  add a chart only once a measure has four points. Show breaks and unreviewed
  gaps inline.
- `/api/v1/measures/<slug>.json` plus CSV, registered through
  `build_manifest.py` (not a hand edit of `manifest.json`).
- A JSON Schema in `contract_schemas.py`, regenerated with
  `validate_contract.py --write-schemas`.
- Move Dataset markup from findings to measures through `SOURCE_CATALOG`, and
  add measures to `sitemap-findings.xml`.
- Citation block and Zenodo deposit (concept DOI plus version DOI).

**Slice 6: entity dimension.** Optional per-organization breakdowns.

**Not in scope for any slice:** Databricks compute for measures, and
exclusion-derived measures. Exclusion data runs on a monthly or continuous date
axis, not on the release axis.
