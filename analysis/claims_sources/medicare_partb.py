"""H30a — Federally excluded VA-resident NPIs still billing Medicare Part B.

Joins the 125-NPI VA federally-excluded cohort against the CMS
Medicare Physician & Other Practitioners by Provider file
(CY 2023, NPI-aggregated, MUP_PHY_R25_P05_V20_D23_Prov.csv).

LEIE exclusions bind across all federal programs (42 USC 1320a-7).
A match here = the federal directory says the provider is enrolled to
bill Medicare AND the federal exclusion list says they shouldn't be.

Source file:
    https://data.cms.gov/sites/default/files/2025-04/
        22edfd1e-d17a-4478-ad6b-92cac2a5a3c4/MUP_PHY_R25_P05_V20_D23_Prov.csv
    (~270 MB CSV, NPI-aggregated; one row per NPI for CY 2023)

Writes:
    frontend/public/api/v1/findings/excluded-billing-medicare-partb.json
    frontend/public/api/v1/states/va/h30a-excluded-billing-partb.csv
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from datetime import datetime, timezone

METHODOLOGY_VERSION = "0.6.0-draft"
DATA_SOURCE_RELEASE = "CY 2023 (RY2025 P05)"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SOURCE_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "partb-by-provider.csv"
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
            npi = (row.get("Rndrng_NPI") or "").strip()
            if not npi or npi not in npis:
                continue
            cohort_row = cohort.get(npi, {})
            paid = float(row.get("Tot_Mdcr_Pymt_Amt") or 0)
            allowed = float(row.get("Tot_Mdcr_Alowd_Amt") or 0)
            services = int(float(row.get("Tot_Srvcs") or 0)) if row.get("Tot_Srvcs") else None
            benes = int(float(row.get("Tot_Benes") or 0)) if row.get("Tot_Benes") else None
            matches.append({
                "npi": npi,
                "name": cohort_row.get("name", ""),
                "billing_state": row.get("Rndrng_Prvdr_State_Abrvtn", ""),
                "medicare_paid_2023": round(paid, 2),
                "medicare_allowed_2023": round(allowed, 2),
                "services_2023": services if services is not None else "",
                "beneficiaries_2023": benes if benes is not None else "",
                "provider_type": row.get("Rndrng_Prvdr_Type", ""),
                "exclusion_source": cohort_row.get("reasons", ""),
                "score": cohort_row.get("score", ""),
                "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
                "sam_lookup_url": "https://sam.gov/search/?index=ex",
                "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{npi}",
            })

    matches.sort(key=lambda r: r["medicare_paid_2023"], reverse=True)
    print(f"VA-cohort NPIs billing Medicare Part B in CY 2023: {len(matches)}")

    # State CSV
    out_dir = STATES_DIR / "va"
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_out = out_dir / "h30a-excluded-billing-partb.csv"
    fields = [
        "npi", "name", "billing_state", "medicare_paid_2023", "medicare_allowed_2023",
        "services_2023", "beneficiaries_2023", "provider_type",
        "exclusion_source", "score",
        "leie_lookup_url", "sam_lookup_url", "nppes_lookup_url",
    ]
    with open(csv_out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in matches:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"Wrote {csv_out}")

    total_paid = sum(r["medicare_paid_2023"] for r in matches)
    total_services = sum(int(r["services_2023"] or 0) for r in matches if r["services_2023"])
    headline = (
        f"{len(matches)} of {len(npis)} currently-active federally-excluded "
        f"VA-resident NPIs billed Medicare Part B in CY 2023 — total paid "
        f"${total_paid:,.0f} on {total_services:,} services, per the CMS "
        f"Medicare Physician & Other Practitioners by Provider file "
        f"({DATA_SOURCE_RELEASE}). LEIE exclusions bind across all federal "
        f"programs (42 USC § 1320a-7), so any Part B billing by these NPIs "
        f"is a direct federal compliance signal regardless of which state "
        f"Medicaid program also paid them (see H29)."
    )

    payload = {
        "slug": "excluded-billing-medicare-partb",
        "title": "Federally excluded VA-resident NPIs billing Medicare Part B (CY 2023)",
        "hypotheses": ["H30", "H30a"],
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
            f"score >= 1.5; VA-resident per NPPES practice state). The Part B "
            f"file is itself national; VA-cohort matches reflect billing "
            f"anywhere in the US, not VA-specific billing."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "VA cohort NPIs billing Part B", "value": len(matches)},
                {"label": "VA cohort NPIs not billing Part B", "value": max(0, len(npis) - len(matches))},
            ],
        },
        "notes": (
            "Per-state CSV at /api/v1/states/va/h30a-excluded-billing-partb.csv "
            "carries one row per matched NPI with paid + allowed + services + "
            "beneficiaries + provider type + exclusion source. Same VA-pilot "
            "operational courtesy as H29: DMAS gets 5-business-day review "
            "before each refresh — operational, not a publication gate."
        ),
    }

    out = FINDINGS_DIR / "excluded-billing-medicare-partb.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {out}")

    # Print top 5
    for r in matches[:5]:
        print(f"  {r['npi']}  {r['name'][:25]:25s}  ${r['medicare_paid_2023']:>12,.0f}  {r['services_2023']} svcs  {r['billing_state']}")


if __name__ == "__main__":
    main()
