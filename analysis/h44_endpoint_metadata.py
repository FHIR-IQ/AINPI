"""H44 — Endpoint metadata coverage vs the HTE submission spec.

Fred Trotter's HTE data-release spec
(ftrotter-gov/HTE_data_release_specifications →
GeneralProviderEndpointAndAffiliationData.md) asks data submitters to provide
nine endpoint-metadata fields. This finding answers two questions a directory
implementer actually has:

  1. STRUCTURAL — does the NDH FHIR Endpoint profile (STU1 v1.0.0) even have a
     home for each of the nine fields? (Derived from the published IG, no BQ.)
  2. EMPIRICAL — for the fields that DO have a home, what share of the current
     FHIR-REST Endpoint records populate them? (One capped BQ scan.)

Why it matters: five of the nine submission-spec fields have no representation
in the STU1 Endpoint profile, so adopting the spec is not just a data-entry
exercise — it needs STU2 extensions or out-of-band storage. The four with a
home start from a measurable (and low) base.

Denominator: FHIR-REST Endpoint records (connectionType.code = 'hl7-fhir-rest')
in the pinned NDH release — the 114,071 an integrator can actually GET (per
H28). Direct Trust HISP addresses are out of scope; they are not FHIR APIs.

Run:    python analysis/h44_endpoint_metadata.py
Writes: frontend/public/api/v1/findings/endpoint-metadata-coverage.json

Cost: one capped scan of cms_npd.endpoint (resource JSON column). Capped at
the project default via bq_job_config().
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
from datetime import datetime, timezone

from google.cloud import bigquery

from claims_sources._cohorts import bq_job_config

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE_DATE = "2026-05-08"
METHODOLOGY_VERSION = "0.7.2-draft"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = (
    REPO_ROOT / "frontend" / "public" / "api" / "v1"
    / "findings" / "endpoint-metadata-coverage.json"
)

NDH_EXT = "http://hl7.org/fhir/us/ndh/StructureDefinition"

# The nine submission-spec fields, each mapped to its home in the NDH STU1
# Endpoint profile. `home` is one of: 'mapped' (a structured element/extension
# carries it), 'partial' (a related element exists but does not capture the
# exact value the spec asks for), or 'none' (no representation in STU1).
# `measure_key` ties a 'mapped'/'partial' field to a column in MAIN_SQL so the
# emitted JSON can attach the live fill rate. 'none' fields have no measure.
SPEC_FIELDS = [
    {
        "spec_field": "fhir_endpoint_url",
        "home": "mapped",
        "stu1_path": "Endpoint.address (core element)",
        "measure_key": "has_address",
    },
    {
        "spec_field": "fhir_endpoint_type",
        "home": "mapped",
        "stu1_path": "Endpoint.connectionType + base-ext-endpoint-usecase",
        "measure_key": "has_usecase",
    },
    {
        "spec_field": "fhir_endpoint_smart_capabilities_url",
        "home": "partial",
        "stu1_path": "base-ext-dynamicRegistration (declares SMART/UDAP dynamic "
        "registration, not the .well-known URL itself)",
        "measure_key": "has_dynamic_registration",
    },
    {
        "spec_field": "fhir_endpoint_developer_documentation_url",
        "home": "none",
        "stu1_path": "(no element or extension in STU1)",
        "measure_key": None,
    },
    {
        "spec_field": "fhir_endpoint_developer_signup_url",
        "home": "none",
        "stu1_path": "(no element or extension in STU1)",
        "measure_key": None,
    },
    {
        "spec_field": "fhir_endpoint_swagger_url",
        "home": "none",
        "stu1_path": "(no element or extension in STU1)",
        "measure_key": None,
    },
    {
        "spec_field": "fhir_endpoint_openapi_url",
        "home": "none",
        "stu1_path": "(no element or extension in STU1)",
        "measure_key": None,
    },
    {
        "spec_field": "fhir_general_sandbox_url",
        "home": "partial",
        "stu1_path": "base-ext-endpoint-environment-type (a code: "
        "production/test/etc., not a sandbox URL)",
        "measure_key": "has_environment_type",
    },
    {
        "spec_field": "fhir_specific_sandbox_endpoint_url",
        "home": "none",
        "stu1_path": "(environment-type is a code, not a per-instance URL)",
        "measure_key": None,
    },
]

# Presence of each NDH extension is detected by scanning the serialized
# resource for the canonical extension URL. This is an UPPER BOUND on real
# usage (it catches the extension wherever it nests), reported honestly as a
# presence scan rather than a strict element-cardinality count.
MAIN_SQL = f"""
WITH fhir_rest AS (
  SELECT TO_JSON_STRING(resource) AS rj, _address
  FROM `{PROJECT}.{DATASET}.endpoint`
  WHERE _connection_type = 'hl7-fhir-rest'
)
SELECT
  COUNT(*)                                                          AS total_fhir_rest,
  COUNTIF(_address IS NOT NULL AND _address != '')                 AS has_address,
  COUNTIF(rj LIKE '%base-ext-endpoint-usecase%')                   AS has_usecase,
  COUNTIF(rj LIKE '%base-ext-dynamicRegistration%')                AS has_dynamic_registration,
  COUNTIF(rj LIKE '%base-ext-endpoint-environment-type%')          AS has_environment_type,
  COUNTIF(rj LIKE '%base-ext-endpoint-connection-type-version%')   AS has_fhir_version,
  COUNTIF(rj LIKE '%"payloadType"%')                               AS has_payload_type,
  COUNTIF(rj LIKE '%base-ext-secureExchangeArtifacts%')            AS has_secure_artifacts,
  COUNTIF(rj LIKE '%base-ext-trustFramework%')                     AS has_trust_framework,
  COUNTIF(rj LIKE '%base-ext-usage-restriction%')                  AS has_usage_restriction
