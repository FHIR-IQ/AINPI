"""Backfill the telecom / address.line / position flattened columns.

`fast_ingest_ndh.py` populates these on ingest, but the NDH release cadence
means the next full load can be months away, and `bq load` runs with
`--ignore_unknown_values`, so the columns stay NULL until then. This fills them
in place from the `resource` JSON already stored in each table.

Idempotent: it recomputes every row from the resource column, so re-running is
safe and converges on the same values the ingest flattener would produce.

The SQL deliberately mirrors `fast_ingest_ndh.py` field for field:

  _phone        first telecom entry whose system is 'phone' (NOT the first
                telecom entry, which is frequently a fax)
  _telecom      every entry as 'system:value', pipe-joined, source order
  _address_line address.line entries pipe-joined, source order
  _position_*   Location.position latitude/longitude as FLOAT64

Source order is pinned with WITH OFFSET ... ORDER BY offset. Without it
BigQuery does not guarantee UNNEST ordering, and _phone could pick a different
number than the Python flattener on the same record.

Run:  python analysis/backfill_flattened_columns.py [--dry-run] [--table NAME]

Cost: one pass over the resource JSON column of each table. Capped via
bq_job_config(). Roughly $0.15 for all four tables.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone

from google.cloud import bigquery

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from claims_sources._cohorts import bq_job_config  # noqa: E402

import sys as _sys, pathlib as _pathlib
_sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parent))
from release import CURRENT_RELEASE as RELEASE_DATE  # noqa: E402

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"


def telecom_sql(path: str = "$.telecom") -> tuple[str, str]:
    """(first-phone expression, pipe-joined system:value expression)."""
    phone = f"""(
      SELECT JSON_VALUE(t, '$.value')
      FROM UNNEST(JSON_QUERY_ARRAY(resource, '{path}')) t WITH OFFSET o
      WHERE JSON_VALUE(t, '$.system') = 'phone'
        AND JSON_VALUE(t, '$.value') IS NOT NULL
      ORDER BY o LIMIT 1
    )"""
    joined = f"""NULLIF(ARRAY_TO_STRING(ARRAY(
      SELECT CONCAT(IFNULL(JSON_VALUE(t, '$.system'), 'unknown'), ':', JSON_VALUE(t, '$.value'))
      FROM UNNEST(JSON_QUERY_ARRAY(resource, '{path}')) t WITH OFFSET o
      WHERE JSON_VALUE(t, '$.value') IS NOT NULL
      ORDER BY o
    ), '|'), '')"""
    return phone, joined


def line_sql(path: str) -> str:
    return f"""NULLIF(ARRAY_TO_STRING(ARRAY(
      SELECT l FROM UNNEST(JSON_VALUE_ARRAY(resource, '{path}')) l WITH OFFSET o
      WHERE l IS NOT NULL AND l != '' ORDER BY o
    ), '|'), '')"""


def statements() -> dict[str, str]:
    phone, telecom = telecom_sql()
    t = f"`{PROJECT}.{DATASET}`"
    return {
        # Practitioner/Organization: address is 0..* so the first entry wins,
        # matching the existing _state/_city columns.
        "practitioner": f"""UPDATE {t}.practitioner SET
              _address_line = {line_sql('$.address[0].line')},
              _phone = {phone}, _telecom = {telecom}
            WHERE TRUE""",
        "organization": f"""UPDATE {t}.organization SET
              _address_line = {line_sql('$.address[0].line')},
              _phone = {phone}, _telecom = {telecom}
            WHERE TRUE""",
        "practitioner_role": f"""UPDATE {t}.practitioner_role SET
              _phone = {phone}, _telecom = {telecom}
            WHERE TRUE""",
        # Location.address is 0..1, so no array index here.
        "location": f"""UPDATE {t}.location SET
              _address_line = {line_sql('$.address.line')},
              _phone = {phone}, _telecom = {telecom},
              _position_lat = SAFE_CAST(JSON_VALUE(resource, '$.position.latitude') AS FLOAT64),
              _position_lng = SAFE_CAST(JSON_VALUE(resource, '$.position.longitude') AS FLOAT64)
            WHERE TRUE""",
    }


COVERAGE_OUT = (
    __file__.rsplit("/", 1)[0] + "/../frontend/public/api/v1/ndh-column-coverage.json"
)


def write_coverage(client: bigquery.Client) -> None:
    """Publish per-column coverage so the numbers we quote are checkable.

    Anything asserted in a report should be verifiable from a public payload
    rather than from an internal query someone has to take on trust. These
    percentages appear in release notes, so they get published.
    """
    t = f"`{PROJECT}.{DATASET}`"
    sql = f"""
    SELECT 'practitioner_active' AS scope, COUNT(*) AS rows_scored,
           ROUND(COUNTIF(_phone IS NOT NULL)/COUNT(*)*100, 2) AS phone_pct,
           ROUND(COUNTIF(_address_line IS NOT NULL)/COUNT(*)*100, 2) AS address_line_pct,
           CAST(NULL AS FLOAT64) AS position_pct
    FROM {t}.practitioner WHERE _active
    UNION ALL SELECT 'practitioner_all', COUNT(*),
           ROUND(COUNTIF(_phone IS NOT NULL)/COUNT(*)*100, 2),
           ROUND(COUNTIF(_address_line IS NOT NULL)/COUNT(*)*100, 2), NULL
    FROM {t}.practitioner
    UNION ALL SELECT 'organization', COUNT(*),
           ROUND(COUNTIF(_phone IS NOT NULL)/COUNT(*)*100, 2),
           ROUND(COUNTIF(_address_line IS NOT NULL)/COUNT(*)*100, 2), NULL
    FROM {t}.organization
    UNION ALL SELECT 'practitioner_role', COUNT(*),
           ROUND(COUNTIF(_phone IS NOT NULL)/COUNT(*)*100, 2), NULL, NULL
    FROM {t}.practitioner_role
    UNION ALL SELECT 'location', COUNT(*),
           ROUND(COUNTIF(_phone IS NOT NULL)/COUNT(*)*100, 2),
           ROUND(COUNTIF(_address_line IS NOT NULL)/COUNT(*)*100, 2),
           ROUND(COUNTIF(_position_lat IS NOT NULL)/COUNT(*)*100, 2)
    FROM {t}.location
    ORDER BY scope
    """
    rows = [dict(r) for r in client.query(sql, job_config=bq_job_config()).result()]
    payload = {
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "description": (
            "Coverage of the flattened telecom, address.line and Location.position "
            "columns extracted from the NDH bulk export. phone_pct counts the first "
            "telecom entry whose system is 'phone', not the first telecom entry. "
            "position is Location-only and is the only geography in the NDH."
        ),
        "columns": rows,
    }
    out = pathlib.Path(COVERAGE_OUT).resolve()
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\n  wrote {out}")
    for r in rows:
        print(f"    {r['scope']:<20} n={r['rows_scored']:>9,}  phone={r['phone_pct']}  "
              f"line={r['address_line_pct']}  position={r['position_pct']}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="Report bytes only, change nothing.")
    ap.add_argument("--table", help="Backfill one table instead of all four.")
    ap.add_argument("--report-only", action="store_true",
                    help="Skip the backfill, just publish the coverage payload.")
    args = ap.parse_args()

    if args.report_only:
        write_coverage(bigquery.Client(project=PROJECT))
        return 0

    client = bigquery.Client(project=PROJECT)
    stmts = statements()
    if args.table:
        if args.table not in stmts:
            print(f"unknown table {args.table}; choose from {', '.join(stmts)}", file=sys.stderr)
            return 2
        stmts = {args.table: stmts[args.table]}

    total_bytes = 0
    for name, sql in stmts.items():
        cfg = bq_job_config()
        cfg.dry_run = args.dry_run
        cfg.use_query_cache = False
        job = client.query(sql, job_config=cfg)
        if args.dry_run:
            total_bytes += job.total_bytes_processed or 0
            print(f"  {name:20} would process {(job.total_bytes_processed or 0)/1e9:6.2f} GB")
            continue
        job.result()
        print(f"  {name:20} {job.num_dml_affected_rows:,} rows updated")

    if args.dry_run:
        print(f"\n  total {total_bytes/1e9:.2f} GB  (~${total_bytes/1e12*5:.2f} at $5/TB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
