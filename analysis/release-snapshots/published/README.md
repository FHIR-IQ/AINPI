# As-published finding payloads from earlier releases

CMS serves only the current NDH export, and each finding JSON under
`frontend/public/api/v1/findings/` is overwritten when the warehouse is
reloaded. The values those files carried for an earlier release survive only
in git history, which a shallow CI checkout cannot read.

`analysis/measures.py` needs those values to build a series, so they are
copied here byte-for-byte from the commit named in each filename
(`<slug>@<short sha>.json`). Nothing here is recomputed or edited. A value in
this directory is the as-published value for the release in its own
`release_date` field, not a value recomputed under today's definition; the
recompute is a later step of the measure-series design
(`docs/superpowers/specs/2026-09-12-ndh-measure-series-design.md`).

| File | Source commit | Release | Used for |
| --- | --- | --- | --- |
| `endpoint-org-linkage@f8a18ab.json` | f8a18ab4f9fc | 2026-05-08 | endpoint-org-linkage |
| `vendor-endpoint-attribution@0f8f39d.json` | 0f8f39df7956 | 2026-05-08 | vendor-filled-attribution |
| `pii-exposure-ndh@c34fe94.json` | c34fe94d859c | 2026-05-08 | ssn-exposures |
| `ndh-payer-endpoint-coverage@c39b178.json` | c39b178a1c49 | 2026-05-08 | payer-directory-endpoints |
| `practitioner-phone-reachability@c34fe94.json` | c34fe94d859c | 2026-05-08 | practitioner-phone-reachability |
| `npi-taxonomy-correctness@c34fe94.json` | c34fe94d859c | 2026-05-08 | role-specialty-agreement (H13, definition 1) |
| `npi-taxonomy-correctness@3fe0500.json` | 3fe05005b08d | 2026-05-08 | npi-validation-failures (H9, written before H10-H13 overwrote the shared slug) |
| `npi-taxonomy-correctness@be51fe6.json` | be51fe6ee4bb | 2026-08-20 | role-specialty-agreement restatement (first-entry reading, superseded 2026-08-28) |

Do not edit these files. If a value here is wrong, the correction belongs in
the generator that produced it and in a new point, with the difference
recorded as a restatement.
