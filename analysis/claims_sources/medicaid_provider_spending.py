"""H29 — Federally excluded providers paid by Medicaid (HHS spending dataset).

Joins the AINPI federally-excluded cohort (active OIG LEIE OR SAM.gov)
against the HHS Medicaid Provider Spending dataset, T-MSIS-sourced,
2018-2024, NPI-keyed, publicly downloadable at
opendata.hhs.gov/datasets/medicaid-provider-spending/
(release date 2026-02-09).

Pilot state: Virginia. The 131-NPI VA cohort at
frontend/public/api/v1/states/va-cohort-critical.csv is the input set
for the per-state CSV at frontend/public/api/v1/states/va/h29-excluded-paid.csv.

SOURCE-FILE SCHEMA NOTE (load-bearing — please read):
    The HHS file has 7 columns and 238M rows:
        BILLING_PROVIDER_NPI_NUM      string
        SERVICING_PROVIDER_NPI_NUM    string
        HCPCS_CODE                    string
        CLAIM_FROM_MONTH              string  (YYYY-MM)
        TOTAL_PATIENTS                int64
        TOTAL_CLAIM_LINES             int64
        TOTAL_PAID                    double
    There is NO state column in the source file. The earlier roadmap
    draft (§6, pre-2026-05-14) assumed state attribution via "T-MSIS
    state code in the source file" — that assumption is wrong.
    State attribution comes from NPPES (provider practice state), not
    from the spending file. So the VA-pilot finding reads as:
        "VA-resident federally-excluded NPIs (per NPPES practice state)
         received Medicaid payments from any state's Medicaid program."
    NOT:
        "VA's Medicaid program paid these excluded providers."
    Both are § 455.436 audit signals; the framing matters for honest
    presentation.

EXECUTION:
    Local pyarrow filter against the 3GB parquet on disk is fast for
    the 131-NPI cohort (single pass over the parquet, predicate pushdown
    on NPI columns). No BigQuery round-trip for the VA pilot.

Run order:
    1. analysis/ingest_oig_leie.py
    2. analysis/ingest_sam_exclusions.py
    3. (download HHS parquet — see PARQUET_URL below)
    4. python analysis/claims_sources/medicaid_provider_spending.py --state va

Schema invariants (locked in 2026-05-14, see cross-audit roadmap §10):
    - Per-NPI publication = paid amount with directory-side context.
    - Every row carries entity_type, nppes_active, ndh_active,
      exclusion_source, exclusion_effective_date, top_hcpcs_codes.
    - No state-comparative ranking; per-state slices only.
    - Publish when available and high confidence. VA gets 5-business-day
      review courtesy on VA-attributed rows; one-state pilot, not a
      precedent.

Writes:
    frontend/public/api/v1/findings/excluded-paid-by-medicaid.json
    frontend/public/api/v1/findings/excluded-paid-by-medicaid-detail.json
    frontend/public/api/v1/states/<state>/h29-excluded-paid.csv
"""
from __future__ import annotations
import argparse
import csv
import json
import pathlib
import subprocess
from collections import defaultdict
from datetime import datetime, timezone

import pyarrow as pa
import pyarrow.parquet as pq
import pyarrow.compute as pc

METHODOLOGY_VERSION = "0.6.1-draft"
DATA_SOURCE_RELEASE = "2026-02-09"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
PARQUET_PATH = (
    REPO_ROOT
    / "frontend"
    / "data"
    / "hhs-medicaid-spending"
    / "medicaid-provider-spending.parquet"
)
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
STATES_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states"
PARQUET_URL = (
    "https://stopendataprod.blob.core.windows.net/datasets/"
    "medicaid-provider-spending/2026-02-09/dataset/"
    "medicaid-provider-spending.parquet"
)


def get_commit_sha() -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            timeout=5,
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except (FileNotFoundError, subprocess.SubprocessError):
        pass
    return "pending"


def load_cohort(csv_path: pathlib.Path) -> list[dict]:
    with open(csv_path, newline="") as fh:
        return list(csv.DictReader(fh))


