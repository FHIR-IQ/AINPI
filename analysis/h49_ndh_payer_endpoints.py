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

Cost: three capped scans of cms_npd.endpoint and two of cms_npd.organization
(the organization queries read the resource JSON column). All queries go
through bq_job_config(). Roughly $0.05 per run.

Release watch, payer PIN (added 2026-09-25): the HL7 NDH STU2 draft adds an
Organization identifier slice for the Payer Identification Number,
identifier.type = v2-0203#PAYERID (Jira FHIR-57606). It is not in the
published STU1. payer_pin_watch() counts the organizations typed `pay`, those
carrying any identifier, and those carrying a PAYERID identifier. The counting
logic lives in release_watch.py and is unit-tested there.

    python analysis/h49_ndh_payer_endpoints.py --payer-pin-watch

runs only that query and merges the result into the published finding as
detail.payer_pin_watch plus one notes paragraph, leaving every other field as
it is.

Refreshing `detail` (added 2026-09-26): the headline, chart and notes are
written by h49_recheck_release.py --write, which never touched `detail`, so
every detail field (organization_type_codings, host counts, payer endpoint
rows, the control probe) sat at the 2026-05-08 values under a 2026-08-20
headline. A bare run of this script now re-measures only `detail` plus the PIN
watch and merges them in, leaving headline, numerator, denominator, chart and
notes as they are:

    python analysis/h49_ndh_payer_endpoints.py            # same as --refresh-detail

