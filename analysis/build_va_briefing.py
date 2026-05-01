"""Build the State-of-Virginia briefing artifacts for the 2026-05-04 meeting.

Reads existing pipeline outputs (no new BigQuery queries) and writes:

  frontend/public/api/v1/states/va-cohort-critical.csv
    The 125 VA federally-excluded NPIs (LEIE or SAM, score >= 1.5),
    expanded with reason combos and per-NPI verification URLs.

  frontend/public/api/v1/states/va-briefing-summary.json
    Consolidated payload combining the va.json findings, the VA cohort
    breakdown, and the H26 mco-exposure-va matches into one object the
    briefing page or doc can read in a single load.

This script is idempotent. Re-run any time the upstream cohort or VA
findings refresh.
"""
from __future__ import annotations
import csv
import json
import pathlib
from collections import Counter
from datetime import datetime, timezone

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
COHORT_CSV = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings" / "high-risk-cohort-export.csv"
VA_JSON = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states" / "va.json"
MCO_JSON = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings" / "mco-exposure-va.json"
MCO_DETAIL_JSON = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings" / "mco-exposure-va-detail.json"

OUT_CSV = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states" / "va-cohort-critical.csv"
OUT_SUMMARY = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states" / "va-briefing-summary.json"


def main() -> None:
    with open(COHORT_CSV, newline="", encoding="utf-8") as fh:
        cohort = list(csv.DictReader(fh))

    va_critical = [
        r for r in cohort
        if r["state"] == "VA"
        and r["bucket"] == "critical"
        and ("oig_excluded" in (r.get("reasons") or "")
             or "sam_excluded" in (r.get("reasons") or ""))
    ]
    va_critical.sort(key=lambda r: (-float(r["score"]), r["npi"]))

    # 1. Per-NPI export with verification URLs.
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow([
            "npi", "name", "state", "score", "bucket", "reasons",
            "leie_lookup_url", "sam_lookup_url", "nppes_lookup_url",
        ])
        for r in va_critical:
            w.writerow([
                r["npi"], r["name"], r["state"], r["score"], r["bucket"], r["reasons"],
                "https://exclusions.oig.hhs.gov/",
                "https://sam.gov/search/?index=ex",
                f"https://npiregistry.cms.hhs.gov/provider-view/{r['npi']}",
            ])
    print(f"Wrote {OUT_CSV} ({len(va_critical)} rows)")

    # 2. Reason-combo distribution.
    combos: Counter[tuple[str, ...]] = Counter()
    for r in va_critical:
        combos[tuple(sorted((r["reasons"] or "").split("|")))] += 1
    combo_breakdown = [
        {
            "reasons": list(combo),
            "count": count,
            "pct_of_critical": round(100 * count / len(va_critical), 2),
        }
        for combo, count in combos.most_common()
    ]

    # 3. Pull 10 verifiable samples — top by score (the triple-flagged ones).
    samples = []
    for r in va_critical[:10]:
        samples.append({
            "npi": r["npi"],
            "name": r["name"],
            "score": float(r["score"]),
            "reason_codes": [
                x for x in (r["reasons"] or "").split("|") if x
            ],
            "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
            "sam_lookup_url": "https://sam.gov/search/?index=ex",
            "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{r['npi']}",
        })

    # 4. Pull existing VA findings.
    with open(VA_JSON, encoding="utf-8") as fh:
        va = json.load(fh)
    va_findings = {
        f["slug"]: {
            "headline": f.get("state_headline"),
            "state_pct": f.get("state_pct"),
            "state_numerator": f.get("state_numerator"),
            "state_denominator": f.get("state_denominator"),
        }
        for f in va.get("findings", [])
        if f.get("state_computable") and f.get("state_pct") is not None
    }

    # 5. Pull the H26 MCO exposure result.
    h26_summary = None
    if MCO_JSON.exists():
        with open(MCO_JSON, encoding="utf-8") as fh:
            mco = json.load(fh)
        with open(MCO_DETAIL_JSON, encoding="utf-8") as fh:
            mco_detail = json.load(fh)
        h26_summary = {
            "headline": mco.get("headline"),
            "numerator": mco.get("numerator"),
            "denominator": mco.get("denominator"),
            "per_payer": [
                {"name": m["name"], "matched": m["matched"], "queried": m["queried"], "errors": m["errors"]}
                for m in mco_detail.get("mcos", [])
            ],
            "matched_npis": [
                {
                    "npi": s["npi"],
                    "name": s["name"],
                    "matched_in": s["matched_in"],
                    "nppes_lookup_url": s["nppes_lookup_url"],
                }
                for s in mco_detail.get("samples", [])
            ],
        }

    # 6. Consolidate.
    summary = {
        "state": "VA",
        "state_name": "Virginia",
        "medicaid_program": "Cardinal Care",
        "agency": "Department of Medical Assistance Services (DMAS)",
        "release_date": va.get("release_date"),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": va.get("methodology_version"),
        "denominators": va.get("denominators"),
        "findings": va_findings,
        "federally_excluded_cohort": {
            "total_critical": len(va_critical),
            "reason_breakdown": combo_breakdown,
            "top_samples": samples,
            "all_npis_csv": "/api/v1/states/va-cohort-critical.csv",
        },
        "h26_payer_directory_exposure": h26_summary,
        "stage_b_roadmap": [
            "Anthem HealthKeepers Plus (Anthem Medicaid in VA) — Elevance TotalView, OAuth registration required",
            "Aetna Better Health of Virginia (CVS/Aetna Medicaid) — developerportal.aetna.com OAuth",
            "UHC Community Plan (UHC Medicaid) — confirm public PDex base URL",
            "Sentara Community Plan — API delayed per parent payer notice",
            "Molina Complete Care — discovery needed",
            "Virginia Premier — discovery needed",
        ],
    }
    OUT_SUMMARY.write_text(json.dumps(summary, indent=2) + "\n")
    print(f"Wrote {OUT_SUMMARY}")
    print(f"  total_critical: {len(va_critical)}")
    print(f"  reason combos:  {len(combo_breakdown)}")
    print(f"  sample size:    {len(samples)}")


if __name__ == "__main__":
    main()