def filter_parquet_for_npis(
    npis: set[str], cutoff_by_npi: dict[str, str] | None = None,
) -> dict[str, dict]:
    """Single pass over the parquet, filtering on (billing|servicing) ∈ npis.

    Returns a dict keyed by NPI with aggregated paid amount, claim line count,
    top HCPCS by paid amount, first/last claim month, and which axis the NPI
    matched on (billing vs servicing).

    `cutoff_by_npi` maps NPI → 'YYYY-MM' (or empty/None). When provided, we
    additionally accumulate `post_exclusion_paid` and `post_exclusion_claims`
    for claim months strictly after the NPI's cutoff. The top-level totals
    (`paid`, `claims`) still cover the full window.
    """
    if not PARQUET_PATH.exists():
        raise SystemExit(
            f"Parquet file not found at {PARQUET_PATH}\n"
            f"Download: curl -sSL -o {PARQUET_PATH} {PARQUET_URL}"
        )

    pf = pq.ParquetFile(PARQUET_PATH)
    print(f"Scanning {PARQUET_PATH.name} — {pf.metadata.num_rows:,} rows · {pf.num_row_groups} row groups")

    cutoff_by_npi = cutoff_by_npi or {}

    per_npi: dict[str, dict] = defaultdict(lambda: {
        "paid": 0.0,
        "claims": 0,
        "patients": 0,
        "post_exclusion_paid": 0.0,
        "post_exclusion_claims": 0,
        "post_exclusion_first_month": None,
        "post_exclusion_last_month": None,
        "axes": set(),
        "first_month": None,
        "last_month": None,
        "hcpcs": defaultdict(float),  # code -> paid
    })

    npi_set = pa.array(list(npis), type=pa.string())
    cols = [
        "BILLING_PROVIDER_NPI_NUM",
        "SERVICING_PROVIDER_NPI_NUM",
        "HCPCS_CODE",
        "CLAIM_FROM_MONTH",
        "TOTAL_PATIENTS",
        "TOTAL_CLAIM_LINES",
        "TOTAL_PAID",
    ]

    for i, batch in enumerate(pf.iter_batches(batch_size=200_000, columns=cols)):
        # Filter rows where billing OR servicing NPI is in the cohort.
        billing = batch.column("BILLING_PROVIDER_NPI_NUM")
        servicing = batch.column("SERVICING_PROVIDER_NPI_NUM")
        mask_b = pc.is_in(billing, value_set=npi_set)
        mask_s = pc.is_in(servicing, value_set=npi_set)
        mask = pc.or_(mask_b, mask_s)
        if not pc.any(mask).as_py():
            continue

        sub = batch.filter(mask).to_pylist()
        for row in sub:
            billing_npi = row["BILLING_PROVIDER_NPI_NUM"]
            servicing_npi = row["SERVICING_PROVIDER_NPI_NUM"]
            paid = float(row["TOTAL_PAID"] or 0)
            claims = int(row["TOTAL_CLAIM_LINES"] or 0)
            patients = int(row["TOTAL_PATIENTS"] or 0)
            hcpcs = row["HCPCS_CODE"] or ""
            month = row["CLAIM_FROM_MONTH"] or ""

            for npi, axis in [(billing_npi, "billing"), (servicing_npi, "servicing")]:
                if not npi or npi not in npis:
                    continue
                slot = per_npi[npi]
                slot["paid"] += paid
                slot["claims"] += claims
                slot["patients"] += patients
                slot["axes"].add(axis)
                slot["hcpcs"][hcpcs] += paid
                if slot["first_month"] is None or month < slot["first_month"]:
                    slot["first_month"] = month
                if slot["last_month"] is None or month > slot["last_month"]:
                    slot["last_month"] = month
                # Strict post-exclusion accumulator
                cutoff = cutoff_by_npi.get(npi, "")
                if cutoff and month and month > cutoff[:7]:
                    slot["post_exclusion_paid"] += paid
                    slot["post_exclusion_claims"] += claims
                    if (slot["post_exclusion_first_month"] is None
                            or month < slot["post_exclusion_first_month"]):
                        slot["post_exclusion_first_month"] = month
                    if (slot["post_exclusion_last_month"] is None
                            or month > slot["post_exclusion_last_month"]):
                        slot["post_exclusion_last_month"] = month

        if (i + 1) % 50 == 0:
            print(f"  scanned {(i + 1) * 200_000:>12,} rows · {len(per_npi)} NPIs matched so far")

    print(f"Done. {len(per_npi)} matching NPIs.")
    return dict(per_npi)


