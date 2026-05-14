# `analysis/claims_sources/` — public claims data ingestion

Landing zone for the claims-side cross-audit findings (H29–H36) pre-registered on 2026-05-14. See the full plan at
[`docs/smd-revalidation/cross-audit-roadmap.md`](../../docs/smd-revalidation/cross-audit-roadmap.md) (rendered at
<https://ainpi.dev/smd-revalidation/cross-audit-roadmap>).

## Phase 1 (June 2026) — modules to drop here

| Module | Source dataset | Pre-registered finding |
| --- | --- | --- |
| `medicaid_provider_spending.py` | HHS opendata.hhs.gov — Medicaid Provider Spending 2018–2024 (NPI-keyed FFS + MCO) | [`/findings/excluded-paid-by-medicaid`](../../frontend/src/data/findings.ts) (H29) |
| `medicare_partb.py` | data.cms.gov — Medicare Physician & Other Practitioners by Provider and Service | [`/findings/excluded-billing-medicare`](../../frontend/src/data/findings.ts) (H30a) |
| `medicare_partd.py` | data.cms.gov — Medicare Part D Prescribers by Provider | [`/findings/excluded-billing-medicare`](../../frontend/src/data/findings.ts) (H30b) |
| `dmepos.py` | data.cms.gov — DMEPOS Supplier Directory (quarterly) | [`/findings/dmepos-excluded`](../../frontend/src/data/findings.ts) (H33) |

## Phase 2 (Jul–Aug 2026)

- `nppes_deactivation_join.py` — H31 (deactivated × any billing)
- `open_payments.py` — H32 (Sunshine Act × exclusions)
- `nh_compare_ownership.py` — H35 (NH/Hospice/HH ownership × exclusions)

## Phase 3 (Q4 2026)

- `pos.py` — H34 (internal CMS contradiction)
- `ndh_completeness.py` — H36 (high-volume billers absent from NDH)

## Shared invariants

Each module should:

1. **Cite the source release tag** in the module docstring and in the emitted JSON `data_source_release` field.
2. **Cap the join to public-only data.** TAF, full DMF, CMS Preclusion List are out of scope; do not load these even if available.
3. **Filter non-individual entities** (state and county health agencies appearing as billing NPIs) via NPPES entity type before publishing aggregate spending totals. Don't drop entity-2 rows entirely — surface them in the per-row CSV with `entity_type=2` so the reader can see them in context — but exclude them from the aggregate headline count.
4. **Apply the H27 privacy pattern** — count and locate, never republish individual claims-level PII. Beneficiary identifiers, dates of birth, addresses other than the provider's own published address are out of scope.
5. **Anchor every claims-side number in AINPI's directory-side priors.** The existing H1–H28 findings are the context layer. Each per-row CSV must include the directory-side columns the reader needs to interpret the claims-side headline — at minimum: `entity_type` (NPPES 1 vs 2), `nppes_active`, `ndh_active` (from `cms_npd.practitioner._active`), `exclusion_source`, `exclusion_effective_date`. Where the procedure mix matters (H29 specifically), add `top_hcpcs_codes` so the reader can see when one NPI mixes wide-ranging procedures. The aggregate-data sources (HHS Medicaid Provider Spending, Medicare Part B) include rows that are not comparable to individual-practitioner billing; the directory-side priors are the de-noise layer that prevents out-of-context citation. See [`docs/smd-revalidation/cross-audit-roadmap.md`](../../docs/smd-revalidation/cross-audit-roadmap.md) §10b for the H29 schema.
6. **Emit a state-scoped CSV** under `frontend/public/api/v1/states/<state>/h<N>-<slug>.csv` with verification URLs for every flagged NPI.
7. **Write per-finding JSON** to `frontend/public/api/v1/findings/<slug>.json` matching the existing `ApiV1Finding` schema (`frontend/src/lib/api-v1-types.ts`).
8. **Stamp every payload** with `methodology_version`, `commit_sha`, and `generated_at` — same as the directory-side findings.

## Refresh cadence

Each source has its own publication rhythm. The repo's weekly GitHub Actions cron picks up whichever source files have rolled forward; the JSON payloads carry `data_source_release` so consumers can see which source vintage produced which number.

| Source | Cadence |
| --- | --- |
| HHS Medicaid Provider Spending | TBD (first release was 2026-02-14; assume annual until proven otherwise) |
| Medicare Part B / Part D | Annual |
| CMS Open Payments | Annual + quarterly refresh |
| DMEPOS Supplier Directory | Quarterly |
| Nursing Home Compare ownership | Monthly |
| Provider of Services | Quarterly |

## Shared cross-walk: CMS Medicare Fee-For-Service Public Provider Enrollment (PPEF)

`frontend/data/cms-claims/PPEF_Enrollment_Extract_2026.04.01.csv` (321 MB, 2.98M rows, 2026-04-01 release). Published quarterly at <https://data.cms.gov> as dataset `2457ea29-fc82-48b0-86ec-3b0755de7515`. Provides the two cross-walks the All Owners files need:

- `PECOS_ASCT_CNTL_ID` ↔ `NPI` — used by `nh_compare_ownership.py` Stage B (methodology #2, 2026-05-14) to resolve owner NPI from the All Owners file's "ASSOCIATE ID - OWNER" column. Reach: 2,470,908 individual NPIs.
- `ENRLMT_ID` ↔ `STATE_CD` — facility-state lookup for owner records whose owner-side STATE is structurally empty (100% empty for TYPE='I' individual owners in the All Owners files). 2,981,799 enrollment IDs covered; lookup hits 100% of owner rows.

The same cross-walk is a candidate enabler for H34 (POS-deactivated × NPPES-active) — PPEF carries `ENRLMT_ID` for individual + organization enrollments but does NOT carry the facility CCN that the POS files key on, so the H34 blocker (CCN ↔ NPI) remains open.

## Phase 0 (now, 2026-05-14)

This README is Phase 0. No module ships in this PR. The findings are pre-registered in `frontend/src/data/findings.ts` with `status: 'pre-registered'`, the roadmap is published at `/smd-revalidation/cross-audit-roadmap`, and the tracking issue is open at <https://github.com/FHIR-IQ/AINPI/issues>.

State agencies writing their SMD response between now and 2026-05-23 can cite the pre-registered findings as "metrics with public-facing data or reporting (forthcoming, methodology pinned)" for Element 2 of the strategy submission.

## Decisions locked in 2026-05-14 (see roadmap §10)

- **Per-NPI publication policy (H29):** paid amount with context, anchored in AINPI's directory-side priors. Every row carries `entity_type`, `nppes_active`, `ndh_active`, `exclusion_source`, `exclusion_effective_date`, `top_hcpcs_codes`. No state-comparative ranking; per-state slices only.
- **Disclosure timing:** publish when available and high confidence. No pre-publication notice gate. Virginia gets a 5-business-day review courtesy on VA-attributed rows as the pilot relationship; that's one-state, not a precedent.
- **Pilot state:** Virginia. The first state-scoped CSV is `/api/v1/states/va/h29-excluded-paid.csv`. The 131-NPI cohort already at `/api/v1/states/va-cohort-critical.csv` is the input set.
