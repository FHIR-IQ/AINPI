"""H31 — NPPES-deactivated NPIs still billing public claims data (all states).

NPPES deactivation = the provider is no longer in practice per the
federal provider registry. Billing after deactivation is either a
data quality problem (NPI reused or misattributed) or evidence of
work being done under a closed identifier. Both are state PI flags.

VA-pilot cohort = NPIs that meet ALL of:
    - NPPES deactivated (npi_deactivation_date IS NOT NULL,
      npi_reactivation_date IS NULL)
    - VA practice state per the NDH practitioner table (_state = 'VA').
      The NPPES practice-state field is nulled on deactivation, so we
      use the NDH-side practice state which is retained even after
      NPPES deactivation. This is the H10 "NPPES-deactivated but still
      listed in NDH" signal extended to its claims-side consequence.

Match rule: claim period > NPPES deactivation date.
    Medicaid (HHS spending) uses month-level granularity (CLAIM_FROM_MONTH).
    Medicare Part B / Part D are CY 2023 aggregates, so the strict
    filter is deactivation_year < 2023.

Sources reused from Phase 1:
    HHS Medicaid Provider Spending parquet (frontend/data/hhs-medicaid-spending/)
    CMS Medicare Part B by Provider (frontend/data/cms-claims/partb-by-provider.csv)
    CMS Medicare Part D by Provider (frontend/data/cms-claims/partd-by-provider.csv)

Writes:
    frontend/public/api/v1/findings/deactivated-still-billing.json
    frontend/public/api/v1/findings/deactivated-still-billing-detail.json
    frontend/public/api/v1/states/va/h31-deactivated-paid.csv
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from collections import defaultdict
from datetime import datetime, timezone

import pyarrow as pa
import pyarrow.parquet as pq
import pyarrow.compute as pc
from google.cloud import bigquery

METHODOLOGY_VERSION = "0.6.1-draft"
PROJECT = "thematic-fort-453901-t7"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
PARQUET_PATH = (
    REPO_ROOT / "frontend" / "data" / "hhs-medicaid-spending"
    / "medicaid-provider-spending.parquet"
)
PARTB_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "partb-by-provider.csv"
PARTD_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "partd-by-provider.csv"
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
STATES_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states"


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


def load_cohort_from_bq() -> dict[str, dict]:
    """All-states cohort: every NPPES-deactivated NPI that's also listed in
    the NDH practitioner table, carrying the NDH practice state for output
    partitioning. Single BQ scan; downstream Python code partitions by state.

    NPPES nulls practice address fields on deactivation. The NDH side retains
    practice state — this is exactly the H10 "deactivated-still-listed" signal
    extended to claims-side consequence.
    """
    client = bigquery.Client(project=PROJECT)
    sql = """
    SELECT
      p._npi AS npi,
      COALESCE(p._family_name, '') AS family_name,
      COALESCE(p._given_name, '') AS given_name,
      p._state AS ndh_state,
      n.npi_deactivation_date AS deactivation_date,
      EXTRACT(YEAR FROM n.npi_deactivation_date) AS deactivation_year,
      EXTRACT(MONTH FROM n.npi_deactivation_date) AS deactivation_month,
      p._active AS ndh_active
    FROM `thematic-fort-453901-t7.cms_npd.practitioner` p
    JOIN `bigquery-public-data.nppes.npi_optimized` n
      ON p._npi = n.npi
    WHERE n.npi_deactivation_date IS NOT NULL
      AND n.npi_reactivation_date IS NULL
      AND p._state IS NOT NULL
      AND LENGTH(p._state) = 2
    """
    cohort = {}
    for row in client.query(sql).result():
        cohort[row.npi] = {
            "npi": row.npi,
            "name": f"{row.family_name}, {row.given_name}".strip(", "),
            "ndh_state": row.ndh_state or "",
            "deactivation_date": str(row.deactivation_date) if row.deactivation_date else "",
            "deactivation_year": row.deactivation_year,
            "deactivation_month": row.deactivation_month,
            "ndh_active": bool(row.ndh_active),
        }
    print(f"All-states cohort (NPPES-deactivated × NDH-listed): {len(cohort):,} NPIs")
    return cohort


def filter_medicaid_parquet(cohort: dict[str, dict]) -> dict[str, dict]:
    """Aggregate post-deactivation paid amount + claim lines per NPI."""
    if not PARQUET_PATH.exists():
        print(f"WARN: Medicaid parquet missing at {PARQUET_PATH}; skipping H31 Medicaid slice.")
        return {}
    pf = pq.ParquetFile(PARQUET_PATH)
    print(f"Scanning Medicaid parquet ({pf.metadata.num_rows:,} rows)...")
    npis = list(cohort.keys())
    npi_set = pa.array(npis, type=pa.string())

    per_npi: dict[str, dict] = defaultdict(lambda: {
        "paid": 0.0, "claims": 0, "patients": 0,
        "post_deactivation_paid": 0.0, "post_deactivation_claims": 0,
        "first_month": None, "last_month": None,
    })

    for i, batch in enumerate(pf.iter_batches(batch_size=200_000, columns=[
        "BILLING_PROVIDER_NPI_NUM", "SERVICING_PROVIDER_NPI_NUM",
        "CLAIM_FROM_MONTH", "TOTAL_PATIENTS", "TOTAL_CLAIM_LINES", "TOTAL_PAID",
    ])):
        billing = batch.column("BILLING_PROVIDER_NPI_NUM")
        servicing = batch.column("SERVICING_PROVIDER_NPI_NUM")
        mask = pc.or_(pc.is_in(billing, value_set=npi_set), pc.is_in(servicing, value_set=npi_set))
        if not pc.any(mask).as_py():
            continue
        sub = batch.filter(mask).to_pylist()
        for row in sub:
            billing_npi = row["BILLING_PROVIDER_NPI_NUM"]
            servicing_npi = row["SERVICING_PROVIDER_NPI_NUM"]
            month = row["CLAIM_FROM_MONTH"] or ""  # YYYY-MM
            paid = float(row["TOTAL_PAID"] or 0)
            claims = int(row["TOTAL_CLAIM_LINES"] or 0)
            patients = int(row["TOTAL_PATIENTS"] or 0)
            for npi, axis in [(billing_npi, "billing"), (servicing_npi, "servicing")]:
                if npi not in cohort:
                    continue
                cohort_row = cohort[npi]
                deact_year = cohort_row["deactivation_year"]
                deact_month = cohort_row["deactivation_month"]
                slot = per_npi[npi]
                slot["paid"] += paid
                slot["claims"] += claims
                slot["patients"] += patients
                # Strict post-deactivation filter at month granularity
                if month and len(month) >= 7:
                    y, m = month[:4], month[5:7]
                    try:
                        if (int(y) > deact_year) or (int(y) == deact_year and int(m) > deact_month):
                            slot["post_deactivation_paid"] += paid
                            slot["post_deactivation_claims"] += claims
                    except ValueError:
                        pass
                if not slot["first_month"] or month < slot["first_month"]:
                    slot["first_month"] = month
                if not slot["last_month"] or month > slot["last_month"]:
                    slot["last_month"] = month
        if (i + 1) % 100 == 0:
            print(f"  scanned {(i+1)*200_000:>12,} rows · {len(per_npi)} cohort matches so far")
    print(f"  Medicaid: {len(per_npi)} cohort NPIs with any Medicaid payment.")
    return dict(per_npi)


def filter_partb(cohort: dict[str, dict]) -> dict[str, dict]:
    """CY 2023 Part B aggregate match; strict filter = deactivation_year < 2023."""
    if not PARTB_CSV.exists():
        return {}
    out: dict[str, dict] = {}
    with open(PARTB_CSV, newline="") as fh:
        for row in csv.DictReader(fh):
            npi = (row.get("Rndrng_NPI") or "").strip()
            if npi not in cohort:
                continue
            cohort_row = cohort[npi]
            paid = float(row.get("Tot_Mdcr_Pymt_Amt") or 0)
            services = int(float(row.get("Tot_Srvcs") or 0)) if row.get("Tot_Srvcs") else 0
            post = cohort_row["deactivation_year"] < 2023
            out[npi] = {
                "partb_2023_paid": paid,
                "partb_2023_services": services,
                "partb_2023_post_deactivation": post,
                "partb_2023_state": row.get("Rndrng_Prvdr_State_Abrvtn", ""),
                "partb_2023_provider_type": row.get("Rndrng_Prvdr_Type", ""),
            }
    print(f"  Part B: {len(out)} cohort NPIs with Medicare Part B billing in CY 2023.")
    return out


def filter_partd(cohort: dict[str, dict]) -> dict[str, dict]:
    """CY 2023 Part D aggregate match."""
    if not PARTD_CSV.exists():
        return {}
    out: dict[str, dict] = {}
    with open(PARTD_CSV, newline="") as fh:
        for row in csv.DictReader(fh):
            npi = (row.get("PRSCRBR_NPI") or "").strip()
            if npi not in cohort:
                continue
            cohort_row = cohort[npi]
            cost = float(row.get("Tot_Drug_Cst") or 0)
            opioid_claims = int(float(row.get("Opioid_Tot_Clms") or 0)) if row.get("Opioid_Tot_Clms") else 0
            opioid_cost = float(row.get("Opioid_Tot_Drug_Cst") or 0)
            post = cohort_row["deactivation_year"] < 2023
            out[npi] = {
                "partd_2023_drug_cost": cost,
                "partd_2023_opioid_claims": opioid_claims,
                "partd_2023_opioid_cost": opioid_cost,
                "partd_2023_post_deactivation": post,
                "partd_2023_state": row.get("Prscrbr_State_Abrvtn", ""),
            }
    print(f"  Part D: {len(out)} cohort NPIs with Medicare Part D prescribing in CY 2023.")
    return out


def main() -> None:
    cohort = load_cohort_from_bq()
    medicaid = filter_medicaid_parquet(cohort)
    partb = filter_partb(cohort)
    partd = filter_partd(cohort)

    all_npis = set(medicaid) | set(partb) | set(partd)
    print(f"\nCohort NPIs with billing in ≥1 public claims source: {len(all_npis)}")
    print(f"  Medicaid only: {len(set(medicaid) - set(partb) - set(partd))}")
    print(f"  Part B only:   {len(set(partb) - set(medicaid) - set(partd))}")
    print(f"  Part D only:   {len(set(partd) - set(medicaid) - set(partb))}")
    print(f"  In ≥2 sources: {len([n for n in all_npis if sum([n in medicaid, n in partb, n in partd]) >= 2])}")

    # Compose rows
    rows: list[dict] = []
    for npi in all_npis:
        cohort_row = cohort[npi]
        m = medicaid.get(npi, {})
        pb = partb.get(npi, {})
        pd = partd.get(npi, {})
        post_medicaid = m.get("post_deactivation_paid", 0) > 0
        post_partb = pb.get("partb_2023_post_deactivation", False) and pb.get("partb_2023_paid", 0) > 0
        post_partd = pd.get("partd_2023_post_deactivation", False) and pd.get("partd_2023_drug_cost", 0) > 0

        sources = []
        if post_medicaid: sources.append("medicaid")
        if post_partb: sources.append("medicare_partb")
        if post_partd: sources.append("medicare_partd")

        # Only publish rows with strict post-deactivation billing in ≥1 source
        if not sources:
            continue

        rows.append({
            "npi": npi,
            "name": cohort_row["name"],
            "state": cohort_row["ndh_state"],
            "deactivation_date": cohort_row["deactivation_date"],
            "ndh_active_flag": "true" if cohort_row["ndh_active"] else "false",
            "billing_sources_post_deactivation": "|".join(sources),
            "medicaid_post_deactivation_paid": round(m.get("post_deactivation_paid", 0), 2),
            "medicaid_post_deactivation_claims": m.get("post_deactivation_claims", 0),
            "medicaid_first_claim_month": m.get("first_month", ""),
            "medicaid_last_claim_month": m.get("last_month", ""),
            "partb_2023_paid": round(pb.get("partb_2023_paid", 0), 2),
            "partb_2023_services": pb.get("partb_2023_services", 0),
            "partd_2023_drug_cost": round(pd.get("partd_2023_drug_cost", 0), 2),
            "partd_2023_opioid_claims": pd.get("partd_2023_opioid_claims", 0),
            "partd_2023_opioid_cost": round(pd.get("partd_2023_opioid_cost", 0), 2),
            "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{npi}",
        })

    rows.sort(
        key=lambda r: r["medicaid_post_deactivation_paid"] + r["partb_2023_paid"] + r["partd_2023_drug_cost"],
        reverse=True,
    )

    fields = [
        "npi", "name", "state", "deactivation_date", "ndh_active_flag",
        "billing_sources_post_deactivation",
        "medicaid_post_deactivation_paid", "medicaid_post_deactivation_claims",
        "medicaid_first_claim_month", "medicaid_last_claim_month",
        "partb_2023_paid", "partb_2023_services",
        "partd_2023_drug_cost", "partd_2023_opioid_claims", "partd_2023_opioid_cost",
        "nppes_lookup_url",
    ]

    # Per-state CSVs. NPPES allows international addresses, so filter to
    # US states / DC / territories only — anything else (Canadian provinces,
    # Mexican states) would create unroutable URLs in the static site.
    from analysis.claims_sources._cohorts import is_valid_us_state
    per_state: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        st = (r.get("state") or "").strip().upper()
        if is_valid_us_state(st):
            per_state[st].append(r)
    for st, st_rows in per_state.items():
        st_dir = STATES_DIR / st.lower()
        st_dir.mkdir(parents=True, exist_ok=True)
        with open(st_dir / "h31-deactivated-paid.csv", "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            for r in st_rows:
                w.writerow({k: r.get(k, "") for k in fields})

    # National rollup
    national_csv = FINDINGS_DIR / "deactivated-still-billing-detail.csv"
    with open(national_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"Wrote {len(per_state)} per-state CSVs · national rollup at {national_csv} ({len(rows)} rows)")

    # Per-state stats for the finding JSON
    per_state_stats = {
        s: {
            "matches": len(rs),
            "multi_source": sum(1 for r in rs if "|" in r["billing_sources_post_deactivation"]),
            "medicaid_paid_post_deactivation": round(sum(r["medicaid_post_deactivation_paid"] for r in rs), 2),
            "partb_paid_cy2023": round(sum(r["partb_2023_paid"] for r in rs), 2),
            "partd_drug_cost_cy2023": round(sum(r["partd_2023_drug_cost"] for r in rs), 2),
            "cohort_size": sum(1 for c in cohort.values() if c["ndh_state"] == s),
        }
        for s, rs in per_state.items()
    }

    total_medicaid = sum(r["medicaid_post_deactivation_paid"] for r in rows)
    total_partb = sum(r["partb_2023_paid"] for r in rows)
    total_partd = sum(r["partd_2023_drug_cost"] for r in rows)
    multi_source = sum(1 for r in rows if "|" in r["billing_sources_post_deactivation"])

    headline = (
        f"{len(rows)} of {len(cohort):,} NPPES-deactivated NPIs (across all "
        f"states, per NDH practice-state retention; NPPES nulls practice state "
        f"on deactivation) billed at least one public claims source STRICTLY "
        f"AFTER their NPPES deactivation date. Post-deactivation totals: "
        f"Medicaid ${total_medicaid:,.0f}, Medicare Part B ${total_partb:,.0f} "
        f"(CY 2023), Medicare Part D ${total_partd:,.0f} drug cost (CY 2023). "
        f"{multi_source} of {len(rows)} matched NPIs appear in MULTIPLE "
        f"post-deactivation billing sources, which is a stronger signal than "
        f"any single source. Match rule: claim month/year > NPPES deactivation "
        f"month/year. Each match is either a data-quality problem (NPI reused "
        f"or misattributed) or evidence of work being done under a closed "
        f"identifier — both are state PI triage flags."
    )

    payload = {
        "slug": "deactivated-still-billing",
        "title": "NPPES-deactivated NPIs still billing public claims data (all states)",
        "hypotheses": ["H31"],
        "status": "published",
        "release_date": "2026-05-17",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(rows),
        "denominator": len(cohort),
        "denominator_note": (
            f"Cohort = {len(cohort):,} NPIs that are NPPES-deactivated "
            f"(npi_deactivation_date IS NOT NULL, npi_reactivation_date "
            f"IS NULL) AND appear in NDH practitioner with a populated "
            f"_state. NPPES nulls practice address fields on deactivation, "
            f"so state attribution comes from the NDH side (the H10 "
            f"\"NPPES-deactivated but still listed in NDH\" signal "
            f"extended to its claims-side consequence). Per-state CSVs "
            f"at /api/v1/states/<state>/h31-deactivated-paid.csv."
        ),
        "data_source_release": "HHS 2026-02-09 + Medicare CY 2023 + NPPES (BigQuery public dataset)",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "NPPES-deactivated NPIs still billing", "value": len(rows)},
                {"label": "Multi-source post-deactivation matches", "value": multi_source},
            ],
        },
        "per_state": sorted(
            ({"state": s, **stats} for s, stats in per_state_stats.items()),
            key=lambda d: -d["matches"],
        ),
        "notes": (
            "Per-state CSV at /api/v1/states/<state>/h31-deactivated-paid.csv. "
            "Match rule for Medicaid: CLAIM_FROM_MONTH > deactivation month/year "
            "(month-level precision). For Medicare Part B / Part D: "
            "deactivation_year < 2023 (year-level precision since the source "
            "files are CY 2023 aggregates). Multi-source matches are the "
            "strongest signal — same NPI billing across Medicaid + Medicare "
            "after NPPES deactivation is direct evidence of work being done "
            "under a closed identifier. State PI triage priority order: "
            "(1) multi-source matches, (2) Part D opioid prescribers, "
            "(3) high-dollar single-source matches."
        ),
    }

    out = FINDINGS_DIR / "deactivated-still-billing.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {out}")

    top_rows = rows[:10]
    detail = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "denominator_cohort_size": len(cohort),
        "matches_post_deactivation_billing": len(rows),
        "multi_source_matches": multi_source,
        "totals": {
            "medicaid_paid_post_deactivation": total_medicaid,
            "partb_paid_cy2023_post_deactivation": total_partb,
            "partd_drug_cost_cy2023_post_deactivation": total_partd,
        },
        "per_state_stats": per_state_stats,
        "top_10_by_combined_amount": [
            {k: r.get(k) for k in (
                "npi", "name", "state", "deactivation_date", "ndh_active_flag",
                "billing_sources_post_deactivation",
                "medicaid_post_deactivation_paid", "medicaid_post_deactivation_claims",
                "partb_2023_paid", "partb_2023_services",
                "partd_2023_drug_cost", "partd_2023_opioid_claims",
            )}
            for r in top_rows
        ],
        "csv_url_pattern": "/api/v1/states/<state>/h31-deactivated-paid.csv",
        "national_csv_url": "/api/v1/findings/deactivated-still-billing-detail.csv",
    }
    (FINDINGS_DIR / "deactivated-still-billing-detail.json").write_text(json.dumps(detail, indent=2) + "\n")
    print(f"Wrote {FINDINGS_DIR / 'deactivated-still-billing-detail.json'}")

    print("\nTop 10 by combined post-deactivation amount:")
    for r in top_rows:
        amounts = []
        if r["medicaid_post_deactivation_paid"]: amounts.append(f"Mcd ${r['medicaid_post_deactivation_paid']:,.0f}")
        if r["partb_2023_paid"]: amounts.append(f"PB ${r['partb_2023_paid']:,.0f}")
        if r["partd_2023_drug_cost"]: amounts.append(f"PD ${r['partd_2023_drug_cost']:,.0f}")
        print(f"  {r['npi']}  {r['name'][:25]:25s}  deact {r['deactivation_date']}  {' · '.join(amounts)}")


if __name__ == "__main__":
    main()
