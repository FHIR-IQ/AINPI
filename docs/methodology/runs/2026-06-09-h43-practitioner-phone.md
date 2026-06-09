# H43 practitioner phone-number reachability — pre-registration + run plan, 2026-06-09

Pre-registration record for H43 and the provenance plan for its first run.
H43 answers a recurring practical question — *can you associate a practitioner
in the NDH bulk export with a phone number?* — by resolving practitioner →
phone across the three FHIR resources where a phone can live, and reporting
both the union (reachable by any path) and the on-record share.

**Methodology version:** `0.7.2-draft`
**Pre-registered:** 2026-06-09
**Operator:** Eugene Vestel
**Status at pre-registration:** compute script committed; live fill-rates
populate on the next weekly-refresh (no BigQuery credentials in the authoring
session — same UI/script-first cadence as the 2026-06-02 landscape release).
**Reproducibility:** see "Commands" at the end.

## The question, reframed as a metric

"Phone number" is not a single field on a practitioner. In FHIR R4 / the NDH
IG a practitioner's phone can appear in three places:

| # | Path | FHIR location | What it means |
|---|------|---------------|---------------|
| 1 | Direct | `Practitioner.telecom[system='phone']` | Phone published on the individual's own record |
| 2 | Via role | `PractitionerRole.telecom[system='phone']` | Phone on the role tying the practitioner to an org |
| 3 | Via location | `Location.telecom[system='phone']`, reached through `PractitionerRole.location → Location` | Phone on the place the practitioner practices |

NPPES — the upstream source of ~90% of these fields — keeps practice phone on
the **location**, not the individual. So the pre-registered expectation is that
`Practitioner.telecom` is sparse and most reachability comes from the
PractitionerRole → Location traversal. H43 quantifies that gap so a consumer
building "call this provider" knows which resource to actually read.

## Pre-registration

| Field | Value |
|---|---|
| Slug | `practitioner-phone-reachability` |
| Hypothesis | H43 |
| Denominator | Active `Practitioner` resources in the pinned NDH release (`_active = TRUE`; ~7,441,211 at 2026-05-08) |
| Numerator | Distinct active practitioners reachable by a `system='phone'` telecom entry via path 1, 2, **or** 3 |
| Null hypothesis | No active Practitioner can be associated with a phone number through any of the three paths |
| Direction | We expect to reject the null; the informative result is the split between on-record and traversal-only reachability, not the rejection itself |

## Source

| Field | Value |
|---|---|
| Warehouse | `thematic-fort-453901-t7.cms_npd` |
| Tables | `practitioner`, `practitioner_role`, `location` |
| Release | 2026-05-08 NDH bulk export (also archived: 2026-04-09) |
| Extraction | `telecom[]` JSON-extracted per resource; roles joined to locations via the pipe-joined `_location_ids` reference list (`PractitionerRole.location[].reference`, see `analysis/fast_ingest_ndh.py`) |
| Cost control | One scan each of the three tables, `maximum_bytes_billed` capped at the project default via `bq_job_config()` |

## Method

Three CTEs evaluate the paths independently, then the union is intersected
back to the active Practitioner set so the numerator can never exceed the
denominator and dangling references / inactive practitioners drop out:

1. `direct` — `Practitioner.telecom` carries a `system='phone'` entry.
2. `role_phone` — any **active** `PractitionerRole` whose `practitioner`
   reference resolves to the practitioner carries a phone telecom.
3. `location_path` — any active role's `location[]` references a `Location`
   whose telecom carries a phone.

The on-record telecom systems (phone / fax / email / url) are broken out
separately so the headline is not inflated by non-voice contact points.

Chart (counts, summing to the denominator):

- **Phone on Practitioner record** — `direct`
- **Phone only via role / location** — `any_path − direct`
- **No phone on any path** — `total_active − any_path`

## Caveats (load-bearing)

- **May Location dedup.** The 2026-05-08 release deduped `Location` resources
  sharply (−61% vs April), which mechanically lowers path-3 reachability
  relative to the April release. Cross-release comparisons must hold this
  constant.
- **Sparse `Practitioner.telecom` is expected, not a defect.** NPPES keeps
  practice phone on the location. The on-record share measures "phone
  published directly on the individual"; the any-path share measures "phone
  discoverable for this individual at all."
- **Reference resolution.** `_practitioner_id` and `_location_ids` hold full
  reference strings (`Practitioner/<id>`, `Location/<id>`); the joins strip the
  prefix to match the target `_id` (same pattern as `analysis/landscape.py`).
  Roles pointing at a non-ingested Location are silently excluded from path 3.

## Commands

```bash
# From repo root, with BigQuery jobUser + dataViewer on cms_npd:
python analysis/h43_practitioner_phone.py
# Writes frontend/public/api/v1/findings/practitioner-phone-reachability.json
```

In CI the run is wired into `.github/workflows/weekly-refresh.yml` (step
"Re-run H43 practitioner phone reachability"), which commits the regenerated
JSON directly to `main`. Once that JSON lands, flip the finding's `status` in
`frontend/src/data/findings.ts` from `pre-registered` to `published`.
