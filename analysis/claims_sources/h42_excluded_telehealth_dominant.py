"""H42 — Federally excluded NPIs whose post-exclusion Part B billing is telehealth-dominant.

Pure filter on H40's output. Reads each per-state
`h40-excluded-partb-by-hcpcs.csv`, groups rows by NPI, filters to
strict-post-exclusion rows, computes the share of services billed under
telehealth-specific HCPCS codes, and emits NPIs where that share is
>= TELEHEALTH_DOMINANT_THRESHOLD.

Why HCPCS-list-based, not POS-based: the published Medicare Physician
& Other Practitioners by Provider AND Service file aggregates
Place_Of_Srvc to 'F' (Facility) / 'O' (Office) at file build, so
claim-level POS 02 / POS 10 are not directly recoverable. The
telehealth-HCPCS list approach matches the CMS Telehealth Services
List (cms.gov/medicare/coverage/telehealth/list-services) — codes that
exist primarily or exclusively as telehealth-delivery procedures.

This script depends on H40 having been computed first. If H40's per-
state CSVs do not exist yet, H42 writes empty outputs and the headline
reflects zero matches (which is correct given the input).

Writes:
    frontend/public/api/v1/findings/excluded-telehealth-dominant-post-exclusion.json
    frontend/public/api/v1/states/<state>/h42-excluded-telehealth-dominant.csv  (per-state)
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from collections import defaultdict
from datetime import datetime, timezone

from analysis.claims_sources._cohorts import (
    VALID_US_JURISDICTIONS,
    lookup_urls,
    state_output_dir,
)

METHODOLOGY_VERSION = "0.7.0-draft"
DATA_SOURCE_RELEASE = "CY 2023 (RY2025)"
SERVICE_YEAR = 2023

# Publishable threshold + sensitivity bands. See findings.ts H42 entry.
TELEHEALTH_DOMINANT_THRESHOLD = 0.80
SENSITIVITY_BANDS = (0.60, 0.95)

# CMS Telehealth Services List — HCPCS codes that exist primarily or
# exclusively as telehealth-delivery procedures. Curated from the
# CMS published list (cms.gov/medicare/coverage/telehealth/list-services).
# Excludes general E/M codes (99202-99215) that are telehealth-enabled
# but used predominantly in-person; those need a 95 / GT modifier to be
# telehealth, which the by-Service file does not carry.
TELEHEALTH_HCPCS: frozenset[str] = frozenset({
    "G2010",  # Remote evaluation of recorded video and/or images
    "G2012",  # Brief communication technology-based service (virtual check-in)
    "G2061",  # Qualified nonphysician online digital E/M, 5-10 min
    "G2062",  # Qualified nonphysician online digital E/M, 11-20 min
    "G2063",  # Qualified nonphysician online digital E/M, 21+ min
    "99421",  # Online digital E/M (physician), 5-10 min
    "99422",  # Online digital E/M (physician), 11-20 min
    "99423",  # Online digital E/M (physician), 21+ min
    "99441",  # Telephone E/M (physician), 5-10 min
    "99442",  # Telephone E/M (physician), 11-20 min
    "99443",  # Telephone E/M (physician), 21-30 min
    "G0425",  # Telehealth consultation, emergency/inpatient, 30 min
    "G0426",  # Telehealth consultation, emergency/inpatient, 50 min
    "G0427",  # Telehealth consultation, emergency/inpatient, 70 min
    "G3002",  # Chronic pain management, monthly bundled (telehealth-enabled)
    "G3003",  # Chronic pain management, each additional 15 min
})

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
STATES_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states"
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"

CSV_FIELDS = [
    "npi", "name", "state", "billing_state",
    "post_exclusion_services_total", "post_exclusion_services_telehealth",
    "telehealth_share", "threshold_band",
    "post_exclusion_estimated_paid_total",
    "telehealth_hcpcs_codes_billed",
    "provider_type",
    "exclusion_source", "exclusion_effective_year", "score",
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


def _band_for_share(share: float) -> str:
    """Map a telehealth share to its falsification band label."""
    if share >= 0.95:
        return ">=95% (high-confidence)"
    if share >= TELEHEALTH_DOMINANT_THRESHOLD:
        return f">={int(TELEHEALTH_DOMINANT_THRESHOLD*100)}% (publishable)"
    if share >= 0.60:
        return ">=60% (sensitivity sidecar)"
    return "<60%"


def _aggregate_npi(rows: list[dict]) -> dict:
    """Aggregate H40 (NPI, HCPCS, POS) rows into one per-NPI summary.

    Only considers rows flagged post_exclusion_2023_billing == 'yes'.
    """
    post_rows = [r for r in rows if r.get("post_exclusion_2023_billing") == "yes"]
    if not post_rows:
        return {}

    total_services = 0
    telehealth_services = 0
    paid_total = 0.0
    telehealth_codes_seen: set[str] = set()
    first = post_rows[0]
    for r in post_rows:
        try:
            srvcs = int(float(r.get("services_2023") or 0))
        except (TypeError, ValueError):
            srvcs = 0
        try:
            paid_total += float(r.get("estimated_paid_total") or 0)
        except (TypeError, ValueError):
            pass
        total_services += srvcs
        if r.get("hcpcs_code") in TELEHEALTH_HCPCS:
            telehealth_services += srvcs
            telehealth_codes_seen.add(r["hcpcs_code"])

    if total_services == 0:
        return {}

    share = telehealth_services / total_services
    return {
        "npi": first["npi"],
        "name": first.get("name", ""),
        "state": first.get("state", ""),
        "billing_state": first.get("billing_state", ""),
        "post_exclusion_services_total": total_services,
        "post_exclusion_services_telehealth": telehealth_services,
        "telehealth_share": round(share, 4),
        "threshold_band": _band_for_share(share),
        "post_exclusion_estimated_paid_total": round(paid_total, 2),
        "telehealth_hcpcs_codes_billed": "|".join(sorted(telehealth_codes_seen)),
        "provider_type": first.get("provider_type", ""),
        "exclusion_source": first.get("exclusion_source", ""),
        "exclusion_effective_year": first.get("exclusion_effective_year", ""),
        "score": first.get("score", ""),
        **lookup_urls(first["npi"]),
    }


def _read_h40_state(state: str) -> dict[str, list[dict]]:
    """Return {npi: [h40 rows]} for one state, or {} if H40 hasn't run yet."""
    path = STATES_DIR / state.lower() / "h40-excluded-partb-by-hcpcs.csv"
    if not path.exists():
        return {}
    by_npi: dict[str, list[dict]] = defaultdict(list)
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            npi = (row.get("npi") or "").strip()
            if npi:
                by_npi[npi].append(row)
    return dict(by_npi)


