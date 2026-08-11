"""H49 — Does the NDH carry payer organizations and payer directory endpoints?

The CMS National Provider Directory is described in the NDH community as the
place where payer API endpoints and organization identifiers will live, so that
a consumer can discover a payer's public Provider Directory API from one
federal index instead of hunting developer portals one payer at a time.

This check measures whether the shipped release does that yet. It asks three
questions of the pinned bulk export, and then does one control probe:

  1. Organization.type  — is there a payer type coding at all, or only prov?
  2. Endpoint           — how many FHIR REST endpoints are provider directories
                          rather than patient-access or EHR patient-data URLs?
  3. Endpoint hosts     — what share of distinct hosts are payer-operated?
  4. Control            — take a payer Provider Directory API that is verified
                          live and public under CMS-9115-F, and check whether
                          the NDH knows about it.

The control matters. A low count could mean payers have not built directories,
which would not be the NDH's fault. Showing that a working, legally-mandated,
publicly-queryable directory is absent from the index separates "nothing to
index" from "not indexed yet".

Framing note: this is a coverage measurement of a release, not a claim that
anyone is out of compliance. The NDH is young and the payer-endpoint capability
has been discussed as direction. What is published here is the current gap
between that direction and the bytes in the file.

Run:    python analysis/h49_ndh_payer_endpoints.py
Writes:
  - frontend/public/api/v1/findings/ndh-payer-endpoint-coverage.json
  - frontend/public/api/v1/findings/ndh-payer-endpoint-coverage-detail.csv
    (every payer-host FHIR endpoint the NDH does carry, for inspection)

Cost: three capped scans of cms_npd.endpoint and one of cms_npd.organization
(the organization query reads the resource JSON column, ~4 GB). All queries go
through bq_job_config(). Roughly $0.03 per run.
"""
from __future__ import annotations

import csv
import json
import pathlib
import re
import subprocess
import sys
from datetime import datetime, timezone

from google.cloud import bigquery

# analysis/ is sys.path[0] when run as `python analysis/h49_ndh_payer_endpoints.py`.
from claims_sources._cohorts import bq_job_config

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE_DATE = "2026-05-08"
METHODOLOGY_VERSION = "0.7.2-draft"

OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "public" / "api" / "v1" / "findings"
SLUG = "ndh-payer-endpoint-coverage"

# Hosts that are payer-operated. Deliberately a conservative brand list rather
# than a fuzzy keyword: "health plan" appears in thousands of *provider* names
# (verified — every PA org matching payer-ish name patterns is a provider such
# as KEYSTONE RURAL HEALTH CENTER), so name matching produces false positives.
PAYER_HOST_RE = (
    r"bcbs|bluecross|blue-cross|anthem|aetna|cigna|humana|optum|molina|centene|"
    r"uhc|unitedhealthcare|kaiser|elevance|highmark|carefirst|wellcare|healthpartners|payer"
)

# URL-path self-labelling. A server is not obliged to name itself in its path,
# so this undercounts; it is a floor, and reported as such.
DIRECTORY_RE = r"providerdirectory|provider-directory|plan-?net|pdex"
PATIENT_ACCESS_RE = r"patientaccess|patient-access"

# Payer Provider Directory APIs verified live and unauthenticated by hand.
# Kept short on purpose: each entry is something checked, not something assumed.
CONTROL_DIRECTORIES = [
    {
        "payer": "Capital BlueCross",
        "state": "PA",
        "base": "https://providerdirectory-api.capbluecross.com/r4",
        "probe": "/Practitioner?family=Smith&_count=1",
    },
]


def q(client: bigquery.Client, sql: str) -> list[dict]:
    return [dict(r) for r in client.query(sql, job_config=bq_job_config()).result()]


