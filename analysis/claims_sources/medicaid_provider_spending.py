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

METHODOLOGY_VERSION = "0.6.0-draft"
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


def filter_parquet_for_npis(npis: set[str]) -> dict[str, dict]:
    """Single pass over the parquet, filtering on (billing|servicing) ∈ npis.

    Returns a dict keyed by NPI with aggregated paid amount, claim line count,
    top HCPCS by paid amount, first/last claim month, and which axis the NPI
    matched on (billing vs servicing).
    """
    if not PARQUET_PATH.exists():
        raise SystemExit(
            f"Parquet file not found at {PARQUET_PATH}\n"
            f"Download: curl -sSL -o {PARQUET_PATH} {PARQUET_URL}"
        )

    pf = pq.ParquetFile(PARQUET_PATH)
    print(f"Scanning {PARQUET_PATH.name} — {pf.metadata.num_rows:,} rows · {pf.num_row_groups} row groups")

    per_npi: dict[str, dict] = defaultdict(lambda: {
        "paid": 0.0,
        "claims": 0,
        "patients": 0,
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

        if (i + 1) % 50 == 0:
            print(f"  scanned {(i + 1) * 200_000:>12,} rows · {len(per_npi)} NPIs matched so far")

    print(f"Done. {len(per_npi)} matching NPIs.")
    return dict(per_npi)


def compose_rows(cohort: list[dict], hits: dict[str, dict]) -> list[dict]:
    by_npi = {r["npi"]: r for r in cohort if r.get("npi")}
    out = []
    for npi, agg in hits.items():
        cohort_row = by_npi.get(npi, {})
        top_hcpcs = sorted(
            agg["hcpcs"].items(), key=lambda kv: kv[1], reverse=True
        )[:3]
        out.append({
            "npi": npi,
            "name": cohort_row.get("name", ""),
            "paid_amount_post_exclusion": round(agg["paid"], 2),
            "claim_lines_total": agg["claims"],
            "patients_total": agg["patients"],
            "top_hcpcs_codes": "; ".join(f"{c}=${a:,.0f}" for c, a in top_hcpcs if c),
            "exclusion_source": cohort_row.get("reasons", ""),
            "score": cohort_row.get("score", ""),
            "first_paid_month": agg["first_month"] or "",
            "last_paid_month": agg["last_month"] or "",
            "billing_or_servicing": ", ".join(sorted(agg["axes"])),
            "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
            "sam_lookup_url": "https://sam.gov/search/?index=ex",
            "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{npi}",
        })
    out.sort(key=lambda r: r["paid_amount_post_exclusion"], reverse=True)
    return out


def write_state_csv(state: str, rows: list[dict]) -> pathlib.Path:
    out_dir = STATES_DIR / state.lower()
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "h29-excluded-paid.csv"
    fieldnames = [
        "npi", "name", "paid_amount_post_exclusion", "claim_lines_total",
        "patients_total", "top_hcpcs_codes", "exclusion_source", "score",
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


def write_finding_json(rows: list[dict], state: str, total_cohort: int) -> None:
    total_paid = sum(r["paid_amount_post_exclusion"] for r in rows)
    total_claims = sum(r["claim_lines_total"] for r in rows)
    top_rows = rows[:5]

    headline = (
        f"{len(rows)} of {total_cohort} currently-active federally-excluded "
        f"{state.upper()}-resident NPIs (per NPPES practice state) received Medicaid "
        f"payments somewhere in T-MSIS 2018–2024, per the HHS Medicaid Provider "
        f"Spending dataset ({DATA_SOURCE_RELEASE} release). Combined paid amount "
        f"across all state Medicaid programs: ${total_paid:,.0f} over {total_claims:,} "
        f"claim lines. Each match is a 42 CFR § 455.436 audit-referral candidate that "
        f"a state PI unit can pull and validate against the per-NPI exclusion-effective "
        f"date in the LEIE / SAM sources. Two source-data limits to read carefully: "
        f"(1) the HHS file has no state-of-payment column, so paid amounts aggregate "
        f"across every state Medicaid program that paid the NPI — the VA-resident "
        f"cohort is per NPPES practice state, NOT per state of payment; "
        f"(2) the cohort's exclusion-effective dates are not pinned in the cohort "
        f"export, so a row's paid amounts may include claim months that pre-date "
        f"the exclusion. Per-NPI MMIS triage should reconcile against the LEIE / SAM "
        f"effective date via the verification URLs in the per-state CSV."
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
        "numerator": len(rows),
        "denominator": total_cohort,
        "denominator_note": (
            f"Phase 1 pilot scope = the {total_cohort}-NPI Virginia federally-"
            f"excluded cohort (active LEIE or SAM, score >= 1.5; VA-resident per "
            f"NPPES practice state). All-50-states roll-up follows once VA "
            f"methodology clears DMAS review. Two source-data limits readers "
            f"must keep in mind: the HHS source file does NOT carry a state-of-"
            f"payment column (so paid amounts aggregate across every state "
            f"Medicaid program that paid the NPI), and the cohort export does "
            f"not currently pin per-NPI exclusion-effective dates (so a row's "
            f"paid amount may include claim months that pre-date the exclusion; "
            f"MMIS triage should reconcile each NPI's paid period against the "
            f"LEIE / SAM effective date)."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://opendata.hhs.gov/datasets/medicaid-provider-spending/",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "VA cohort NPIs paid by Medicaid", "value": len(rows)},
                {"label": "VA cohort NPIs not paid (in this dataset)", "value": max(0, total_cohort - len(rows))},
            ],
        },
        "notes": (
            "Pilot state: Virginia. Per-state CSV at "
            f"/api/v1/states/{state}/h29-excluded-paid.csv carries one row per "
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
            "roadmap §10). DMAS receives 5-business-day review courtesy on "
            "VA-attributed rows before each refresh — operational courtesy, not "
            "a publication gate."
        ),
    }

    out = FINDINGS_DIR / "excluded-paid-by-medicaid.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {out}")

    detail = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "pilot_state": state.upper(),
        "denominator_cohort_size": total_cohort,
        "matches": len(rows),
        "total_paid_post_exclusion": total_paid,
        "total_claim_lines": total_claims,
        "source_file_schema_note": (
            "HHS Medicaid Provider Spending has no state-of-payment column. "
            "State attribution (VA in this slice) is via NPPES practice state, "
            "not the source file. Per-NPI paid amounts aggregate across all "
            "state Medicaid programs."
        ),
        "top_paid_npis": [
            {k: r.get(k) for k in (
                "npi", "name", "paid_amount_post_exclusion", "claim_lines_total",
                "patients_total", "exclusion_source", "top_hcpcs_codes",
                "first_paid_month", "last_paid_month", "billing_or_servicing",
            )}
            for r in top_rows
        ],
        "csv_url": f"/api/v1/states/{state.lower()}/h29-excluded-paid.csv",
    }
    detail_out = FINDINGS_DIR / "excluded-paid-by-medicaid-detail.json"
    detail_out.write_text(json.dumps(detail, indent=2) + "\n")
    print(f"Wrote {detail_out}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--state", default="va", help="State pilot to materialize (default: va)")
    args = p.parse_args()

    state = args.state.lower()
    va_cohort_csv = STATES_DIR / "va-cohort-critical.csv"
    if not va_cohort_csv.exists():
        raise SystemExit(f"VA cohort CSV not found at {va_cohort_csv}")

    cohort = load_cohort(va_cohort_csv)
    npis = {r["npi"].strip() for r in cohort if r.get("npi")}
    print(f"VA cohort: {len(npis)} NPIs")

    hits = filter_parquet_for_npis(npis)
    rows = compose_rows(cohort, hits)
    write_state_csv(state, rows)
    write_finding_json(rows, state, total_cohort=len(npis))


if __name__ == "__main__":
    main()
