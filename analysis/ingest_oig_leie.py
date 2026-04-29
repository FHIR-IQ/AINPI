"""Ingest OIG LEIE (List of Excluded Individuals/Entities) into BigQuery.

The LEIE is the canonical federal database of providers excluded from
participating in Medicare, Medicaid, and all other Federal health care
programs under the Social Security Act §§ 1128 and 1156. State Medicaid
agencies are required by 42 CFR § 455.436 to check it monthly against
all enrolled providers.

Source:
    https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv (15 MB, ~83K rows)

Schema (CSV columns, all STRING):
    LASTNAME, FIRSTNAME, MIDNAME      — individuals (blank for entities)
    BUSNAME                           — entities (blank for individuals)
    GENERAL                           — provider type, e.g. 'NURSE-LPN'
    SPECIALTY                         — specialty narrative
    UPIN, NPI                         — identifiers; NPI is '0000000000' when absent
    DOB                               — YYYYMMDD or empty
    ADDRESS, CITY, STATE, ZIP         — last known
    EXCLTYPE                          — statutory citation (1128a1, 1128b4, etc.)
    EXCLDATE                          — YYYYMMDD exclusion date
    REINDATE                          — YYYYMMDD reinstatement date or '00000000'
    WAIVERDATE, WVRSTATE              — waivers per 42 CFR § 1001.1801

Notes on data quality (measured 2026-04-29):
    Total rows: 83,001
    With real NPI (not '0000000000'): 8,977 (10.8%)
    The 89% without an NPI are predominantly pre-NPI-era exclusions or
    cases where OIG did not collect/match an NPI. State MMIS systems
    typically join these by (lastname, firstname, DOB) — out of scope
    for the NPI-keyed AINPI methodology.

Usage:
    python analysis/ingest_oig_leie.py

Loads to:
    thematic-fort-453901-t7.cms_npd.oig_leie

Required:
    BigQuery jobUser + dataEditor on cms_npd dataset.
"""
from __future__ import annotations
import csv
import io
import json
import pathlib
import urllib.request
from datetime import datetime, timezone
from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
TABLE = f"{PROJECT}.{DATASET}.oig_leie"
LEIE_URL = "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv"
LEIE_CACHE = "/tmp/oig_leie.csv"

LEIE_COLUMNS = [
    "LASTNAME", "FIRSTNAME", "MIDNAME",
    "BUSNAME",
    "GENERAL", "SPECIALTY",
    "UPIN", "NPI",
    "DOB",
    "ADDRESS", "CITY", "STATE", "ZIP",
    "EXCLTYPE",
    "EXCLDATE", "REINDATE",
    "WAIVERDATE", "WVRSTATE",
]


def download() -> int:
    """Download the latest UPDATED.csv to /tmp. Returns row count."""
    print(f"Fetching {LEIE_URL}...")
    req = urllib.request.Request(
        LEIE_URL,
        headers={
            # Polite UA so OIG can identify the audit pipeline if they look at logs.
            "User-Agent": "AINPI-DirectoryQualityBot/1.0 (+https://ainpi.dev/methodology; gene@fhiriq.com)",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    pathlib.Path(LEIE_CACHE).write_bytes(body)
    rows = body.count(b"\n") - 1  # subtract header
    print(f"  {len(body):,} bytes, {rows:,} data rows → {LEIE_CACHE}")
    return rows


def load_to_bq(client: bigquery.Client) -> int:
    """Load /tmp/oig_leie.csv into BigQuery, replacing the existing table.

    All columns loaded as STRING. Date fields are YYYYMMDD strings in the
    source — we keep them as STRING to preserve fidelity (some are
    '00000000' to mean 'not applicable'). Downstream queries cast as needed.
    """
    schema = [bigquery.SchemaField(c, "STRING") for c in LEIE_COLUMNS]
    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.CSV,
        skip_leading_rows=1,
        schema=schema,
        write_disposition="WRITE_TRUNCATE",
        allow_quoted_newlines=True,
    )

    # The OIG CSV uses CRLF line endings and standard RFC-4180 quoting.
    # BigQuery handles both natively as long as we pass the file as bytes.
    with open(LEIE_CACHE, "rb") as fh:
        job = client.load_table_from_file(
            fh, TABLE, job_config=job_config, rewind=True
        )
    job.result()  # waits

    table = client.get_table(TABLE)
    print(f"Loaded {table.num_rows:,} rows into {TABLE}")
    return int(table.num_rows)


def report_quality(client: bigquery.Client) -> dict:
    """Quick-look stats — NPI population, top exclusion types, geography."""
    sql = f"""
    SELECT
      COUNT(*)                                                         AS total,
      COUNTIF(NPI != '' AND NPI != '0000000000')                       AS with_real_npi,
      COUNTIF(REINDATE = '00000000' OR REINDATE IS NULL OR REINDATE = '') AS still_excluded,
      COUNT(DISTINCT EXCLTYPE)                                         AS distinct_types,
      COUNT(DISTINCT STATE)                                            AS distinct_states
    FROM `{TABLE}`
    """
    row = next(iter(client.query(sql).result()))
    stats = {
        "total": int(row.total),
        "with_real_npi": int(row.with_real_npi),
        "still_excluded": int(row.still_excluded),
        "distinct_exclusion_types": int(row.distinct_types),
        "distinct_states": int(row.distinct_states),
    }
    print(f"\nLEIE quality summary:")
    for k, v in stats.items():
        print(f"  {k:<26} {v:>10,}")
    return stats


def run() -> None:
    download()
    client = bigquery.Client(project=PROJECT)
    rows = load_to_bq(client)
    stats = report_quality(client)
    stats["rows_loaded"] = rows
    stats["loaded_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    stats["source"] = LEIE_URL
    print(f"\n{json.dumps(stats, indent=2)}")


if __name__ == "__main__":
    run()