def cutoff_for_cohort_row(row: dict) -> str:
    """Compute the strict-post-exclusion cutoff for one cohort row.

    Uses LEIE / SAM exclusion-effective dates only — NPPES deactivation
    is NOT an exclusion (can be triggered by retirement, death, voluntary
    closure of practice, etc.) so it's not load-bearing for the
    post-exclusion attribution claim. Returns the EARLIEST of the LEIE
    or SAM dates if either is present. Format: 'YYYY-MM-DD'.
    """
    candidates = [
        (row.get("leie_excldate") or "").strip(),
        (row.get("sam_active_date") or "").strip(),
    ]
    candidates = [c for c in candidates if c and len(c) >= 10]
    return min(candidates) if candidates else ""


def compose_rows(cohort: list[dict], hits: dict[str, dict]) -> list[dict]:
    by_npi = {r["npi"]: r for r in cohort if r.get("npi")}
    out = []
    for npi, agg in hits.items():
        cohort_row = by_npi.get(npi, {})
        cutoff = cutoff_for_cohort_row(cohort_row)
        top_hcpcs = sorted(
            agg["hcpcs"].items(), key=lambda kv: kv[1], reverse=True
        )[:3]
        # Use post-exclusion amount as the strict headline when we have a
        # cutoff; otherwise fall back to total paid (back-compat).
        if cutoff:
            headline_paid = round(agg["post_exclusion_paid"], 2)
            headline_claims = agg["post_exclusion_claims"]
            first = agg["post_exclusion_first_month"] or ""
            last = agg["post_exclusion_last_month"] or ""
        else:
            headline_paid = round(agg["paid"], 2)
            headline_claims = agg["claims"]
            first = agg["first_month"] or ""
            last = agg["last_month"] or ""
        out.append({
            "npi": npi,
            "name": cohort_row.get("name", ""),
            "paid_amount_post_exclusion": headline_paid,
            "claim_lines_post_exclusion": headline_claims,
            "paid_amount_full_window": round(agg["paid"], 2),
            "claim_lines_full_window": agg["claims"],
            "patients_total": agg["patients"],
            "top_hcpcs_codes": "; ".join(f"{c}=${a:,.0f}" for c, a in top_hcpcs if c),
            "exclusion_source": cohort_row.get("reasons", ""),
            "exclusion_effective_date": cutoff,
            "score": cohort_row.get("score", ""),
            "first_paid_month": first,
            "last_paid_month": last,
            "billing_or_servicing": ", ".join(sorted(agg["axes"])),
            "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
            "sam_lookup_url": "https://sam.gov/search/?index=ex",
            "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{npi}",
        })
    # Sort by strict post-exclusion paid amount when available; cohort rows
    # with no cutoff will have it == full_window paid.
    out.sort(key=lambda r: r["paid_amount_post_exclusion"], reverse=True)
    return out


def write_state_csv(state: str, rows: list[dict]) -> pathlib.Path:
    out_dir = STATES_DIR / state.lower()
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "h29-excluded-paid.csv"
    fieldnames = [
        "npi", "name",
        "paid_amount_post_exclusion", "claim_lines_post_exclusion",
        "paid_amount_full_window", "claim_lines_full_window",
        "patients_total", "top_hcpcs_codes",
        "exclusion_source", "exclusion_effective_date", "score",
        "first_paid_month", "last_paid_month", "billing_or_servicing",
        "leie_lookup_url", "sam_lookup_url", "nppes_lookup_url",
    ]
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})
    print(f"Wrote {out} ({len(rows)} rows)")
    return out


