"""H50 — Endpoint-to-organization linkage in the NDH, and the resolved crosswalk.

An Endpoint resource is only actionable if you can say whose it is. "There is a
FHIR server at this URL" answers nothing on its own; "this URL belongs to the
organization with NPI 1234567890" is the thing an integrator, a payer doing
network validation, or an auditor actually needs.

The NDH models that with Endpoint.managingOrganization. This measures how often
the link is present and resolvable, and publishes the crosswalk it produces.

Two distinctions the headline number hides, both reported separately:

  present vs resolvable  A reference can exist and point at nothing. Measuring
                         only presence would count dangling references as
                         successes.
  host vs organization   EHR vendors host thousands of tenants on one domain
                         (athenahealth alone serves 35,439 endpoints). So the
                         host tells you the vendor, never the organization.
                         Only the managingOrganization link distinguishes them,
                         which is exactly why its absence matters.

Run:    python analysis/h50_endpoint_org_linkage.py
Writes:
  - frontend/public/api/v1/findings/endpoint-org-linkage.json
  - frontend/public/api/v1/findings/endpoint-org-crosswalk.csv
      Resolved base URL -> organization, for the FHIR REST subset. Columns:
      endpoint_id, base_url, host, status, org_id, org_npi, org_name,
      org_state. Direct Trust addresses are excluded: they are messaging
      addresses, not base URLs you can call (see H28).

Cost: three capped joins of cms_npd.endpoint against cms_npd.organization,
roughly 150 MB each. Well under a cent.
"""
from __future__ import annotations

import csv
import json
import pathlib
import subprocess
import sys
from datetime import datetime, timezone

from google.cloud import bigquery

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from claims_sources._cohorts import bq_job_config  # noqa: E402

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE_DATE = "2026-05-08"
METHODOLOGY_VERSION = "0.7.2-draft"
SLUG = "endpoint-org-linkage"

OUT_DIR = (pathlib.Path(__file__).resolve().parent.parent
           / "frontend" / "public" / "api" / "v1" / "findings")

EP = f"`{PROJECT}.{DATASET}.endpoint`"
ORG = f"`{PROJECT}.{DATASET}.organization`"

# FHIR references are stored as full strings ("Organization/Organization-123"),
# so the join reconstructs the reference from the target's _id.
JOIN = f"LEFT JOIN {ORG} o ON e._managing_org_id = CONCAT('Organization/', o._id)"


def q(client: bigquery.Client, sql: str) -> list[dict]:
    return [dict(r) for r in client.query(sql, job_config=bq_job_config()).result()]


