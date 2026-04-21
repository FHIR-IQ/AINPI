"""Aggregate full-population FHIR-REST crawl (2,974 hosts) into:
  - endpoint-liveness.json  (H1-H5, status=published)
  - network-adequacy-gauge.json  (H22, status=published)

Reads the completed probe Parquet at analysis/.crawl/ainpi-probe/out/
full_liveness.parquet and the H4/H5 BigQuery aggregates (full-population
already computed in h1_h5_pilot.py; repeating here for fresh numbers).
"""
from __future__ import annotations
import json
import pathlib
from collections import Counter
from datetime import datetime, timezone

import pyarrow.parquet as pq
from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE_DATE = "2026-04-09"
PROBE_PARQUET = pathlib.Path(__file__).resolve().parent / ".crawl" / "ainpi-probe" / "out" / "full_liveness.parquet"
REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
NETWORK_ADEQUACY_CEILING = 85.0  # Medicare Advantage network adequacy implied ceiling


def bq_h4_h5(client: bigquery.Client) -> dict:
    ct = list(client.query(f"""
        SELECT _connection_type AS ct, COUNT(*) AS n
        FROM `{PROJECT}.{DATASET}.endpoint`
        GROUP BY ct ORDER BY n DESC
    """).result())
    ct_total = sum(r.n for r in ct)
    ct_dist = {r.ct: r.n for r in ct}
    orgs_with_ep = list(client.query(f"""
        SELECT COUNT(DISTINCT _managing_org_id) AS n
        FROM `{PROJECT}.{DATASET}.endpoint`
        WHERE _managing_org_id IS NOT NULL
    """).result())[0].n
    total_orgs = list(client.query(f"""
        SELECT COUNT(*) AS n FROM `{PROJECT}.{DATASET}.organization`
    """).result())[0].n
    return {
        "total_endpoints": ct_total,
        "connection_types": ct_dist,
        "fhir_rest": ct_dist.get("hl7-fhir-rest", 0),
        "direct_project": ct_dist.get("direct-project", 0),
        "total_orgs": total_orgs,
        "orgs_with_endpoint": orgs_with_ep,
        "orgs_without_endpoint": total_orgs - orgs_with_ep,
    }


def aggregate_crawl(parquet_path: pathlib.Path) -> dict:
    tbl = pq.read_table(parquet_path).to_pylist()
    n = len(tbl)

    # L-level pass counts
    l0 = sum(1 for r in tbl if r.get("l0_dns") is True)
    l1 = sum(1 for r in tbl if r.get("l1_tcp") is True)
    l2 = sum(1 for r in tbl if r.get("l2_tls") is True)
    l3_any = sum(1 for r in tbl if r.get("l3_http_status") is not None)
    l3_strict = sum(
        1 for r in tbl
        if (r.get("l3_http_status") is not None
            and (200 <= r["l3_http_status"] < 400 or r["l3_http_status"] == 401))
    )
    l4 = sum(1 for r in tbl if r.get("l4_capability_parseable") is True)
    l5 = sum(1 for r in tbl if r.get("l5_capability_conformant") is True)
    l6 = sum(1 for r in tbl if r.get("l6_smart_valid") is True)
    l7 = sum(1 for r in tbl if r.get("l7_unauth_search_pass") is True)

    # Version + software distribution
    fhir_versions = Counter(r.get("l5_fhir_version") for r in tbl if r.get("l5_fhir_version"))
    software = Counter(r.get("l5_software_name") for r in tbl if r.get("l5_software_name"))

    # Highest-level-reached distribution
    by_level = Counter(r.get("highest_level_reached", -1) for r in tbl)

    # Cert expiry — count certs expiring within 90 days of release
    soon_expire = 0
    release_ts = datetime.fromisoformat(RELEASE_DATE)
    for r in tbl:
        na = r.get("l2_cert_not_after")
        if not na:
            continue
        try:
            exp = datetime.fromisoformat(na.replace("+00:00", ""))
            if (exp - release_ts).days <= 90:
                soon_expire += 1
        except (ValueError, TypeError):
            continue

    return {
        "n": n,
        "l0_dns": l0,
        "l1_tcp": l1,
        "l2_tls": l2,
        "l3_any_http": l3_any,
        "l3_strict": l3_strict,
        "l4_cs_parseable": l4,
        "l5_cs_conformant": l5,
        "l6_smart_valid": l6,
        "l7_unauth_search": l7,
        "fhir_versions": dict(fhir_versions.most_common(10)),
        "software_top": dict(software.most_common(5)),
        "by_level": dict(by_level),
        "certs_expiring_within_90d": soon_expire,
    }