FROM fhir_rest
"""


def get_commit_sha() -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, check=True,
        )
        return r.stdout.strip()
    except Exception:
        return "pending"


def pct(n: int, d: int) -> float:
    return round(100 * n / d, 1) if d else 0.0


def main() -> None:
    client = bigquery.Client(project=PROJECT)
    row = list(client.query(MAIN_SQL, job_config=bq_job_config()).result())[0]

    total = int(row.total_fhir_rest)
    measures = {
        "has_address": int(row.has_address),
        "has_usecase": int(row.has_usecase),
        "has_dynamic_registration": int(row.has_dynamic_registration),
        "has_environment_type": int(row.has_environment_type),
    }
    # Supporting context (not spec fields, but useful for the FHIR discussion)
    context = {
        "fhir_version_declared": int(row.has_fhir_version),
        "payload_type_present": int(row.has_payload_type),
        "secure_exchange_artifacts": int(row.has_secure_artifacts),
        "trust_framework": int(row.has_trust_framework),
        "usage_restriction": int(row.has_usage_restriction),
    }

    # Build the per-spec-field coverage rows.
    field_rows = []
    n_none = n_partial = n_mapped = 0
    for f in SPEC_FIELDS:
        n_none += f["home"] == "none"
        n_partial += f["home"] == "partial"
        n_mapped += f["home"] == "mapped"
        entry = {
            "spec_field": f["spec_field"],
            "stu1_home": f["home"],
            "stu1_path": f["stu1_path"],
        }
        if f["measure_key"]:
            present = measures[f["measure_key"]]
            entry["present_in_ndh"] = present
            entry["present_pct"] = pct(present, total)
        else:
            entry["present_in_ndh"] = None
            entry["present_pct"] = None
        field_rows.append(entry)

    headline = (
        f"The HTE submission spec collects 9 endpoint-metadata fields. Mapped "
        f"against the NDH FHIR Endpoint profile (STU1 v1.0.0): {n_mapped} have a "
        f"structured home, {n_partial} map partially, and {n_none} have no "
        f"representation in STU1 at all (developer documentation, developer "
        f"signup, swagger, OpenAPI, and per-instance sandbox URLs). Adopting the "
        f"spec for those five needs STU2 extensions or out-of-band storage, not "
        f"data entry. Across {total:,} FHIR-REST Endpoint records in the "
        f"{RELEASE_DATE} NDH release, the fields that DO have a home are sparsely "
        f"populated: endpoint use-case "
        f"{pct(measures['has_usecase'], total)}%, SMART/UDAP dynamic-registration "
        f"{pct(measures['has_dynamic_registration'], total)}%, environment-type "
        f"{pct(measures['has_environment_type'], total)}%."
    )

    notes = (
        "Two layers. STRUCTURAL: each of the nine submission-spec fields is "
        "mapped to its home in the published NDH STU1 Endpoint profile "
        "(hl7.org/fhir/us/ndh/STU1). 'mapped' = a core element or extension "
        "carries the exact value; 'partial' = a related element exists but does "
        "not capture what the spec asks for (e.g. environment-type is a code, "
        "not a sandbox URL; dynamicRegistration declares SMART/UDAP support, not "
        "the .well-known URL); 'none' = no element or extension in STU1. "
        "EMPIRICAL: presence of each mappable NDH extension is detected by "
        "scanning the serialized Endpoint resource for the extension's canonical "
        "URL, which is an UPPER BOUND on real usage (it catches the extension "
        "wherever it nests) — reported as a presence scan, not a strict "
        "cardinality count. Denominator is FHIR-REST endpoints "
        "(connectionType.code = 'hl7-fhir-rest'); Direct Trust HISP addresses "
        "(91.6% of the Endpoint table per H28) are excluded because they are not "
        "queryable FHIR APIs. Cross-reference: H1-H5 found that 81.6% of distinct "
        "FHIR-REST hosts already publish a valid SMART .well-known by crawl, so "
        "the SMART capability is largely auto-discoverable even though the NDH "
        "record rarely declares it — the submission-spec field is most valuable "
        "for the minority of hosts that are not crawl-discoverable. Supporting "
        f"context (not spec fields): FHIR version declared on "
        f"{pct(context['fhir_version_declared'], total)}%, payloadType present on "
        f"{pct(context['payload_type_present'], total)}%."
    )

    payload = {
        "slug": "endpoint-metadata-coverage",
        "title": "Endpoint metadata coverage vs the HTE submission spec",
        "hypotheses": ["H44"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": n_mapped + n_partial,   # fields with any STU1 home
        "denominator": len(SPEC_FIELDS),     # 9 spec fields
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "Mapped to STU1", "value": n_mapped},
                {"label": "Partial home", "value": n_partial},
                {"label": "No home in STU1", "value": n_none},
            ],
        },
        "notes": notes,
        "spec_field_coverage": field_rows,
        "context_extensions": context,
        "total_fhir_rest_endpoints": total,
    }

    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {OUT}")
    print(f"  FHIR-REST endpoints:        {total:,}")
    print(f"  spec fields mapped/partial/none: {n_mapped}/{n_partial}/{n_none}")
    for f in field_rows:
        pp = f"{f['present_pct']}%" if f["present_pct"] is not None else "n/a (no STU1 home)"
        print(f"    {f['spec_field']:42s} {f['stu1_home']:8s} {pp}")


if __name__ == "__main__":
    main()
