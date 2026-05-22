"""H41 — NPPES taxonomy vs Medicare-billed-specialty divergence (behavioral specialty drift).

H37 tests whether PECOS PROVIDER_TYPE matches NPPES NUCC — a record-vs-
record test. H41 is the billing-behavior counterpart: for each NPI active
in Medicare Part B, does the actual procedure mix match what the NPPES-
registered taxonomy would predict?

Two passes over the CMS Medicare Physician & Other Practitioners by
Provider AND Service file (same source as H40):

  Pass 1: Build an HCPCS → modal NUCC affinity table. For each HCPCS
  code, the NPPES primary taxonomy that the largest plurality of
  service-volume comes from. Empirical, not normative — reflects what
  providers in each taxonomy actually bill.

  Pass 2: Per-NPI, compute the share of services billed under HCPCS
  codes whose modal NUCC is NOT in the NPI's NPPES taxonomy set.
  "Drift" = modal NUCC outside the NPI's registered NUCC set.

The drift threshold is publishable at >= 80% (matches H40/H42); 60-79%
banded as sensitivity sidecar; >= 95% as high-confidence. The 80%
threshold is the publishable falsification line; sensitivity bands
are output alongside so consumers can pick their own.

State attribution: an NPI billing from multiple states appears in each
state's CSV. Uses Rndrng_Prvdr_State_Abrvtn from the source rows (the
state Medicare actually billed from), not NPPES practice state.

Source:
    frontend/data/cms-claims/partb-by-provider-and-service.csv (~3 GB, CY 2023)
    bigquery-public-data.nppes.npi_optimized (~7.4M practitioners)

Writes:
    frontend/public/api/v1/findings/specialty-billing-drift.json
    frontend/public/api/v1/findings/specialty-billing-drift-detail.csv  (national, all bands)
    frontend/public/api/v1/states/<state>/h41-specialty-drift.csv         (per-state, publishable + sensitivity)
"""
from __future__ import annotations
import csv
import json
import os
import pathlib
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone

from google.cloud import bigquery

from analysis.claims_sources._cohorts import (
    VALID_US_JURISDICTIONS,
    is_valid_us_state,
    state_output_dir,
)

PROJECT = os.environ.get("GCP_PROJECT_ID", "thematic-fort-453901-t7")
METHODOLOGY_VERSION = "0.7.0-draft"
DATA_SOURCE_RELEASE = "CY 2023 (RY2025)"
SERVICE_YEAR = 2023

DRIFT_THRESHOLD = 0.80
SENSITIVITY_BANDS = (0.60, 0.95)

# Below this total-service count we skip drift judgment — too few
# services to attribute a billing pattern confidently. Same intent as
# CMS's <11-beneficiary suppression: noise-floor protection.
MIN_TOTAL_SERVICES = 50

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "partb-by-provider-and-service.csv"
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"

