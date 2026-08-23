# Cross-release identifier stability in the NDH bulk export

Run date: 2026-08-23
Releases compared: 2026-04-09 and 2026-05-08
Source: local parquet export (`analysis/export_parquet.py`), not BigQuery, which
holds only the current release.

## Why this was measured

The NDH release archive is now published as Delta tables partitioned by
`release_date`. Partitioning invites a cross-release diff, and the obvious way
to write one is to join on the resource id. That is valid for two of the six
resources and produces a completely false answer for two others. Nothing had
checked which.

## Result

Comparing the id sets of the two releases directly:

| Resource | 2026-04-09 | 2026-05-08 | Shared ids | Jaccard |
| --- | ---: | ---: | ---: | ---: |
| practitioner | 7,441,212 | 7,441,211 | 7,441,211 | 1.0000 |
| organization | 3,605,261 | 3,414,375 | 3,414,340 | 0.9470 |
| endpoint | 5,043,524 | 1,360,585 | 0 | 0.0000 |
| location | 3,494,239 | 1,362,869 | 0 | 0.0000 |

The zero is not near zero. It is exactly zero, and the reason is the id format:

- `practitioner` ids are `Practitioner-<NPI>`, 100.0% of rows in both releases.
- `organization` ids are mixed: 1,999,118 rows are `Organization-<NPI>` in both
  releases, the rest are UUIDs. Both kinds persist across the two releases.
- `endpoint` and `location` ids are `Endpoint-<UUID>` and `Location-<UUID>`,
  0.0% NPI-keyed, and the UUIDs are regenerated on every export.

**A cross-release diff of endpoint or location joined on `_id` therefore reports
100% churn every time.** That is an artifact of id minting, not a measurement.
The Delta table comments carry this warning, so a consumer meets it before
writing the join rather than after.

## The replacement key works for endpoint and only partly for location

Telling a consumer to join on something else is worth nothing until someone has
run that join, so both were measured.

**Endpoint joins cleanly on `_address`:** 1,299,999 shared values, which is
100.0% of the 1,300,082 distinct May addresses and 100.0% of the 1,300,241
distinct April ones. 83 May addresses are new and 242 April ones are gone.

**Location has no reliable key in the exported columns.** `_name` + `_city` +
`_state` + `_postal_code` matches 74,627 keys, only 9.7% of May rows, as
stored. Upper-casing and stripping non-alphanumerics raises that to 564,285,
or 73.5%, because CMS re-cased and re-punctuated these fields between the two
releases. Any Location cross-release join is lossy and should state its match
rate. (The April and May parquet predate the `_address_line` column, so a
street-level key was not available to test.)

## The id set being stable does not mean the records are

Practitioner ids overlap 100%, which invites the opposite error: concluding CMS
republished the same data. It did not. Of 20,000 practitioners present in both
releases, **0 have byte-identical resource JSON, and 0 are identical after
normalising key order, array order, string case, and `meta.lastUpdated`.** Every
record changed.

One change drives most of that. CMS replaced the universal practitioner
extension vocabulary wholesale between the two releases, with no overlap:

| 2026-04-09 (100% of records) | 2026-05-08 (100% of records) |
| --- | --- |
| `base-ext-enrollment-validated` | `base-ext-hhs-in-exclusion-list` |
| `base-ext-cms-ial2-verified` | `base-ext-cms-identity-verified` |
| `base-ext-aligned-with-cms-data-network` | `base-ext-cms_aligned_with_data_network` |
| `base-ext-cms-enrollment-in-good-standing` | `base-ext-cms_medicare_enrollment` |

Two of the four new names use snake_case where the rest of the profile uses
kebab-case, so the naming convention is not internally consistent. Any code
matching the April names against a May-or-later release returns zero rows and
does not error, which is the failure shape this project keeps hitting.

Sampled record-level changes beyond the extension rename: CMS normalised
address case (`ORANGE` to `Orange`), split suite numbers onto their own
`address.line` entry, dropped a duplicated address object, and changed the
order of the telecom and qualification arrays.

## The 73% fall in endpoint count is de-duplication, not removal

`endpoint` fell from 5,043,524 rows to 1,360,585 (-73%) between April and May,
which reads as mass deletion. It is not. The distinct-address counts barely
move:

| | rows | distinct `_address` | rows per address |
| --- | ---: | ---: | ---: |
| 2026-04-09 | 5,043,524 | 1,300,241 | 3.88 |
| 2026-05-08 | 1,360,585 | 1,300,082 | 1.05 |

April repeated each endpoint address 3.9 times on average; May repeats it 1.05
times. 1,299,999 of the 1,300,241 distinct April addresses are still present in
May. **CMS removed duplicate rows, not endpoints.** Anyone who read the April
figure as a count of endpoints was overcounting by nearly four to one.

`location` fell from 3,494,239 to 1,362,869 (-61%), and its duplication factor
barely changed (1.81 to 1.77), so de-duplication does not explain it. Distinct
composite keys fell from 1,928,602 to 769,715. Because that key is itself
unreliable across these releases, this run does not attribute the fall to
deletion rather than renaming, and makes no claim either way.

## Reproducing

```bash
python analysis/export_parquet.py --release 2026-04-09
python analysis/export_parquet.py --release 2026-05-08
python analysis/databricks_publish.py --upload --load --share
```

## Caveat

Two releases is a short baseline. The id-format observation is structural and
should hold, since it follows from whether the id embeds an NPI. The volume changes are two data
points; do not read them as a trend.
