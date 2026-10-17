# Pennsylvania endpoint reach, 2026-08-20 and 2026-10-07, by one method

Run date: 2026-10-16
Releases: NDH 2026-08-20 and NDH 2026-10-07
Script: `analysis/pa_reach_same_method.py`
Output: `frontend/public/api/v1/states/pa-reach-same-method.json`
Pipeline commit: b5aa33a (the H50, H51, H53 and `state_connectivity.py` code
after FHI-73)
Cost: none billed. Both runs read local parquet through DuckDB. The one
BigQuery query in the chain (NPPES corporate parents, a static public
snapshot) was captured once with a capped job and served from that capture.

## Question

The published Pennsylvania ledgers read 18.7% of practitioners reaching a FHIR
endpoint at 2026-08-20 and 15.8% at 2026-10-07 (as first published, before
FHI-73), and the October figure under the current method is 22.3%. Did reach
fall between the two releases when both are measured by the same method on
consistent inputs?

## Short answer

It fell slightly. Under the current method, with every input outside the NDH
held constant, any-route reach went from 52,802 of 230,837 practitioners
(22.9%) to 50,812 of 227,917 (22.3%). Deterministic reach went from 8,117
(3.5%) to 6,555 (2.9%). Among practitioners affiliated through any source,
reach went from 52.1% to 50.3%.

The published 18.7% for August cannot be compared with either October figure.
Besides predating the FHI-73 method change, it read H53 inputs computed on the
2026-05-08 release (see "The published August ledger mixed releases").

## Result

| Measure | 2026-08-20 | 2026-10-07 | Change |
| --- | ---: | ---: | ---: |
| Active practitioners with an NPI | 230,837 | 227,917 | -2,920 |
| Has a PractitionerRole | 100,918 (43.7%) | 100,379 (44.0%) | -539 |
| Affiliated through any source | 101,255 | 100,974 | -281 |
| Reaches an endpoint, any route | 52,802 (22.9%) | 50,812 (22.3%) | -1,990 |
| of those affiliated | 52.1% | 50.3% | -1.8 pts |
| Reaches an endpoint, deterministic | 8,117 (3.5%) | 6,555 (2.9%) | -1,562 |

Reach by tier. Each practitioner is counted once, at the strongest tier that
reaches them.

| Tier | 2026-08-20 | 2026-10-07 | Change |
| --- | ---: | ---: | ---: |
| NDH only (`green`) | 2,461 | 1,907 | -554 |
| Vendor NPI, URL listing 10 or fewer (`yellow`) | 5,656 | 4,648 | -1,008 |
| Vendor NPI list, URL listing more than 10 (`vendor_list`) | 10,038 | 8,967 | -1,071 |
| H53 resolved (`resolved`) | 27,665 | 27,214 | -451 |
| of which curated alias | 11,240 | 11,393 | +153 |
| of which name plus state | 5,884 | 5,548 | -336 |
| of which brand plus state | 10,541 | 10,273 | -268 |
| CMS enrollment only (`enrolled`) | 6,982 | 8,076 | +1,094 |
| Name-matched candidate only, not counted | 1,808 | 1,693 | -115 |
| Affiliated, no endpoint (`red`) | 40,626 | 41,588 | +962 |
| No organization (`none`) | 135,601 | 133,824 | -1,777 |

The five reaching tiers sum to the any-route total, and all eight bands sum to
the practitioner count, on both releases. `check_summary()` in the script
enforces both and refuses to write otherwise.

What the tiers say: the fall is concentrated in the NDH and vendor-NPI tiers
(deterministic down 1,562), while the CMS-enrollment tier rose by 1,094 and
partly offset it. Because the vendor files are the same file in both runs, the
fall in the vendor-NPI tiers is a change in which NDH organizations carry the
NPIs the vendors publish, not a change in what the vendors publish.

## The published August ledger mixed releases

The August ledger published in #169 (0b99964, built 2026-10-13) read four
intermediate files. Their last commits before 0b99964:

| File | Last written | Release it was computed on |
| --- | --- | --- |
| `findings/endpoint-org-crosswalk.csv` (H50) | 51bf5d5, 2026-08-21 | 2026-08-20 |
| `findings/vendor-endpoint-attribution.csv` (H51) | be51fe6, 2026-08-21 | 2026-08-20 |
| `states/pa-org-endpoint-resolution.csv` (H53) | 0e95ed7, 2026-08-16 | 2026-05-08 |
| `states/pa-enrollment-endpoint.csv` (H53) | c8b9a28, 2026-08-16 | 2026-05-08 |