CSV_FIELDS = [
    "npi", "name", "provider_type",
    "billing_states", "primary_billing_state",
    "total_services", "drift_services", "drift_share", "threshold_band",
    "estimated_paid_total_at_drift_codes",
    "nppes_nucc_set",
    "top_drift_hcpcs",
    "nppes_lookup_url",
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


def load_nppes_primary_taxonomy(client: bigquery.Client) -> dict[str, str]:
    """{npi -> primary NUCC code}.

    Primary = taxonomy slot with healthcare_provider_primary_taxonomy_switch_<n> = 'Y'.
    Falls back to slot 1 if no primary marker is set (some practitioners
    don't mark a primary).
    """
    code_cols = ", ".join(f"healthcare_provider_taxonomy_code_{i}" for i in range(1, 16))
    switch_cols = ", ".join(f"healthcare_provider_primary_taxonomy_switch_{i}" for i in range(1, 16))
    sql = f"""
    SELECT npi, {code_cols}, {switch_cols}
    FROM `bigquery-public-data.nppes.npi_optimized`
    WHERE npi IS NOT NULL
    """
    out: dict[str, str] = {}
    n_rows = 0
    for row in client.query(sql).result():
        primary_code: str | None = None
        first_code: str | None = None
        for i in range(1, 16):
            code = getattr(row, f"healthcare_provider_taxonomy_code_{i}", None)
            switch = getattr(row, f"healthcare_provider_primary_taxonomy_switch_{i}", None)
            if code and code.strip():
                code = code.strip()
                if first_code is None:
                    first_code = code
                if switch and switch.strip().upper() == "Y":
                    primary_code = code
                    break
        chosen = primary_code or first_code
        if chosen:
            out[row.npi] = chosen
        n_rows += 1
    print(f"NPPES primary: {n_rows:,} rows scanned, {len(out):,} with >=1 taxonomy code")
    return out


def load_nppes_taxonomy_set(client: bigquery.Client) -> dict[str, frozenset[str]]:
    """{npi -> frozenset(NUCC codes)} across all 15 slots."""
    cols = ", ".join(f"healthcare_provider_taxonomy_code_{i}" for i in range(1, 16))
    sql = f"""
    SELECT npi, {cols}
    FROM `bigquery-public-data.nppes.npi_optimized`
    WHERE npi IS NOT NULL
    """
    out: dict[str, frozenset[str]] = {}
    for row in client.query(sql).result():
        codes: set[str] = set()
        for i in range(1, 16):
            val = getattr(row, f"healthcare_provider_taxonomy_code_{i}", None)
            if val and val.strip():
                codes.add(val.strip())
        if codes:
            out[row.npi] = frozenset(codes)
    print(f"NPPES set: {len(out):,} NPIs with >=1 taxonomy")
    return out


def _int(v) -> int:
    try:
        return int(float(v)) if v not in (None, "") else 0
    except (TypeError, ValueError):
        return 0


def _float(v) -> float:
    try:
        return float(v) if v not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _band(share: float) -> str:
    if share >= SENSITIVITY_BANDS[1]:
        return ">=95% (high-confidence)"
    if share >= DRIFT_THRESHOLD:
        return f">={int(DRIFT_THRESHOLD*100)}% (publishable)"
    if share >= SENSITIVITY_BANDS[0]:
        return ">=60% (sensitivity sidecar)"
    return "<60%"


def build_affinity_table(primary: dict[str, str]) -> dict[str, str]:
    """Pass 1: HCPCS -> modal NUCC weighted by service volume.

    Only counts NPIs that have a NPPES primary taxonomy. NPIs without
    NPPES data don't vote on the affinity table.
    """
    print(f"\nPass 1: building HCPCS->NUCC affinity table from {SOURCE_CSV.name}...")
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    rows_scanned = 0
    with open(SOURCE_CSV, newline="") as fh:
        for row in csv.DictReader(fh):
            rows_scanned += 1
            if rows_scanned % 2_000_000 == 0:
                print(f"  pass 1 scanned {rows_scanned:,} rows")
            npi = (row.get("Rndrng_NPI") or "").strip()
            hcpcs = (row.get("HCPCS_Cd") or "").strip()
            nucc = primary.get(npi)
            if not (npi and hcpcs and nucc):
                continue
            srvcs = _int(row.get("Tot_Srvcs"))
            if srvcs > 0:
                counts[hcpcs][nucc] += srvcs

    affinity: dict[str, str] = {}
    for hcpcs, ctr in counts.items():
        if ctr:
            affinity[hcpcs] = ctr.most_common(1)[0][0]
    print(f"Pass 1 done: {rows_scanned:,} rows scanned, {len(affinity):,} HCPCS codes resolved")
    return affinity


def compute_per_npi_drift(
    affinity: dict[str, str],
    nppes_set: dict[str, frozenset[str]],
) -> dict[str, dict]:
    """Pass 2: per-NPI drift services / total services.

    Returns {npi -> {total, drift, billing_states, name, provider_type,
    paid_at_drift, drift_hcpcs Counter}}.
    """
    print(f"\nPass 2: computing per-NPI drift...")
    per_npi: dict[str, dict] = {}
    rows_scanned = 0
    with open(SOURCE_CSV, newline="") as fh:
        for row in csv.DictReader(fh):
            rows_scanned += 1
            if rows_scanned % 2_000_000 == 0:
                print(f"  pass 2 scanned {rows_scanned:,} rows, {len(per_npi):,} NPIs tracked")
            npi = (row.get("Rndrng_NPI") or "").strip()
            hcpcs = (row.get("HCPCS_Cd") or "").strip()
            if not (npi and hcpcs):
                continue
            nucc_set = nppes_set.get(npi)
            if not nucc_set:
                continue
            modal = affinity.get(hcpcs)
            if not modal:
                continue
            srvcs = _int(row.get("Tot_Srvcs"))
            if srvcs <= 0:
                continue
            avg_paid = _float(row.get("Avg_Mdcr_Pymt_Amt"))
            data = per_npi.setdefault(npi, {
                "total": 0,
                "drift": 0,
                "paid_at_drift": 0.0,
                "billing_states": Counter(),
                "drift_hcpcs": Counter(),
                "name": "",
                "provider_type": "",
            })
            data["total"] += srvcs
            state = (row.get("Rndrng_Prvdr_State_Abrvtn") or "").strip().upper()
            if state:
                data["billing_states"][state] += srvcs
            if not data["name"]:
                last = (row.get("Rndrng_Prvdr_Last_Org_Name") or "").strip()
                first = (row.get("Rndrng_Prvdr_First_Name") or "").strip()
                data["name"] = f"{last}, {first}".strip(", ")
            if not data["provider_type"]:
                data["provider_type"] = (row.get("Rndrng_Prvdr_Type") or "").strip()
            if modal not in nucc_set:
                data["drift"] += srvcs
                data["paid_at_drift"] += avg_paid * srvcs
                data["drift_hcpcs"][hcpcs] += srvcs
    print(f"Pass 2 done: {rows_scanned:,} rows scanned, {len(per_npi):,} NPIs with NPPES + drift evaluation")
    return per_npi


def _format_record(npi: str, data: dict, nppes_set: dict[str, frozenset[str]]) -> dict:
    share = data["drift"] / data["total"]
    primary_state = data["billing_states"].most_common(1)[0][0] if data["billing_states"] else ""
    top_drift = "|".join(f"{h}({c})" for h, c in data["drift_hcpcs"].most_common(5))
    return {
        "npi": npi,
        "name": data["name"],
        "provider_type": data["provider_type"],
        "billing_states": "|".join(sorted(data["billing_states"].keys())),
        "primary_billing_state": primary_state,
        "total_services": data["total"],
        "drift_services": data["drift"],
        "drift_share": round(share, 4),
        "threshold_band": _band(share),
        "estimated_paid_total_at_drift_codes": round(data["paid_at_drift"], 2),
        "nppes_nucc_set": "|".join(sorted(nppes_set.get(npi, frozenset()))),
        "top_drift_hcpcs": top_drift,
        "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{npi}",
    }


def main() -> None:
    if not SOURCE_CSV.exists():
        print(f"Source file not found at {SOURCE_CSV}. Download it first; see docstring.")
        return

    client = bigquery.Client(project=PROJECT)
    print("Loading NPPES taxonomy from BigQuery (~7.4M rows)...")
    primary = load_nppes_primary_taxonomy(client)
    nppes_set = load_nppes_taxonomy_set(client)

    affinity = build_affinity_table(primary)
    per_npi = compute_per_npi_drift(affinity, nppes_set)

    print("\nClassifying NPIs into bands...")
    all_records: list[dict] = []
    publishable: list[dict] = []
    sensitivity: list[dict] = []
    high_confidence: list[dict] = []
    skipped_low_volume = 0
    for npi, data in per_npi.items():
        if data["total"] < MIN_TOTAL_SERVICES:
            skipped_low_volume += 1
            continue
        share = data["drift"] / data["total"]
        if share < SENSITIVITY_BANDS[0]:
            continue
        rec = _format_record(npi, data, nppes_set)
        all_records.append(rec)
        if share >= SENSITIVITY_BANDS[1]:
            high_confidence.append(rec)
            publishable.append(rec)
        elif share >= DRIFT_THRESHOLD:
            publishable.append(rec)
        else:
            sensitivity.append(rec)

    print(f"Total NPIs considered: {len(per_npi):,}")
    print(f"Skipped (<{MIN_TOTAL_SERVICES} services): {skipped_low_volume:,}")
    print(f"Publishable (>={int(DRIFT_THRESHOLD*100)}%): {len(publishable):,}")
    print(f"High-confidence (>=95%): {len(high_confidence):,}")
    print(f"Sensitivity sidecar (60-79%): {len(sensitivity):,}")

    # National detail CSV (all bands, sorted by drift share desc then volume)
    all_records.sort(key=lambda r: (-r["drift_share"], -r["total_services"]))
    national_csv = FINDINGS_DIR / "specialty-billing-drift-detail.csv"
    with open(national_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        w.writeheader()
        for r in all_records:
            w.writerow({k: r.get(k, "") for k in CSV_FIELDS})
    print(f"Wrote {national_csv} ({len(all_records):,} rows)")

    # Per-state CSVs — only publishable + sensitivity for state-level files.
    # An NPI billing from multiple states appears in each state's CSV.
    per_state: dict[str, list[dict]] = defaultdict(list)
    for rec in all_records:
        states = (rec["billing_states"] or "").split("|") if rec["billing_states"] else []
        for st in states:
            if is_valid_us_state(st):
                per_state[st].append(rec)

    for state, rows in per_state.items():
        rows.sort(key=lambda r: (-r["drift_share"], -r["total_services"]))
        out_dir = state_output_dir(state)
        out_path = out_dir / "h41-specialty-drift.csv"
        with open(out_path, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in CSV_FIELDS})

    per_state_summary = sorted(
        (
            {
                "state": s,
                "publishable_npis": sum(
                    1 for r in rs if r["drift_share"] >= DRIFT_THRESHOLD
                ),
                "sensitivity_npis": sum(
                    1 for r in rs
                    if SENSITIVITY_BANDS[0] <= r["drift_share"] < DRIFT_THRESHOLD
                ),
                "publishable_paid_at_drift": round(
                    sum(
                        r["estimated_paid_total_at_drift_codes"]
                        for r in rs
                        if r["drift_share"] >= DRIFT_THRESHOLD
                    ),
                    2,
                ),
            }
            for s, rs in per_state.items()
        ),
        key=lambda d: -d["publishable_npis"],
    )

    print(f"\nStates with >=1 publishable NPI: {sum(1 for s in per_state_summary if s['publishable_npis'] > 0)}")
    if per_state_summary:
        print("Top 5 states by publishable count:")
        for s in per_state_summary[:5]:
            print(f"  {s['state']:2s}  publishable={s['publishable_npis']:>5}  sensitivity={s['sensitivity_npis']:>5}")

    denominator_evaluated = len(per_npi) - skipped_low_volume
    drift_rate = len(publishable) / denominator_evaluated if denominator_evaluated else 0

    headline = (
        f"**{len(publishable):,} of {denominator_evaluated:,} NPIs evaluated "
        f"({drift_rate*100:.2f}%) show specialty drift** — ≥{int(DRIFT_THRESHOLD*100)}% "
        f"of Medicare Part B services in CY {SERVICE_YEAR} billed under HCPCS "
        f"codes whose modal NPPES NUCC differs from the NPI's registered "
        f"taxonomy set. High-confidence subset (≥95%): {len(high_confidence):,}. "
        f"Sensitivity sidecar (60–79%): {len(sensitivity):,}. NPPES says one "
        f"specialty; Medicare billing says another. State Medicaid systems "
        f"that trust NPPES taxonomy for prior-authorization rules, network-"
        f"adequacy counts, and credentialing are operating on stale signal "
        f"for this cohort."
    )

    payload = {
        "slug": "specialty-billing-drift",
        "title": f"NPPES taxonomy vs Medicare-billed-specialty divergence (CY {SERVICE_YEAR}, all states)",
        "hypotheses": ["H41"],
        "status": "published",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(publishable),
        "denominator": denominator_evaluated,
        "numerator_note": (
            f"Numerator = NPIs with >={int(DRIFT_THRESHOLD*100)}% of CY {SERVICE_YEAR} "
            f"service volume in HCPCS codes whose modal NPPES NUCC is OUTSIDE the "
            f"NPI's NPPES NUCC set. Affinity table built empirically from the same "
            f"file (each HCPCS code's modal NPPES NUCC, weighted by total services)."
        ),
        "denominator_note": (
            f"NPIs with (a) at least {MIN_TOTAL_SERVICES} total Part B services "
            f"in CY {SERVICE_YEAR}, AND (b) at least one NPPES taxonomy code. "
            f"Excludes {skipped_low_volume:,} NPIs below the {MIN_TOTAL_SERVICES}-"
            f"service noise floor (analog of CMS's <11-beneficiary suppression)."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners/medicare-physician-other-practitioners-by-provider-and-service",
        "thresholds": {
            "publishable": DRIFT_THRESHOLD,
            "sensitivity_low": SENSITIVITY_BANDS[0],
            "sensitivity_high": SENSITIVITY_BANDS[1],
            "min_total_services": MIN_TOTAL_SERVICES,
        },
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": ">=95% drift (high-confidence)", "value": len(high_confidence)},
                {"label": f">={int(DRIFT_THRESHOLD*100)}% drift (publishable)", "value": len(publishable)},
                {"label": "60-79% drift (sensitivity sidecar)", "value": len(sensitivity)},
            ],
        },
        "per_state": per_state_summary,
        "csv_url_national": "/api/v1/findings/specialty-billing-drift-detail.csv",
        "notes": (
            "HCPCS→NUCC affinity table is empirical, not normative — it reflects what "
            "providers in each taxonomy actually bill, not what they should bill. "
            "Drift = modal NUCC for the billed HCPCS is NOT in the NPI's NPPES NUCC "
            "set. Sensitivity bands (60% / 95%) published alongside the publishable "
            "(80%) headline so consumers can choose their own falsification threshold. "
            "Source file streamed TWICE (one pass to build the affinity table, one "
            "pass to compute per-NPI drift); memory pressure capped at the per-HCPCS "
            "modal-NUCC Counter (~10K HCPCS codes) and per-NPI accumulator (~1M NPIs)."
        ),
    }
    out = FINDINGS_DIR / "specialty-billing-drift.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
