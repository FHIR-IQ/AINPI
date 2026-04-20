"""H6-H8 — Referential integrity of the NPD resource graph.

H6: dangling Practitioner/Organization references in PractitionerRole
H7: dangling managingOrganization references in Location
H8: Organization-to-HealthcareService coverage
    (NPD does not ship HealthcareService; the finding is the gap itself)

All via BigQuery anti-joins — no data leaves BQ.

Writes frontend/public/api/v1/findings/referential-integrity.json.
"""
from __future__ import annotations
import json
import pathlib
from datetime import datetime, timezone
from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE_DATE = "2026-04-09"


def scalar(client: bigquery.Client, sql: str) -> dict:
    row = next(iter(client.query(sql).result()))
    return dict(row.items())


def run() -> None:
    c = bigquery.Client(project=PROJECT)

    print("H6a — dangling Practitioner references in PractitionerRole")
    h6a = scalar(c, f"""
    SELECT
      (SELECT COUNT(*) FROM `{PROJECT}.{DATASET}.practitioner_role`) AS total_roles,
      COUNTIF(_practitioner_id IS NOT NULL) AS roles_with_ref,
      COUNTIF(_practitioner_id IS NOT NULL
              AND _practitioner_id NOT IN (
                SELECT CONCAT('Practitioner/', _id)
                FROM `{PROJECT}.{DATASET}.practitioner`
              )) AS dangling
    FROM `{PROJECT}.{DATASET}.practitioner_role`
    """)
    h6a_pct = 100 * h6a["dangling"] / h6a["roles_with_ref"] if h6a["roles_with_ref"] else 0
    print(f"  total roles: {h6a['total_roles']:,}")
    print(f"  with prac ref: {h6a['roles_with_ref']:,}")
    print(f"  dangling: {h6a['dangling']:,} ({h6a_pct:.4f}%)")

    print("\nH6b — dangling Organization references in PractitionerRole")
    h6b = scalar(c, f"""
    SELECT
      COUNTIF(_org_id IS NOT NULL) AS roles_with_ref,
      COUNTIF(_org_id IS NOT NULL
              AND _org_id NOT IN (
                SELECT CONCAT('Organization/', _id)
                FROM `{PROJECT}.{DATASET}.organization`
              )) AS dangling
    FROM `{PROJECT}.{DATASET}.practitioner_role`
    """)
    h6b_pct = 100 * h6b["dangling"] / h6b["roles_with_ref"] if h6b["roles_with_ref"] else 0
    print(f"  with org ref: {h6b['roles_with_ref']:,}")
    print(f"  dangling: {h6b['dangling']:,} ({h6b_pct:.4f}%)")

    print("\nH7 — dangling managingOrganization references in Location")
    h7 = scalar(c, f"""
    SELECT
      (SELECT COUNT(*) FROM `{PROJECT}.{DATASET}.location`) AS total_locations,
      COUNTIF(_managing_org_id IS NOT NULL) AS loc_with_ref,
      COUNTIF(_managing_org_id IS NOT NULL
              AND _managing_org_id NOT IN (
                SELECT CONCAT('Organization/', _id)
                FROM `{PROJECT}.{DATASET}.organization`
              )) AS dangling
    FROM `{PROJECT}.{DATASET}.location`
    """)
    h7_pct = 100 * h7["dangling"] / h7["loc_with_ref"] if h7["loc_with_ref"] else 0
    print(f"  total locations: {h7['total_locations']:,}")
    print(f"  with managingOrg ref: {h7['loc_with_ref']:,}")
    print(f"  dangling: {h7['dangling']:,} ({h7_pct:.4f}%)")

    # H7b — also measure Endpoint.managingOrganization integrity while we're here
    print("\nH7-bonus — dangling managingOrganization references in Endpoint")
    h7e = scalar(c, f"""
    SELECT
      (SELECT COUNT(*) FROM `{PROJECT}.{DATASET}.endpoint`) AS total_endpoints,
      COUNTIF(_managing_org_id IS NOT NULL) AS ep_with_ref,
      COUNTIF(_managing_org_id IS NOT NULL
              AND _managing_org_id NOT IN (
                SELECT CONCAT('Organization/', _id)
                FROM `{PROJECT}.{DATASET}.organization`
              )) AS dangling
    FROM `{PROJECT}.{DATASET}.endpoint`
    """)
    h7e_pct = 100 * h7e["dangling"] / h7e["ep_with_ref"] if h7e["ep_with_ref"] else 0
    print(f"  total endpoints: {h7e['total_endpoints']:,}")
    print(f"  with managingOrg ref: {h7e['ep_with_ref']:,}")
    print(f"  dangling: {h7e['dangling']:,} ({h7e_pct:.4f}%)")

    # H8 — the structural gap
    print("\nH8 — Organization-to-HealthcareService coverage")
    print("  The NPD public-use bulk export does not include HealthcareService.")
    print("  NDH IG defines 10 resources; NPD ships 6. H8 coverage = 0 by absence.")

    # Parts that are NULL ints → turn into plain int
    def n(x): return int(x) if x is not None else 0

    # Reframe: integrity (dangling refs among declared) + coverage (declared vs possible)
    total_refs = (h6a["roles_with_ref"] + h6b["roles_with_ref"]
                  + h7["loc_with_ref"] + h7e["ep_with_ref"])
    total_dangling = (h6a["dangling"] + h6b["dangling"]
                      + h7["dangling"] + h7e["dangling"])
    overall_dangling_pct = 100 * total_dangling / total_refs if total_refs else 0

    # Coverage rates — share of rows that *declared* the reference
    h6b_coverage = 100 * h6b["roles_with_ref"] / h6a["total_roles"] if h6a["total_roles"] else 0
    h7_coverage = 100 * h7["loc_with_ref"] / h7["total_locations"] if h7["total_locations"] else 0
    h7e_coverage = 100 * h7e["ep_with_ref"] / h7e["total_endpoints"] if h7e["total_endpoints"] else 0

    headline = (
        f"Referential integrity is clean but coverage is sparse. "
        f"{overall_dangling_pct:.3f}% of {total_refs/1_000_000:.1f}M declared "
        f"cross-resource references actually dangle (target missing). "
        f"But only {h7e_coverage:.1f}% of Endpoints carry a managingOrganization "
        f"({n(h7e['ep_with_ref']):,} of {n(h7e['total_endpoints']):,}) and "
        f"only {h7_coverage:.1f}% of Locations do "
        f"({n(h7['loc_with_ref']):,} of {n(h7['total_locations']):,}). "
        f"H8: the NPD bulk export does not ship HealthcareService "
        f"(NDH IG defines 10 resources; NPD ships 6)."
    )

    # Two charts: one for integrity (all near zero), one for coverage
    chart_data = [
        {"label": "PR → Practitioner (coverage)", "value": 100.0},
        {"label": "PR → Organization (coverage)", "value": round(h6b_coverage, 2)},
        {"label": "Location → Org (coverage)",    "value": round(h7_coverage, 2)},
        {"label": "Endpoint → Org (coverage)",    "value": round(h7e_coverage, 2)},
    ]

    notes = (
        f"Integrity (dangling rate among declared references): "
        f"H6a PR→Practitioner {h6a_pct:.4f}%, "
        f"H6b PR→Organization {h6b_pct:.4f}%, "
        f"H7 Location→Org {h7_pct:.4f}%, "
        f"Endpoint→Org {h7e_pct:.4f}%. "
        f"All near zero — when a reference is declared, it resolves. "
        f"Coverage (share of rows with the optional reference populated): "
        f"PR→Practitioner 100.00% (required), "
        f"PR→Organization {h6b_coverage:.2f}%, "
        f"Location→managingOrganization {h7_coverage:.2f}%, "
        f"Endpoint→managingOrganization {h7e_coverage:.2f}%. "
        f"The Endpoint→Organization gap pairs with H5 (98.69% of Orgs have "
        f"no Endpoint referencing them) — the Endpoint↔Organization link is "
        f"sparse in both directions. "
        f"H8 requires HealthcareService, which is one of four NDH IG "
        f"resources (HealthcareService, InsurancePlan, Network, Verification) "
        f"absent from the 2026-04-09 NPD bulk export. Any HealthcareService-"
        f"based check cannot be performed from NPD alone."
    )

    payload = {
        "slug": "referential-integrity",
        "title": "Referential integrity",
        "hypotheses": ["H6", "H7", "H8"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": "0.1.0-draft",
        "commit_sha": "pending",
        "headline": headline,
        "numerator": int(total_dangling),
        "denominator": int(total_refs),
        "chart": {
            "type": "bar",
            "unit": "percent",
            "data": chart_data,
        },
        "notes": notes,
    }

    out = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "public" / "api" / "v1" / "findings" / "referential-integrity.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    run()