It refuses when the published finding is for another release, when the
Organization.type walk finds no codings or no `prov`, or when it finds fewer
`pay` codings than the PIN watch found payer-typed organizations. A control
probe with no HTTP answer keeps the last answered probe instead of publishing
a zero. Regenerating the whole finding from the template below needs
--rewrite-headline, so the weekly refresh cannot do it by accident.
"""
from __future__ import annotations

import argparse
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
from release import CURRENT_RELEASE
from release_watch import PAYER_TYPE_CODE, PIN_NOTE_MARKER, merge_note, payer_pin_summary
from finding_detail import (
    RefreshRefused,
    control_probe_usable,
    merge_detail,
    type_codings_control,
)

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE_DATE = CURRENT_RELEASE
# Read from docs/methodology/index.md, as stats.json does, rather than typed in.
from build_stats import methodology_version  # noqa: E402
METHODOLOGY_VERSION = methodology_version()

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

# Payer directory classification (FHI-71) lives in payer_directory.py, which
# both this script and h49_recheck_release.py import. DIRECTORY_RE is H49's
# original URL-path rule and is now one of two signals; the host signal
# (contract IDs from InsurancePlan, hand-checked payer directory hosts) is the
# other. Re-exported here for callers that imported it from this module.
from payer_directory import (  # noqa: E402
    DIRECTORY_RE,
    PATIENT_ACCESS_RE,
    ClassifierControlFailed,
    check_controls,
    classify,
    host_of,
    summarize,
)

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


def payer_pin_watch(client: bigquery.Client) -> tuple[dict, int]:
    """Payer organizations and their identifiers, from the raw resource JSON.

    SQL only selects the organizations carrying a `pay` code anywhere in
    type[].coding[]; the counting is done by the tested release_watch
    functions, which re-check the type. Never reads a flattened `_*` column.
    Returns the summary and the bytes billed.
    """
    org = f"`{PROJECT}.{DATASET}.organization`"
    job = client.query(f"""
        SELECT TO_JSON_STRING(resource) AS json
        FROM {org}
        WHERE EXISTS (
          SELECT 1
          FROM UNNEST(JSON_QUERY_ARRAY(resource, '$.type')) t,
               UNNEST(JSON_QUERY_ARRAY(t, '$.coding')) c
          WHERE JSON_VALUE(c, '$.code') = 'pay'
        )
    """, job_config=bq_job_config())
    resources = [json.loads(r["json"]) for r in job.result()]
    summary = payer_pin_summary(resources)
    summary["release_date"] = RELEASE_DATE
    return summary, int(job.total_bytes_billed or 0)


def merge_payer_pin_watch(payload: dict, summary: dict) -> dict:
    """Add the watch to a finding payload without touching its other fields."""
    detail = payload.get("detail")
    if not isinstance(detail, dict):
        detail = {}
    detail["payer_pin_watch"] = summary
    payload["detail"] = detail
    payload["notes"] = merge_note(payload.get("notes"), PIN_NOTE_MARKER, summary["note"])
    return payload


def run_payer_pin_watch_only() -> int:
    out = OUT_DIR / f"{SLUG}.json"
    pub = json.loads(out.read_text())
    if pub.get("release_date") != RELEASE_DATE:
        print(f"refusing: published finding is for {pub.get('release_date')}, "
              f"warehouse is pinned to {RELEASE_DATE}. Re-measure the finding "
              f"first so the watch and the finding describe the same release.")
        return 1
    client = bigquery.Client(project=PROJECT)
    summary, billed = payer_pin_watch(client)
    print(f"payer PIN watch: {summary['payer_orgs']} payer-typed orgs, "
          f"{summary['payer_orgs_with_any_identifier']} with any identifier, "
          f"{summary['payer_orgs_with_payerid']} with PAYERID "
          f"(control_passed={summary['control_passed']}); "
          f"bytes billed {billed:,}")
    pub = merge_payer_pin_watch(pub, summary)
    pub["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    pub["commit_sha"] = git_sha()
    out.write_text(json.dumps(pub, indent=2) + "\n")
    print(f"wrote {out}")
    return 0


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


def measure_detail(client: bigquery.Client, payer_orgs: int,
                   classification: dict | None = None) -> tuple[dict, list[dict], list[dict], int]:
    """Measure every `detail` field from BigQuery for the loaded release.

    Returns (detail, org_type_rows, payer_endpoint_rows, bytes_billed).
    `payer_orgs` is the payer PIN watch's count of payer-typed organizations,
    used as a cross-check on the Organization.type walk. `classification` is
    the published detail.payer_directory_classification for the same release,
    which carries the contract hosts. Raises RefreshRefused
    when a positive control fails, so a broken walk cannot publish an empty or
    truncated table.
    """
    ep = f"`{PROJECT}.{DATASET}.endpoint`"
    org = f"`{PROJECT}.{DATASET}.organization`"
    billed = 0

    def run(sql: str) -> list[dict]:
        nonlocal billed
        job = client.query(sql, job_config=bq_job_config())
        rows = [dict(r) for r in job.result()]
        billed += int(job.total_bytes_billed or 0)
        return rows

    print("1/4  Organization.type codings (raw resource JSON) ...")
    org_type_rows = run(f"""
        SELECT JSON_VALUE(c, '$.code') AS code,
               JSON_VALUE(c, '$.display') AS display,
               COUNT(*) AS n
        FROM {org},
             UNNEST(JSON_QUERY_ARRAY(resource, '$.type')) t,
             UNNEST(JSON_QUERY_ARRAY(t, '$.coding')) c
        GROUP BY 1, 2 ORDER BY n DESC
    """)
    codings = type_codings_control(org_type_rows, payer_orgs=payer_orgs)

    print("2/4  Endpoint classification ...")
    # Every FHIR REST address (about 111,000 rows) comes back and is classified
    # in Python by payer_directory.classify(), the same function the NDJSON
    # recheck uses, so the two paths cannot disagree about a release. The
    # contract-ID half of the host signal needs InsurancePlan, which is not in
    # BigQuery; it is read from the classification the recheck published for
    # this same release (run_refresh_detail refuses on a release mismatch).
    addresses = [r["address"] for r in run(f"""
        SELECT _address AS address
        FROM {ep}
        WHERE _connection_type = 'hl7-fhir-rest'
    """)]
    contracts = dict((classification or {}).get("contract_ids_in_addresses") or {})
    hosts_with_contracts = dict((classification or {}).get("contract_hosts") or {})
    # Same positive control as the NDJSON path: a known directory that stops
    # classifying, or a known non-directory that starts, refuses the refresh.
    try:
        check_controls(contracts, plans_present=bool(classification))
    except ClassifierControlFailed as exc:
        raise RefreshRefused(f"payer directory classifier control failed: {exc}") from exc
    by_kind: dict[str, int] = {}
    directory_rows = []
    for a in addresses:
        c = classify(a or "", contracts, hosts_with_contracts)
        by_kind[c["url_kind"]] = by_kind.get(c["url_kind"], 0) + 1
        if c["directory"]:
            directory_rows.append({**c, "address": a, "hostname": host_of(a or "")})

    print("3/4  Host concentration ...")
    hosts = run(f"""
        SELECT COUNT(DISTINCT REGEXP_EXTRACT(LOWER(_address), r'https?://([^/]+)')) AS distinct_hosts,
               COUNT(DISTINCT IF(REGEXP_CONTAINS(LOWER(_address), r'{PAYER_HOST_RE}'),
                     REGEXP_EXTRACT(LOWER(_address), r'https?://([^/]+)'), NULL)) AS payer_hosts
        FROM {ep}
        WHERE _connection_type = 'hl7-fhir-rest'
    """)[0]
    if not hosts["distinct_hosts"]:
        raise RefreshRefused("no FHIR REST endpoint hosts found; the endpoint "
                             "query read nothing")

    payer_eps = run(f"""
        SELECT REGEXP_EXTRACT(LOWER(_address), r'https?://([^/]+)') AS host,
               _address, _status, _managing_org_id
        FROM {ep}
        WHERE _connection_type = 'hl7-fhir-rest'
          AND REGEXP_CONTAINS(LOWER(_address), r'{PAYER_HOST_RE}')
        ORDER BY host, _address
    """)

    print("4/4  Control probe: is a verified-live payer directory in the index? ...")
    controls = []
    for c in CONTROL_DIRECTORIES:
        code, size = probe(c["base"] + c["probe"])
        host = re.sub(r"^https?://([^/]+).*$", r"\1", c["base"]).lower()
        in_ndh = any(h and host in h for h in (r["host"] for r in payer_eps))
        # The control URL being absent is not the same as the payer's
        # directory being absent: on 2026-10-07 Capital BlueCross's MA
        # directory was in the index under another host.
        same_payer = sorted({r["address"] for r in directory_rows
                             if r["payer"] == c["payer"] and r["hostname"] != host})
        controls.append({**c, "http_status": code, "bytes": size,
                         "live_public": code == 200 and size > 0, "present_in_ndh": in_ndh,
                         "same_payer_directories_in_ndh": same_payer})
    live_absent = [c for c in controls if c["live_public"] and not c["present_in_ndh"]]

    # Even where a payer endpoint IS carried, it is only usable as an index if
    # it resolves to an organization. Endpoint.managingOrganization is the "org
    # id" half of the discovery story, so measure it rather than assume it.
    status_mix: dict[str, int] = {}
    for r in payer_eps:
        status_mix[r["_status"] or "unknown"] = status_mix.get(r["_status"] or "unknown", 0) + 1
    with_org = sum(1 for r in payer_eps if r["_managing_org_id"])

    detail = {
        "organization_type_codings": codings,
        "distinct_endpoint_hosts": hosts["distinct_hosts"],
        "payer_operated_hosts": hosts["payer_hosts"],
        "payer_endpoint_rows": len(payer_eps),
        "payer_endpoint_status": status_mix,
        "payer_endpoints_with_managing_org": with_org,
        "control_directories": controls,
        # URL-level: counts control base URLs that answer live and are not in
        # the index at that address. It says nothing about the same payer's
        # other directories; see control_directories[].same_payer_directories_in_ndh.
        "live_but_absent_from_ndh": len(live_absent),
        "live_but_absent_from_ndh_scope": (
            "control base URL only; the same payer may be indexed at another "
            "address (control_directories[].same_payer_directories_in_ndh)"),
        # Added fields: which release the detail block was measured against,
        # and the URL-kind split the numerator and denominator come from.
        "endpoint_url_kinds": dict(sorted(by_kind.items(), key=lambda kv: -kv[1])),
        "directory_signal_breakdown": summarize(directory_rows),
        "detail_release_date": RELEASE_DATE,
    }
    return detail, org_type_rows, payer_eps, billed


def write_detail_csv(payer_eps: list[dict]) -> pathlib.Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{SLUG}-detail.csv"
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["host", "address", "status", "managing_org_id"])
        for r in payer_eps:
            w.writerow([r["host"], r["_address"], r["_status"], r["_managing_org_id"] or ""])
    return path


def run_refresh_detail() -> int:
    """Re-measure `detail` (and the payer PIN watch) into the published finding.

    Headline, numerator, denominator, chart and notes are left exactly as they
    are. They are written by h49_recheck_release.py --write, and the full-run
    template further down would replace them with its own wording. Only keys
    under `detail` are replaced, plus the one PIN notes paragraph that
    --payer-pin-watch already owns.
    """
    out = OUT_DIR / f"{SLUG}.json"
    pub = json.loads(out.read_text())
    if pub.get("release_date") != RELEASE_DATE:
        print(f"refusing: published finding is for {pub.get('release_date')}, "
              f"warehouse is pinned to {RELEASE_DATE}. Re-measure the finding "
              f"with h49_recheck_release.py --write first.")
        return 1
    client = bigquery.Client(project=PROJECT)
    pin, pin_billed = payer_pin_watch(client)
    try:
        classification = (pub.get("detail") or {}).get("payer_directory_classification")
        if not classification or classification.get("release_date") != RELEASE_DATE:
            print("warning: no payer_directory_classification for this release in the "
                  "published finding; the contract-ID host signal is off for this run. "
                  "Run h49_recheck_release.py --write first.")
            classification = None
        detail, _, payer_eps, billed = measure_detail(client, pin["payer_orgs"], classification)
    except RefreshRefused as exc:
        print(f"refusing: positive control failed: {exc}")
        return 1

    # A curl failure reads as (0, 0), which would publish "not live" as if it
    # were measured. Keep the last answered probe instead.
    if not control_probe_usable(detail["control_directories"]):
        print("warning: control probe got no HTTP answer; keeping the published "
              "control_directories and live_but_absent_from_ndh")
        detail.pop("control_directories")
        detail.pop("live_but_absent_from_ndh")

    # The headline embeds the FHIR REST denominator measured from NDJSON. If
    # BigQuery disagrees, the warehouse and the headline describe different
    # files, and that needs looking at rather than papering over.
    rest = sum(detail["endpoint_url_kinds"].values())
    directories = detail["endpoint_url_kinds"].get("provider-directory", 0)
    if (rest, directories) != (pub.get("denominator"), pub.get("numerator")):
        print(f"warning: BigQuery measures {directories} of {rest:,} FHIR REST "
              f"endpoints as provider directories; the published headline says "
              f"{pub.get('numerator')} of {pub.get('denominator')}. Headline "
              f"left unchanged.")

    pub = merge_detail(pub, detail)
    pub = merge_payer_pin_watch(pub, pin)
    pub["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    pub["commit_sha"] = git_sha()
    out.write_text(json.dumps(pub, indent=2) + "\n")
    csv_path = write_detail_csv(payer_eps)
    print("organization type codings: "
          + ", ".join(f"{c['code']}={c['count']:,}" for c in pub["detail"]["organization_type_codings"]))
    print(f"bytes billed: detail {billed:,}, payer PIN watch {pin_billed:,}, "
          f"total {billed + pin_billed:,}")
    print(f"wrote {out}")
    print(f"wrote {csv_path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--payer-pin-watch", action="store_true",
                    help="run only the payer PIN watch and merge it into the published finding")
    ap.add_argument("--refresh-detail", action="store_true",
                    help="re-measure detail (and the PIN watch) into the published "
                         "finding without touching headline, chart or notes. "
                         "This is also what a bare run does.")
    ap.add_argument("--rewrite-headline", action="store_true",
                    help="regenerate the whole finding from the BigQuery template, "
                         "replacing headline, chart and notes. Deliberate use only.")
    args = ap.parse_args()
    if args.payer_pin_watch:
        return run_payer_pin_watch_only()
    if not args.rewrite_headline:
        return run_refresh_detail()

    client = bigquery.Client(project=PROJECT)
    pin, pin_billed = payer_pin_watch(client)
    print(f"     payer PIN watch bytes billed {pin_billed:,}")
    out_path = OUT_DIR / f"{SLUG}.json"
    prev = json.loads(out_path.read_text()) if out_path.exists() else {}
    classification = (prev.get("detail") or {}).get("payer_directory_classification")
    if not classification or classification.get("release_date") != RELEASE_DATE:
        classification = None
    detail, org_types, payer_eps, billed = measure_detail(client, pin["payer_orgs"], classification)
    print(f"     detail bytes billed {billed:,}")
    by_kind = detail["endpoint_url_kinds"]
    total_rest = sum(by_kind.values())
    directories = by_kind.get("provider-directory", 0)
    payer_type_rows = [r for r in org_types if r["code"] == PAYER_TYPE_CODE]
    status_mix = detail["payer_endpoint_status"]
    with_org = detail["payer_endpoints_with_managing_org"]
    write_detail_csv(payer_eps)

    pct = (directories / total_rest * 100) if total_rest else 0.0
    headline = (
        f"Of {total_rest:,} FHIR REST endpoints in the {RELEASE_DATE} NDH release, "
        f"{directories:,} ({pct:.4f}%) is a payer provider directory, and "
        f"{'no' if not payer_type_rows else len(payer_type_rows)} payer organization type exists "
        f"across {sum(r['n'] for r in org_types):,} typed Organization resources. "
        f"The NDH does not yet function as a payer-endpoint discovery index."
    )

    # The type paragraph is built from the measured codings. It used to state
    # "exactly three codings ... no payer type" as fixed text, which became
    # false the release a `pay` coding arrived.
    codes = ", ".join(f"{r['code']} ({r['n']:,})" for r in org_types)
    if payer_type_rows:
        type_para = (
            f"Organization.type carries these codings in this release: {codes}. "
            "A payer type is present, so payer organizations can be selected by "
            "type rather than by name."
        )
    else:
        type_para = (
            f"Organization.type carries these codings in this release: {codes}. "
            "There is no payer type, so payer organizations cannot be selected by type. "
            "Name matching is not a substitute: every Pennsylvania organization matching payer-like name "
            "patterns is in fact a provider (KEYSTONE RURAL HEALTH CENTER and similar), which is why this "
            "check classifies by endpoint host rather than organization name."
        )
    notes = (
        type_para + "\n\n"
        f"Where payer endpoints are carried, they are largely unusable as an index: of the "
        f"{len(payer_eps)} payer-host endpoints found, {with_org} carry a managingOrganization "
        f"reference, so the endpoint cannot be resolved to an organization for the rest. "
        f"Status mix: {', '.join(f'{k}={v}' for k, v in sorted(status_mix.items()))}.\n\n"
        "The provider-directory count is a floor, not a census. An address counts when its URL path "
        "names a directory or its host is shown to serve a payer's directory (analysis/payer_directory.py); "
        "a directory that does neither is not counted, so the true number may be higher. The control "
        "probe takes a directory verified live and unauthenticated and checks whether the index knows "
        "it, at that address and for the same payer at any other address.\n\n"
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
            "data": [{"label": k, "value": v} for k, v in by_kind.items()],
        },
        "notes": notes,
        "detail": detail,
    }
    # Keep what the NDJSON recheck owns: the classification it measured for
    # this release and the dated corrections.
    if classification:
        payload["detail"]["payer_directory_classification"] = classification
    if prev.get("corrections"):
        payload["corrections"] = prev["corrections"]
    payload = merge_payer_pin_watch(payload, pin)

    out = OUT_DIR / f"{SLUG}.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print("\n" + headline)
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
