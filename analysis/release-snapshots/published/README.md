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
| `endpoint-org-linkage@6e74041.json` | 6e7404180d80 | 2026-08-20 | endpoint-org-linkage |
| `vendor-endpoint-attribution@6e74041.json` | 6e7404180d80 | 2026-08-20 | vendor-filled-attribution |
| `ndh-payer-endpoint-coverage@6e74041.json` | 6e7404180d80 | 2026-08-20 | payer-directory-endpoints |
| `pii-exposure-ndh@6e74041.json` | 6e7404180d80 | 2026-08-20 | ssn-exposures |
| `npi-validity-summary@6e74041.json` | 6e7404180d80 | 2026-08-20 | npi-validation-failures |
| `npi-taxonomy-correctness@6e74041.json` | 6e7404180d80 | 2026-08-20 | role-specialty-agreement (H13, definition 2) |
| `practitioner-phone-reachability@6e74041.json` | 6e7404180d80 | 2026-08-20 | practitioner-phone-reachability |
| `role-gap-delta@6e74041.json` | 6e7404180d80 | 2026-05-08 (`before` side) | role-coverage-pa; its `after` side repeats 2026-08-20, which the regenerated file now supplies |
| `role-gap-composition@6e74041.json` | 6e7404180d80 | 2026-08-20 | `--before` input to `analysis/role_gap_delta.py` |
| `vendor-endpoint-attribution@4023860.json` | 40238604e34c (file last changed in c1129ee) | 2026-10-07 | as published before the FHI-73 regeneration (one NPI per URL). Not registered in `measures.py`: the regenerated file carries the same numerator and denominator, so there is nothing to restate |

## Required before every warehouse reload

The current-release points in `measures.json` are read from files the next
reload overwrites: every `frontend/public/api/v1/findings/*.json` the registry
names, and `frontend/public/api/v1/role-gap-delta.json`. If nobody copies them
here first, the generator correctly omits the outgoing release on its next
run, and the series loses a point it had.

In the same commit as `python3 analysis/release_snapshot.py --release <outgoing>`:

1. Copy each finding payload the registry in `analysis/measures.py` reads from
   `frontend/public/api/v1/findings/` into this directory as
   `<slug>@<short sha of HEAD>.json`, plus `role-gap-delta.json` the same way.
2. Add each copy to the registry as a vendored `Source` for the outgoing
   release, and add a row to the table above. `role-gap-delta.json` is the
   exception to a plain copy: it carries two releases (`from` and `to`), and
   the regenerated file's `from` repeats the outgoing release. Registering
   both with `role_gap_delta_pa` makes the generator raise "two sources for
   one release". Register the vendored copy with the per-side extractor so it
   supplies only the release the regenerated file drops, and keep the live
   file on `role_gap_delta_pa`:

   ```python
   sources=(Source(f"{PUBLISHED}/role-gap-delta@<sha>.json",
                   role_gap_delta_pa_side("before"), vendored_from="<sha>"),
            Source("frontend/public/api/v1/role-gap-delta.json", role_gap_delta_pa)),
   ```

   If the regenerated file restates the shared release, also register the
   vendored copy's `"after"` side with `restatement_of=<outgoing release>` so
   the difference is published. `test_role_gap_delta_*` in
   `analysis/tests/test_measures.py` pins both registrations against a
   three-release fixture.
3. Run `python3 analysis/measures.py` and confirm the outgoing release is
   still a point, not an omission, for every measure.

Automating this as a `--vendor-current` mode is a follow-up in the plan.

Do not edit these files. If a value here is wrong, the correction belongs in
the generator that produced it and in a new point, with the difference
recorded as a restatement.
