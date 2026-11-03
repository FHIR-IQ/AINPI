# Data-quality first slice: partial backfill, 2026-11-03

Five rules in `ndh_quality/` were run over the local NDH parquet exports with `analysis/dq_run.py`. Results are in `frontend/public/api/v1/dq-results.json`. The backfill is partial: four input files are unreadable iCloud placeholders on the run machine (2026-05-08 endpoint, organization and practitioner; 2026-10-07 location), so 2026-05-08 was not run and 2026-08-20 ran without a previous release.

## What ran

- `dq_run.py --release 2026-08-20 --no-previous`, about 9 seconds. `control_previous` is null and the field control applies the non-zero test only. The `--no-previous` flag was added for this run.
- `dq_run.py --release 2026-10-07`, about 8 seconds, previous release 2026-08-20.
- `ndh_fingerprint.py fingerprint --release 2026-08-20`. Timing and output are in the Fingerprint section.

## Results

| Release | Rule | Status | Numerator | Denominator | Measure pairing |
| --- | --- | --- | --- | --- | --- |
| 2026-08-20 | endpoint-org-linkage | recorded | 16,262 | 110,973 | agrees |
| 2026-08-20 | endpoint-types-present | pass | 2 | 2 | not paired |
| 2026-08-20 | fhir-rest-endpoint-share | recorded | 110,973 | 1,128,169 | not paired |
| 2026-08-20 | npi-check-digit | pass | 11,607,652 | 11,607,656 | agrees (4 invalid, 4 published) |
| 2026-08-20 | role-references-resolve | pass | 31,748,624 | 31,748,624 | not paired |
| 2026-10-07 | endpoint-org-linkage | recorded | 16,247 | 111,259 | agrees |
| 2026-10-07 | endpoint-types-present | pass | 2 | 2 | not paired |
| 2026-10-07 | fhir-rest-endpoint-share | recorded | 111,259 | 1,140,836 | not paired |
| 2026-10-07 | npi-check-digit | pass | 9,526,462 | 9,526,462 | no published point |
| 2026-10-07 | role-references-resolve | pass | 20,755,282 | 20,755,282 | not paired |

The October values match what was expected: 9,526,462 NPIs checked with 0 invalid, 16,247 of 111,259 endpoints linked, no dangling role references. The August NPI rule agrees with the published 4 only after the correction described below; as first measured, the rule's definition differed from H9's and the pairing was `false`.

## The August NPI disagreement

The published figure is 4 flagged of 11,607,656 NPIs checked, all structural and none Luhn (`npi-validity-summary`, `invalid_structure` 4, `luhn_fail` 0). The rule reports 0 invalid over the same 11,607,656 NPIs.

I compared the raw `resource` JSON with the flattened `_npi` using the identifier signals in `analysis/fhir_identifiers.py` (either NPI system URL, or a type coding of NPI). Counts only:

- Practitioner: 7,373,311 NPI-marked identifiers across 7,373,232 records. None is malformed or fails the check digit, none is missing from `_npi`, and none differs from it.
- Organization: 4,983,602 NPI-marked identifiers across 4,234,424 records. None is malformed or fails the check digit and none is missing from `_npi`. 159,642 records carry a second NPI-marked identifier that differs from `_npi`, all valid. `extract_npi` in `fast_ingest_ndh.py` returns the first match, so the flattener does not drop malformed NPIs here; it picks one of several.
- The 168,247 records with no NPI match the published `missing_npi`.

The 4 are explained by the definition, not the data. `analysis/h9_npi_luhn.py` requires `^[12]\d{9}$` before the check digit. The rule as first written accepted any 10 digits. In the 2026-08-20 export, 4 organization `_npi` values (0 practitioner) have a first digit other than 1 or 2 and pass the check digit. That reproduces the published 4 exactly. The methodology (`docs/methodology/index.md`, H9) says first digit 1 or 2 is part of the check, so the first version of the rule was incomplete. This first measurement, 0 invalid against 4 published, is kept here as the record. No source-changes entry was added because the source did not change.

## Correction before publication

Nothing from this rule had been published, so the rule was corrected to H9's definition at rule version 1 rather than bumped: ten digits, first digit 1 or 2, then the check digit. Its relation to H9 is now `implements` (it was `partial`, with a comment that wrongly said H9 covers NPPES agreement; that is H10). The test that compared the rule with H9 had omitted the first-digit rule in its own helper, which is why it did not catch the gap. It now reimplements H9's `validate()` and includes Luhn-valid NPIs with first digits 0 and 3 to 9 as negatives.

Re-run on 2026-08-20: 11,607,652 valid of 11,607,656 checked, 4 invalid, and the pairing with the published measure is `true`. 2026-10-07 is unchanged: 9,526,462 checked, 0 invalid. The re-run used the same input fingerprint, so the rows were replaced in place and no `superseded_by` row exists for this rule.

## Contract check

`validate_contract.py` rejected `relation: control` in dq-results rows, a value the package documents. The `dq_results` schema enum in `analysis/contract_schemas.py` now includes it.

## Fingerprint

`fingerprints/2026-08-20.json` was written after about 28 minutes. Record counts match the warehouse: practitioner 7,373,232, practitioner_role 16,545,158, organization 4,402,671, organization_affiliation 483,992, location 2,535,686, endpoint 1,128,169. The new taxonomy coding system URL (`HealthcareIndividualTaxonomyVS`) appears in it. No diff is possible until the May and October fingerprints exist.

## Pending

Once the four files are downloaded:

1. `dq_run.py --release 2026-05-08` (no previous release exists).
2. Re-run `dq_run.py --release 2026-08-20` with previous 2026-05-08. The input fingerprint is unchanged, so its rows are replaced in place.
3. Fingerprints for 2026-05-08 and 2026-10-07.
4. Diffs May to August and August to October. Check that the first shows the taxonomy system URL change at August and the second the `ein` organization type collapse at October. If either is missing the fingerprint is wrong and must be fixed first.
5. Optional: confirm the 2026-05-08 NPI result against the published 2026-05-08 point once that release can be read.
