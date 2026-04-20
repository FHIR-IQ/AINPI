"""H1-H5 — Endpoint liveness pilot.

Composition:
  - H4 + H5 computed entirely from BigQuery (fast, full population)
  - H1-H3 pilot: sample 300 distinct FHIR-REST hosts (one endpoint each),
    run ainpi-probe L0-L7 against them, aggregate the Parquet output.

Writes frontend/public/api/v1/findings/endpoint-liveness.json with
status='in-progress' and a pilot-sample caveat until the full 2,974-host
crawl completes.
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone

from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE_DATE = "2026-04-09"
REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
PILOT_N = 300


def h4_h5_from_bq(c: bigquery.Client) -> dict:
    """Connection-type distribution + organizations without any endpoint."""
    # H4 — connection type distribution
    ct_rows = list(c.query(f"""
        SELECT _connection_type AS ct, COUNT(*) AS n
        FROM `{PROJECT}.{DATASET}.endpoint`
        GROUP BY ct ORDER BY n DESC
    """).result())
    ct_total = sum(r.n for r in ct_rows)
    ct_dist = {r.ct: r.n for r in ct_rows}
    fhir_rest = ct_dist.get("hl7-fhir-rest", 0)
    direct = ct_dist.get("direct-project", 0)

    # H5 — Organizations with no endpoint references
    orgs_with_endpoint = list(c.query(f"""
        SELECT COUNT(DISTINCT _managing_org_id) AS n
        FROM `{PROJECT}.{DATASET}.endpoint`
        WHERE _managing_org_id IS NOT NULL
    """).result())[0].n
    total_orgs = list(c.query(f"""
        SELECT COUNT(*) AS n FROM `{PROJECT}.{DATASET}.organization`
    """).result())[0].n
    orgs_without = total_orgs - orgs_with_endpoint

    return {
        "h4": {
            "total_endpoints": ct_total,
            "fhir_rest": fhir_rest,
            "direct_project": direct,
            "fhir_rest_pct": round(100 * fhir_rest / ct_total, 2) if ct_total else 0,
            "direct_project_pct": round(100 * direct / ct_total, 2) if ct_total else 0,
        },
        "h5": {
            "total_orgs": total_orgs,
            "orgs_with_endpoint": orgs_with_endpoint,
            "orgs_without_endpoint": orgs_without,
            "orgs_without_endpoint_pct": round(100 * orgs_without / total_orgs, 2) if total_orgs else 0,
        },
    }


def sample_distinct_hosts(c: bigquery.Client, n: int) -> list[tuple[str, str]]:
    """Return n (endpoint_id, url) pairs, one per distinct host.

    Host diversity is a stronger sample for L0-L7 liveness than a raw
    random sample — otherwise one large chain dominates.
    """
    sql = f"""
    WITH by_host AS (
      SELECT
        _id,
        JSON_EXTRACT_SCALAR(resource, '$.address') AS url,
        NET.HOST(JSON_EXTRACT_SCALAR(resource, '$.address')) AS host,
        ROW_NUMBER() OVER (
          PARTITION BY NET.HOST(JSON_EXTRACT_SCALAR(resource, '$.address'))
          ORDER BY _id
        ) AS rn
      FROM `{PROJECT}.{DATASET}.endpoint`
      WHERE _connection_type = 'hl7-fhir-rest'
        AND JSON_EXTRACT_SCALAR(resource, '$.address') LIKE 'http%'
    )
    SELECT _id, url, host
    FROM by_host
    WHERE rn = 1
    ORDER BY FARM_FINGERPRINT(host)  -- deterministic pseudo-random
    LIMIT @n
    """
    job = c.query(sql, job_config=bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("n", "INT64", n)],
    ))
    return [(row._id, row.url) for row in job.result()]


def write_csv(rows: list[tuple[str, str]], path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["endpoint_id", "url"])
        for rid, url in rows:
            w.writerow([rid, url])


def run_probe(probe_dir: pathlib.Path, csv_path: pathlib.Path, out_path: pathlib.Path) -> None:
    """Invoke ainpi-probe against the CSV; writes Parquet to out_path."""
    cmd = [
        str(probe_dir / ".venv" / "bin" / "python"),
        "probe.py",
        "--input", str(csv_path),
        "--output", str(out_path),
        "--concurrency", "8",
        "--per-host-rps", "1.0",
    ]
    print("running:", " ".join(cmd))
    subprocess.run(cmd, cwd=probe_dir, check=True)


def aggregate_probe_results(parquet_path: pathlib.Path) -> dict:
    import pyarrow.parquet as pq
    tbl = pq.read_table(parquet_path).to_pylist()
    n = len(tbl)
    if n == 0:
        return {"n": 0}

    # H1: share with l3_http_status in 200-399 OR 401 (strict FHIR-REST reachability)
    h1_pass = sum(
        1 for r in tbl
        if (r.get("l3_http_status") is not None
            and (200 <= r["l3_http_status"] < 400 or r["l3_http_status"] == 401))
    )
    # L3 loose (any response at all)
    l3_any = sum(1 for r in tbl if r.get("l3_http_status") is not None)

    # H2: CS parseable + fhirVersion distribution
    h2_pass = sum(1 for r in tbl if r.get("l4_capability_parseable") is True)
    fhir_versions = Counter(r.get("l5_fhir_version") for r in tbl if r.get("l5_fhir_version"))

    # H3: SMART well-known valid
    h3_pass = sum(1 for r in tbl if r.get("l6_smart_valid") is True)

    # Highest-level-reached distribution
    by_level: Counter[int] = Counter(r.get("highest_level_reached", -1) for r in tbl)

    return {
        "n": n,
        "h1_fhir_rest_reachable": h1_pass,
        "l3_any_response": l3_any,
        "h2_capability_parseable": h2_pass,
        "fhir_version_top": dict(fhir_versions.most_common(5)),
        "h3_smart_configured": h3_pass,
        "by_level": dict(by_level),
    }


def setup_probe(probe_dir: pathlib.Path) -> None:
    """Clone + install ainpi-probe if not already present."""
    if probe_dir.exists():
        print(f"using existing probe at {probe_dir}")
        return
    probe_dir.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "clone", "https://github.com/FHIR-IQ/ainpi-probe.git", str(probe_dir)],
        check=True,
    )
    subprocess.run(
        ["python3", "-m", "venv", ".venv"],
        cwd=probe_dir, check=True,
    )
    subprocess.run(
        [str(probe_dir / ".venv" / "bin" / "pip"), "install", "--quiet",
         "--upgrade", "pip"],
        check=True,
    )
    subprocess.run(
        [str(probe_dir / ".venv" / "bin" / "pip"), "install", "--quiet",
         "-r", "requirements.txt"],
        cwd=probe_dir, check=True,
    )


def main() -> None:
    client = bigquery.Client(project=PROJECT)

    print(f"== H4 + H5 from BigQuery ==")
    bq_block = h4_h5_from_bq(client)
    h4 = bq_block["h4"]
    h5 = bq_block["h5"]
    print(f"  H4 endpoints: {h4['total_endpoints']:,}  "
          f"FHIR-REST {h4['fhir_rest_pct']}%  "
          f"Direct {h4['direct_project_pct']}%")
    print(f"  H5 orgs: {h5['total_orgs']:,}  "
          f"without any endpoint: {h5['orgs_without_endpoint']:,} "
          f"({h5['orgs_without_endpoint_pct']}%)")

    print(f"\n== H1-H3 pilot: sampling {PILOT_N} distinct FHIR-REST hosts ==")
    pairs = sample_distinct_hosts(client, PILOT_N)
    print(f"  got {len(pairs)} host→endpoint pairs")

    workdir = pathlib.Path(tempfile.mkdtemp(prefix="ainpi-pilot-"))
    probe_dir = workdir / "ainpi-probe"
    csv_path = workdir / "endpoints.csv"
    out_path = workdir / "liveness.parquet"
    write_csv(pairs, csv_path)
    print(f"  wrote {csv_path}")

    setup_probe(probe_dir)
    run_probe(probe_dir, csv_path, out_path)

    print("\n== Aggregating probe results ==")
    agg = aggregate_probe_results(out_path)
    print(f"  n={agg['n']}")
    print(f"  H1 reachable (200/30x/401): {agg['h1_fhir_rest_reachable']:,} "
          f"({100*agg['h1_fhir_rest_reachable']/agg['n']:.1f}%)")
    print(f"  L3 any response:            {agg['l3_any_response']:,} "
          f"({100*agg['l3_any_response']/agg['n']:.1f}%)")
    print(f"  H2 CapabilityStatement:     {agg['h2_capability_parseable']:,} "
          f"({100*agg['h2_capability_parseable']/agg['n']:.1f}%)")
    print(f"  H3 SMART well-known:        {agg['h3_smart_configured']:,} "
          f"({100*agg['h3_smart_configured']/agg['n']:.1f}%)")
    print(f"  FHIR version top: {agg['fhir_version_top']}")
    print(f"  highest-level reached: {agg['by_level']}")

    # Compose the finding
    h1_pct = 100 * agg['h1_fhir_rest_reachable'] / agg['n'] if agg['n'] else 0
    l3_any_pct = 100 * agg['l3_any_response'] / agg['n'] if agg['n'] else 0
    h2_pct = 100 * agg['h2_capability_parseable'] / agg['n'] if agg['n'] else 0
    h3_pct = 100 * agg['h3_smart_configured'] / agg['n'] if agg['n'] else 0

    headline = (
        f"Pilot of {agg['n']} distinct FHIR-REST hosts: "
        f"{l3_any_pct:.1f}% answered HTTP, "
        f"{h2_pct:.1f}% served a parseable CapabilityStatement at /metadata, "
        f"{h3_pct:.1f}% published a valid .well-known/smart-configuration. "
        f"Across all {h4['total_endpoints']/1_000_000:.1f}M NPD endpoints, "
        f"{h4['fhir_rest_pct']}% declare FHIR-REST and {h4['direct_project_pct']}% declare Direct. "
        f"{h5['orgs_without_endpoint_pct']}% of Organizations carry zero Endpoint references."
    )

    chart_data = [
        {"label": "L3 any HTTP",   "value": round(l3_any_pct, 1)},
        {"label": "H1 200/30x/401","value": round(h1_pct, 1)},
        {"label": "H2 CS parseable","value": round(h2_pct, 1)},
        {"label": "H3 SMART valid", "value": round(h3_pct, 1)},
    ]

    notes = (
        f"H1-H3 results from {agg['n']}-host pilot sample (1 endpoint per host, "
        f"stratified by host-fingerprint). Full FHIR-REST crawl spans "
        f"{2974:,} distinct hosts; results here are preliminary. "
        f"Highest level reached on pilot: {agg['by_level']}. "
        f"FHIR version top declarations: {agg['fhir_version_top']}. "
        f"H4 (connection-type distribution) and H5 (orgs without endpoints) "
        f"computed over the full population in BigQuery: "
        f"H4 {h4['total_endpoints']:,} endpoints "
        f"({h4['fhir_rest']:,} FHIR-REST, {h4['direct_project']:,} Direct); "
        f"H5 {h5['total_orgs']:,} orgs of which {h5['orgs_without_endpoint']:,} "
        f"have no managingOrganization reference from any Endpoint."
    )

    payload = {
        "slug": "endpoint-liveness",
        "title": "Endpoint liveness",
        "hypotheses": ["H1", "H2", "H3", "H4", "H5"],
        "status": "in-progress",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": "0.1.0-draft",
        "commit_sha": "pending",
        "headline": headline,
        "numerator": agg['h2_capability_parseable'],  # report H2 as the lead numerator
        "denominator": agg['n'],
        "chart": {
            "type": "bar",
            "unit": "percent",
            "data": chart_data,
        },
        "notes": notes,
    }

    out_json = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings" / "endpoint-liveness.json"
    out_json.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out_json}")


if __name__ == "__main__":
    sys.exit(main() or 0)