def main() -> None:
    per_state_matches: dict[str, list[dict]] = {}
    states_scanned = 0
    states_with_h40 = 0

    for state in sorted(VALID_US_JURISDICTIONS):
        states_scanned += 1
        h40_rows = _read_h40_state(state)
        if not h40_rows:
            continue
        states_with_h40 += 1
        per_npi: list[dict] = []
        for npi, rows in h40_rows.items():
            summary = _aggregate_npi(rows)
            if not summary:
                continue
            if summary["telehealth_share"] >= SENSITIVITY_BANDS[0]:
                # Keep anything at >= 60% so the sidecar bands are populated;
                # the published headline filters to >= TELEHEALTH_DOMINANT_THRESHOLD.
                per_npi.append(summary)
        if per_npi:
            per_state_matches[state] = sorted(
                per_npi,
                key=lambda r: (-r["telehealth_share"], -r["post_exclusion_estimated_paid_total"]),
            )

    print(f"Scanned {states_scanned} jurisdictions, {states_with_h40} have H40 output.")

    states_with_h42 = 0
    for state, rows in per_state_matches.items():
        out_dir = state_output_dir(state)
        out_path = out_dir / "h42-excluded-telehealth-dominant.csv"
        with open(out_path, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in CSV_FIELDS})
        states_with_h42 += 1

    all_rows = [r for rows in per_state_matches.values() for r in rows]
    publishable = [r for r in all_rows if r["telehealth_share"] >= TELEHEALTH_DOMINANT_THRESHOLD]
    high_confidence = [r for r in all_rows if r["telehealth_share"] >= SENSITIVITY_BANDS[1]]
    sensitivity = [
        r for r in all_rows
        if SENSITIVITY_BANDS[0] <= r["telehealth_share"] < TELEHEALTH_DOMINANT_THRESHOLD
    ]
    total_paid_publishable = sum(r["post_exclusion_estimated_paid_total"] for r in publishable)

    per_state_summary = sorted(
        (
            {
                "state": s,
                "publishable_npis": sum(
                    1 for r in rs
                    if r["telehealth_share"] >= TELEHEALTH_DOMINANT_THRESHOLD
                ),
                "sensitivity_npis": sum(
                    1 for r in rs
                    if SENSITIVITY_BANDS[0] <= r["telehealth_share"] < TELEHEALTH_DOMINANT_THRESHOLD
                ),
                "publishable_paid_total": round(
                    sum(
                        r["post_exclusion_estimated_paid_total"]
                        for r in rs
                        if r["telehealth_share"] >= TELEHEALTH_DOMINANT_THRESHOLD
                    ),
                    2,
                ),
            }
            for s, rs in per_state_matches.items()
        ),
        key=lambda d: -d["publishable_npis"],
    )

    print(f"\nPublishable (>={int(TELEHEALTH_DOMINANT_THRESHOLD*100)}%): {len(publishable)} NPIs")
    print(f"High-confidence (>=95%): {len(high_confidence)} NPIs")
    print(f"Sensitivity sidecar (60-79%): {len(sensitivity)} NPIs")
    print(f"Total est. paid (publishable): ${total_paid_publishable:,.0f}")
    print(f"States with >=1 publishable match: {sum(1 for s in per_state_summary if s['publishable_npis'] > 0)}")
    if per_state_summary:
        print("Top 5 states by publishable count:")
        for s in per_state_summary[:5]:
            print(f"  {s['state']:2s}  publishable={s['publishable_npis']:>3}  sensitivity={s['sensitivity_npis']:>3}  paid=${s['publishable_paid_total']:>10,.0f}")

    if states_with_h40 == 0:
        headline = (
            "H40's per-state CSVs are not present yet — run "
            "`python -m analysis.claims_sources.medicare_partb_by_hcpcs` first, "
            "then re-run H42. H42 is a pure filter on H40's output and produces "
            "no findings until H40 has been computed."
        )
    elif len(publishable) == 0:
        headline = (
            f"**Null hypothesis supported.** Zero federally-excluded NPIs in CY "
            f"{SERVICE_YEAR} show ≥{int(TELEHEALTH_DOMINANT_THRESHOLD*100)}% of "
            f"post-exclusion Medicare Part B services billed under telehealth-"
            f"specific HCPCS codes. Sensitivity sidecar (60–79%): "
            f"{len(sensitivity)} NPIs; high-confidence (≥95%): "
            f"{len(high_confidence)} NPIs. Two readings are consistent with "
            f"this result: (a) federal exclusion screening is in fact catching "
            f"telehealth-specific Part B billing pre-payment, or (b) the post-"
            f"exclusion cohort billing Part B is too small for the dominant-"
            f"share threshold to register at all. Use H40 (per-claim recoupment "
            f"unit) for the headline cohort instead; H42 is intended as a "
            f"sharpened sub-test."
        )
    else:
        headline = (
            f"**{len(publishable)} federally-excluded NPIs** billed Medicare "
            f"Part B in CY {SERVICE_YEAR} with ≥{int(TELEHEALTH_DOMINANT_THRESHOLD*100)}% "
            f"of post-exclusion services billed under telehealth-specific "
            f"HCPCS codes (est. ${total_paid_publishable:,.0f} paid). "
            f"Sensitivity sidecar (60–79%): {len(sensitivity)} NPIs. "
            f"High-confidence (≥95%): {len(high_confidence)} NPIs. "
            f"Whichever telehealth platform credentialed these providers "
            f"did not run the LEIE/SAM screening that would have caught the exclusion."
        )

    payload = {
        "slug": "excluded-telehealth-dominant-post-exclusion",
        "title": "Federally excluded NPIs whose post-exclusion Medicare Part B billing is telehealth-dominant",
        "hypotheses": ["H42"],
        "status": "published" if states_with_h40 else "pre-registered",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(publishable),
        "denominator_note": (
            f"Federally-excluded cohort with strict-post-exclusion Part B billing in "
            f"CY {SERVICE_YEAR} (the H40 cohort). Numerator is the share of those NPIs "
            f"with >={int(TELEHEALTH_DOMINANT_THRESHOLD*100)}% of post-exclusion services "
            f"under telehealth-specific HCPCS codes. See `analysis/claims_sources/"
            f"h42_excluded_telehealth_dominant.py` for the HCPCS code list and the "
            f"share computation."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://www.cms.gov/medicare/coverage/telehealth/list-services",
        "thresholds": {
            "publishable": TELEHEALTH_DOMINANT_THRESHOLD,
            "sensitivity_low": SENSITIVITY_BANDS[0],
            "sensitivity_high": SENSITIVITY_BANDS[1],
        },
        "telehealth_hcpcs_codes": sorted(TELEHEALTH_HCPCS),
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": f">={int(SENSITIVITY_BANDS[1]*100)}% telehealth (high-confidence)", "value": len(high_confidence)},
                {"label": f">={int(TELEHEALTH_DOMINANT_THRESHOLD*100)}% telehealth (publishable)", "value": len(publishable)},
                {"label": f"{int(SENSITIVITY_BANDS[0]*100)}-{int(TELEHEALTH_DOMINANT_THRESHOLD*100)-1}% (sensitivity sidecar)", "value": len(sensitivity)},
            ],
        },
        "per_state": per_state_summary,
        "notes": (
            "H42 is a pure filter on H40's per-state CSV output — no separate source "
            "file read. Telehealth-HCPCS list is from the CMS Telehealth Services List "
            "(cms.gov/medicare/coverage/telehealth/list-services). Excludes general "
            "E/M codes (99202-99215) that are telehealth-enabled but used predominantly "
            "in-person — the published file does not carry the 95/GT modifier needed to "
            "distinguish in-person from telehealth for those codes. Sensitivity bands "
            "at 60% and 95% published as sidecar so readers can pick their own "
            "falsification threshold."
        ),
    }
    out = FINDINGS_DIR / "excluded-telehealth-dominant-post-exclusion.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
