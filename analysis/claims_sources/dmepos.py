"""H33 — DMEPOS suppliers on federal exclusion lists.

DMEPOS has historically been the highest-fraud category in Medicare.
CMS has imposed enrollment moratoria in multiple states (most recently
Florida, March 2026). Cross-checking the active supplier directory
against federal exclusion lists is a direct state and federal PI signal.

This is a NATIONAL finding (not VA-cohort-scoped) — the DMEPOS supplier
file is itself the population. We match every supplier NPI against the
active LEIE + SAM exclusion lists (queried from BigQuery). VA-state
suppliers are surfaced as a per-state slice for the VA pilot.

Sources:
    DMEPOS by Supplier:
      https://data.cms.gov/sites/default/files/2025-06/
        5b10992b-8290-4b93-b036-0c233020d7da/
        mup_dme_ry25_p05_v10_dy23_supr.csv
    LEIE + SAM exclusion NPIs:
      BigQuery — cms_npd.oig_leie + cms_npd.sam_exclusions

Writes:
    frontend/public/api/v1/findings/dmepos-excluded.json
    frontend/public/api/v1/findings/dmepos-excluded-detail.json
    frontend/public/api/v1/states/va/h33-dmepos-excluded-va.csv (VA-suppliers slice)
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from collections import Counter
from datetime import datetime, timezone

from google.cloud import bigquery

METHODOLOGY_VERSION = "0.6.0-draft"
DATA_SOURCE_RELEASE = "DY 2023 (RY2025 P05)"
PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SOURCE_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "dmepos-by-supplier.csv"
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


def load_exclusion_npis(client: bigquery.Client) -> dict[str, dict]:
    """Return dict NPI -> {sources, leie_date, sam_date}."""
    sql = f"""
    SELECT
      NPI,
      MIN(EXCLDATE) AS leie_exclusion_date,
      'leie' AS source
    FROM `{PROJECT}.{DATASET}.oig_leie`
    WHERE NPI IS NOT NULL AND NPI != '0000000000' AND IFNULL(REINDATE, '00000000') = '00000000'
    GROUP BY NPI
    UNION ALL
    SELECT
      NPI,
      NULL AS leie_exclusion_date,
      'sam' AS source
    FROM `{PROJECT}.{DATASET}.sam_exclusions`
    WHERE NPI IS NOT NULL AND REGEXP_CONTAINS(NPI, r'^\\d{{10}}$')
    """
    out: dict[str, dict] = {}
    for row in client.query(sql).result():
        npi = row.NPI
        slot = out.setdefault(npi, {"sources": set(), "leie_date": None})
        slot["sources"].add(row.source)
        if row.source == "leie" and row.leie_exclusion_date:
            slot["leie_date"] = row.leie_exclusion_date
    return out


def main() -> None:
    print("Loading LEIE + SAM exclusion NPIs from BigQuery...")
    client = bigquery.Client(project=PROJECT)
    excl = load_exclusion_npis(client)
    print(f"Excluded NPIs (LEIE ∪ SAM, NPI-keyed): {len(excl)}")

    print(f"Scanning {SOURCE_CSV.name}...")
    matches: list[dict] = []
    total_suppliers = 0
    with open(SOURCE_CSV, newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            total_suppliers += 1
            npi = (row.get("Suplr_NPI") or "").strip()
            if npi not in excl:
                continue
            slot = excl[npi]
            name = " ".join(
                filter(None, [
                    row.get("Suplr_Prvdr_Last_Name_Org", ""),
                    row.get("Suplr_Prvdr_First_Name", ""),
                ])
            ).strip(", ")
            matches.append({
                "npi": npi,
                "name": name,
                "supplier_state": row.get("Suplr_Prvdr_State_Abrvtn", ""),
                "city": row.get("Suplr_Prvdr_City", ""),
                "specialty": row.get("Suplr_Prvdr_Spclty_Desc", ""),
                "medicare_paid_2023": float(row.get("Suplr_Mdcr_Pymt_Amt") or 0),
                "claims_2023": int(float(row.get("Tot_Suplr_Clms") or 0)),
                "services_2023": int(float(row.get("Tot_Suplr_Srvcs") or 0)),
                "beneficiaries_2023": int(float(row.get("Tot_Suplr_Benes") or 0)),
                "exclusion_source": "+".join(sorted(slot["sources"])),
                "leie_exclusion_date": slot.get("leie_date") or "",
                "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
                "sam_lookup_url": "https://sam.gov/search/?index=ex",
                "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{npi}",
            })

    matches.sort(key=lambda r: r["medicare_paid_2023"], reverse=True)
    print(f"DMEPOS suppliers in directory: {total_suppliers:,}")
    print(f"Suppliers on LEIE or SAM exclusion lists: {len(matches)}")

    # Per-state tally for breakdown
    state_counts = Counter(r["supplier_state"] for r in matches)
    va_matches = [r for r in matches if r["supplier_state"] == "VA"]

    # Write VA slice
    out_dir = STATES_DIR / "va"
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_out = out_dir / "h33-dmepos-excluded-va.csv"
    fields = [
        "npi", "name", "supplier_state", "city", "specialty",
        "medicare_paid_2023", "claims_2023", "services_2023", "beneficiaries_2023",
        "exclusion_source", "leie_exclusion_date",
        "leie_lookup_url", "sam_lookup_url", "nppes_lookup_url",
    ]
    with open(csv_out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in va_matches:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"Wrote VA slice: {csv_out} ({len(va_matches)} rows)")

    # Also write national CSV detail with all matches for context
    national_csv = FINDINGS_DIR / "dmepos-excluded-detail.csv"
    with open(national_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in matches:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"Wrote national: {national_csv} ({len(matches)} rows)")

    total_paid = sum(r["medicare_paid_2023"] for r in matches)
    total_va_paid = sum(r["medicare_paid_2023"] for r in va_matches)

    if len(matches) == 0:
        headline = (
            f"0 of {total_suppliers:,} active DMEPOS suppliers in the CMS "
            f"Medicare DME, Devices & Supplies by Supplier file (DY 2023) "
            f"appear on the active OIG LEIE ∪ SAM.gov exclusion list "
            f"({len(excl):,} excluded NPIs). This is the system working "
            f"correctly: DMEPOS enrollment screens federally-excluded NPIs "
            f"at the gate, which is what 42 CFR § 424.530(a)(2) and CMS "
            f"DMEPOS Supplier Standard 11 require. Worth publishing as a "
            f"reference point — when other federal program directories "
            f"(NDH, see H24/H25; state Medicaid spending, see H29) show "
            f"non-zero exposure, the DMEPOS zero is the comparison baseline."
        )
    else:
        headline = (
            f"{len(matches)} of {total_suppliers:,} active DMEPOS suppliers in "
            f"the CMS Medicare DME, Devices & Supplies by Supplier file "
            f"(DY 2023) appear on the active OIG LEIE or SAM.gov exclusion "
            f"list. Combined Medicare paid amount: ${total_paid:,.0f}. DMEPOS "
            f"has historically been the highest-fraud category in Medicare "
            f"(CMS imposed an enrollment moratorium in multiple states most "
            f"recently Florida, March 2026). {len(va_matches)} of the "
            f"{len(matches)} matched suppliers are VA-state, with VA-state "
            f"paid amount ${total_va_paid:,.0f}."
        )

    payload = {
        "slug": "dmepos-excluded",
        "title": "DMEPOS suppliers on federal exclusion lists",
        "hypotheses": ["H33"],
        "status": "published",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(matches),
        "denominator": total_suppliers,
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://data.cms.gov/provider-summary-by-type-of-service/medicare-durable-medical-equipment-devices-supplies-by-supplier",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": code, "value": count}
                for code, count in state_counts.most_common(10)
            ],
        },
        "notes": (
            f"This is a national finding — DMEPOS supplier directory is itself "
            f"the population, joined against the active LEIE ∪ SAM NPI set "
            f"({len(excl)} NPIs). Per-state breakdown chart shows the top 10 "
            f"states by matched supplier count. Virginia-state slice at "
            f"/api/v1/states/va/h33-dmepos-excluded-va.csv ({len(va_matches)} "
            f"rows) for state PI triage. Full national CSV with all "
            f"{len(matches)} matched suppliers at "
            f"/api/v1/findings/dmepos-excluded-detail.csv."
        ),
    }

    payload_path = FINDINGS_DIR / "dmepos-excluded.json"
    payload_path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {payload_path}")

    detail = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total_suppliers": total_suppliers,
        "matched_suppliers": len(matches),
        "matched_va_suppliers": len(va_matches),
        "total_paid_2023": total_paid,
        "total_va_paid_2023": total_va_paid,
        "top_states_by_matches": [
            {"state": s, "matches": c} for s, c in state_counts.most_common(15)
        ],
        "top_10_matched_nationally": [
            {k: r.get(k) for k in (
                "npi", "name", "supplier_state", "city", "specialty",
                "medicare_paid_2023", "claims_2023", "beneficiaries_2023",
                "exclusion_source", "leie_exclusion_date",
            )}
            for r in matches[:10]
        ],
        "csv_url_national": "/api/v1/findings/dmepos-excluded-detail.csv",
        "csv_url_va": "/api/v1/states/va/h33-dmepos-excluded-va.csv",
    }
    detail_path = FINDINGS_DIR / "dmepos-excluded-detail.json"
    detail_path.write_text(json.dumps(detail, indent=2) + "\n")
    print(f"Wrote {detail_path}")

    print("\nTop 10 nationally:")
    for r in matches[:10]:
        print(f"  {r['npi']}  {r['name'][:30]:30s} {r['supplier_state']}  ${r['medicare_paid_2023']:>12,.0f}  {r['exclusion_source']}")


if __name__ == "__main__":
    main()
