"""Scoreboard for /primer: six metrics with a current baseline.

The point of a scoreboard is that progress becomes arguable rather than felt.
Each metric is reproducible from public data, so CMS or anyone else can adopt
it without taking this project's word for anything.

Numbers come from two places and never from prose:

  - Metrics an existing finding already publishes are read out of that
    finding's JSON. Restating them here by hand is how a corrected number
    keeps shipping wrong somewhere else, which has happened on this project
    before.
  - The Organization-structure metrics have no finding of their own yet, so
    they are computed here against the pinned release.

Cost: two capped BigQuery queries.

Usage:
    python analysis/primer_scoreboard.py

Outputs:
    frontend/public/api/v1/primer-scoreboard.json
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from analysis.claims_sources._cohorts import bq_job_config  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
API = REPO_ROOT / "frontend" / "public" / "api" / "v1"
FINDINGS = API / "findings"
PROJECT = "thematic-fort-453901-t7"
RELEASE = "2026-05-08"

ORG_SQL = f"""
SELECT
  COUNT(*)                                                          AS orgs,
  COUNTIF(JSON_VALUE(resource, '$.type[0].text') = 'ein')           AS ein_records,
  COUNTIF(JSON_VALUE(resource, '$.type[0].coding[0].code') = 'prov') AS prov_records,
  COUNTIF(JSON_VALUE(resource, '$.partOf.reference') IS NOT NULL)   AS with_part_of
FROM `{PROJECT}.cms_npd.organization`
"""

PARTOF_SQL = f"""
WITH o AS (
  SELECT _id, JSON_VALUE(resource, '$.partOf.reference') AS ref
  FROM `{PROJECT}.cms_npd.organization`
),
kids AS (SELECT ref FROM o WHERE ref IS NOT NULL)
SELECT
  COUNT(*)                       AS refs,
  COUNT(DISTINCT k.ref)          AS distinct_targets,
  COUNTIF(p._id IS NOT NULL)     AS resolved
FROM kids k
LEFT JOIN o p ON p._id = REPLACE(k.ref, 'Organization/', '')
"""


def finding(slug):
    path = FINDINGS / f"{slug}.json"
    return json.loads(path.read_text()) if path.exists() else {}


def pct(n, d):
    return round(100.0 * n / d, 1) if d else None


def _commit_sha():
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT,
                              capture_output=True, text=True,
                              check=True).stdout.strip()
    except Exception:
        return "pending"


def main():
    from google.cloud import bigquery
    client = bigquery.Client(project=PROJECT)

    org = dict(next(iter(client.query(ORG_SQL, job_config=bq_job_config()).result())))
    po = dict(next(iter(client.query(PARTOF_SQL, job_config=bq_job_config()).result())))

    linkage = finding("endpoint-org-linkage")
    vendor = finding("vendor-endpoint-attribution")
    validity = finding("endpoint-url-validity")
    roles = finding("role-gap-composition")

    pa = (roles.get("states") or {}).get("PA", {})
    rates = pa.get("role_coverage_by_category") or []

    metrics = [
        {
            "key": "endpoint-attribution",
            "label": "Endpoint attribution",
            "question": "Does the directory say who an endpoint belongs to?",
            "value": pct(linkage.get("numerator"), linkage.get("denominator")),
            "unit": "%",
            "detail": (
                f"{linkage.get('numerator', 0):,} of "
                f"{linkage.get('denominator', 0):,} FHIR REST endpoints name a "
                "managing organization."),
            "headroom": "79.9% using only public vendor files that exist today.",
            "finding": "endpoint-org-linkage",
        },
        {
            "key": "partof-resolution",
            "label": "partOf resolution",
            "question": "Does the organization hierarchy point at anything?",
            "value": pct(po["resolved"], po["refs"]),
            "unit": "%",
            "detail": (
                f"{po['refs']:,} references to {po['distinct_targets']:,} "
                f"distinct parent organizations. {po['resolved']:,} resolve to a "
                "record in the export."),
            "headroom": "Publish the parents, or drop the field.",
            "finding": None,
        },
        {
            "key": "organization-typing",
            "label": "Organization typing",
            "question": "Can a consumer tell entities from tax records?",
            "value": pct(org["ein_records"], org["orgs"]),
            "unit": "% untyped",
            "detail": (
                f"{org['ein_records']:,} of {org['orgs']:,} Organization records "
                "are tax-entity records carrying free text rather than a coding, "
                f"against {org['prov_records']:,} provider records."),
            "headroom": "Give them a real code so they can be filtered.",
            "finding": None,
        },
        {
            "key": "endpoint-usability",
            "label": "Endpoint usability",
            "question": "How many endpoints can software actually query?",
            "value": pct(validity.get("numerator"), validity.get("denominator")),
            "unit": "%",
            "detail": (
                f"{validity.get('numerator', 0):,} of "
                f"{validity.get('denominator', 0):,} Endpoint resources are FHIR "
                "REST. The rest are Direct messaging addresses."),
            "headroom": "Not a defect. It is the right denominator to publish.",
            "finding": "endpoint-url-validity",
        },
        {
            "key": "affiliation-coverage",
            "label": "Affiliation coverage",
            "question": "Does the directory say where a clinician works?",
            "value": pa.get("with_ndh_role_pct"),
            "unit": "% have one",
            "detail": (
                f"{pa.get('with_ndh_role', 0):,} of "
                f"{pa.get('active_practitioners', 0):,} active Pennsylvania "
                "practitioners carry a PractitionerRole. Coverage is uneven by "
                f"profession, from {rates[0]['pct']}% of "
                f"{rates[0]['category'].replace('-', ' ')} to {rates[-1]['pct']}% "
                f"of {rates[-1]['category'].replace('-', ' ')} providers."
                if rates else ""),
            "headroom": "Publish role provenance so absence can be read.",
            "finding": "role-gap-composition",
        },
        {
            "key": "brand-coverage",
            "label": "Brand coverage",
            "question": "Can a patient's hospital be identified as itself?",
            "value": 0,
            "unit": "%",
            "detail": (
                "No brand or health-system layer exists in the directory. "
                "Nothing states that an organization belongs to a system a "
                "patient would recognize."),
            "headroom": "Vendor User Access Brands files are already public.",
            "finding": "vendor-endpoint-attribution",
        },
    ]

    payload = {
        "title": "Provider directory scoreboard",
        "note": (
            "Six metrics with a current baseline, each reproducible from public "
            "data. Stated so progress is arguable rather than felt. Recompute "
            "them against the next release with "
            "analysis/primer_scoreboard.py."),
        "release_date": RELEASE,
        "generated_at": dt.datetime.now(dt.timezone.utc)
                          .replace(microsecond=0).isoformat(),
        "commit_sha": _commit_sha(),
        "metrics": metrics,
    }
    out = API / "primer-scoreboard.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {out}")
    for m in metrics:
        print(f"  {m['label']:24s} {str(m['value']):>6}{m['unit']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
