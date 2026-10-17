"""Pennsylvania endpoint reach on two NDH releases, measured by one method.

The published Pennsylvania connectivity ledger for 2026-08-20 (built
2026-10-13 in #169) and the one for 2026-10-07 were not computed the same way.
The August ledger read H53 organization-resolution and enrollment-endpoint
CSVs last written on 2026-08-16 (0e95ed7, c8b9a28), before the 2026-08-20
reload, so its H53 side was computed on the 2026-05-08 release, and the
ledger method changed again in FHI-73 (#180, #181). Its 18.7% and the October
15.8% therefore cannot be compared.

This script reruns the current chain (H50, H51, H53, then
``state_connectivity.py pa --no-geo``) against a local parquet export of each
release, with every release-independent input held constant, and writes a
side-by-side summary. Provenance and results:
``docs/methodology/runs/2026-10-16-pa-reach-same-method.md``.

BigQuery is replaced by DuckDB over the parquet export
(``frontend/data/parquet-export/<release>/``). ``translate()`` rewrites the
handful of BigQuery-only constructs the four scripts use and refuses to run
any query it has not translated. The one NPPES query (a static public
snapshot, independent of the NDH release) is served from a JSON cache, captured
once with a real capped BigQuery job if the cache file is absent.

Inputs held constant across both releases:
  vendor endpoint files   --vendor-cache (the 2026-10-13 download was used)
  NPPES corporate parents --nppes-parent-cache
  pecos-org-crosswalk-pa.csv, hospital-ownership-crosswalk.csv,
  pa-rural-health.json    copied from the repo's published tree

Usage, from the repo root:

  # one release; outputs go to <out-dir>/<release>/
  python3 analysis/pa_reach_same_method.py run --release 2026-08-20 \\
      --export-dir frontend/data/parquet-export/2026-08-20 \\
      --out-dir /tmp/pa-reach --vendor-cache /tmp/ainpi-vendor-endpoints \\
      --nppes-parent-cache /tmp/pa-reach/parent_pa_nppes.json

  # side-by-side summary from two runs
  python3 analysis/pa_reach_same_method.py summarize \\
      --before /tmp/pa-reach/2026-08-20/states/pa-connectivity.json \\
      --after /tmp/pa-reach/2026-10-07/states/pa-connectivity.json \\
      --write frontend/public/api/v1/states/pa-reach-same-method.json

Only ``summarize`` and the pure functions above ``run_release`` are covered by
``analysis/tests/test_pa_reach_same_method.py``; they need the standard library
only. ``run`` needs duckdb and the parquet exports.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import re
import shutil
import subprocess
import sys
import types

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
API_V1 = REPO_ROOT / "frontend" / "public" / "api" / "v1"
RUN_DOC = "docs/methodology/runs/2026-10-16-pa-reach-same-method.md"
SITE = "https://ainpi.dev"

# Release-independent inputs copied into every run so both releases see the
# same CMS enrollment, ownership and H47 data.
CONSTANT_INPUTS = [
    ("pecos-org-crosswalk-pa.csv", "findings"),
    ("hospital-ownership-crosswalk.csv", "findings"),
    ("pa-rural-health.json", "states"),
]
TABLES = ["practitioner", "practitioner_role", "organization", "endpoint",
          "organization_affiliation"]


# --------------------------------------------------------------------------
# pure functions (tested offline)
# --------------------------------------------------------------------------

def pct(n: int, d: int) -> float:
    return round(100.0 * n / d, 1) if d else 0.0


def release_summary(payload: dict) -> dict:
    """The comparable numbers from one ``pa-connectivity.json`` payload."""
    s = payload["summary"]
    c = payload["confidence"]
    tiers = c.get("resolved_by_tier") or {}
    n = s["practitioners"]
    return {
        "release_date": payload.get("release_date"),
        "practitioners": n,
        "with_role": s["with_role"],
        "with_role_pct": s["with_role_pct"],
        "affiliated_any_source": s["affiliated_any_source"],
        "reaches_endpoint": s["reaches_endpoint"],
        "reaches_endpoint_pct": s["reaches_endpoint_pct"],
        "reaches_endpoint_pct_of_affiliated": s["reaches_endpoint_pct_of_affiliated"],
        "reaches_endpoint_deterministic": s["reaches_endpoint_deterministic"],
        "reaches_endpoint_deterministic_pct": s["reaches_endpoint_deterministic_pct"],
        "tiers": {
            "ndh_only": c["green"],
            "vendor_npi": c["yellow"],
            "vendor_npi_list": c["vendor_list"],
            "resolved": c["resolved"],
            "resolved_alias": tiers.get("alias"),
            "resolved_name_state": tiers.get("name-state"),
            "resolved_brand_state": tiers.get("brand-state"),
            "enrollment_only": c["enrolled"],
            "name_candidate_only": c["candidate"],
            "affiliated_no_endpoint": c["red"],
            "no_organization": c["none"],
        },
    }


def check_summary(r: dict) -> list[str]:
    """Internal consistency of one release summary. Returns problems found."""
    t = r["tiers"]
    problems = []
    reach = (t["ndh_only"] + t["vendor_npi"] + t["vendor_npi_list"]
             + t["resolved"] + t["enrollment_only"])
    if reach != r["reaches_endpoint"]:
        problems.append(f"tiers sum to {reach}, reaches_endpoint is {r['reaches_endpoint']}")
    det = t["ndh_only"] + t["vendor_npi"]
    if det != r["reaches_endpoint_deterministic"]:
        problems.append(f"ndh_only + vendor_npi = {det}, deterministic is "
                        f"{r['reaches_endpoint_deterministic']}")
    parts = [t["resolved_alias"], t["resolved_name_state"], t["resolved_brand_state"]]
    if None not in parts and sum(parts) != t["resolved"]:
        problems.append(f"resolved_by_tier sums to {sum(parts)}, resolved is {t['resolved']}")
    total = (reach + t["name_candidate_only"] + t["affiliated_no_endpoint"]
             + t["no_organization"])
    if total != r["practitioners"]:
        problems.append(f"bands sum to {total}, practitioners is {r['practitioners']}")
    if pct(r["reaches_endpoint"], r["practitioners"]) != r["reaches_endpoint_pct"]:
        problems.append("reaches_endpoint_pct does not match its counts")
    if pct(r["reaches_endpoint"], r["affiliated_any_source"]) != r["reaches_endpoint_pct_of_affiliated"]:
        problems.append("reaches_endpoint_pct_of_affiliated does not match its counts")
    return problems


def _delta(a, b):
    if isinstance(a, dict):
        return {k: _delta(a[k], b[k]) for k in a}
    if a is None or b is None or isinstance(a, str):
        return None
    d = b - a
    return round(d, 1) if isinstance(d, float) else d


def build_side_by_side(before: dict, after: dict, *, source_commit: str,
                       run_commit: str, generated_at: str) -> dict:
    """Side-by-side payload for two ``pa-connectivity.json`` runs."""
    a, b = release_summary(before), release_summary(after)
    for r in (a, b):
        problems = check_summary(r)
        if problems:
            raise ValueError(f"{r['release_date']}: " + "; ".join(problems))
    if a["release_date"] == b["release_date"]:
        raise ValueError("both runs are on the same release")
    keys = [k for k in a if k != "release_date"]
    return {
        "state": "PA",
        "slug": "pa-reach-same-method",
        "generated_at": generated_at,
        "source_commit": source_commit,
        "run_commit": run_commit,
        "commit_note": (
            "source_commit is the pipeline code the measurement ran on; "
            "run_commit is the checkout the vendored script was rerun from. "
            "They differ only in H49, which is outside this chain."
        ),
        "units": (
            "Counts are practitioners. Fields ending _pct are percentages, and "
            "in `change` their values are differences in percentage points."
        ),
        "tier_notes": {
            "reaching": ["ndh_only", "vendor_npi", "vendor_npi_list",
                         "resolved", "enrollment_only"],
            "resolved_alias, resolved_name_state, resolved_brand_state":
                "split of resolved; not added again",
            "name_candidate_only":
                "excluded from reach: an endpoint exists under a matching "
                "name with nothing deterministic tying it to the organization",
            "affiliated_no_endpoint, no_organization": "do not reach an endpoint",
        },
        "run_doc": f"https://github.com/FHIR-IQ/AINPI/blob/main/{RUN_DOC}",
        "question": (
            "Did Pennsylvania endpoint reach fall between the 2026-08-20 and "
            "2026-10-07 NDH releases when both are measured by the same method "
            "on consistent inputs?"
        ),
        "method": (
            "The current connectivity chain (H50, H51, H53, then "
            "state_connectivity.py pa --no-geo) was run on each release from "
            "the local parquet export, read through DuckDB in place of "
            "BigQuery. Vendor endpoint files (2026-10-13 download), the NPPES "
            "corporate-parent snapshot, the CMS enrollment crosswalk, the "
            "hospital ownership crosswalk and the H47 rural file were held "
            "constant, so the difference isolates the change on the NDH side."
        ),
        "releases": {a["release_date"]: {k: a[k] for k in keys},
                     b["release_date"]: {k: b[k] for k in keys}},
        "change": {k: _delta(a[k], b[k]) for k in keys},
        "superseded_comparison": {
            "note": (
                "The published ledgers read 18.7% (2026-08-20, built 2026-10-13) "
                "and 15.8% (2026-10-07, before FHI-73). The August file used H53 "
                "organization-resolution and enrollment-endpoint CSVs last "
                "written on 2026-08-16, before the 2026-08-20 reload, so its H53 "
                "side was computed on the 2026-05-08 release. That pair mixes "
                "releases and methods and should not be cited as a change."
            ),
            "stale_inputs": [
                {"file": "states/pa-org-endpoint-resolution.csv", "last_written": "0e95ed7"},
                {"file": "states/pa-enrollment-endpoint.csv", "last_written": "c8b9a28"},
            ],
        },
        "limits": [
            "Run with --no-geo. The summary, funnel and confidence bands do not "
            "depend on the county layer.",
            "Vendor files were held at one download, so vendor-side change "
            "between August and October is excluded by design.",
            "BigQuery SQL was run through DuckDB with a small set of rewrites. "
            "The October run reproduces the committed October summary, "
            "funnel, confidence bands and all four intermediate CSVs (as row "
            "sets), except vendor_known, which varies by one between runs "
            "with row order (49,455 or 49,456; 49,456 committed). It is not "
            "part of the reach count.",
            "Pennsylvania only.",
        ],
    }


# --------------------------------------------------------------------------
# DuckDB stand-in for the BigQuery client
# --------------------------------------------------------------------------

def translate(sql: str) -> str:
    """Rewrite the BigQuery constructs the chain uses into DuckDB SQL."""
    s = re.sub(r"`thematic-fort-453901-t7\.cms_npd\.(\w+)`", r"\1", sql)
    s = s.replace("@state", "$state")
    s = re.sub(r"COUNTIF\(", "count_if(", s)
    s = re.sub(r"REGEXP_EXTRACT\(([^,]+\)), r'([^']*)'\)",
               r"regexp_extract(\1, '\2', 1)", s)
    s = re.sub(r"ARRAY_AGG\(DISTINCT (\w+\.\w+) IGNORE NULLS\)",
               r"coalesce(list_sort(list(DISTINCT \1) FILTER (WHERE \1 IS NOT NULL)), [])", s)
    if "ARRAY_AGG" in s or "IGNORE NULLS" in s or "OFFSET(" in s:
        raise RuntimeError("untranslated BigQuery construct:\n" + s)
    return s


def capture_parent_cache(path: pathlib.Path) -> None:
    """One capped real BigQuery job for the NPPES corporate-parent rows."""
    sys.path.insert(0, str(REPO_ROOT / "analysis"))
    import state_connectivity as sc  # real google.cloud.bigquery, capped config
    rows = [dict(r.items()) for r in sc.run_query(sc.PARENT_SQL, "PA")]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows))
    print(f"captured {len(rows):,} NPPES parent rows -> {path}")


def install_fake_bigquery(export_dir: pathlib.Path, parent_rows: list, log: list):
    import duckdb

    con = duckdb.connect()
    for t in TABLES:
        f = export_dir / f"{t}.parquet"
        if not f.exists():
            raise SystemExit(f"missing {f}")
        con.execute(f"CREATE VIEW {t} AS SELECT * FROM read_parquet('{f}')")

    class Job:
        total_bytes_processed = 0

        def __init__(self, rows):
            self.rows = rows

        def result(self):
            return self.rows

    class Client:
        def __init__(self, *a, **k):
            pass

        def query(self, sql, job_config=None):
            params = {p.name: p.value
                      for p in getattr(job_config, "query_parameters", []) or []}
            if "bigquery-public-data.nppes.npi_raw" in sql:
                assert params.get("state") == "PA"
                log.append("NPPES parent query served from cache")
                return Job([dict(r) for r in parent_rows])
            s = translate(sql)
            used = {k: v for k, v in params.items() if f"${k}" in s}
            cur = con.execute(s, used) if used else con.execute(s)
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            log.append(f"{len(rows)} rows: {' '.join(sql.split())[:90]}")
            return Job(rows)

    class QueryJobConfig:
        def __init__(self, **k):
            self.query_parameters = []
            self.__dict__.update(k)

    class ScalarQueryParameter:
        def __init__(self, name, typ, value):
            self.name, self.type, self.value = name, typ, value

    fake = types.ModuleType("google.cloud.bigquery")
    fake.Client = Client
    fake.QueryJobConfig = QueryJobConfig
    fake.ScalarQueryParameter = ScalarQueryParameter
    import google.cloud  # namespace package
    sys.modules["google.cloud.bigquery"] = fake
    google.cloud.bigquery = fake


def run_release(release: str, export_dir: pathlib.Path, out_dir: pathlib.Path,
                vendor_cache: pathlib.Path, parent_cache: pathlib.Path) -> None:
    out = out_dir / release
    find, states = out / "findings", out / "states"
    find.mkdir(parents=True, exist_ok=True)
    states.mkdir(parents=True, exist_ok=True)
    for name, sub in CONSTANT_INPUTS:
        shutil.copy(API_V1 / sub / name, out / sub / name)
    if not vendor_cache.is_dir() or not any(vendor_cache.glob("*.json")):
        raise SystemExit(f"vendor cache {vendor_cache} is empty; run H51 once to populate it")
    if not parent_cache.exists():
        capture_parent_cache(parent_cache)
    parent_rows = json.loads(parent_cache.read_text())

    log: list[str] = []
    install_fake_bigquery(export_dir, parent_rows, log)
    sys.path.insert(0, str(REPO_ROOT))
    sys.path.insert(0, str(REPO_ROOT / "analysis"))

    def no_download(url, dest):
        if not dest.exists():
            raise RuntimeError(f"vendor cache missing {dest}; refusing to download")
        return json.loads(dest.read_text(errors="ignore"))

    def call(mod, argv):
        sys.argv = argv
        rc = mod.main()
        print(f"[{argv[0]}] rc={rc}", flush=True)
        if rc not in (None, 0):
            raise SystemExit(f"{argv[0]} failed with {rc}")

    import h50_endpoint_org_linkage as h50
    h50.OUT_DIR, h50.RELEASE_DATE = find, release
    call(h50, ["h50"])

    import h51_vendor_endpoint_attribution as h51
    h51.OUT_DIR, h51.RELEASE_DATE, h51.CACHE = find, release, vendor_cache
    h51.fetch = no_download
    call(h51, ["h51"])

    import analysis.h53_org_endpoint_resolution as h53
    h53.OUT_DIR, h53.STATES_DIR, h53.NDH_RELEASE = find, states, release
    h53.CACHE = vendor_cache
    call(h53, ["h53", "pa", "--sample", "0"])

    import analysis.state_connectivity as sc
    sc.FINDINGS_DIR, sc.STATES_DIR, sc.NDH_RELEASE = find, states, release
    call(sc, ["sc", "pa", "--no-geo", "--out-dir", str(states)])

    (out / "query-log.txt").write_text("\n".join(log) + "\n")


def git_head() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       cwd=REPO_ROOT, text=True).strip()
    except Exception:
        return "unknown"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run the chain on one release")
    r.add_argument("--release", required=True)
    r.add_argument("--export-dir", required=True, type=pathlib.Path)
    r.add_argument("--out-dir", required=True, type=pathlib.Path)
    r.add_argument("--vendor-cache", default="/tmp/ainpi-vendor-endpoints", type=pathlib.Path)
    r.add_argument("--nppes-parent-cache", required=True, type=pathlib.Path)
    s = sub.add_parser("summarize", help="side-by-side summary of two runs")
    s.add_argument("--before", required=True, type=pathlib.Path)
    s.add_argument("--after", required=True, type=pathlib.Path)
    s.add_argument("--source-commit", default=None,
                   help="commit the pipeline ran at (default: this checkout's HEAD)")
    s.add_argument("--run-commit", default=None,
                   help="checkout the script ran from (default: this checkout's HEAD)")
    s.add_argument("--write", type=pathlib.Path)
    args = ap.parse_args(argv)

    if args.cmd == "run":
        run_release(args.release, args.export_dir.resolve(), args.out_dir.resolve(),
                    args.vendor_cache, args.nppes_parent_cache)
        return 0

    payload = build_side_by_side(
        json.loads(args.before.read_text()), json.loads(args.after.read_text()),
        source_commit=args.source_commit or git_head(),
        run_commit=args.run_commit or git_head(),
        generated_at=dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
    )
    text = json.dumps(payload, indent=2) + "\n"
    if args.write:
        args.write.write_text(text)
        print(f"wrote {args.write}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