The warehouse was reloaded with 2026-08-20 in 51bf5d5 on 2026-08-21, so both
H53 files predate it. The August ledger was therefore August on the H50 and
H51 side and 2026-05-08 on the H53 side. The 18.7% to 15.8% comparison mixed
releases on the H53 side, and the method also changed between the two
(FHI-73). This run does not measure what the old method would have reported on
consistent inputs; it measures the current method on both releases.

## Fidelity checks

The DuckDB port has to reproduce what BigQuery produced before its August
numbers can be trusted.

- **October against the committed October files.** The October run reproduces
  the committed `states/pa-connectivity.json` (b5aa33a) in `summary`, `funnel`
  and `confidence`, with one exception: `vendor_known` (the "Endpoint
  attributed to an EHR vendor" funnel step) reads 49,455 or 49,456 depending
  on run, against 49,456 committed. It is an array-order artifact and is not
  part of the reach count. The four intermediate CSVs (H50 crosswalk, H51
  attribution, both H53 files) match the committed files as row sets; two of
  them differ in row order only.
- **August against the committed August file.** The August run matches the
  August ledger published in #169 on the three numbers that do not depend on
  H53 or the method change: 230,837 practitioners, role coverage 43.7%, and
  NDH-only reach 2,461.
- **The vendored script against the original driver.** The measurement was
  first run with a scratch driver over trimmed parquet extracts, since deleted. The
  vendored script, which reads the full parquet exports, was rerun on both
  releases on 2026-10-16 and produced identical `summary`, `funnel` and
  `confidence` blocks and identical intermediate CSVs (as row sets) for
  August, and the same result for October up to the `vendor_known` artifact
  above.

## Inputs held constant

| Input | Source |
| --- | --- |
| Vendor endpoint files (eight publishers) | `/tmp/ainpi-vendor-endpoints`, downloaded 2026-10-13; the script refuses to download |
| NPPES corporate parents (`parent_organization_lbn`, PA) | one capped BigQuery job against `bigquery-public-data.nppes.npi_raw`, 5,894 rows |
| CMS enrollment crosswalk | `findings/pecos-org-crosswalk-pa.csv` as published |
| Hospital ownership crosswalk | `findings/hospital-ownership-crosswalk.csv` as published |
| H47 rural file | `states/pa-rural-health.json` as published |

The NDH release is the only input that changes between the two runs.

## Method

1. For each release, point a stand-in BigQuery client at the parquet export in
   `frontend/data/parquet-export/<release>/` (one DuckDB view per resource
   table).
2. Run H50, H51 and H53 (`pa --sample 0`) with their output directories and
   release date redirected to a scratch directory, then
   `state_connectivity.py pa --no-geo` on those outputs.
3. Build the side-by-side summary from the two `pa-connectivity.json` files
   with `summarize`.

The DuckDB port rewrites five BigQuery constructs in `translate()`: the
fully-qualified table names, `@state` parameters, `COUNTIF`, `REGEXP_EXTRACT`
with a raw-string pattern, and `ARRAY_AGG(DISTINCT ... IGNORE NULLS)`. Any
query that still carries `ARRAY_AGG`, `IGNORE NULLS` or `OFFSET(` after the
rewrite raises rather than running.

To reproduce, from the repo root:

```bash
python3 analysis/pa_reach_same_method.py run --release 2026-08-20 \
    --export-dir frontend/data/parquet-export/2026-08-20 \
    --out-dir /tmp/pa-reach --nppes-parent-cache /tmp/pa-reach/parent_pa_nppes.json
python3 analysis/pa_reach_same_method.py run --release 2026-10-07 \
    --export-dir frontend/data/parquet-export/2026-10-07 \
    --out-dir /tmp/pa-reach --nppes-parent-cache /tmp/pa-reach/parent_pa_nppes.json
python3 analysis/pa_reach_same_method.py summarize \
    --before /tmp/pa-reach/2026-08-20/states/pa-connectivity.json \
    --after /tmp/pa-reach/2026-10-07/states/pa-connectivity.json \
    --source-commit b5aa33a \
    --write frontend/public/api/v1/states/pa-reach-same-method.json
```

Each run takes under a minute on a laptop. The first run captures the NPPES
cache with real BigQuery credentials if the file is absent.

## Limits

- Run with `--no-geo`. The county layer is skipped; the summary, funnel and
  confidence bands compared here do not depend on it.
- The vendor side is held constant on purpose, so this isolates the change on
  the NDH side. Whatever the vendors changed between August and October is
  excluded, and the October figures here equal the published October figures
  only because the published October run used the same 2026-10-13 download.
- The NDH queries ran through DuckDB, not BigQuery. The fidelity checks above
  are the evidence that the port is faithful; they cover October fully and
  August on the fields that the stale inputs did not touch.
- Pennsylvania only. The same comparison has not been run for any other
  state, and no other state has a published ledger.
- Reaching an endpoint is not the endpoint answering. Liveness is H1 to H5.