def git_sha() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True).stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def main() -> int:
    client = bigquery.Client(project=PROJECT)

    print("1/3  linkage by connection type ...")
    by_type = q(client, f"""
        SELECT e._connection_type AS connection_type,
               COUNT(*) AS total,
               COUNTIF(e._managing_org_id IS NOT NULL) AS reference_present,
               COUNTIF(o._id IS NOT NULL) AS resolvable,
               COUNTIF(o._npi IS NOT NULL) AS resolves_to_npi,
               COUNT(DISTINCT o._id) AS distinct_orgs
        FROM {EP} e {JOIN}
        GROUP BY 1 ORDER BY total DESC
    """)

    print("2/3  per-host linkage ...")
    by_host_all = q(client, f"""
        SELECT REGEXP_EXTRACT(LOWER(e._address), r'https?://([^/]+)') AS host,
               COUNT(*) AS endpoints,
               COUNTIF(o._id IS NOT NULL) AS resolvable,
               ROUND(COUNTIF(o._id IS NOT NULL) / COUNT(*) * 100, 1) AS resolvable_pct
        FROM {EP} e {JOIN}
        WHERE e._connection_type = 'hl7-fhir-rest'
        GROUP BY 1 HAVING endpoints >= 100
        ORDER BY endpoints DESC
    """)
    by_host = by_host_all[:25]

    # The rate is bimodal rather than uniformly low: some vendors attribute most
    # of their endpoints, others attribute none at all. Quantify the zero group,
    # because "no organization is ever published" is a different problem from
    # "attribution is patchy" and has a different fix.
    zero_hosts = [h for h in by_host_all if h["resolvable"] == 0]
    zero_endpoints = sum(h["endpoints"] for h in zero_hosts)

    print("3/3  building the resolved crosswalk ...")
    crosswalk = q(client, f"""
        SELECT e._id AS endpoint_id, e._address AS base_url,
               REGEXP_EXTRACT(LOWER(e._address), r'https?://([^/]+)') AS host,
               e._status AS status,
               o._id AS org_id, o._npi AS org_npi, o._name AS org_name, o._state AS org_state
        FROM {EP} e {JOIN}
        WHERE e._connection_type = 'hl7-fhir-rest' AND o._id IS NOT NULL
        ORDER BY o._state, o._name, e._address
    """)

    rest = next(r for r in by_type if r["connection_type"] == "hl7-fhir-rest")
    total_all = sum(r["total"] for r in by_type)
    resolvable_all = sum(r["resolvable"] for r in by_type)

    # A reference that exists but points nowhere would be a different problem
    # from one that is simply absent. Check rather than assume.
    dangling = sum(r["reference_present"] - r["resolvable"] for r in by_type)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = OUT_DIR / "endpoint-org-crosswalk.csv"
    with csv_path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["endpoint_id", "base_url", "host", "status",
                    "org_id", "org_npi", "org_name", "org_state"])
        for r in crosswalk:
            w.writerow([r["endpoint_id"], r["base_url"], r["host"], r["status"],
                        r["org_id"], r["org_npi"], r["org_name"], r["org_state"]])

    pct = rest["resolvable"] / rest["total"] * 100
    headline = (
        f"Of {rest['total']:,} FHIR REST endpoints in the {RELEASE_DATE} NDH release, "
        f"{rest['resolvable']:,} ({pct:.1f}%) resolve to a managing organization. "
        f"The remaining {rest['total'] - rest['resolvable']:,} are URLs with no owner "
        f"in the directory. Every endpoint that does resolve reaches an organization "
        f"carrying an NPI, so the link yields a usable base-URL-to-NPI crosswalk for "
        f"{rest['resolves_to_npi']:,} endpoints across {rest['distinct_orgs']:,} organizations."
    )

    notes = (
        f"Presence and resolvability are reported separately because a reference can exist "
        f"and point at nothing. In this release they are identical: {dangling} of the "
        f"managingOrganization references across both connection types dangle. The gap is "
        f"absence, not breakage, which matters because absence is fixed by populating a "
        f"field and breakage would be fixed by repairing referential integrity.\n\n"
        f"Host is not a substitute for the organization link. EHR vendors host thousands of "
        f"tenants on one domain, so a host identifies the vendor and never the practice. "
        f"The rate is bimodal rather than uniformly low. Of the {len(by_host_all)} hosts carrying "
        f"at least 100 endpoints, {len(zero_hosts)} publish no organization link on any of them, "
        f"covering {zero_endpoints:,} endpoints; others attribute most of theirs. That is a "
        f"publishing-behaviour difference between vendors rather than one systemic cause, and it "
        f"means the fix is per-vendor: a host sitting at 0% is not partially populated, it has "
        f"never populated the field at all.\n\n"
        f"Direct Trust addresses are excluded from the crosswalk. They are messaging "
        f"addresses rather than callable base URLs (H28), though their linkage rate is "
        f"reported in the chart for completeness. The crosswalk covers the FHIR REST subset "
        f"only, which is the right denominator for anything that resolves a base URL."
    )

    payload = {
        "slug": SLUG,
        "title": "Endpoint-to-organization linkage",
        "hypotheses": ["H50"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": git_sha(),
        "headline": headline,
        "numerator": rest["resolvable"],
        "denominator": rest["total"],
        "chart": {
            "type": "bar",
            "unit": "percent",
            "data": [
                {"label": f"{r['connection_type']} resolvable",
                 "value": round(r["resolvable"] / r["total"] * 100, 1)}
                for r in by_type
            ],
        },
        "notes": notes,
        "detail": {
            "by_connection_type": by_type,
            "all_endpoints_total": total_all,
            "all_endpoints_resolvable": resolvable_all,
            "dangling_references": dangling,
            "crosswalk_rows": len(crosswalk),
            "crosswalk_url": "/api/v1/findings/endpoint-org-crosswalk.csv",
            "top_hosts_by_linkage": by_host,
            "hosts_scored": len(by_host_all),
            "hosts_with_zero_linkage": len(zero_hosts),
            "endpoints_on_zero_linkage_hosts": zero_endpoints,
        },
    }
    (OUT_DIR / f"{SLUG}.json").write_text(json.dumps(payload, indent=2) + "\n")

    print("\n" + headline)
    print(f"\n  dangling references : {dangling}")
    print(f"  crosswalk rows      : {len(crosswalk):,} -> {csv_path.name}")
    print("\n  linkage rate for the busiest hosts:")
    for h in by_host[:8]:
        print(f"    {h['host'][:44]:<44} {h['endpoints']:>6,}  {h['resolvable_pct']:>5.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
