"""H30b — Federally excluded VA-resident NPIs still prescribing Medicare Part D.

Joins the 125-NPI VA federally-excluded cohort against the CMS
Medicare Part D Prescribers by Provider file (CY 2023, NPI-aggregated).

Part D adds the prescribing dimension: an excluded prescriber writing
reimbursed prescriptions. LEIE binding under 42 USC § 1320a-7 covers
Part D the same way it covers Part B.

Source file:
    MUP_DPR_RY25_P04_V10_DY23_NPI.csv
    (~130 MB CSV, NPI-aggregated, one row per prescriber for CY 2023)

Writes:
    frontend/public/api/v1/findings/excluded-prescribing-medicare-partd.json
    frontend/public/api/v1/states/va/h30b-excluded-prescribing-partd.csv
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from datetime import datetime, timezone

METHODOLOGY_VERSION = "0.6.0-draft"
DATA_SOURCE_RELEASE = "CY 2023 (RY2025 P04)"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SOURCE_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "partd-by-provider.csv"
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


def main() -> None:
    cohort_csv = STATES_DIR / "va-cohort-critical.csv"
    cohort = {r["npi"]: r for r in csv.DictReader(open(cohort_csv)) if r.get("npi")}
    npis = set(cohort.keys())
    print(f"VA cohort: {len(npis)} NPIs")

    matches: list[dict] = []
    with open(SOURCE_CSV, newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            npi = (row.get("PRSCRBR_NPI") or "").strip()
            if not npi or npi not in npis:
                continue
            cohort_row = cohort.get(npi, {})
            drug_cost = float(row.get("Tot_Drug_Cst") or 0)
            claims = int(float(row.get("Tot_Clms") or 0)) if row.get("Tot_Clms") else None
            benes = int(float(row.get("Tot_Benes") or 0)) if row.get("Tot_Benes") else None
            opioid_claims = int(float(row.get("Opioid_Tot_Clms") or 0)) if row.get("Opioid_Tot_Clms") else None
            opioid_cost = float(row.get("Opioid_Tot_Drug_Cst") or 0)
            matches.append({
                "npi": npi,
                "name": cohort_row.get("name", ""),
                "prescribing_state": row.get("Prscrbr_State_Abrvtn", ""),
                "drug_cost_2023": round(drug_cost, 2),
                "claims_2023": claims if claims is not None else "",
                "beneficiaries_2023": benes if benes is not None else "",
                "opioid_claims_2023": opioid_claims if opioid_claims is not None else "",
                "opioid_cost_2023": round(opioid_cost, 2) if opioid_cost else "",
                "exclusion_source": cohort_row.get("reasons", ""),
                "score": cohort_row.get("score", ""),
                "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
                "sam_lookup_url": "https://sam.gov/search/?index=ex",
                "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{npi}",
            })

    matches.sort(key=lambda r: r["drug_cost_2023"], reverse=True)
    print(f"VA-cohort NPIs prescribing Medicare Part D in CY 2023: {len(matches)}")

    out_dir = STATES_DIR / "va"
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_out = out_dir / "h30b-excluded-prescribing-partd.csv"
    fields = [
        "npi", "name", "prescribing_state", "drug_cost_2023", "claims_2023",
        "beneficiaries_2023", "opioid_claims_2023", "opioid_cost_2023",
        "exclusion_source", "score",
        "leie_lookup_url", "sam_lookup_url", "nppes_lookup_url",
    ]
    with open(csv_out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in matches:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"Wrote {csv_out}")

    total_cost = sum(r["drug_cost_2023"] for r in matches)
    total_opioid_claims = sum(int(r["opioid_claims_2023"] or 0) for r in matches if r["opioid_claims_2023"])
    opioid_prescribers = sum(1 for r in matches if r["opioid_claims_2023"])

    headline = (
        f"{len(matches)} of {len(npis)} currently-active federally-excluded "
        f"VA-resident NPIs prescribed Medicare Part D in CY 2023 — total "
        f"drug cost ${total_cost:,.0f}. {opioid_prescribers} of those "
        f"{len(matches)} were opioid prescribers, writing {total_opioid_claims:,} "
        f"opioid claims for the year, per the CMS Medicare Part D Prescribers "
        f"by Provider file ({DATA_SOURCE_RELEASE}). LEIE binds across all "
        f"federal programs (42 USC § 1320a-7) — a Part D prescribing match "
        f"is a federal compliance signal regardless of state of practice."
    )

    payload = {
        "slug": "excluded-prescribing-medicare-partd",
        "title": "Federally excluded VA-resident NPIs prescribing Medicare Part D (CY 2023)",
        "hypotheses": ["H30", "H30b"],
        "status": "published",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(matches),
        "denominator": len(npis),
        "denominator_note": (
            f"VA federally-excluded cohort (125 NPIs, active LEIE or SAM, "
            f"score >= 1.5; VA-resident per NPPES practice state). The Part D "
            f"file is itself national; cohort matches reflect prescribing "
            f"anywhere in the US."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://data.cms.gov/provider-summary-by-type-of-service/medicare-part-d-prescribers",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "VA cohort prescribing Part D", "value": len(matches)},
                {"label": "of which prescribed opioids", "value": opioid_prescribers},
            ],
        },
        "notes": (
            "Per-state CSV at /api/v1/states/va/h30b-excluded-prescribing-partd.csv "
            "with drug cost + claims + beneficiaries + opioid metrics + "
            "exclusion source. Opioid prescribing by federally-excluded NPIs is "
            "a particularly elevated signal because the 21st Century Cures Act "
            "and 2018 SUPPORT Act extended controlled-substance enforcement to "
            "specifically cover Medicaid/Medicare prescribers; this should feed "
            "directly into state PI + DEA referral queues."
        ),
    }

    out = FINDINGS_DIR / "excluded-prescribing-medicare-partd.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {out}")

    for r in matches[:5]:
        opioid = f"opioid={r['opioid_claims_2023']}clms ${r['opioid_cost_2023']:,}" if r['opioid_claims_2023'] else "(non-opioid)"
        print(f"  {r['npi']}  {r['name'][:25]:25s}  ${r['drug_cost_2023']:>10,.0f}  {opioid}")


if __name__ == "__main__":
    main()