def write_finding_json(rows: list[dict], states_total: int, total_cohort: int, per_state_stats: dict) -> None:
    total_paid_post = sum(r["paid_amount_post_exclusion"] for r in rows if r["exclusion_effective_date"])
    total_paid_window = sum(r["paid_amount_full_window"] for r in rows)
    total_claims_window = sum(r["claim_lines_full_window"] for r in rows)
    post_exclusion_rows = [
        r for r in rows
        if r["paid_amount_post_exclusion"] > 0 and r["exclusion_effective_date"]
    ]
    top_rows = rows[:5]

    headline = (
        f"Of {total_cohort:,} currently-active federally-excluded NPIs across "
        f"{states_total} state cohorts (per NPPES practice state), {len(rows)} "
        f"received Medicaid payments somewhere in T-MSIS 2018–2024 totalling "
        f"${total_paid_window:,.0f} across {total_claims_window:,} claim lines — "
        f"but only {len(post_exclusion_rows)} of those {len(rows)} matches "
        f"received payment STRICTLY AFTER the earliest of their LEIE / SAM "
        f"exclusion-effective dates, totalling ${total_paid_post:,.0f} in strict "
        f"post-exclusion payments. The strict-filter result is the regulatorily "
        f"significant signal — pre-exclusion billing reflects work the provider "
        f"was legitimately authorized to do at the time, while post-exclusion "
        f"billing is a direct 42 CFR § 455.436 audit-referral candidate. Source: "
        f"HHS Medicaid Provider Spending dataset ({DATA_SOURCE_RELEASE} release). "
        f"Two source-data limits: (1) the HHS file has no state-of-payment "
        f"column, so paid amounts aggregate across every state Medicaid program "
        f"that paid the NPI — state attribution is per NPPES practice state, "
        f"not per state of payment; (2) NPPES deactivation is NOT used as an "
        f"exclusion-effective date because it can be triggered by retirement / "
        f"death / voluntary closure of practice."
    )

    payload = {
        "slug": "excluded-paid-by-medicaid",
        "title": "Federally excluded providers paid by Medicaid (HHS spending dataset)",
        "hypotheses": ["H29"],
        "status": "published",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(post_exclusion_rows),
        "denominator": total_cohort,
        "numerator_full_window": len(rows),
        "numerator_note": (
            f"Numerator = NPIs with payments STRICTLY AFTER their LEIE/SAM "
            f"exclusion-effective date. Full-window numerator (any payment "
            f"2018-2024, regardless of pre/post exclusion) = {len(rows)}."
        ),
        "denominator_note": (
            f"All-states scope = {total_cohort:,} unique federally-excluded NPIs "
            f"across {states_total} state cohorts (active LEIE or SAM, score >= "
            f"1.5; state per NPPES practice state). Per-state CSVs at "
            f"/api/v1/states/<state>/h29-excluded-paid.csv. Source-data limit: "
            f"the HHS file does NOT carry a state-of-payment column, so per-NPI "
            f"paid amounts aggregate across every state Medicaid program that "
            f"paid the NPI. State attribution comes from NPPES practice state, "
            f"not state of payment."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://opendata.hhs.gov/datasets/medicaid-provider-spending/",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "Cohort NPIs paid by Medicaid (full-window)", "value": len(rows)},
                {"label": "Strict post-exclusion subset", "value": len(post_exclusion_rows)},
            ],
        },
        "per_state": sorted(
            ({"state": s, **stats} for s, stats in per_state_stats.items()),
            key=lambda d: -d["matches_full_window"],
        ),
        "notes": (
            "All-states refresh. Per-state CSVs at "
            f"/api/v1/states/<state>/h29-excluded-paid.csv carry one row per "
            "matched NPI with the directory-side context columns (top_hcpcs_codes, "
            "exclusion_source, billing-or-servicing axis, first/last paid month) "
            "needed to interpret the paid-amount headline. Source-file schema: "
            "7 columns (billing/servicing NPI, HCPCS, claim month, patients, "
            "claim lines, paid amount), 238M rows, no state-of-payment column. "
            "State attribution comes from NPPES practice state, not the spending "
            "file. The HHS source aggregates fee-for-service, managed care, and "
            "CHIP; matches catch MCO-side exposures that AINPI's H26 4-payer sweep "
            "currently misses behind authentication walls. Disclosure timing: "
            "publish when available and high confidence (locked-in 2026-05-14 per "
            "roadmap §10). All per-state CSVs ship concurrently with each "
            "refresh; no state agency receives prior notice or has gating "
            "rights over publication."
        ),
    }

    out = FINDINGS_DIR / "excluded-paid-by-medicaid.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {out}")

    detail = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "denominator_cohort_size": total_cohort,
        "states_covered": states_total,
        "matches": len(rows),
        "total_paid_post_exclusion": total_paid_post,
        "total_paid_full_window": total_paid_window,
        "total_claim_lines_full_window": total_claims_window,
        "matches_with_post_exclusion_payment": len(post_exclusion_rows),
        "source_file_schema_note": (
            "HHS Medicaid Provider Spending has no state-of-payment column. "
            "State attribution is via NPPES practice state from each state's "
            "cohort CSV, not the source file. Per-NPI paid amounts aggregate "
            "across all state Medicaid programs that paid the NPI."
        ),
        "per_state_stats": per_state_stats,
        "top_paid_npis": [
            {k: r.get(k) for k in (
                "npi", "name", "paid_amount_post_exclusion", "paid_amount_full_window",
                "patients_total", "exclusion_source", "top_hcpcs_codes",
                "first_paid_month", "last_paid_month", "billing_or_servicing",
            )}
            for r in top_rows
        ],
        "csv_url_pattern": "/api/v1/states/<state>/h29-excluded-paid.csv",
    }
    detail_out = FINDINGS_DIR / "excluded-paid-by-medicaid-detail.json"
    detail_out.write_text(json.dumps(detail, indent=2) + "\n")
    print(f"Wrote {detail_out}")


