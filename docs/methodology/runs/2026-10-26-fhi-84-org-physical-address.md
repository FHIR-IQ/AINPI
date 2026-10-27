# Organization address flattening: physical address instead of address[0] (FHI-84)

Run date: 2026-10-26 (UTC 2026-10-27)
Release: NDH 2026-10-07
Scripts: `analysis/fast_ingest_ndh.py` (`physical_address`),
`analysis/backfill_flattened_columns.py --table organization`
(`picked_address_sql`), `analysis/explorer_geo.py`
Backup: `thematic-fort-453901-t7.cms_npd.organization_addr_backup_20261026`
(`_id, _npi, _state, _city, _address_line` as they were, clustered on `_npi`)
Cost: about 49.6 GB billed across 43 capped query jobs (about $0.30 on
demand), including the backfill (2.53 GB), the backup (0.14 GB), the
before/after measurement, the PA ledger chain run twice and the explorer
regeneration.

## The defect

`Organization.address` is 0..*. The flattener read `address[0]` into
`_state`, `_city` and `_address_line`, and the NDH often lists the postal
billing address first. NPI 1548282270 (CVS Pharmacy 16602) lists a billing
address in Woonsocket, RI, then its Harrisburg, PA practice; it was counted
in Rhode Island.

Only two address kinds occur in the 2026-10-07 file, for both Organization
and Practitioner: `type=physical, use=work` and `type=postal, use=billing`.
No record uses `type=both`.

## The rule

First entry with `type` `physical` or `both`; else first with `use` `work`;
else the first entry that is an object. The Python flattener and the SQL
backfill implement the same rule, and a parity check over 6,000
multi-address records (movers first) found 0 disagreements after the
backfill.

## What moved (organization, 2026-10-07)

| | Count |
|---|---:|
| Organizations | 2,058,500 |
| With more than one address | 671,089 |
| With a physical or work address | 1,608,871 |
| `_state` changed | 63,194 |
| `_city` changed | 130,444 |
| `_address_line` changed | 163,762 |
| `_state` null, before and after | 375,789 |
| PA out (PA to another state) | 4,322 |
| PA in (another state to PA) | 1,996 |
| PA organizations, before and after | 62,704 to 60,378 |

By record type, 61,339 of the movers are `Healthcare Provider` records and
1,853 are `ein` records. Payer, network, team and government organizations
did not move.

PA out, largest destinations: NY 524, CA 420, OH 394, NJ 322, MD 273, MI 262,
NC 213, VA 166. PA in, largest sources: RI 427, NJ 238, TX 141, NY 135, OH 135,
IL 110, FL 94, TN 90.

Largest transitions (old state to new state):

| Before | After | Organizations |
|---|---|---:|
| AR | MN | 4,971 |
| RI | CA | 1,014 |
| RI | MN | 723 |
| RI | FL | 699 |
| RI | TX | 679 |
| IL | TX | 594 |
| PA | NY | 524 |
| IL | FL | 515 |
| RI | NY | 476 |
| RI | PA | 427 |
| PA | CA | 420 |
| TX | FL | 419 |
| TN | FL | 411 |
| TN | CO | 405 |
| PA | OH | 394 |
| RI | MA | 390 |
| IL | CA | 362 |
| TX | CA | 361 |
| IL | IN | 356 |
| IL | NY | 353 |

The full matrix has 1,848 distinct transitions, many of them involving
free-text values in the state field that are not jurisdictions.

## Is the new state right?

Checked against the NPPES practice-location state
(`bigquery-public-data.nppes.npi_raw`, entity type 2, snapshot as of
2026-02-07) for organizations whose NPI is in NPPES:

| Group | In NPPES | Old state = NPPES practice | New state = NPPES practice |
|---|---:|---:|---:|
| Movers, one physical address | 49,429 | 265 | 48,708 |
| Movers, several physical addresses | 12,267 | 796 | 5,843 |
| All movers | 61,696 | 1,061 | 54,551 |

The new state agrees with NPPES for 88.4% of movers in NPPES, the old one for
1.7%. The disagreements concentrate in organizations with several physical
addresses, and one address dominates them: 5,475 movers whose new state
disagrees with NPPES list `100 N 6th St, Minneapolis, MN` as their first
physical address. Most are records named ABILITY NETWORK (4,942) with a
billing address in Bentonville, AR and a second physical address elsewhere.
They moved from Arkansas to Minnesota, and NPPES places them in neither.
For movers with several physical addresses the last physical address
matches NPPES more often (11,145) than the first (5,843), but nothing in the
FHIR record says which physical address is primary, so the rule keeps the
first and this is reported rather than tuned away.

