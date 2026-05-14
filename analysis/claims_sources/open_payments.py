"""H32 — Federally excluded NPIs receiving industry payments (Open Payments).

Pharmaceutical and device manufacturers report payments to physicians
and teaching hospitals under the Sunshine Act. If a manufacturer is
paying a federally excluded provider, that is an industry-side
compliance gap.

Open Payments is already public and individually searchable per recipient;
AINPI's contribution is the systematic cross-join with federal exclusion
lists, which has not been published.

Source file:
    https://download.cms.gov/openpayments/SMRY_RPTS_P01232026_01102026/
        PBLCTN_SMRY_BY_CR_BY_NTR_OF_PYMT_PGYR2024_P01232026_01102026.csv
    Aggregated 2024 General Payments grouped by Covered Recipient and
    Nature of Payment Type (~98 MB CSV, ~one row per recipient × payment type).

Cohort: full 8,619-NPI active LEIE ∪ SAM exclusion set (queried from
BigQuery, same as H33). National finding; VA-resident subset surfaced
as the per-state slice.

Writes:
    frontend/public/api/v1/findings/excluded-receiving-industry-payments.json
    frontend/public/api/v1/findings/excluded-receiving-industry-payments-detail.json
    frontend/public/api/v1/states/va/h32-excluded-industry-payments-va.csv
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from collections import defaultdict
from datetime import datetime, timezone

from google.cloud import bigquery

METHODOLOGY_VERSION = "0.6.0-draft"
DATA_SOURCE_RELEASE = "PGYR2024 P01232026 (released 2026-01-10)"
PROGRAM_YEAR = 2024
PROJECT = "thematic-fort-453901-t7"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SOURCE_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "openpayments-2024-by-recipient-nature.csv"
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


def load_exclusion_npis_with_state(client: bigquery.Client) -> dict[str, dict]:
    """LEIE ∪ SAM active exclusion NPIs with effective dates + NDH practice state."""
    sql = f"""
    WITH leie AS (
      SELECT NPI, MIN(EXCLDATE) AS leie_excldate
      FROM `{PROJECT}.cms_npd.oig_leie`
      WHERE NPI IS NOT NULL AND NPI != '0000000000' AND IFNULL(REINDATE, '00000000') = '00000000'
      GROUP BY NPI
    ),
    sam AS (
      SELECT npi AS NPI, CAST(MIN(active_date) AS STRING) AS sam_active_date
      FROM `{PROJECT}.cms_npd.sam_exclusions`
      WHERE npi IS NOT NULL AND REGEXP_CONTAINS(npi, r'^\\d{{10}}$')
      GROUP BY npi
    ),
    merged AS (
      SELECT COALESCE(leie.NPI, sam.NPI) AS NPI, leie.leie_excldate, sam.sam_active_date
      FROM leie FULL OUTER JOIN sam USING (NPI)
    )
    SELECT
      m.NPI AS npi,
      m.leie_excldate,
      m.sam_active_date,
      p._state AS ndh_state,
      p._family_name,
      p._given_name
    FROM merged m
    LEFT JOIN `{PROJECT}.cms_npd.practitioner` p ON m.NPI = p._npi
    """
    out: dict[str, dict] = {}
    for row in client.query(sql).result():
        # Earliest exclusion year — format EXCLDATE YYYYMMDD → year int
        years: list[int] = []
        if row.leie_excldate and len(row.leie_excldate) >= 4 and row.leie_excldate[:4].isdigit():
            years.append(int(row.leie_excldate[:4]))
        if row.sam_active_date and len(row.sam_active_date) >= 4 and row.sam_active_date[:4].isdigit():
            years.append(int(row.sam_active_date[:4]))
        sources = []
        if row.leie_excldate: sources.append("leie")
        if row.sam_active_date: sources.append("sam")
        out[row.npi] = {
            "npi": row.npi,
            "sources": "+".join(sources) or "unknown",
            "leie_excldate": row.leie_excldate,
            "sam_active_date": row.sam_active_date,
            "earliest_exclusion_year": min(years) if years else None,
            "ndh_state": row.ndh_state or "",
            "name": f"{(row._family_name or '').strip()}, {(row._given_name or '').strip()}".strip(", "),
        }
    return out


def main() -> None:
    print("Loading LEIE + SAM exclusion NPIs from BigQuery...")
    client = bigquery.Client(project=PROJECT)
    excl = load_exclusion_npis_with_state(client)
    print(f"Excluded NPIs: {len(excl)}")
    va_in_cohort = sum(1 for r in excl.values() if r["ndh_state"] == "VA")
    print(f"  of which VA-resident per NDH: {va_in_cohort}")

    print(f"Scanning {SOURCE_CSV.name}...")
    # Aggregate per NPI across nature-of-payment rows
    per_npi: dict[str, dict] = defaultdict(lambda: {
        "transactions": 0,
        "total_amount": 0.0,
        "nature_breakdown": defaultdict(float),
        "first_name": "",
        "last_name": "",
        "recipient_type": "",
    })
    rows_scanned = 0
    with open(SOURCE_CSV, newline="") as fh:
        for row in csv.DictReader(fh):
            rows_scanned += 1
            npi = (row.get("Covered_Recipient_NPI") or "").strip()
            if npi not in excl:
                continue
            slot = per_npi[npi]
            try:
                amt = float(row.get("Total_Amount", "0") or 0)
            except ValueError:
                amt = 0.0
            try:
                n = int(float(row.get("Number_of_Transaction", "0") or 0))
            except ValueError:
                n = 0
            slot["transactions"] += n
            slot["total_amount"] += amt
            nature = row.get("Nature_Of_Payment_Type_Code", "")
            if nature:
                slot["nature_breakdown"][nature] += amt
            slot["first_name"] = row.get("Covered_Recipient_Profile_First_Name", "") or slot["first_name"]
            slot["last_name"] = row.get("Covered_Recipient_Profile_Last_Name", "") or slot["last_name"]
            slot["recipient_type"] = row.get("Recipient_Type", "") or slot["recipient_type"]

    print(f"  scanned {rows_scanned:,} OP rows · {len(per_npi)} cohort NPIs matched")

    # Compose rows
    rows: list[dict] = []
    for npi, agg in per_npi.items():
        cohort_row = excl[npi]
        top_nature = sorted(agg["nature_breakdown"].items(), key=lambda kv: kv[1], reverse=True)[:3]
        excl_year = cohort_row["earliest_exclusion_year"]
        post_excl = excl_year is not None and excl_year < PROGRAM_YEAR
        rows.append({
            "npi": npi,
            "name": (cohort_row["name"] or f"{agg['last_name']}, {agg['first_name']}").strip(", "),
            "ndh_state": cohort_row["ndh_state"],
            "recipient_type": agg["recipient_type"],
            "exclusion_source": cohort_row["sources"],
            "leie_excldate": cohort_row["leie_excldate"] or "",
            "sam_active_date": cohort_row["sam_active_date"] or "",
            "earliest_exclusion_year": excl_year if excl_year is not None else "",
            "post_exclusion_pgyr2024": "yes" if post_excl else "no",
            "industry_payments_2024_total": round(agg["total_amount"], 2),
            "industry_payments_2024_transactions": agg["transactions"],
            "top_nature_codes": "; ".join(f"{c}=${a:,.0f}" for c, a in top_nature),
            "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
            "sam_lookup_url": "https://sam.gov/search/?index=ex",
            "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{npi}",
        })

    rows.sort(key=lambda r: r["industry_payments_2024_total"], reverse=True)
    print(f"\nTotal matched: {len(rows)}")
    va_rows = [r for r in rows if r["ndh_state"] == "VA"]
    strict_post = [r for r in rows if r["post_exclusion_pgyr2024"] == "yes"]
    strict_va = [r for r in va_rows if r["post_exclusion_pgyr2024"] == "yes"]
    print(f"  of which strictly POST-EXCLUSION (excl year < {PROGRAM_YEAR}): {len(strict_post)}")
    print(f"  of which VA-state per NDH: {len(va_rows)}")
    print(f"  of which VA + strict post-exclusion: {len(strict_va)}")
    total_paid = sum(r["industry_payments_2024_total"] for r in rows)
    total_paid_strict = sum(r["industry_payments_2024_total"] for r in strict_post)
    total_va_paid = sum(r["industry_payments_2024_total"] for r in va_rows)
    print(f"Total {PROGRAM_YEAR} industry payments to LEIE/SAM-excluded NPIs: ${total_paid:,.0f}")
    print(f"  strict post-exclusion subset: ${total_paid_strict:,.0f}")
    print(f"  to VA-resident: ${total_va_paid:,.0f}")

    # CSV writes
    fields = [
        "npi", "name", "ndh_state", "recipient_type", "exclusion_source",
        "leie_excldate", "sam_active_date", "earliest_exclusion_year",
        "post_exclusion_pgyr2024",
        "industry_payments_2024_total", "industry_payments_2024_transactions",
        "top_nature_codes", "leie_lookup_url", "sam_lookup_url", "nppes_lookup_url",
    ]
    out_dir = STATES_DIR / "va"
    out_dir.mkdir(parents=True, exist_ok=True)
    va_csv = out_dir / "h32-excluded-industry-payments-va.csv"
    with open(va_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in va_rows:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"Wrote VA: {va_csv} ({len(va_rows)} rows)")

    national_csv = FINDINGS_DIR / "excluded-receiving-industry-payments-detail.csv"
    with open(national_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"Wrote national: {national_csv} ({len(rows)} rows)")

    headline = (
        f"{len(rows)} of {len(excl):,} currently-active LEIE / SAM-excluded NPIs "
        f"received industry payments from drug and device manufacturers in "
        f"program year {PROGRAM_YEAR} per CMS Open Payments. Combined paid "
        f"amount: ${total_paid:,.0f}. Of those {len(rows)} matches, "
        f"**{len(strict_post)} were paid STRICTLY POST-EXCLUSION** (earliest "
        f"LEIE/SAM exclusion year before {PROGRAM_YEAR}), with "
        f"${total_paid_strict:,.0f} in strict post-exclusion industry payments. "
        f"{len(va_rows)} of the {len(rows)} matches are VA-resident per NDH; "
        f"{len(strict_va)} of those VA-resident matches are also strict "
        f"post-exclusion. The strict-post-exclusion subset is the regulatorily "
        f"significant signal — pre-exclusion industry payments reflect work "
        f"the provider was authorized to do at the time."
    )

    payload = {
        "slug": "excluded-receiving-industry-payments",
        "title": "Federally excluded NPIs receiving industry payments (Open Payments)",
        "hypotheses": ["H32"],
        "status": "published",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(strict_post),
        "denominator": len(excl),
        "numerator_full_window": len(rows),
        "numerator_note": (
            f"Numerator = NPIs receiving industry payments in PY {PROGRAM_YEAR} "
            f"with LEIE/SAM exclusion-effective year < {PROGRAM_YEAR}. "
            f"Full-window numerator (any {PROGRAM_YEAR} payment, regardless of "
            f"when exclusion took effect) = {len(rows)}."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://openpaymentsdata.cms.gov/",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "LEIE/SAM NPIs receiving industry payments", "value": len(rows)},
                {"label": "of which VA-resident", "value": len(va_rows)},
            ],
        },
        "notes": (
            "Aggregate file (PBLCTN_SMRY_BY_CR_BY_NTR_OF_PYMT) used rather than "
            "the line-detail file (~10M rows) — the aggregate gives per-NPI × "
            "per-nature-code totals which is the right granularity for the "
            "exclusion join. Open Payments is itself public — drug and device "
            "manufacturers are required to report by the Sunshine Act / "
            "Physician Payments Sunshine Act (42 USC § 1320a-7h). AINPI's "
            "contribution is the systematic cross-join with the LEIE ∪ SAM "
            "active exclusion set, which has not been published. VA-state "
            "slice at /api/v1/states/va/h32-excluded-industry-payments-va.csv. "
            "Full national list at /api/v1/findings/excluded-receiving-"
            "industry-payments-detail.csv."
        ),
    }

    out = FINDINGS_DIR / "excluded-receiving-industry-payments.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {out}")

    detail = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "denominator_cohort_size": len(excl),
        "matched_nationally": len(rows),
        "matched_va": len(va_rows),
        "total_paid_2024": total_paid,
        "total_va_paid_2024": total_va_paid,
        "top_10_nationally": [
            {k: r.get(k) for k in (
                "npi", "name", "ndh_state", "recipient_type", "exclusion_source",
                "industry_payments_2024_total", "industry_payments_2024_transactions",
                "top_nature_codes",
            )}
            for r in rows[:10]
        ],
        "csv_url_national": "/api/v1/findings/excluded-receiving-industry-payments-detail.csv",
        "csv_url_va": "/api/v1/states/va/h32-excluded-industry-payments-va.csv",
    }
    (FINDINGS_DIR / "excluded-receiving-industry-payments-detail.json").write_text(
        json.dumps(detail, indent=2) + "\n"
    )
    print(f"Wrote {FINDINGS_DIR / 'excluded-receiving-industry-payments-detail.json'}")

    print("\nTop 10 nationally:")
    for r in rows[:10]:
        print(f"  {r['npi']}  {r['name'][:28]:28s} {r['ndh_state']:2s}  ${r['industry_payments_2024_total']:>10,.0f}  ({r['exclusion_source']})")


if __name__ == "__main__":
    main()
