"""H30b — Federally excluded NPIs still prescribing Medicare Part D (all states).

Joins the per-state federally-excluded cohorts against the CMS Medicare
Part D Prescribers by Provider file (CY 2023, NPI-aggregated).

Part D adds the prescribing dimension. An excluded prescriber writing
reimbursed prescriptions is a § 455.436 / 42 USC § 1320a-7 signal that
also feeds the controlled-substance referral path (21st Century Cures
Act + 2018 SUPPORT Act extended controlled-substance enforcement to
specifically cover Medicaid/Medicare prescribers).

Streams the source file ONCE per refresh; partitions matches across
all states in memory.

Source file (already on disk):
    frontend/data/cms-claims/partd-by-provider.csv  (~550 MB, CY 2023)

Writes:
    frontend/public/api/v1/findings/excluded-prescribing-medicare-partd.json
    frontend/public/api/v1/states/<state>/h30b-excluded-prescribing-partd.csv  (per-state)
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
DATA_SOURCE_RELEASE = "CY 2023 (RY2025 P04)"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SOURCE_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "partd-by-provider.csv"
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"

CSV_FIELDS = [
    "npi", "name", "state", "prescribing_state",
    "drug_cost_2023", "claims_2023", "beneficiaries_2023",
    "opioid_claims_2023", "opioid_cost_2023",
    "exclusion_source", "exclusion_effective_year",
    "post_exclusion_2023_prescribing", "score",
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

    with open(SOURCE_CSV, newline="") as fh:
        for row in csv.DictReader(fh):
            npi = (row.get("PRSCRBR_NPI") or "").strip()
            if not npi or npi not in npi_to_state:
                continue
            state = npi_to_state[npi]
            cohort_row = cohorts[state].get(npi, {})
            drug_cost = float(row.get("Tot_Drug_Cst") or 0)
            claims = int(float(row.get("Tot_Clms") or 0)) if row.get("Tot_Clms") else None
            benes = int(float(row.get("Tot_Benes") or 0)) if row.get("Tot_Benes") else None
            opioid_claims = int(float(row.get("Opioid_Tot_Clms") or 0)) if row.get("Opioid_Tot_Clms") else None
            opioid_cost = float(row.get("Opioid_Tot_Drug_Cst") or 0)
            cy = cutoff_year(cohort_row)
            post_excl = cy is not None and cy < 2023
            per_state_matches[state].append({
                "npi": npi,
                "name": cohort_row.get("name", ""),
                "state": state,
                "prescribing_state": row.get("Prscrbr_State_Abrvtn", ""),
                "drug_cost_2023": round(drug_cost, 2),
                "claims_2023": claims if claims is not None else "",
                "beneficiaries_2023": benes if benes is not None else "",
                "opioid_claims_2023": opioid_claims if opioid_claims is not None else "",
                "opioid_cost_2023": round(opioid_cost, 2) if opioid_cost else "",
                "exclusion_source": cohort_row.get("reasons", ""),
                "exclusion_effective_year": cy if cy is not None else "",
                "post_exclusion_2023_prescribing": "yes" if post_excl else "no",
                "score": cohort_row.get("score", ""),
                **lookup_urls(npi),
            })

    for state, rows in per_state_matches.items():
        rows.sort(key=lambda r: r["drug_cost_2023"], reverse=True)
        out_dir = state_output_dir(state)
        with open(out_dir / "h30b-excluded-prescribing-partd.csv", "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in CSV_FIELDS})

    all_matches = [m for rows in per_state_matches.values() for m in rows]
    strict_post = [m for m in all_matches if m["post_exclusion_2023_prescribing"] == "yes"]
    total_cost = sum(m["drug_cost_2023"] for m in all_matches)
    total_cost_strict = sum(m["drug_cost_2023"] for m in strict_post)
    total_opioid_claims = sum(int(m["opioid_claims_2023"] or 0) for m in all_matches if m["opioid_claims_2023"])
    total_opioid_claims_strict = sum(int(m["opioid_claims_2023"] or 0) for m in strict_post if m["opioid_claims_2023"])
    opioid_prescribers = sum(1 for m in all_matches if m["opioid_claims_2023"])
    opioid_prescribers_strict = sum(1 for m in strict_post if m["opioid_claims_2023"])

    state_summary = sorted(
        ({"state": s, "matches_full_window": len(rs),
          "matches_strict_post": sum(1 for r in rs if r["post_exclusion_2023_prescribing"] == "yes"),
          "drug_cost_full_window": round(sum(r["drug_cost_2023"] for r in rs), 2),
          "opioid_prescribers_full_window": sum(1 for r in rs if r["opioid_claims_2023"])}
         for s, rs in per_state_matches.items()),
        key=lambda d: -d["matches_full_window"],
    )

    print(f"\nTotal NPIs matched: {len(all_matches)} of {total_npis:,}")
    print(f"Strict post-exclusion: {len(strict_post)}")
    print(f"Total drug cost (full-window):  ${total_cost:,.0f}")
    print(f"Total drug cost (strict-post):  ${total_cost_strict:,.0f}")
    print(f"Opioid prescribers (full):      {opioid_prescribers} of {len(all_matches)}")
    print(f"Opioid claims (full):           {total_opioid_claims:,}")
    print(f"States with >= 1 match: {sum(1 for rs in per_state_matches.values() if rs)}")
    print("Top 5 states by match count:")
    for s in state_summary[:5]:
        print(f"  {s['state']:2s}  matches={s['matches_full_window']:>4}  strict={s['matches_strict_post']:>3}  "
              f"drugs=${s['drug_cost_full_window']:>12,.0f}  opioid_prescribers={s['opioid_prescribers_full_window']}")

    headline = (
        f"{len(all_matches)} of {total_npis:,} currently-active federally-"
        f"excluded NPIs (across {len(cohorts)} state cohorts) prescribed Medicare "
        f"Part D in CY 2023 (full-window drug cost ${total_cost:,.0f}; "
        f"{opioid_prescribers} of {len(all_matches)} were opioid prescribers "
        f"with {total_opioid_claims:,} opioid claims). Of those, "
        f"**{len(strict_post)} were prescribing STRICTLY POST-EXCLUSION** "
        f"(LEIE or SAM exclusion-effective year before 2023), with "
        f"${total_cost_strict:,.0f} drug cost and {opioid_prescribers_strict} "
        f"opioid prescribers writing {total_opioid_claims_strict:,} opioid claims. "
        f"The strict-post-exclusion subset is the regulatorily significant signal — "
        f"pre-exclusion prescribing was authorized at the time."
    )

    payload = {
        "slug": "excluded-prescribing-medicare-partd",
        "title": "Federally excluded NPIs prescribing Medicare Part D (CY 2023, all states)",
        "hypotheses": ["H30", "H30b"],
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
            f"Numerator = NPIs prescribing Part D in CY 2023 with LEIE/SAM "
            f"exclusion-effective year < 2023 (strict post-exclusion). "
            f"Full-window numerator = {len(all_matches)}."
        ),
        "denominator_note": (
            f"Federally-excluded cohort across all {len(cohorts)} state slices "
            f"({total_npis:,} unique NPIs; active LEIE or SAM; score >= 1.5)."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://data.cms.gov/provider-summary-by-type-of-service/medicare-part-d-prescribers",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "All cohorts prescribing Part D (full-window)", "value": len(all_matches)},
                {"label": "Strict post-exclusion", "value": len(strict_post)},
                {"label": "Opioid prescribers (full-window)", "value": opioid_prescribers},
            ],
        },
        "per_state": state_summary,
        "notes": (
            "Per-state CSV at /api/v1/states/<state>/h30b-excluded-prescribing-partd.csv "
            "carries drug cost + claims + beneficiaries + opioid metrics + "
            "exclusion source. Opioid prescribing by federally-excluded NPIs is a "
            "particularly elevated signal because the 21st Century Cures Act and "
            "2018 SUPPORT Act extended controlled-substance enforcement to "
            "specifically cover Medicaid/Medicare prescribers; this should feed "
            "directly into state PI + DEA referral queues."
        ),
    }
    out = FINDINGS_DIR / "excluded-prescribing-medicare-partd.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
