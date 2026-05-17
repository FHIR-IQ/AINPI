"""H30a — Federally excluded NPIs still billing Medicare Part B (all states).

Joins the per-state federally-excluded cohorts (cohort builder runs
nightly via `analysis/build_state_cohort.py --all`) against the CMS
Medicare Physician & Other Practitioners by Provider file (CY 2023,
NPI-aggregated).

42 USC § 1320a-7 LEIE exclusions bind across every federal program. A
match here = the federal directory says the provider is enrolled to
bill Medicare AND the federal exclusion list says they shouldn't be.

Streams the source file ONCE per refresh; partitions matches across
all states in memory and writes a per-state CSV plus an aggregated
national finding payload. Doing one-pass-per-state would re-read the
470 MB CSV 51 times for no incremental information.

Source file (already on disk):
    frontend/data/cms-claims/partb-by-provider.csv (~470 MB, CY 2023)

Writes:
    frontend/public/api/v1/findings/excluded-billing-medicare-partb.json
    frontend/public/api/v1/states/<state>/h30a-excluded-billing-partb.csv  (per-state)
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from collections import defaultdict
from datetime import datetime, timezone

from analysis.claims_sources._cohorts import (
    cutoff_year,
    load_all_state_cohorts,
    lookup_urls,
    npi_to_state_map,
    state_output_dir,
)

METHODOLOGY_VERSION = "0.6.1-draft"
DATA_SOURCE_RELEASE = "CY 2023 (RY2025 P05)"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SOURCE_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "partb-by-provider.csv"
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"

CSV_FIELDS = [
    "npi", "name", "state", "billing_state",
    "medicare_paid_2023", "medicare_allowed_2023",
    "services_2023", "beneficiaries_2023", "provider_type",
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


def main() -> None:
    cohorts = load_all_state_cohorts()
    npi_to_state = npi_to_state_map(cohorts)
    total_npis = len(npi_to_state)
    print(f"Loaded {len(cohorts)} state cohorts, {total_npis:,} unique NPIs total")

    per_state_matches: dict[str, list[dict]] = defaultdict(list)
    seen_npis: set[str] = set()

    with open(SOURCE_CSV, newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            npi = (row.get("Rndrng_NPI") or "").strip()
            if not npi or npi not in npi_to_state:
                continue
            state = npi_to_state[npi]
            cohort_row = cohorts[state].get(npi, {})
            seen_npis.add(npi)
            paid = float(row.get("Tot_Mdcr_Pymt_Amt") or 0)
            allowed = float(row.get("Tot_Mdcr_Alowd_Amt") or 0)
            services = int(float(row.get("Tot_Srvcs") or 0)) if row.get("Tot_Srvcs") else None
            benes = int(float(row.get("Tot_Benes") or 0)) if row.get("Tot_Benes") else None
            cy = cutoff_year(cohort_row)
            post_excl = cy is not None and cy < 2023
            per_state_matches[state].append({
                "npi": npi,
                "name": cohort_row.get("name", ""),
                "state": state,
                "billing_state": row.get("Rndrng_Prvdr_State_Abrvtn", ""),
                "medicare_paid_2023": round(paid, 2),
                "medicare_allowed_2023": round(allowed, 2),
                "services_2023": services if services is not None else "",
                "beneficiaries_2023": benes if benes is not None else "",
                "provider_type": row.get("Rndrng_Prvdr_Type", ""),
                "exclusion_source": cohort_row.get("reasons", ""),
                "exclusion_effective_year": cy if cy is not None else "",
                "post_exclusion_2023_billing": "yes" if post_excl else "no",
                "score": cohort_row.get("score", ""),
                **lookup_urls(npi),
            })

    # Per-state writes
    states_with_matches = 0
    for state, rows in per_state_matches.items():
        rows.sort(key=lambda r: r["medicare_paid_2023"], reverse=True)
        out_dir = state_output_dir(state)
        out_path = out_dir / "h30a-excluded-billing-partb.csv"
        with open(out_path, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in CSV_FIELDS})
        states_with_matches += 1

    # National aggregates for the finding JSON
    all_matches = [m for rows in per_state_matches.values() for m in rows]
    strict_post = [m for m in all_matches if m["post_exclusion_2023_billing"] == "yes"]
    total_paid = sum(m["medicare_paid_2023"] for m in all_matches)
    total_paid_strict = sum(m["medicare_paid_2023"] for m in strict_post)
    total_services = sum(int(m["services_2023"] or 0) for m in all_matches if m["services_2023"])
    total_services_strict = sum(int(m["services_2023"] or 0) for m in strict_post if m["services_2023"])

    # Per-state summary chart bars (top 10 states by full-window match count)
    state_summary = sorted(
        ({"state": s, "matches_full_window": len(rs),
          "matches_strict_post": sum(1 for r in rs if r["post_exclusion_2023_billing"] == "yes"),
          "paid_full_window": round(sum(r["medicare_paid_2023"] for r in rs), 2),
          "paid_strict_post": round(sum(r["medicare_paid_2023"] for r in rs if r["post_exclusion_2023_billing"] == "yes"), 2)}
         for s, rs in per_state_matches.items()),
        key=lambda d: -d["matches_full_window"],
    )

    print(f"\nTotal NPIs matched across all states: {len(all_matches)} of {total_npis:,}")
    print(f"Strict post-exclusion: {len(strict_post)}")
    print(f"Total Medicare paid (full-window):    ${total_paid:,.0f}")
    print(f"Total Medicare paid (strict-post):    ${total_paid_strict:,.0f}")
    print(f"States with >= 1 match: {states_with_matches}")
    print(f"Top 5 states by match count:")
    for s in state_summary[:5]:
        print(f"  {s['state']:2s}  matches={s['matches_full_window']:>4}  strict={s['matches_strict_post']:>3}  paid=${s['paid_full_window']:>12,.0f}")

    headline = (
        f"{len(all_matches)} of {total_npis:,} currently-active federally-"
        f"excluded NPIs (across {len(cohorts)} state cohorts) billed Medicare "
        f"Part B in CY 2023 (full-window total paid ${total_paid:,.0f} on "
        f"{total_services:,} services). Of those, **{len(strict_post)} were "
        f"billing STRICTLY POST-EXCLUSION** (LEIE or SAM exclusion-effective "
        f"year before 2023), with ${total_paid_strict:,.0f} paid on "
        f"{total_services_strict:,} services. The strict-post-exclusion subset "
        f"is the regulatorily significant signal under 42 USC § 1320a-7 — "
        f"pre-exclusion billing reflects work the provider was authorized to "
        f"do at the time."
    )

    payload = {
        "slug": "excluded-billing-medicare-partb",
        "title": "Federally excluded NPIs billing Medicare Part B (CY 2023, all states)",
        "hypotheses": ["H30", "H30a"],
        "status": "published",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(strict_post),
        "denominator": total_npis,
        "numerator_full_window": len(all_matches),
        "numerator_note": (
            f"Numerator = NPIs billing Part B in CY 2023 with LEIE/SAM "
            f"exclusion-effective year < 2023 (strict post-exclusion). "
            f"Full-window numerator (any 2023 billing) = {len(all_matches)}."
        ),
        "denominator_note": (
            f"Federally-excluded cohort across all {len(cohorts)} state slices "
            f"({total_npis:,} unique NPIs; active LEIE or SAM; H23 score >= 1.5; "
            f"state per NPPES practice state in the NDH practitioner table). "
            f"Per-state CSVs at /api/v1/states/<state>/h30a-excluded-billing-partb.csv."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "All federally-excluded NPIs billing Part B (full-window)", "value": len(all_matches)},
                {"label": "Strictly post-exclusion subset", "value": len(strict_post)},
            ],
        },
        "per_state": state_summary,
        "notes": (
            "Per-state CSV at /api/v1/states/<state>/h30a-excluded-billing-partb.csv "
            "carries one row per matched NPI with paid + allowed + services + "
            "beneficiaries + provider type + exclusion source + post-exclusion flag. "
            "Source CSV streamed once and partitioned across all state cohorts "
            "in memory — same I/O cost as the original VA-only run."
        ),
    }
    out = FINDINGS_DIR / "excluded-billing-medicare-partb.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
