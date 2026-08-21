"""Snapshot the headline shape of whatever NDH release is currently in BigQuery.

The bulk tables carry no release column and `fast_ingest_ndh.py` loads with
`--replace`, so the moment a new release lands the previous one is gone from
the warehouse. Every release-over-release delta this project publishes
therefore depends on someone having captured the outgoing numbers *before*
the load, and nothing in the pipeline did that.

Run this immediately before an ingest. It writes a small JSON per release, so
deltas become a diff of two files rather than an archaeology exercise.

Usage:
    python analysis/release_snapshot.py --release 2026-05-08
    python analysis/release_snapshot.py --release 2026-08-20 --compare 2026-05-08

Outputs:
    analysis/release-snapshots/<release>.json        (tracked, tiny)
    frontend/public/api/v1/release-deltas.json       (when --compare is given)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from analysis.claims_sources._cohorts import bq_job_config  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
# Deliberately NOT under analysis/data/, which is gitignored for bulk files.
# Once fast_ingest_ndh.py runs with --replace, the snapshot is the only
# surviving record of the outgoing release, so it has to be in version
# control. Each file is a few KB.
SNAP_DIR = REPO_ROOT / "analysis" / "release-snapshots"
API = REPO_ROOT / "frontend" / "public" / "api" / "v1"
PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"

TABLES = ("practitioner", "organization", "location", "endpoint",
          "practitioner_role", "organization_affiliation")


def counts(client):
    """Row counts per table, from table metadata rather than COUNT(*).

    __TABLES__ is free and exact for row counts. Six COUNT(*) scans would
    cost real money for a number BigQuery already stores.
    """
    sql = f"""
    SELECT table_id, row_count, size_bytes
    FROM `{PROJECT}.{DATASET}.__TABLES__`
    WHERE table_id IN UNNEST(@t)
    """
    from google.cloud import bigquery
    cfg = bq_job_config()
    cfg.query_parameters = [bigquery.ArrayQueryParameter("t", "STRING", list(TABLES))]
    return {r["table_id"]: {"rows": r["row_count"], "bytes": r["size_bytes"]}
            for r in client.query(sql, job_config=cfg).result()}


def shape(client):
    """The handful of derived numbers the site quotes most often."""
    out = {}
    q = lambda sql: [dict(r) for r in client.query(sql, job_config=bq_job_config()).result()]

    out["organization_types"] = q(f"""
        SELECT COALESCE(JSON_VALUE(resource,'$.type[0].coding[0].code'),
                        CONCAT('text:', JSON_VALUE(resource,'$.type[0].text'))) AS kind,
               COUNT(*) AS n
        FROM `{PROJECT}.{DATASET}.organization`
        GROUP BY kind ORDER BY n DESC LIMIT 12
    """)
    out["endpoint_connection_types"] = q(f"""
        SELECT _connection_type AS kind, COUNT(*) AS n
        FROM `{PROJECT}.{DATASET}.endpoint`
        GROUP BY kind ORDER BY n DESC LIMIT 8
    """)
    out["practitioners_active"] = q(f"""
        SELECT COUNTIF(_active) AS active, COUNT(*) AS total
        FROM `{PROJECT}.{DATASET}.practitioner`
    """)[0]
    out["roles_active"] = q(f"""
        SELECT COUNTIF(_active) AS active, COUNT(*) AS total
        FROM `{PROJECT}.{DATASET}.practitioner_role`
    """)[0]
    out["endpoints_with_managing_org"] = q(f"""
        SELECT COUNTIF(_managing_org_id IS NOT NULL AND _managing_org_id != '') AS with_org,
               COUNT(*) AS total
        FROM `{PROJECT}.{DATASET}.endpoint`
        WHERE _connection_type = 'hl7-fhir-rest'
    """)[0]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", required=True)
    ap.add_argument("--compare", default=None,
                    help="earlier release to diff against")
    args = ap.parse_args()

    from google.cloud import bigquery
    client = bigquery.Client(project=PROJECT)

    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    snap = {
        "release": args.release,
        "captured_at": dt.datetime.now(dt.timezone.utc)
                         .replace(microsecond=0).isoformat(),
        "tables": counts(client),
        "shape": shape(client),
    }
    path = SNAP_DIR / f"{args.release}.json"
    path.write_text(json.dumps(snap, indent=2) + "\n")
    print(f"Wrote {path}")
    for t, v in sorted(snap["tables"].items()):
        print(f"  {t:26s} {v['rows']:>12,}")

    if args.compare:
        prev_path = SNAP_DIR / f"{args.compare}.json"
        if not prev_path.exists():
            raise SystemExit(f"no snapshot for {args.compare} at {prev_path}")
        prev = json.loads(prev_path.read_text())
        rows = []
        for t in sorted(TABLES):
            a = prev["tables"].get(t, {}).get("rows")
            b = snap["tables"].get(t, {}).get("rows")
            if a is None or b is None:
                continue
            rows.append({
                "table": t, "before": a, "after": b, "delta": b - a,
                "pct": round(100.0 * (b - a) / a, 1) if a else None,
            })
        payload = {
            "from": args.compare, "to": args.release,
            "generated_at": snap["captured_at"],
            "note": ("Row-count deltas between two NDH bulk releases. Captured "
                     "before and after ingest because the tables carry no "
                     "release column and the load replaces them."),
            "tables": rows,
            "before_shape": prev["shape"], "after_shape": snap["shape"],
        }
        out = API / "release-deltas.json"
        out.write_text(json.dumps(payload, indent=2) + "\n")
        print(f"\nWrote {out}")
        print(f"  {'table':26s}{'before':>13}{'after':>13}{'delta':>13}{'pct':>8}")
        for r in rows:
            print(f"  {r['table']:26s}{r['before']:>13,}{r['after']:>13,}"
                  f"{r['delta']:>+13,}{str(r['pct']):>8}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
