"""H36 — High-volume Medicare billers absent from NDH (directory completeness).

The NDH is meant to be the federal source of truth on provider identity.
Material billers absent from NDH are a directory-side failure of the
federal system, distinct from H10 (NPPES match rate) and worth
surfacing.

Method:
    1. Load every NPI from the AINPI NDH practitioner table into a set.
    2. Stream the Medicare Part B by-Provider file (CY 2023, ~1.25M NPIs).
    3. For each NPI absent from NDH, capture name, state, paid amount,
       services, provider type.
    4. Surface the "material" cohort = NPIs absent from NDH with paid
       amount above a threshold. Default threshold $10K — caller can
       override.

Source files:
    cms_npd.practitioner (BigQuery; latest NDH release)
    MUP_PHY_R25_P05_V20_D23_Prov.csv (CY 2023, ~270 MB)

Writes:
    frontend/public/api/v1/findings/ndh-completeness-gap.json
    frontend/public/api/v1/findings/ndh-completeness-gap-detail.json
    frontend/public/api/v1/findings/ndh-completeness-gap-detail.csv
    frontend/public/api/v1/states/va/h36-billers-absent-from-ndh.csv
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
DATA_SOURCE_RELEASE = "CY 2023 (RY2025 P05) Part B × NDH 2026-05-08"
PROJECT = "thematic-fort-453901-t7"
MATERIAL_THRESHOLD = 10_000  # paid USD

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
PARTB_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "partb-by-provider.csv"
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


def load_ndh_npis() -> set[str]:
    """Load all NDH NPIs (practitioner ∪ organization) as a Python set.

    Part B billing NPIs can be either individuals (entity_type=1, NDH
    practitioner table) or organizations (entity_type=2, NDH organization
    table — big labs, IDTFs, group practices billing in aggregate). To
    measure "absent from NDH" honestly we need the union of both NDH
    NPI sets.
    """
    client = bigquery.Client(project=PROJECT)
    print("Loading NDH practitioner + organization NPIs from BigQuery...")
    sql = """
    SELECT DISTINCT _npi FROM `thematic-fort-453901-t7.cms_npd.practitioner` WHERE _npi IS NOT NULL
    UNION DISTINCT
    SELECT DISTINCT _npi FROM `thematic-fort-453901-t7.cms_npd.organization` WHERE _npi IS NOT NULL
    """
    ndh = {row._npi for row in client.query(sql).result()}
    print(f"  loaded {len(ndh):,} NDH NPIs (practitioner ∪ organization)")
    return ndh


def main() -> None:
    ndh = load_ndh_npis()

    print(f"\nScanning {PARTB_CSV.name}...")
    absent: list[dict] = []
    total_partb = 0
    total_paid_absent = 0.0
    with open(PARTB_CSV, newline="") as fh:
        for row in csv.DictReader(fh):
            total_partb += 1
            npi = (row.get("Rndrng_NPI") or "").strip()
            if npi in ndh:
                continue
            paid = float(row.get("Tot_Mdcr_Pymt_Amt") or 0)
            services = int(float(row.get("Tot_Srvcs") or 0)) if row.get("Tot_Srvcs") else 0
            absent.append({
                "npi": npi,
                "name": " ".join(filter(None, [
                    row.get("Rndrng_Prvdr_Last_Org_Name", ""),
                    row.get("Rndrng_Prvdr_First_Name", ""),
                ])).strip(", "),
                "billing_state": row.get("Rndrng_Prvdr_State_Abrvtn", ""),
                "provider_type": row.get("Rndrng_Prvdr_Type", ""),
                "entity_type": row.get("Rndrng_Prvdr_Ent_Cd", ""),  # I=individual, O=organization
                "medicare_paid_2023": round(paid, 2),
                "medicare_allowed_2023": round(float(row.get("Tot_Mdcr_Alowd_Amt") or 0), 2),
                "services_2023": services,
                "beneficiaries_2023": int(float(row.get("Tot_Benes") or 0)) if row.get("Tot_Benes") else 0,
                "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{npi}",
            })
            total_paid_absent += paid

    print(f"\nPart B billing NPIs in CY 2023:       {total_partb:,}")
    print(f"Absent from NDH:                       {len(absent):,}")
    print(f"  total paid amount:                   ${total_paid_absent:,.0f}")
    material = [r for r in absent if r["medicare_paid_2023"] >= MATERIAL_THRESHOLD]
    print(f"Material absences (paid >= ${MATERIAL_THRESHOLD:,}): {len(material):,}")
    total_paid_material = sum(r["medicare_paid_2023"] for r in material)
    print(f"  material paid amount:                ${total_paid_material:,.0f}")

    # Entity type breakdown
    entity_breakdown = defaultdict(int)
    for r in material:
        entity_breakdown[r["entity_type"] or "(blank)"] += 1
    print(f"  by entity type: {dict(entity_breakdown)}")

    state_breakdown: dict[str, int] = defaultdict(int)
    for r in material:
        state_breakdown[r["billing_state"] or "(unknown)"] += 1

    material.sort(key=lambda r: r["medicare_paid_2023"], reverse=True)

    # National + VA outputs
    va_material = [r for r in material if r["billing_state"] == "VA"]
    fields = [
        "npi", "name", "billing_state", "provider_type", "entity_type",
        "medicare_paid_2023", "medicare_allowed_2023",
        "services_2023", "beneficiaries_2023", "nppes_lookup_url",
    ]
    national_csv = FINDINGS_DIR / "ndh-completeness-gap-detail.csv"
    with open(national_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in material:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"Wrote national: {national_csv} ({len(material):,} rows)")

    out_dir = STATES_DIR / "va"
    out_dir.mkdir(parents=True, exist_ok=True)
    va_csv = out_dir / "h36-billers-absent-from-ndh.csv"
    with open(va_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in va_material:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"Wrote VA: {va_csv} ({len(va_material):,} rows)")

    headline = (
        f"{len(material):,} of {total_partb:,} Medicare Part B billing NPIs in "
        f"CY 2023 ({100*len(material)/total_partb:.2f}%) are absent from "
        f"NDH (practitioner ∪ organization tables, 2026-05-08 release) "
        f"AND billed ≥ ${MATERIAL_THRESHOLD:,} in Medicare Part B. Combined "
        f"paid amount: ${total_paid_material:,.0f}. The NDH is the federal "
        f"source of truth on provider identity; material Medicare billers "
        f"absent from NDH are a directory-side completeness gap distinct "
        f"from H10's NPPES-match-rate signal. {len(va_material)} of the "
        f"material absences bill from a VA-state address. Entity-type "
        f"breakdown in the material cohort: {dict(entity_breakdown)} "
        f"(O=organization, I=individual)."
    )

    payload = {
        "slug": "ndh-completeness-gap",
        "title": "High-volume Medicare billers absent from NDH (directory completeness)",
        "hypotheses": ["H36"],
        "status": "published",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(material),
        "denominator": total_partb,
        "denominator_note": (
            f"Denominator = every NPI in the Medicare Physician & Other "
            f"Practitioners by Provider file for CY 2023 ({total_partb:,}). "
            f"Numerator = NPIs absent from NDH with Medicare paid amount "
            f"≥ ${MATERIAL_THRESHOLD:,} in CY 2023. The full absent set "
            f"(any paid amount) is {len(absent):,} NPIs — the material "
            f"threshold filter removes the long tail of small-volume "
            f"absences that are mostly NDH-out-of-scope provider types."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "Part B NPIs absent from NDH (material)", "value": len(material)},
                {"label": "of which entity_type=2 (org)", "value": entity_breakdown.get("O", 0)},
                {"label": "of which entity_type=1 (individual)", "value": entity_breakdown.get("I", 0)},
            ],
        },
        "notes": (
            "NDH NPI set = UNION of cms_npd.practitioner._npi and "
            "cms_npd.organization._npi. Part B billing NPIs can be either "
            "individuals (entity_type=1, NDH practitioner table) or "
            "organizations (entity_type=2, NDH organization table — big "
            "labs, IDTFs, group practices billing in aggregate). Joining "
            "against just practitioners would over-count absences with "
            "entity_type=2 NPIs that ARE in NDH-organization. The union "
            "join produces the honest completeness gap. Per-state CSV at "
            "/api/v1/states/va/h36-billers-absent-from-ndh.csv carries "
            "the Virginia subset for state PI triage; national rollup at "
            "/api/v1/findings/ndh-completeness-gap-detail.csv. Verify "
            "individual NPIs at the NPPES Registry to distinguish "
            "true directory-completeness gaps from out-of-scope billers."
        ),
    }

    out = FINDINGS_DIR / "ndh-completeness-gap.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {out}")

    detail = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "part_b_total_npis": total_partb,
        "absent_from_ndh_any": len(absent),
        "absent_from_ndh_material": len(material),
        "material_threshold_usd": MATERIAL_THRESHOLD,
        "total_paid_absent_any": total_paid_absent,
        "total_paid_absent_material": total_paid_material,
        "entity_type_breakdown_material": dict(entity_breakdown),
        "top_states_by_material_absences": [
            {"state": s, "matches": c}
            for s, c in sorted(state_breakdown.items(), key=lambda kv: kv[1], reverse=True)[:15]
        ],
        "top_10_material_absences_nationally": [
            {k: r.get(k) for k in (
                "npi", "name", "billing_state", "provider_type", "entity_type",
                "medicare_paid_2023", "services_2023", "beneficiaries_2023",
            )}
            for r in material[:10]
        ],
        "va_material_absences": len(va_material),
        "csv_url_national": "/api/v1/findings/ndh-completeness-gap-detail.csv",
        "csv_url_va": "/api/v1/states/va/h36-billers-absent-from-ndh.csv",
    }
    (FINDINGS_DIR / "ndh-completeness-gap-detail.json").write_text(json.dumps(detail, indent=2) + "\n")
    print(f"Wrote {FINDINGS_DIR / 'ndh-completeness-gap-detail.json'}")

    print("\nTop 10 nationally (material):")
    for r in material[:10]:
        print(f"  {r['npi']}  {r['name'][:35]:35s}  {r['billing_state']:2s}  ${r['medicare_paid_2023']:>14,.0f}  ent={r['entity_type']}  {r['provider_type']}")


if __name__ == "__main__":
    main()