## Practitioner and Location

Practitioner has the same pattern: 574,377 records list a billing address
first, and the same rule would change `_state` for 119,906 of 7,481,907
practitioners (PA 5,806 out, 3,302 in). It was **not** changed. Practitioner
`_state` is the denominator of every per-state number this project publishes
(51 state slices, the connectivity ledger's 227,917, H54, the landscape,
the explorer), so changing it means restating all of them together. The
extractor and the warehouse were left in agreement on `address[0]`, and a
test pins that, so the two cannot drift apart. Follow-up below.

`Location.address` is 0..1. No Location record in 2026-10-07 carries an
array (0 of 2,558,069), so there is no choice to make.

## Consumers and their numeric impact

Measured old against new on the same release. "Live" means the number reads
the warehouse at request time and changed when the backfill landed.

| Consumer | Uses | Before | After | Status |
|---|---|---|---|---|
| State slices `states/<st>.json`, `denominators.organization` | org `_state` | PA 62,704; VA 37,133; OH 55,299 | PA 60,378; VA 38,517; OH 55,747 | Not regenerated here (per-NPI verify samples; no suppression list locally). VA, PA, OH restate at the next weekly refresh with an FHI-84 note from `state_findings.py`; the other 48 stay as published until rerun. Full table below. |
| State slices, H14/H15 state duplicate rate | org `_state` | PA 1,979 / 62,704 (3.1561%) | PA 1,913 / 60,378 (3.1684%) | As above |
| State slices, H18 organization staleness | org `_state` | 100% on release day | 100% (denominator moves with the org count) | As above |
| H15 `duplicate-detection.json` (national, name+state+city) | org `_state`, `_city` | 127,322 of 1,383,429 keys (9.2034%), excess 298,875, max 7,527 | 131,685 of 1,415,597 (9.3024%), excess 266,769, max 9,520 | Restates at the next weekly refresh; the FHI-84 correction is in the `h14_h15_duplicates.py` notes |
| H24 `oig-leie-exclusions-detail.json`, organization `ndh_state` | org `_state` | 598 LEIE-matched organizations | 5 change state | Restates weekly. The headline and the state chart count practitioners only and do not move |
| H50 `endpoint-org-crosswalk.csv`, `org_state` | org `_state` | 16,247 rows | 105 rows (104 orgs) change `org_state`; PA rows 400 to 398 | Not regenerated (per-NPI). No H50 number depends on state |
| H53 PA resolution (`pa-org-endpoint-resolution.csv`) | `org_state` in name-state / brand-state tiers | name-state 887 orgs / 13,576 slots; brand-state 1,559 / 43,828; resolved 113,550 of 309,311 | name-state 891 / 13,684; brand-state 1,559 / 43,825; resolved 113,655 | Not regenerated (per-NPI) |
| PA connectivity ledger `pa-connectivity.json` | org `_state`/`_city` via H53, system rollup, affiliation graph | any route 50,812 (22.3%, 50.3% of affiliated); deterministic 6,555 (2.9%) | any route 50,880 (22.3%, 50.4%); deterministic 6,555 (2.9%) | Not regenerated (per-NPI). Old run reproduces the published file exactly. FHI-84 correction added to `state_connectivity.py` for the next run |
| Ledger `confidence` | same | resolved 27,214 (name-state 5,548, brand-state 10,273); enrolled 8,076 | resolved 27,285 (5,627, 10,265); enrolled 8,073 | as above |
| Ledger affiliation graph (orgs filtered by `_state`) | org `_state` | 6,507 edges, 7,173 orgs | 5,612 edges, 6,583 orgs | as above |
| Ledger systems | member `org_state` | 433 systems reach an endpoint (250 deterministic); 22,751 practitioners in a deterministically reaching system | 431 (248); 22,963 | Two of 60 system rows change: PENNSYLVANIA 73 to 116 reached, DIGESTIVE 319 to 343. UPMC, Geisinger, St. Luke's, AHN, Pinnacle, WellSpan, Jefferson unchanged |
| `pa-reach-same-method.json` | ledger chain | 10-07 side 50.3% of affiliated | would read 50.4% | Not rerun: its 08-20 side reads the Databricks archive, out of scope |
| Explorer `explorer/*.json` | org `_state`, ZIP | PA provider orgs 60,584 | 58,344 | **Regenerated in this PR** (aggregates only, no NPIs). The ZIP now comes from the same physical address. Practitioner figures identical before and after |
| `/api/npd/search` organizations, `/api/npd/state-detail`, `/api/npd/org`, `/api/npd/data-quality`, `/api/npd/geo-search`, views `v_org_by_state`, `v_data_quality_summary` | org `_state`/`_city` | as the per-state table | as the per-state table | Live; changed with the backfill. Null-state count unchanged, so `address_completeness_pct` does not move |
| `NpdStateMetrics.org_count` (Supabase, `scripts/sync-bq-to-supabase.ts`) | org `_state` | as the per-state table | not synced | Follow-up: needs a Supabase write |
| `landscape.py`, H54, H43, high-risk cohort, `state_findings` practitioner fields | practitioner `_state` only | | | Unaffected |
| H47 / H48 | CMS hospital files, not the NDH organization table | | | Unaffected |
| `measures.json` | | | | No measure reads organization state; `measures.py --check` passes unchanged |
| Databricks archive `workspace.ainpi.organization` | `address[0]` values in all three partitions | | | Out of scope; follow-up |

