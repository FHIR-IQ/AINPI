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
3. **Filter non-individual entities** (state and county health agencies appearing as billing NPIs) via NPPES entity type before publishing aggregate spending totals.
4. **Apply the H27 privacy pattern** — count and locate, never republish individual claims-level PII. Beneficiary identifiers, dates of birth, addresses other than the provider's own published address are out of scope.
5. **Emit a state-scoped CSV** under `frontend/public/api/v1/states/<state>/h<N>-<slug>.csv` with verification URLs for every flagged NPI.
6. **Write per-finding JSON** to `frontend/public/api/v1/findings/<slug>.json` matching the existing `ApiV1Finding` schema (`frontend/src/lib/api-v1-types.ts`).
7. **Stamp every payload** with `methodology_version`, `commit_sha`, and `generated_at` — same as the directory-side findings.

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

## Phase 0 (now, 2026-05-14)

This README is Phase 0. No module ships in this PR. The findings are pre-registered in `frontend/src/data/findings.ts` with `status: 'pre-registered'`, the roadmap is published at `/smd-revalidation/cross-audit-roadmap`, and the tracking issue is open at <https://github.com/FHIR-IQ/AINPI/issues>.

State agencies writing their SMD response between now and 2026-05-23 can cite the pre-registered findings as "metrics with public-facing data or reporting (forthcoming, methodology pinned)" for Element 2 of the strategy submission.
