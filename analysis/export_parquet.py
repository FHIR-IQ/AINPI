"""Export NDH releases to parquet — the open-tables distribution.

Converts the local NDJSON.zst release files into flattened parquet, one file
per resource per release, matching the BigQuery flexible FHIR-as-JSON schema
(full `resource` JSON string + extracted `_*` columns). The extraction logic
is IMPORTED from analysis/fast_ingest_ndh.py, so the parquet columns agree
with the BQ tables by construction.

Why parquet + why local: the raw CMS files are 2-5 GB zst NDJSON per release
and directory.cms.gov serves only the LATEST release. Publishing flattened
parquet per release (e.g. on HuggingFace, where DuckDB can query hf:// paths
directly) gives the community two things CMS does not: a release archive and
a 30-second query path with no download-and-ingest step. Everything here runs
locally: zero BigQuery, zero cloud egress.

Usage:
    python analysis/export_parquet.py --release 2026-05-08
    python analysis/export_parquet.py --release 2026-04-09
    python analysis/export_parquet.py --release 2026-05-08 --resource Practitioner
    python analysis/export_parquet.py --cohort   # exclusions cohort only

Output:
    frontend/data/parquet-export/<release>/<table>.parquet
    frontend/data/parquet-export/exclusions/high_risk_cohort.parquet

(frontend/data/ is gitignored and vercelignored; nothing here ships in git.)
"""
from __future__ import annotations

import argparse
import csv
import json
import pathlib
import subprocess
import sys
import time

import pyarrow as pa
import pyarrow.parquet as pq

# Reuse the exact extraction logic the BQ ingest uses.
from fast_ingest_ndh import RESOURCES  # (name, table, extractor)

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_ROOT = REPO_ROOT / "frontend" / "data" / "parquet-export"

# Local release dirs. The April dir predates the dated-naming convention.
RELEASE_DIRS = {
    "2026-04-09": REPO_ROOT / "frontend" / "data" / "cms-npd",
    "2026-05-08": REPO_ROOT / "frontend" / "data" / "cms-npd-2026-05-08",
}

BATCH_ROWS = 100_000


def schema_for(extractor) -> pa.Schema:
    """Derive the parquet schema from the extractor's key set.

    Every extractor is total on `{}` (uses .get throughout), so calling it on
    an empty resource yields the full column list. `_active` is the only
    boolean; everything else is a nullable string, matching the BQ pattern.
    """
    keys = list(extractor({}).keys())
    fields = [pa.field("resource", pa.string())]
    for k in keys:
        fields.append(pa.field(k, pa.bool_() if k == "_active" else pa.string()))
    return pa.schema(fields)


def export_resource(name: str, table: str, extractor, src_dir: pathlib.Path, out_dir: pathlib.Path) -> int:
    zst = src_dir / f"{name}.ndjson.zst"
    if not zst.exists():
        print(f"  {name}: SKIP (no {zst.name} in {src_dir})")
        return 0
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{table}.parquet"

    schema = schema_for(extractor)
    cols = [f.name for f in schema]

    proc = subprocess.Popen(["zstdcat", str(zst)], stdout=subprocess.PIPE)
    writer = pq.ParquetWriter(out_path, schema, compression="zstd")

    batch: dict[str, list] = {c: [] for c in cols}
    n = 0
    errors = 0
    t0 = time.time()

    def flush() -> None:
        if not batch["resource"]:
            return
        writer.write_batch(pa.record_batch([batch[c] for c in cols], schema=schema))
        for c in cols:
            batch[c].clear()

    assert proc.stdout is not None
    for line_bytes in proc.stdout:
        try:
            line = line_bytes.decode("utf-8").strip()
            if not line:
                continue
            resource = json.loads(line)
            row = extractor(resource)
            batch["resource"].append(line)
            for k, v in row.items():
                if k == "_active":
                    batch[k].append(bool(v))
                else:
                    batch[k].append(v if v is None else str(v))
            n += 1
            if n % BATCH_ROWS == 0:
                flush()
                rate = n / (time.time() - t0)
                print(f"    {name}: {n:,} rows ({rate:,.0f}/s)", flush=True)
        except (json.JSONDecodeError, UnicodeDecodeError):
            errors += 1
    flush()
    writer.close()
    proc.wait()

    mb = out_path.stat().st_size / 1e6
    print(f"  {name}: {n:,} rows -> {out_path.name} ({mb:,.0f} MB, {errors} errors, {time.time() - t0:,.0f}s)")
    return n


def export_cohort() -> None:
    """High-risk cohort CSV -> parquet (the pre-joined exclusions table)."""
    src = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings" / "high-risk-cohort-export.csv"
    out_dir = OUT_ROOT / "exclusions"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "high_risk_cohort.parquet"

    with open(src, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    cols = list(rows[0].keys())
    data = {c: [r[c] for r in rows] for c in cols}
    table = pa.table(data)
    pq.write_table(table, out_path, compression="zstd")
    print(f"  cohort: {len(rows):,} rows -> {out_path} ({out_path.stat().st_size/1e3:,.0f} KB)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", choices=sorted(RELEASE_DIRS), help="NDH release to export")
    parser.add_argument("--resource", help="single resource name (e.g. Practitioner); default all six")
    parser.add_argument("--cohort", action="store_true", help="export the exclusions cohort parquet only")
    args = parser.parse_args()

    if args.cohort:
        export_cohort()
        return
    if not args.release:
        parser.error("--release is required unless --cohort")

    src_dir = RELEASE_DIRS[args.release]
    out_dir = OUT_ROOT / args.release
    targets = [r for r in RESOURCES if not args.resource or r[0].lower() == args.resource.lower()]
    if not targets:
        print(f"unknown resource: {args.resource}", file=sys.stderr)
        sys.exit(2)

    print(f"Exporting {args.release} from {src_dir} -> {out_dir}")
    total = 0
    t0 = time.time()
    for name, table, extractor in targets:
        total += export_resource(name, table, extractor, src_dir, out_dir)
    print(f"Done: {total:,} rows in {time.time() - t0:,.0f}s")


if __name__ == "__main__":
    main()