## Organizations per state, before and after

`denominators.organization` and the H14/H15 state rate as
`state_findings.py` computes them (all 2,058,500 organizations, active or not;
every organization in this release is active).

| State | Orgs before | Orgs after | Δ | H14/H15 state rate before | after |
|---|---:|---:|---:|---:|---:|
| AK | 4,421 | 4,548 | +127 | 3.6417% | 3.65% |
| AL | 23,191 | 23,241 | +50 | 3.9153% | 3.937% |
| AR | 21,592 | 16,066 | -5,526 | 3.0104% | 4.1267% |
| AZ | 38,358 | 38,788 | +430 | 3.1024% | 3.1195% |
| CA | 178,315 | 179,611 | +1,296 | 3.3273% | 3.2598% |
| CO | 36,760 | 38,475 | +1,715 | 3.6834% | 3.6335% |
| CT | 16,570 | 17,139 | +569 | 2.9028% | 2.8765% |
| DC | 4,788 | 4,728 | -60 | 2.381% | 2.4112% |
| DE | 5,113 | 5,310 | +197 | 3.1684% | 3.2015% |
| FL | 143,293 | 144,724 | +1,431 | 3.0295% | 3.0147% |
| GA | 49,718 | 49,656 | -62 | 3.4676% | 3.4961% |
| HI | 6,669 | 6,875 | +206 | 3.8237% | 3.8691% |
| IA | 14,133 | 14,524 | +391 | 5.2572% | 5.274% |
| ID | 11,527 | 10,576 | -951 | 3.4788% | 3.8767% |
| IL | 74,218 | 68,972 | -5,246 | 2.9804% | 3.1578% |
| IN | 27,232 | 28,318 | +1,086 | 3.8594% | 3.8456% |
| KS | 14,693 | 15,134 | +441 | 5.6558% | 5.7156% |
| KY | 22,253 | 22,343 | +90 | 4.0579% | 3.9386% |
| LA | 27,498 | 27,627 | +129 | 3.8257% | 3.8006% |
| MA | 30,906 | 31,272 | +366 | 3.7242% | 3.5943% |
| MD | 43,899 | 45,307 | +1,408 | 3.4124% | 3.3571% |
| ME | 6,675 | 6,944 | +269 | 3.4307% | 3.485% |
| MI | 53,939 | 55,180 | +1,241 | 3.2277% | 3.1968% |
| MN | 31,001 | 36,332 | +5,331 | 3.5612% | 2.9698% |
| MO | 29,228 | 29,742 | +514 | 3.9209% | 3.8834% |
| MS | 13,962 | 14,444 | +482 | 4.2616% | 4.2301% |
| MT | 6,124 | 6,270 | +146 | 4.066% | 4.1308% |
| NC | 57,423 | 59,236 | +1,813 | 2.7776% | 2.7551% |
| ND | 3,745 | 3,795 | +50 | 5.7677% | 5.7708% |
| NE | 10,326 | 10,536 | +210 | 6.7693% | 6.5205% |
| NH | 5,923 | 6,169 | +246 | 3.6468% | 3.6148% |
| NJ | 55,049 | 54,770 | -279 | 2.8774% | 2.8574% |
| NM | 9,843 | 10,124 | +281 | 3.4949% | 3.4769% |
| NV | 17,368 | 18,053 | +685 | 3.5871% | 3.6171% |
| NY | 83,189 | 83,347 | +158 | 2.8477% | 2.8363% |
| OH | 55,299 | 55,747 | +448 | 4.3563% | 4.3626% |
| OK | 21,228 | 21,690 | +462 | 4.1031% | 4.0802% |
| OR | 19,776 | 20,197 | +421 | 3.4638% | 3.4857% |
| PA | 62,704 | 60,378 | -2,326 | 3.1561% | 3.1684% |
| RI | 14,571 | 6,188 | -8,383 | 1.4549% | 2.6018% |
| SC | 24,121 | 24,771 | +650 | 3.2088% | 3.2417% |
| SD | 4,619 | 4,647 | +28 | 4.7413% | 4.7127% |
| TN | 32,262 | 29,569 | -2,693 | 4.169% | 3.9366% |
| TX | 139,555 | 138,917 | -638 | 3.3112% | 3.3135% |
| UT | 14,495 | 14,370 | -125 | 3.5461% | 3.4656% |
| VA | 37,133 | 38,517 | +1,384 | 3.3124% | 3.2531% |
| VT | 2,957 | 2,991 | +34 | 3.1113% | 3.1762% |
| WA | 31,766 | 32,373 | +607 | 3.4125% | 3.4381% |
| WI | 22,054 | 22,453 | +399 | 4.2169% | 4.2132% |
| WV | 8,410 | 8,726 | +316 | 3.5672% | 3.4265% |
| WY | 3,703 | 3,801 | +98 | 4.5909% | 4.6041% |

