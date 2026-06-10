# H43 practitioner phone-number reachability — pre-registration + run plan, 2026-06-09

Pre-registration record for H43 and the provenance plan for its first run.
H43 answers a recurring practical question — *can you associate a practitioner
in the NDH bulk export with a phone number?* — by resolving practitioner →
phone across the three FHIR resources where a phone can live, and reporting
both the union (reachable by any path) and the on-record share.

**Methodology version:** `0.7.2-draft`
**Pre-registered:** 2026-06-09
**First run:** 2026-06-09 (dispatched via the isolated `h43-refresh.yml` workflow)
**Operator:** Eugene Vestel
**Status:** published — measured against the 2026-05-08 release.
**Reproducibility:** see "Commands" at the end.

## Result (2026-06-09 run) — prior rejected

| Metric | Value |
|---|---|
| Active Practitioner resources (denominator) | 7,196,385 |
| Phone directly on `Practitioner.telecom` | **7,195,270 (99.98%)** |
| Reachable any path (numerator) | 7,195,270 (99.98%) |
| Reachable *only* via role / location | 0 |
| No phone on any of the three resources | 1,115 (0.015%) |
| On-record fax / email / url | 2,871,690 / 0 / 0 |
| Practitioner refs with a role-level phone (pre-dedup) | 1,790,830 |
| Location-level phone (pre-dedup) | 0 |

The pre-registered expectation (below) was that `Practitioner.telecom` would be
sparse and reachability would come from the PractitionerRole → Location
traversal. The data rejected it: NDH carries a phone directly on the
Practitioner record for essentially every active practitioner, and the
traversal adds nothing.

Two zeros to keep an eye on (they do not affect the headline, which stands on
on-record phone alone): on-record `email`/`url` and the location-phone path all
came back empty. Could be genuine (May deduped Locations may carry no telecom)
or a join nuance in path 3 — verify against the source before relying on those
channels. Phone (7.2M) vs fax (2.87M) differing confirms the telecom-system
matcher itself works.

## The question, reframed as a metric

"Phone number" is not a single field on a practitioner. In FHIR R4 / the NDH
IG a practitioner's phone can appear in three places:

| # | Path | FHIR location | What it means |
|---|------|---------------|---------------|
| 1 | Direct | `Practitioner.telecom[system='phone']` | Phone published on the individual's own record |
| 2 | Via role | `PractitionerRole.telecom[system='phone']` | Phone on the role tying the practitioner to an org |
| 3 | Via location | `Location.telecom[system='phone']`, reached through `PractitionerRole.location → Location` | Phone on the place the practitioner practices |

NPPES — the upstream source of ~90% of these fields — keeps practice phone on
the **location**, not the individual. So the pre-registered expectation was that
`Practitioner.telecom` would be sparse and most reachability would come from the
PractitionerRole → Location traversal. H43 quantifies that gap so a consumer
building "call this provider" knows which resource to actually read. *(See the
Result section above: this prior was wrong — NDH carries the phone on the
Practitioner record directly.)*

## Pre-registration

| Field | Value |
|---|---|
| Slug | `practitioner-phone-reachability` |
| Hypothesis | H43 |
| Denominator | Active `Practitioner` resources in the pinned NDH release (`_active = TRUE`; 7,196,385 active of 7,441,211 total at 2026-05-08) |
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
- **On-record vs any-path framing.** The on-record share measures "phone
  published directly on the individual"; the any-path share measures "phone
  discoverable for this individual at all." The pre-registration assumed these
  would diverge widely (NPPES keeps practice phone on the location); in the
  measured 2026-05-08 release they coincide — NDH carries the phone on the
  Practitioner record for 99.98% of active practitioners.
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

In CI the run is available two ways: the standalone `.github/workflows/h43-refresh.yml`
(dispatch-only, runs just this analysis and commits its single JSON — used for
the 2026-06-09 first run), and the weekly `.github/workflows/weekly-refresh.yml`
step "Re-run H43 practitioner phone reachability". The isolated workflow exists
because the weekly chain runs fail-fast and an unrelated earlier step (H24) was
breaking it, which skipped H43. The finding's `status` in
`frontend/src/data/findings.ts` is now `published`.