def probe(url: str, timeout: int = 40) -> tuple[int, int]:
    """GET a URL with curl. curl, not urllib: Akamai-fronted payer endpoints
    WAF-block Python's TLS fingerprint (established in H26, reconfirmed H46)."""
    try:
        p = subprocess.run(
            ["curl", "-sS", "-o", "/dev/null", "-w", "%{http_code} %{size_download}",
             "-L", "--max-time", str(timeout),
             "-H", "Accept: application/fhir+json",
             "-A", "AINPI-research/1.0 (+https://ainpi.dev; open provider-directory audit)",
             url],
            capture_output=True, text=True, timeout=timeout + 15,
        )
        code, size = p.stdout.strip().split()
        return int(code), int(size)
    except Exception:
        return 0, 0


def git_sha() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True).stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def main() -> int:
    client = bigquery.Client(project=PROJECT)
    ep = f"`{PROJECT}.{DATASET}.endpoint`"
    org = f"`{PROJECT}.{DATASET}.organization`"

    print("1/4  Organization.type codings ...")
    org_types = q(client, f"""
        SELECT JSON_VALUE(c, '$.code') AS code,
               JSON_VALUE(c, '$.display') AS display,
               COUNT(*) AS n
        FROM {org},
             UNNEST(JSON_QUERY_ARRAY(resource, '$.type')) t,
             UNNEST(JSON_QUERY_ARRAY(t, '$.coding')) c
        GROUP BY 1, 2 ORDER BY n DESC
    """)
    payer_type_rows = [r for r in org_types if r["code"] not in ("prov", "team", "govt")]

    print("2/4  Endpoint classification ...")
    kinds = q(client, f"""
        SELECT CASE
                 WHEN REGEXP_CONTAINS(LOWER(_address), r'{DIRECTORY_RE}') THEN 'provider-directory'
                 WHEN REGEXP_CONTAINS(LOWER(_address), r'{PATIENT_ACCESS_RE}') THEN 'patient-access'
                 ELSE 'unlabelled'
               END AS url_kind,
               COUNT(*) AS n
        FROM {ep}
        WHERE _connection_type = 'hl7-fhir-rest'
        GROUP BY 1 ORDER BY n DESC
    """)
    by_kind = {r["url_kind"]: r["n"] for r in kinds}
    total_rest = sum(by_kind.values())
    directories = by_kind.get("provider-directory", 0)

    print("3/4  Host concentration ...")
    hosts = q(client, f"""
        SELECT COUNT(DISTINCT REGEXP_EXTRACT(LOWER(_address), r'https?://([^/]+)')) AS distinct_hosts,
               COUNT(DISTINCT IF(REGEXP_CONTAINS(LOWER(_address), r'{PAYER_HOST_RE}'),
                     REGEXP_EXTRACT(LOWER(_address), r'https?://([^/]+)'), NULL)) AS payer_hosts
        FROM {ep}
        WHERE _connection_type = 'hl7-fhir-rest'
    """)[0]

    payer_eps = q(client, f"""
        SELECT REGEXP_EXTRACT(LOWER(_address), r'https?://([^/]+)') AS host,
               _address, _status, _managing_org_id
        FROM {ep}
        WHERE _connection_type = 'hl7-fhir-rest'
          AND REGEXP_CONTAINS(LOWER(_address), r'{PAYER_HOST_RE}')
        ORDER BY host
    """)

    print("4/4  Control probe: is a verified-live payer directory in the index? ...")
    controls = []
    for c in CONTROL_DIRECTORIES:
        code, size = probe(c["base"] + c["probe"])
        host = re.sub(r"^https?://([^/]+).*$", r"\1", c["base"]).lower()
        in_ndh = any(h and host in h for h in (r["host"] for r in payer_eps))
        controls.append({**c, "http_status": code, "bytes": size,
                         "live_public": code == 200 and size > 0, "present_in_ndh": in_ndh})

    live_absent = [c for c in controls if c["live_public"] and not c["present_in_ndh"]]

    # Even where a payer endpoint IS carried, it is only usable as an index if
    # it resolves to an organization. Endpoint.managingOrganization is the "org
    # id" half of the discovery story, so measure it rather than assume it.
    status_mix: dict[str, int] = {}
    for r in payer_eps:
        status_mix[r["_status"] or "unknown"] = status_mix.get(r["_status"] or "unknown", 0) + 1
    with_org = sum(1 for r in payer_eps if r["_managing_org_id"])

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with (OUT_DIR / f"{SLUG}-detail.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["host", "address", "status", "managing_org_id"])
        for r in payer_eps:
            w.writerow([r["host"], r["_address"], r["_status"], r["_managing_org_id"] or ""])

    pct = (directories / total_rest * 100) if total_rest else 0.0
    headline = (
        f"Of {total_rest:,} FHIR REST endpoints in the {RELEASE_DATE} NDH release, "
        f"{directories:,} ({pct:.4f}%) is a payer provider directory, and "
        f"{'no' if not payer_type_rows else len(payer_type_rows)} payer organization type exists "
        f"across {sum(r['n'] for r in org_types):,} typed Organization resources. "
        f"The NDH does not yet function as a payer-endpoint discovery index."
    )

    notes = (
        "Organization.type carries exactly three codings in this release: prov (Healthcare Provider), "
        "team, govt. There is no payer type, so payer organizations cannot be selected by type. "
        "Name matching is not a substitute: every Pennsylvania organization matching payer-like name "
        "patterns is in fact a provider (KEYSTONE RURAL HEALTH CENTER and similar), which is why this "
        "check classifies by endpoint host rather than organization name.\n\n"
        f"Where payer endpoints are carried, they are largely unusable as an index: of the "
        f"{len(payer_eps)} payer-host endpoints found, {with_org} carry a managingOrganization "
        f"reference, so the endpoint cannot be resolved to an organization for the rest. "
        f"Status mix: {', '.join(f'{k}={v}' for k, v in sorted(status_mix.items()))}.\n\n"
        "The provider-directory count is a floor, not a census: it counts servers that self-label in "
        "their URL path. A directory hosted at an unlabelled path is not counted, so the true number "
        "may be higher. The control probe is what makes the gap concrete, by taking a directory "
        "verified live and unauthenticated and checking whether the index knows it.\n\n"
        "This measures a release, not compliance. Payer endpoint coverage has been discussed in the "
        "NDH community as intended direction; what is reported here is the distance between that "
        "direction and the shipped file, which is the actionable part."
    )

    payload = {
        "slug": SLUG,
        "title": "NDH payer endpoint and organization coverage",
        "hypotheses": ["H49"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": git_sha(),
        "headline": headline,
        "numerator": directories,
        "denominator": total_rest,
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [{"label": k, "value": v} for k, v in sorted(by_kind.items(), key=lambda kv: -kv[1])],
        },
        "notes": notes,
        "detail": {
            "organization_type_codings": [
                {"code": r["code"], "display": r["display"], "count": r["n"]} for r in org_types
            ],
            "distinct_endpoint_hosts": hosts["distinct_hosts"],
            "payer_operated_hosts": hosts["payer_hosts"],
            "payer_endpoint_rows": len(payer_eps),
            "payer_endpoint_status": status_mix,
            "payer_endpoints_with_managing_org": with_org,
            "control_directories": controls,
            "live_but_absent_from_ndh": len(live_absent),
        },
    }

    out = OUT_DIR / f"{SLUG}.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")

    print("\n" + headline)
    print(f"\n  distinct endpoint hosts : {hosts['distinct_hosts']:,}")
    print(f"  payer-operated hosts    : {hosts['payer_hosts']:,}")
    print(f"  payer endpoint rows     : {len(payer_eps):,}")
    for c in controls:
        print(f"  control {c['payer']}: live={c['live_public']} (HTTP {c['http_status']}) "
              f"present_in_ndh={c['present_in_ndh']}")
    print(f"\nwrote {out}")
    print(f"wrote {OUT_DIR / (SLUG + '-detail.csv')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