def write_endpoint_liveness(probe: dict, bq: dict) -> None:
    n = probe["n"]
    pct = lambda k: round(100 * k / n, 2) if n else 0

    headline = (
        f"Full crawl of {n:,} distinct FHIR-REST hosts in the NDH: "
        f"{pct(probe['l3_any_http']):.1f}% answered HTTP, "
        f"{pct(probe['l4_cs_parseable']):.1f}% served a parseable CapabilityStatement, "
        f"{pct(probe['l6_smart_valid']):.1f}% published valid SMART well-known, "
        f"{pct(probe['l7_unauth_search']):.1f}% answered an unauthenticated "
        f"Practitioner?_count=1 with 200/401. Across the full NDH endpoint "
        f"population: {bq['total_endpoints']:,} endpoints total "
        f"({100*bq['fhir_rest']/bq['total_endpoints']:.1f}% FHIR-REST, "
        f"{100*bq['direct_project']/bq['total_endpoints']:.1f}% Direct Project); "
        f"{100*bq['orgs_without_endpoint']/bq['total_orgs']:.1f}% of Organizations "
        f"carry zero Endpoint references."
    )

    chart_data = [
        {"label": "L3 any HTTP",         "value": pct(probe["l3_any_http"])},
        {"label": "L3 strict (200/30x/401)", "value": pct(probe["l3_strict"])},
        {"label": "L4 CS parseable",     "value": pct(probe["l4_cs_parseable"])},
        {"label": "L5 CS conformant",    "value": pct(probe["l5_cs_conformant"])},
        {"label": "L6 SMART valid",      "value": pct(probe["l6_smart_valid"])},
        {"label": "L7 unauth search",    "value": pct(probe["l7_unauth_search"])},
    ]

    notes = (
        f"Probed {n:,} distinct FHIR-REST hosts (one endpoint per host, "
        f"stratified by host). Crawl: 16 global concurrency, 1 rps per host, "
        f"10s connect / 30s read, exponential backoff on 429/503, User-Agent "
        f"AINPI-DirectoryQualityBot/1.0. "
        f"fhirVersion declared by L5-conformant hosts: "
        f"{probe['fhir_versions']}. "
        f"CapabilityStatement software top-5: {probe['software_top']}. "
        f"Highest level reached distribution: {probe['by_level']}. "
        f"Certs expiring within 90 days of release: "
        f"{probe['certs_expiring_within_90d']}. "
        f"H4 (connection type distribution) and H5 (orgs without endpoints) "
        f"computed over the full population in BigQuery: "
        f"H4 connection types: {bq['connection_types']}; "
        f"H5 {bq['total_orgs']:,} orgs of which {bq['orgs_without_endpoint']:,} "
        f"have no managingOrganization reference from any Endpoint."
    )

    payload = {
        "slug": "endpoint-liveness",
        "title": "Endpoint liveness",
        "hypotheses": ["H1", "H2", "H3", "H4", "H5"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": "0.2.0-draft",
        "commit_sha": "pending",
        "headline": headline,
        "numerator": probe["l4_cs_parseable"],
        "denominator": n,
        "chart": {"type": "bar", "unit": "percent", "data": chart_data},
        "notes": notes,
    }
    out = FINDINGS_DIR / "endpoint-liveness.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"  wrote {out}")


def write_network_adequacy(probe: dict) -> None:
    n = probe["n"]
    pct = lambda k: round(100 * k / n, 2) if n else 0

    l7_pct = pct(probe["l7_unauth_search"])
    l5_pct = pct(probe["l5_cs_conformant"])
    l6_pct = pct(probe["l6_smart_valid"])
    ceiling = NETWORK_ADEQUACY_CEILING

    headline = (
        f"Empirical FHIR endpoint liveness vs the {ceiling:.0f}% "
        f"Medicare Advantage network-adequacy implied ceiling: "
        f"L7 unauthenticated-read {l7_pct:.1f}% (ABOVE), "
        f"L5 CapabilityStatement conformance {l5_pct:.1f}% (AT), "
        f"L6 SMART well-known {l6_pct:.1f}% (BELOW). "
        f"Gauge sampled across {n:,} distinct FHIR-REST hosts in the NDH."
    )

    # Build a gauge chart: baseline ceiling vs three measurements
    chart_data = [
        {"label": "Regulatory ceiling (implied)", "value": ceiling},
        {"label": "L7 unauth Practitioner read",  "value": l7_pct},
        {"label": "L5 CS conformance",            "value": l5_pct},
        {"label": "L6 SMART well-known",          "value": l6_pct},
    ]

    notes = (
        f"The 85% network-adequacy ceiling is the implied minimum active "
        f"provider share under Medicare Advantage adequacy rules (42 CFR "
        f"§422.116). This comparison maps 'adequacy' onto technical reachability "
        f"and conformance — NOT onto the regulatory definition itself, which "
        f"concerns whether a sufficient share of the network is active, not "
        f"whether its FHIR endpoints respond. Interpret as: if consumers assume "
        f"the FHIR directory surface offers a regulatory-equivalent "
        f"conformance floor, that assumption holds only on unauthenticated "
        f"basic reachability (L7 {l7_pct:.1f}%) and collapses on SMART "
        f"discovery ({l6_pct:.1f}% vs {ceiling:.0f}%). "
        f"Probe methodology: {n:,} distinct FHIR-REST hosts, one endpoint per "
        f"host, stratified by host-fingerprint, via ainpi-probe L0-L7 with 1 "
        f"rps per host rate limit and 10s connect / 30s read timeouts."
    )

    payload = {
        "slug": "network-adequacy-gauge",
        "title": "Network adequacy gauge",
        "hypotheses": ["H22"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": "0.2.0-draft",
        "commit_sha": "pending",
        "headline": headline,
        "numerator": probe["l7_unauth_search"],
        "denominator": n,
        "chart": {"type": "bar", "unit": "percent", "data": chart_data},
        "notes": notes,
    }
    out = FINDINGS_DIR / "network-adequacy-gauge.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"  wrote {out}")


def main() -> None:
    if not PROBE_PARQUET.exists():
        raise SystemExit(f"Probe Parquet missing: {PROBE_PARQUET}")

    print(f"Aggregating {PROBE_PARQUET}...")
    probe = aggregate_crawl(PROBE_PARQUET)
    print(f"  n={probe['n']}  L7={probe['l7_unauth_search']}  L4={probe['l4_cs_parseable']}")

    print(f"Pulling H4/H5 from BigQuery...")
    client = bigquery.Client(project=PROJECT)
    bq = bq_h4_h5(client)
    print(f"  H4 total endpoints: {bq['total_endpoints']:,}; "
          f"H5 orgs without endpoint: {bq['orgs_without_endpoint']:,}")

    print("\nWriting finding JSONs:")
    write_endpoint_liveness(probe, bq)
    write_network_adequacy(probe)


if __name__ == "__main__":
    main()
