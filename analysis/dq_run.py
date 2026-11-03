"""Run the ndh_quality rules on local NDH releases and merge the rows into
frontend/public/api/v1/dq-results.json.

The file is append-safe. Rows are keyed on (release_date, rule_id,
rule_version) and merged into what is already committed, never regenerated,
so a release this run did not touch keeps its rows byte for byte. When a rule
is re-run against an input that has changed (different row counts, byte size
or export sha), the old row is kept and marked superseded rather than
overwritten, the same pattern as `restated` in measures.json.

Run (owner-run, after export_parquet.py; needs duckdb via ndh_quality/.venv):
    ndh_quality/.venv/bin/python analysis/dq_run.py --release 2026-10-07

Exit codes: 0 clean, 1 if a `pipeline` row for a requested release is not
`pass`, or an input is a macOS iCloud placeholder. Results are written before
the pipeline exit, so a failure is published, not withheld.

ndh_quality is imported only inside main(): CI runs analysis/tests without
duckdb, and everything tested there is pure.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import pathlib
import subprocess
import sys
from datetime import datetime, timezone

import pyarrow.parquet as pq

ROOT = pathlib.Path(__file__).resolve().parent.parent
PARQUET_ROOT = ROOT / "frontend" / "data" / "parquet-export"
RESULTS = ROOT / "frontend" / "public" / "api" / "v1" / "dq-results.json"
MEASURES = ROOT / "frontend" / "public" / "api" / "v1" / "measures.json"

SCHEMA_VERSION = 1
SF_DATALESS = 0x40000000

# Releases the warehouse still holds, oldest first. 2026-04-09 is retired and
# is never a "previous" release.
RUN_RELEASES = ("2026-05-08", "2026-08-20", "2026-10-07")

# Every resource any registered rule reads. Used to check for placeholders
# before ndh_quality is imported; the registry re-checks its own inputs.
RUNNER_RESOURCES = ("endpoint", "organization", "practitioner", "practitioner_role")

# Which measures.json definition_version each rule's measure implements. A
# rule is only compared with a point written under the same definition;
# otherwise the pair is `definition_mismatch`, not true or false.
PAIRED_MEASURE_DEFINITION = {
    "endpoint-org-linkage": 1,
    "npi-validation-failures": 1,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def assert_local(paths) -> None:
    """Stop, naming the file, on an iCloud placeholder. Must run before any read."""
    for p in paths:
        flags = getattr(os.stat(p), "st_flags", 0)
        if flags & SF_DATALESS:
            raise RuntimeError(f"{p} is dataless (not downloaded locally); materialize it first")


def input_fingerprint(release_dir, resources: list[str]) -> dict:
    """Row count (parquet footer, no scan) and byte size per input, plus the export sha."""
    release_dir = pathlib.Path(release_dir)
    paths = {r: release_dir / f"{r}.parquet" for r in resources}
    assert_local([p for p in paths.values() if p.exists()])
    fp: dict = {}
    for res, path in paths.items():
        if not path.exists():
            fp[res] = None
            continue
        fp[res] = {"rows": pq.ParquetFile(path).metadata.num_rows,
                   "bytes": os.stat(path).st_size}
    sha = None
    meta = release_dir / "_export.json"
    if meta.exists():
        try:
            j = json.loads(meta.read_text())
            sha = j.get("export_sha") or j.get("git_sha")
        except (OSError, ValueError):
            sha = None
    fp["export_sha"] = sha
    return fp


def _key(r: dict) -> tuple:
    return (r["release_date"], r["rule_id"], r["rule_version"])


def merge_results(existing: dict, new_rows: list[dict]) -> dict:
    """Merge new rows into an existing results document. Pure; inputs untouched."""
    rows = [copy.deepcopy(r) for r in existing.get("rows", [])]
    for new in new_rows:
        new = copy.deepcopy(new)
        keep = []
        for old in rows:
            if _key(old) != _key(new) or old.get("superseded_by"):
                keep.append(old)
                continue
            if old.get("input_fingerprint") != new.get("input_fingerprint"):
                old["superseded_by"] = f"{new['rule_version']}@{new['run_at']}"
                keep.append(old)
            # same key and same fingerprint: the old row is replaced
        keep.append(new)
        rows = keep
    rows.sort(key=lambda r: (r["release_date"], r["rule_id"], r["rule_version"],
                             0 if r.get("superseded_by") else 1, r.get("run_at") or ""))
    stamps = [r["run_at"] for r in new_rows if r.get("run_at")]
    generated = max(stamps) if stamps else existing.get("generated_at") or utc_now()
    return {"schema_version": SCHEMA_VERSION, "generated_at": generated, "rows": rows}


def _point(measure: dict, release: str) -> dict | None:
    for pt in measure.get("series", []):
        if pt.get("release") == release:
            return pt
    return None


def pair_measure(row: dict, measures: dict) -> dict:
    """Compare a rule row with the published measure point for the same release."""
    slug = row.get("measure")
    out = {"measure_value": None, "measure_agrees": "not_paired"}
    if slug not in PAIRED_MEASURE_DEFINITION:
        return out
    measure = next((m for m in measures.get("measures", []) if m.get("slug") == slug), None)
    pt = _point(measure, row["release_date"]) if measure else None
    if pt is None:
        out["measure_agrees"] = "no_point"
        return out
    out["measure_value"] = pt.get("value")
    if pt.get("definition_version") != PAIRED_MEASURE_DEFINITION[slug]:
        out["measure_agrees"] = "definition_mismatch"
        return out
    num, den = row.get("numerator"), row.get("denominator")
    if num is None or den is None:
        out["measure_agrees"] = "not_paired"
        return out
    if slug == "npi-validation-failures":
        # The rule counts valid NPIs; the measure is a failure share.
        agree = (den - num) == pt.get("numerator") and den == pt.get("denominator")
    else:
        agree = num == pt.get("numerator") and den == pt.get("denominator")
    out["measure_agrees"] = "true" if agree else "false"
    return out


def previous_release(release: str, root=None) -> str | None:
    root = pathlib.Path(root or PARQUET_ROOT)
    earlier = [r for r in RUN_RELEASES if r < release and (root / r).is_dir()]
    return earlier[-1] if earlier else None


def _git_sha() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, check=True,
                              capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--release", action="append", required=True, metavar="YYYY-MM-DD")
    args = ap.parse_args(argv)

    plan = []
    for rel in args.release:
        rdir = PARQUET_ROOT / rel
        prev = previous_release(rel)
        plan.append((rel, rdir, PARQUET_ROOT / prev if prev else None))
    try:
        for _, rdir, pdir in plan:
            for d in (rdir, pdir):
                if d is not None:
                    assert_local([d / f"{r}.parquet" for r in RUNNER_RESOURCES
                                  if (d / f"{r}.parquet").exists()])
    except RuntimeError as exc:
        print(f"dq_run: {exc}", file=sys.stderr)
        return 1

    import duckdb  # noqa: E402
    sys.path.insert(0, str(ROOT / "ndh_quality"))
    from ndh_quality.registry import all_rules, run_release  # noqa: E402

    resources = sorted({res for r in all_rules() for res in r.resources})
    measures = json.loads(MEASURES.read_text()) if MEASURES.exists() else {"measures": []}
    engine, sha, run_at = f"duckdb {duckdb.__version__}", _git_sha(), utc_now()

    new_rows: list[dict] = []
    for rel, rdir, pdir in plan:
        try:
            fp = input_fingerprint(rdir, resources)
            rows = run_release(rdir, pdir)
        except RuntimeError as exc:
            print(f"dq_run: {exc}", file=sys.stderr)
            return 1
        for r in rows:
            r.update({"release_date": rel, "input_fingerprint": fp, "engine": engine,
                      "git_sha": sha, "run_at": run_at, "superseded_by": None})
            r.update(pair_measure(r, measures))
            new_rows.append(r)

    existing = json.loads(RESULTS.read_text()) if RESULTS.exists() else {"rows": []}
    out = merge_results(existing, new_rows)
    RESULTS.write_text(json.dumps(out, indent=2, sort_keys=False) + "\n")
    print(f"dq_run: wrote {len(new_rows)} rows for {', '.join(args.release)} to {RESULTS}")

    failed = [r for r in new_rows if r["severity"] == "pipeline" and r["status"] != "pass"]
    for r in failed:
        print(f"dq_run: pipeline rule {r['rule_id']} {r['release_date']}: {r['status']}",
              file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