## Verification after the backfill

- 1,608,871 organizations carry a physical or work address; `_state` equals
  that address's state for all of them (0 mismatches).
- The 449,629 without one kept their previous value (0 changed).
- `_state` changed for 63,194, matching the pre-change measurement.
- Clustering is still `[_npi]`. A filter on `_npi = '1548282270'` processed
  1.98 MB after the update against 4.44 MB before, so pruning works.
- The flattener and the SQL agree on 6,000 of 6,000 sampled multi-address
  records (a one-off check, not a test).
- One malformed shape differed between the two: a bare string in place of
  the `line` array. The SQL (`JSON_VALUE_ARRAY`) yields NULL; the Python
  flattener joined the string's characters. The flattener now yields None as
  well, with a test. The warehouse was written by the SQL, so it already held
  NULL for any such record.
- The UPDATE also recomputes `_phone` and `_telecom` from the resource JSON,
  as this backfill always has, and those two columns were not in the backup.
  BigQuery time travel proves they did not change. The snapshot at
  `TIMESTAMP_MILLIS(1793069360000)` (2026-10-27 02:49:20 UTC) falls between
  the backup and the UPDATE. Table-wide row fingerprints, each of the form
  `BIT_XOR(FARM_FINGERPRINT(_id || '|' || IFNULL(<col>, '~')))`, run
  2026-10-27 with the 100 GB cap (0.60 GB + 0.48 GB billed):

  | Fingerprint | Pre-UPDATE (time travel) | Now | Backup table |
  |---|---:|---:|---:|
  | rows | 2,058,500 | 2,058,500 | 2,058,500 |
  | `_phone` | -2273490497277010357 | -2273490497277010357 | |
  | `_telecom` | -8166632363891282643 | -8166632363891282643 | |
  | `_npi`, `_name`, `_org_type`, `_active` | 2175581868414352575 | 2175581868414352575 | |
  | `_state`, `_city`, `_address_line` | 3917027149982458588 | -9004506659694116740 | 3917027149982458588 |

  So every column other than the three address columns is identical row by
  row, and the backup is an exact copy of the pre-UPDATE address columns.
  Time travel on this table expires about 2026-11-02, after which the backup
  is the only record.
- The weekly refresh on Monday 2026-11-02 09:00 UTC reruns H15 and the VA,
  PA and OH slices against the changed warehouse. The FHI-84 notes in
  `h14_h15_duplicates.py` and `state_findings.py` reach those files only if
  this change is merged first.

To revert: `UPDATE cms_npd.organization o SET _state = b._state, _city =
b._city, _address_line = b._address_line FROM
cms_npd.organization_addr_backup_20261026 b WHERE o._id = b._id`.

## Follow-ups

1. Regenerate, with the suppression list available, the per-NPI artifacts
   listed above as not regenerated: the PA ledger chain (H53 then
   `state_connectivity.py pa`), the H50 crosswalk, the 48 state slices the
   weekly refresh does not cover, and `pa-reach-same-method.json`.
2. Practitioner `_state`: apply the same rule with a full restatement of every
   per-state number, in one change.
3. Databricks archive: re-export the organization table for all three
   releases with the current flattener and reload.
4. `npm run bq:sync` to refresh `NpdStateMetrics`.
5. Decide whether to special-case the ABILITY Network address, or to use NPPES
   practice location as a tiebreaker when an organization has several
   physical addresses.
