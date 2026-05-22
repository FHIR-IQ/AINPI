"""H40 — Federally excluded NPIs billing Medicare Part B by HCPCS post-exclusion.

Sharpens H30a from "billed Part B for $X" to per-(NPI, HCPCS, POS) detail
— the unit-of-work State Medicaid PI offices write recoupment letters
against. Uses the granular sibling of the file H30a reads: CMS Medicare
Physician & Other Practitioners **by Provider AND Service** (one row per
NPI × HCPCS × place_of_service per service year).

Streams the source file ONCE per refresh; partitions matches across all
state cohorts in memory. Same I/O pattern as `medicare_partb.py` — the
source is larger (~3 GB unzipped) but the streaming approach scales.

The published file's Place_Of_Srvc column is aggregated to F (Facility)
or O (Office/non-facility) at file build time — claim-level POS codes
(02 telehealth, 10 home telehealth, etc.) are not directly recoverable
here. H42's POS-02/POS-10 filter therefore needs to operate on telehealth-
specific HCPCS codes (G2010-G2012, 99421-99423, etc.), not the
Place_Of_Srvc column. See h42_*.py when that lands.

Source file (already on disk via weekly-refresh):
    frontend/data/cms-claims/partb-by-provider-and-service.csv
    (CMS RY2025 release; latest service year CY 2023; ~3 GB / ~10M rows)

Writes:
    frontend/public/api/v1/findings/excluded-billing-medicare-partb-by-hcpcs.json
    frontend/public/api/v1/states/<state>/h40-excluded-partb-by-hcpcs.csv  (per-state)
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone

from analysis.claims_sources._cohorts import (
    cutoff_year,
    load_all_state_cohorts,
    lookup_urls,
    npi_to_state_map,
    state_output_dir,
)

METHODOLOGY_VERSION = "0.7.0-draft"
DATA_SOURCE_RELEASE = "CY 2023 (RY2025)"
SERVICE_YEAR = 2023

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SOURCE_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "partb-by-provider-and-service.csv"
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"

CSV_FIELDS = [
    "npi", "name", "state", "billing_state",
    "hcpcs_code", "hcpcs_description", "hcpcs_drug_ind",
    "place_of_service",
    "services_2023", "beneficiaries_2023",
    "avg_paid_per_service", "avg_allowed_per_service", "avg_submitted_charge",
    "estimated_paid_total",
    "provider_type",
    "exclusion_source", "exclusion_effective_year",
    "post_exclusion_2023_billing", "score",
    "leie_lookup_url", "sam_lookup_url", "nppes_lookup_url",
]


def get_commit_sha() -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            capture_output=True, text=True, cwd=REPO_ROOT, timeout=5,
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except (FileNotFoundError, subprocess.SubprocessError):
        pass
    return "pending"


def _f(v) -> float:
    try:
        return float(v) if v not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _i(v) -> int | str:
    try:
        return int(float(v)) if v not in (None, "") else ""
    except (TypeError, ValueError):
        return ""


def main() -> None:
    cohorts = load_all_state_cohorts()
    npi_to_state = npi_to_state_map(cohorts)
    total_npis = len(npi_to_state)
    print(f"Loaded {len(cohorts)} state cohorts, {total_npis:,} unique NPIs total")
    print(f"Streaming {SOURCE_CSV} (one pass)...")

    per_state_rows: dict[str, list[dict]] = defaultdict(list)
    matched_npis: set[str] = set()
    matched_post_excl_npis: set[str] = set()
    hcpcs_counter: Counter[tuple[str, str]] = Counter()  # (hcpcs_code, description)
    hcpcs_counter_post: Counter[tuple[str, str]] = Counter()
    rows_scanned = 0

    with open(SOURCE_CSV, newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows_scanned += 1
            if rows_scanned % 1_000_000 == 0:
                print(f"  scanned {rows_scanned:,} rows, matched {len(matched_npis):,} NPIs so far")
            npi = (row.get("Rndrng_NPI") or "").strip()
            if not npi or npi not in npi_to_state:
                continue
            state = npi_to_state[npi]
            cohort_row = cohorts[state].get(npi, {})
            hcpcs = (row.get("HCPCS_Cd") or "").strip()
            hcpcs_desc = (row.get("HCPCS_Desc") or "").strip()
            pos = (row.get("Place_Of_Srvc") or "").strip()
            services = _i(row.get("Tot_Srvcs"))
            benes = _i(row.get("Tot_Benes"))
            avg_paid = _f(row.get("Avg_Mdcr_Pymt_Amt"))
            avg_allowed = _f(row.get("Avg_Mdcr_Alowd_Amt"))
            avg_sbmtd = _f(row.get("Avg_Sbmtd_Chrg"))
            services_n = int(services) if isinstance(services, int) else 0
            est_paid = round(avg_paid * services_n, 2)
            cy = cutoff_year(cohort_row)
            post_excl = cy is not None and cy < SERVICE_YEAR

            matched_npis.add(npi)
            if post_excl:
                matched_post_excl_npis.add(npi)
                hcpcs_counter_post[(hcpcs, hcpcs_desc)] += 1
            hcpcs_counter[(hcpcs, hcpcs_desc)] += 1

            per_state_rows[state].append({
                "npi": npi,
                "name": cohort_row.get("name", ""),
                "state": state,
                "billing_state": row.get("Rndrng_Prvdr_State_Abrvtn", ""),
                "hcpcs_code": hcpcs,
                "hcpcs_description": hcpcs_desc,
                "hcpcs_drug_ind": row.get("HCPCS_Drug_Ind", ""),
                "place_of_service": pos,
                "services_2023": services,
                "beneficiaries_2023": benes,
                "avg_paid_per_service": round(avg_paid, 2),
                "avg_allowed_per_service": round(avg_allowed, 2),
                "avg_submitted_charge": round(avg_sbmtd, 2),
                "estimated_paid_total": est_paid,
                "provider_type": row.get("Rndrng_Prvdr_Type", ""),
                "exclusion_source": cohort_row.get("reasons", ""),
                "exclusion_effective_year": cy if cy is not None else "",
                "post_exclusion_2023_billing": "yes" if post_excl else "no",
                "score": cohort_row.get("score", ""),
                **lookup_urls(npi),
            })

    print(f"\nFinished scan: {rows_scanned:,} rows total.")

    states_with_matches = 0
    for state, rows in per_state_rows.items():
        rows.sort(key=lambda r: (-r["estimated_paid_total"], r["npi"], r["hcpcs_code"]))
        out_dir = state_output_dir(state)
        out_path = out_dir / "h40-excluded-partb-by-hcpcs.csv"
        with open(out_path, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in CSV_FIELDS})
        states_with_matches += 1

    all_rows = [r for rows in per_state_rows.values() for r in rows]
    strict_post = [r for r in all_rows if r["post_exclusion_2023_billing"] == "yes"]
    total_est_paid = sum(r["estimated_paid_total"] for r in all_rows)
    total_est_paid_strict = sum(r["estimated_paid_total"] for r in strict_post)
    total_services = sum(int(r["services_2023"] or 0) for r in all_rows if r["services_2023"])
    total_services_strict = sum(int(r["services_2023"] or 0) for r in strict_post if r["services_2023"])

    state_summary = sorted(
        (
            {
                "state": s,
                "distinct_npis": len({r["npi"] for r in rs}),
                "distinct_npis_strict_post": len({
                    r["npi"] for r in rs if r["post_exclusion_2023_billing"] == "yes"
                }),
                "match_rows_full_window": len(rs),
                "match_rows_strict_post": sum(
                    1 for r in rs if r["post_exclusion_2023_billing"] == "yes"
                ),
                "estimated_paid_full_window": round(
                    sum(r["estimated_paid_total"] for r in rs), 2
                ),
                "estimated_paid_strict_post": round(
                    sum(
                        r["estimated_paid_total"]
                        for r in rs
                        if r["post_exclusion_2023_billing"] == "yes"
                    ),
                    2,
                ),
            }
            for s, rs in per_state_rows.items()
        ),
        key=lambda d: -d["distinct_npis"],
    )

    top_hcpcs = [
        {"hcpcs": code, "description": desc, "match_rows": cnt}
        for (code, desc), cnt in hcpcs_counter.most_common(20)
    ]
    top_hcpcs_post = [
        {"hcpcs": code, "description": desc, "match_rows": cnt}
        for (code, desc), cnt in hcpcs_counter_post.most_common(20)
    ]

    print(f"\nDistinct NPIs matched: {len(matched_npis):,} of {total_npis:,}")
    print(f"Distinct NPIs strict-post-exclusion: {len(matched_post_excl_npis):,}")
    print(f"Total (NPI, HCPCS, POS) match rows: {len(all_rows):,}")
    print(f"Match rows strict-post-exclusion: {len(strict_post):,}")
    print(f"Estimated paid (full-window): ${total_est_paid:,.0f}")
    print(f"Estimated paid (strict-post): ${total_est_paid_strict:,.0f}")
    print(f"States with >= 1 match: {states_with_matches}")
    print(f"Top 5 HCPCS codes among excluded NPIs (strict-post):")
    for h in top_hcpcs_post[:5]:
        print(f"  {h['hcpcs']:6s}  rows={h['match_rows']:>4}  {h['description'][:60]}")

    headline = (
        f"{len(matched_npis):,} of {total_npis:,} currently-active federally-"
        f"excluded NPIs billed Medicare Part B in CY {SERVICE_YEAR} across "
        f"{len(all_rows):,} (NPI, HCPCS, place-of-service) row combinations "
        f"(est. ${total_est_paid:,.0f} paid on {total_services:,} services). "
        f"Of those, **{len(matched_post_excl_npis):,} NPIs were billing "
        f"STRICTLY POST-EXCLUSION** across {len(strict_post):,} (NPI, HCPCS, "
        f"POS) rows (est. ${total_est_paid_strict:,.0f} paid on "
        f"{total_services_strict:,} services). Per-row detail is the unit-of-"
        f"work State Medicaid PI offices write recoupment letters against — "
        f"per-claim, not per-provider."
    )

    payload = {
        "slug": "excluded-billing-medicare-partb-by-hcpcs",
        "title": f"Federally excluded NPIs billing Medicare Part B by HCPCS code (CY {SERVICE_YEAR}, all states)",
        "hypotheses": ["H40"],
        "status": "published",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(matched_post_excl_npis),
        "denominator": total_npis,
        "numerator_full_window": len(matched_npis),
        "numerator_note": (
            f"Numerator = distinct NPIs with LEIE/SAM exclusion-effective year "
            f"< {SERVICE_YEAR} AND >= 1 row in the by-Provider-AND-Service file "
            f"for CY {SERVICE_YEAR} (strict post-exclusion). Full-window numerator "
            f"(any {SERVICE_YEAR} billing) = {len(matched_npis):,} NPIs across "
            f"{len(all_rows):,} (NPI, HCPCS, POS) rows."
        ),
        "denominator_note": (
            f"Federally-excluded cohort across all {len(cohorts)} state slices "
            f"({total_npis:,} unique NPIs; active LEIE or SAM; H23 score >= 1.5; "
            f"state per NPPES practice state in the NDH practitioner table). "
            f"Per-state CSVs at /api/v1/states/<state>/h40-excluded-partb-by-hcpcs.csv."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners/medicare-physician-other-practitioners-by-provider-and-service",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "Distinct NPIs billing Part B (full-window)", "value": len(matched_npis)},
                {"label": "Distinct NPIs strict-post-exclusion", "value": len(matched_post_excl_npis)},
                {"label": "Total (NPI, HCPCS, POS) match rows (full-window)", "value": len(all_rows)},
                {"label": "Match rows strict-post-exclusion", "value": len(strict_post)},
            ],
        },
        "per_state": state_summary,
        "top_hcpcs_full_window": top_hcpcs,
        "top_hcpcs_strict_post": top_hcpcs_post,
        "notes": (
            "Per-state CSV at /api/v1/states/<state>/h40-excluded-partb-by-hcpcs.csv "
            "carries one row per (NPI, HCPCS, place_of_service) combination. "
            "estimated_paid_total = Tot_Srvcs × Avg_Mdcr_Pymt_Amt (CMS publishes "
            "averages, not totals, in this file). Place_Of_Srvc is aggregated "
            "to 'F' (Facility) or 'O' (Office/non-facility) at file build "
            "time — claim-level POS codes (02 telehealth, etc.) are not "
            "directly recoverable. Source CSV streamed once and partitioned "
            "across all state cohorts in memory — same I/O pattern as H30a."
        ),
    }
    out = FINDINGS_DIR / "excluded-billing-medicare-partb-by-hcpcs.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
