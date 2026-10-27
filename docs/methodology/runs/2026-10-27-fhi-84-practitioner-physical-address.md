# FHI-84, second step: practitioner state from the physical address

Run date: 2026-10-27. Release: 2026-10-07. Follows
`2026-10-26-fhi-84-org-physical-address.md`, which changed the organization
columns and held this one back because practitioner `_state` is the
denominator of every per-state number this project publishes.

## The change

`Practitioner._state`, `_city`, `_postal_code` and `_address_line` now come
from the physical address, by the rule organizations use since 2026-10-26:
the first entry typed `physical` or `both`, else the first with `use` work,
else the first entry that is an object. Before, all four read `address[0]`,
which the NDH often fills with the postal billing address.

Code: `extract_practitioner` in `analysis/fast_ingest_ndh.py` (so the parquet
export and the next ingest), the practitioner `UPDATE` in
`analysis/backfill_flattened_columns.py` (`address_select`), and the
deprecated `frontend/scripts/ingest-cms-npd.ts`. Tests:
`test_practitioner_reads_the_physical_address` and
`test_practitioner_without_a_physical_address_keeps_address_zero`.

## The backfill

Before the `UPDATE`, the four address columns plus `_id`, `_npi` and
`_active` were copied to `cms_npd.practitioner_address0_20261007`, so the
before/after below does not depend on BigQuery's 7-day time travel window.
`_id` was checked unique (7,481,907 rows, 7,481,907 ids). The `UPDATE`
processed 10.23 GB and touched every row.

| | Count |
|---|---|
| Practitioners | 7,481,907 |
| `_state` changed | 119,906 (all active) |
| `_postal_code` changed | 407,005 |
| `_state` null before / after | 1,173,300 / 1,173,299 |

The 119,906 matches the figure measured on 2026-10-26 before any change, and
the local parquet re-export of the same release produces the same count, so
the SQL and the Python flattener agree.

Largest relative moves in active practitioners by state: South Dakota
15,706 to 15,200 (-3.2%), Alabama 62,106 to 60,437 (-2.7%), Nebraska 58,841 to
60,281 (+2.4%), Florida 379,343 to 370,065 (-2.4%), Utah 68,984 to 70,648
(+2.4%), Virginia 129,075 to 132,116 (+2.4%). Pennsylvania: 5,806 out, 3,302
in, 227,917 to 225,413.

## Regenerated

All with the suppression list in force (1 row), then `suppression.py --apply`
and `--check`.

| Artifact | Before | After |
|---|---|---|
| 51 state slices, `denominators.practitioner` | as the warehouse, old | as the warehouse, new; all 51 checked against the snapshot by script, 0 mismatches |
| State slice notes | "Practitioner state still reads the first address"; verify samples described as "not present in NPPES" | both corrected; the samples have come from the OIG LEIE since 2026-08-21 |
| State slice verify samples | `ORDER BY EXCLDATE`, `ANY_VALUE(EXCLTYPE)` | `ORDER BY EXCLDATE, _npi`, `MIN(EXCLTYPE)`, so a refresh with no data change cannot reshuffle them |
| PA ledger `pa-connectivity.json` | 227,917; any route 50,880 (22.3%, 50.4% of affiliated); deterministic 6,555 (2.9%); role coverage 44.0% | 225,413; any route 49,995 (22.2%, 50.8%); deterministic 6,352 (2.8%); role coverage 43.4%. A second dated FHI-84 entry in `corrections` states both |
| PA ledger organization-step correction | read the current run for its "after" figure | pinned to the figures published on 2026-10-27, so it does not take credit for this step |
| H53 PA, `pa-system-endpoint-gap.json` | | regenerated in the same chain |
| H54 `role-gap-composition.json` | PA 100,379 of 227,917 with a role (44.0%); nursing 549 of 8,809 (6.2%) | 97,848 of 225,413 (43.4%); nursing 551 of 8,783 (6.3%) |
| Landscape | 1,066 cells | 1,067 cells, 53 changed |
| Explorer | PA 227,917 practitioners, 44.0% with a role | 225,413, 43.4%. Organization figures unchanged |
| High-risk cohort | | 9,999 rows, same NPIs; 112 change state. VA critical 108 to 110 |
| H24, H25 state charts | | small moves per state; the largest LEIE move is Texas, 380 to 374. Headlines count practitioners nationally and do not move |
| `states/<st>-cohort-critical.csv` (52 files, behind `/for-state-medicaid/<state>`) | 51 of 52 did not match the published national cohort: they had last been built on 2026-10-12, before the 2026-10-07 reload | rebuilt from the current cohort; 36 differ from what a rebuild before this change would have produced |
| VA briefing, H26 `mco-exposure-va.json` | 5 of 108 critical VA providers in at least one of 4 payer directories (all Cigna) | 5 of 110 (all Cigna); payer directories probed live on 2026-10-27 |
| `pa-reach-same-method.json` | 2026-08-20 22.9% (52.1% of affiliated), 3.5% deterministic; 2026-10-07 22.3% (50.3%), 2.9% | 2026-08-20 23.0% (52.8%), 3.5%; 2026-10-07 22.2% (50.8%), 2.8%. Both releases rerun on the physical address from re-exported parquet |

### The same-method pair

Both sides were rerun with the physical address rule, from parquet re-exported
on 2026-10-27 with the current flattener. The 2026-10-13 vendor download the
first comparison used is no longer on disk, so both sides hold the
2026-10-26 download instead. That is still one download for both releases,
which is what makes the pair a same-method comparison. It does mean the
October side (49,997 any route, 6,381 deterministic) differs slightly from
the published ledger (49,995, 6,352), which reads the published H51 file;
the payload says so in `limits`. The change between releases is -0.8 points
any route and -0.7 deterministic, against -0.6 and -0.6 as first published.

## Not regenerated, and why

- **Claims cross-audits H29 to H42** (`excluded-billing-medicare-partb*.json`,
  Part D, DMEPOS, Medicaid, Open Payments). They read the per-state cohort
  files, which changed, but their outputs were last generated on 2026-05-17
  from the May release cohort. Rerunning now would mix the release change
  into this correction. They are a release behind regardless of FHI-84;
  refreshing them is separate work.
- **`role-gap-delta.json`** and the `role-coverage-pa` measure that reads it.
  Both sides (2026-08-20 and 2026-10-07) used `address[0]`, so the pair is
  consistent within itself. Regenerating it from the new October H54 alone
  would mix the two rules. The live H54 figure (43.4%) and the measure's
  October point (44.0%) therefore differ by the address rule.
  `measures.py --check` passes unchanged.
- **Databricks archive.** Not reloaded, by decision, to avoid paying for a
  rewrite of data no consumer reads yet. The practitioner and organization
  table comments, and the share's own copies, now state that the archived
  partitions read `address[0]` and give the SQL that applies the physical
  address rule. That SQL, run on the 2026-10-07 practitioner partition,
  reproduced the 119,906 exactly. Re-exported parquet for all three releases
  is on disk if a reload is wanted later.

## Cost

BigQuery: the snapshot copy, the dry run and the 10.23 GB `UPDATE`, plus the
regeneration jobs, all through `bq_job_config()`. Databricks: one comment
write per table and one 1.6 GB verification query.
