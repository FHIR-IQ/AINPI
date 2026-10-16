"""Export the measure series (measures.json) to one long-format parquet file.

One row per measure x published release point, for the `measures` Delta table
in the Databricks share (analysis/databricks_publish.py --table measures).

The rows are the as-published values measures.py already assembled from
committed files. Nothing is recomputed here, and nothing is added: a release a
measure omits (the generator refused to publish it, for example a zero with no
positive control) has no row. A missing row is therefore never a zero.

Two fields need a decision because their JSON shape does not fit a column:

  comparable_to_previous   JSON true / false / "unreviewed" / null. Written as
                           a nullable STRING: "true", "false", "unreviewed",
                           or null for the first point of a series.
  restatements             A list per point. Today no point carries more than
                           one, so it is flattened into restated plus
                           as_published_* columns. A point with two raises
                           rather than dropping one silently.

release_date is a STRING, matching every other table in the share, so joins on
the partition column work across tables.

The file covers every release at once, because a regeneration can restate an
earlier point and recomputes comparable_to_previous across the series. It is
loaded with one CREATE OR REPLACE, never one release at a time.

Usage:
    python analysis/measures_parquet.py
    python analysis/measures_parquet.py --src frontend/public/api/v1/measures.json --out /tmp/m.parquet

Output (gitignored, as is all of frontend/data/):
    frontend/data/parquet-export/measures/measures.parquet
"""
from __future__ import annotations

import argparse
import json
import pathlib
from typing import Optional

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC_PATH = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "measures.json"
OUT_PATH = REPO_ROOT / "frontend" / "data" / "parquet-export" / "measures" / "measures.parquet"

# Column order is the table schema. Keep it stable: databricks_publish.py
# compares parquet columns to the table before any write.
COLUMNS = [
    "slug",
    "question",
    "unit",
    "measure_source",
    "release_date",
    "numerator",
    "denominator",
    "value",
    "definition_version",
    "numerator_definition",
    "denominator_definition",
    "comparable_to_previous",
    "comparability_reason",
    "source_file",
    "source_field",
    "source_commit",
    "source_vendored",
    "zero_control",
    "restated",
    "as_published_value",
    "as_published_numerator",
    "as_published_denominator",
    "restatement_reason",
    "restatement_source_file",
    "restatement_source_commit",
    "generated_at",
]


def _comparable(v) -> Optional[str]:
    if v is None:
        return None
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v == "unreviewed":
        return "unreviewed"
    raise ValueError(f"unexpected comparable_to_previous value {v!r}")


def build_rows(doc: dict) -> list[dict]:
    """Flatten a measures.json document into one dict per (slug, release)."""
    generated_at = doc["generated_at"]
    rows: list[dict] = []
    seen: set = set()
    for m in doc["measures"]:
        defs = {d["version"]: d for d in m.get("definitions", [])}
        for p in m["series"]:
            key = (m["slug"], p["release"])
            if key in seen:
                raise ValueError(f"{m['slug']}: two points for {p['release']}")
            seen.add(key)
            d = defs.get(p["definition_version"])
            if d is None:
                raise ValueError(f"{m['slug']}: point {p['release']} names undeclared "
                                 f"definition {p['definition_version']}")
            src = p.get("source") or {}
            rs = p.get("restatements") or []
            if len(rs) > 1:
                raise ValueError(f"{m['slug']}: {len(rs)} restatements for {p['release']}; "
                                 "the flat columns hold one")
            r = rs[0] if rs else {}
            rsrc = r.get("source") or {}
            zc = p.get("zero_control")
            rows.append({
                "slug": m["slug"],
                "question": m["question"],
                "unit": m["unit"],
                "measure_source": m.get("source"),
                "release_date": p["release"],
                "numerator": float(p["numerator"]),
                "denominator": None if p["denominator"] is None else float(p["denominator"]),
                "value": float(p["value"]),
                "definition_version": int(p["definition_version"]),
                "numerator_definition": d.get("numerator"),
                "denominator_definition": d.get("denominator"),
                "comparable_to_previous": _comparable(p.get("comparable_to_previous")),
                "comparability_reason": p.get("comparability_reason"),
                "source_file": src.get("file"),
                "source_field": src.get("field"),
                "source_commit": src.get("commit"),
                "source_vendored": src.get("vendored"),
                "zero_control": None if zc is None else json.dumps(zc, sort_keys=True),
                "restated": bool(rs),
                "as_published_value": None if not rs else float(r["as_published_value"]),
                "as_published_numerator": None if not rs else float(r["as_published_numerator"]),
                "as_published_denominator": (None if not rs or r.get("as_published_denominator") is None
                                             else float(r["as_published_denominator"])),
                "restatement_reason": r.get("reason"),
                "restatement_source_file": rsrc.get("file"),
                "restatement_source_commit": rsrc.get("commit"),
                "generated_at": generated_at,
            })
    return rows


def schema():
    import pyarrow as pa
    s, f, i, b = pa.string(), pa.float64(), pa.int64(), pa.bool_()
    types = {
        "numerator": f, "denominator": f, "value": f, "definition_version": i,
        "source_vendored": b, "restated": b, "as_published_value": f,
        "as_published_numerator": f, "as_published_denominator": f,
    }
    return pa.schema([(c, types.get(c, s)) for c in COLUMNS])


def write_parquet(rows: list[dict], out: pathlib.Path) -> int:
    import pyarrow as pa
    import pyarrow.parquet as pq
    if not rows:
        raise SystemExit("measures export has 0 rows; refusing to write an empty table")
    table = pa.Table.from_pylist(rows, schema=schema())
    out.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, out)
    return table.num_rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", default=str(SRC_PATH))
    ap.add_argument("--out", default=str(OUT_PATH))
    a = ap.parse_args(argv)
    doc = json.loads(pathlib.Path(a.src).read_text())
    n = write_parquet(build_rows(doc), pathlib.Path(a.out))
    print(f"wrote {n} rows ({len(doc['measures'])} measures) to {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