def main() -> None:
    from analysis.claims_sources._cohorts import (
        load_all_state_cohorts,
        npi_to_state_map,
    )

    cohorts = load_all_state_cohorts()
    if not cohorts:
        raise SystemExit("No per-state cohort CSVs found. Run analysis/build_state_cohort.py --all first.")

    npi_to_state = npi_to_state_map(cohorts)
    total_npis = len(npi_to_state)
    print(f"Loaded {len(cohorts)} state cohorts, {total_npis:,} unique NPIs total")

    # Flatten cohorts to one big list (for compose_rows) and build cutoff index
    flat_cohort: list[dict] = []
    cutoff_by_npi: dict[str, str] = {}
    for state, state_cohort in cohorts.items():
        for npi, row in state_cohort.items():
            flat_cohort.append(row)
            cutoff_by_npi[npi] = cutoff_for_cohort_row(row)
    with_cutoff = sum(1 for v in cutoff_by_npi.values() if v)
    print(f"  with exclusion-effective date: {with_cutoff} ({100*with_cutoff/total_npis:.1f}%)")

    # Single pass over the 2.9 GB parquet
    hits = filter_parquet_for_npis(set(npi_to_state.keys()), cutoff_by_npi=cutoff_by_npi)
    rows = compose_rows(flat_cohort, hits)

    # Partition by state
    per_state_rows: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        st = npi_to_state.get(r["npi"], "")
        if st:
            per_state_rows[st].append(r)

    per_state_stats: dict[str, dict] = {}
    for st, st_rows in per_state_rows.items():
        write_state_csv(st, st_rows)
        full_window = sum(r["paid_amount_full_window"] for r in st_rows)
        strict = sum(r["paid_amount_post_exclusion"] for r in st_rows if r["exclusion_effective_date"])
        per_state_stats[st] = {
            "matches_full_window": len(st_rows),
            "matches_strict_post": sum(
                1 for r in st_rows
                if r["exclusion_effective_date"] and r["paid_amount_post_exclusion"] > 0
            ),
            "paid_full_window": round(full_window, 2),
            "paid_strict_post": round(strict, 2),
        }

    write_finding_json(
        rows,
        states_total=len(cohorts),
        total_cohort=total_npis,
        per_state_stats=per_state_stats,
    )

    print("\nTop 5 states by match count:")
    top5 = sorted(per_state_stats.items(), key=lambda kv: -kv[1]["matches_full_window"])[:5]
    for s, st in top5:
        print(f"  {s:2s}  matches={st['matches_full_window']:>4}  strict={st['matches_strict_post']:>3}  "
              f"paid=${st['paid_full_window']:>14,.0f}  strict_paid=${st['paid_strict_post']:>12,.0f}")


if __name__ == "__main__":
    main()
