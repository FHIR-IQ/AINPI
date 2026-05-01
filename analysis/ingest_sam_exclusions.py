"""Ingest SAM.gov Exclusions into BigQuery (SCAFFOLD).

Closes the third of four federal database checks required by 42 CFR § 455.436.
LEIE is in (analysis/ingest_oig_leie.py); this script handles SAM.gov.

Two access paths, in order of preference:

1. SAM.gov public API
   - Requires a free SAM.gov account + API key
   - Documented at https://open.gsa.gov/api/exclusions-api/
   - Set SAM_GOV_API_KEY env var (also: GitHub Actions secret)
   - The /api/exclusions/v1 endpoint returns JSON; we paginate and load.

2. Manual CSV drop (fallback for one-off runs without API access)
   - Download a CSV from the SAM.gov UI (sam.gov/data-services/Exclusions/Public V2)
   - Save it to /tmp/sam_exclusions.csv
   - Re-run this script — it picks up the file automatically.

License notes:
   - SAM.gov data is public domain (US federal government work).
   - The OpenSanctions mirror exists but is CC-BY-NC, which would
     contaminate downstream commercial reuse of the AINPI cohort —
     so we do NOT ingest from there. Public-domain primary source only.

Once ingested, BigQuery destination:
   thematic-fort-453901-t7.cms_npd.sam_exclusions

Then update analysis/high_risk_cohort.py to add the SAM signal at weight 1.5
(reason code: sam_excluded), and analysis/h25_sam_exclusions.py for the
match finding.

USAGE — TWO MODES

  # Mode 1: API key path (preferred for weekly cron)
  export SAM_GOV_API_KEY=...
  python analysis/ingest_sam_exclusions.py

  # Mode 2: manual CSV drop
  curl ... -o /tmp/sam_exclusions.csv  # download from SAM UI manually
  python analysis/ingest_sam_exclusions.py --from-csv /tmp/sam_exclusions.csv

This is a SCAFFOLD — the API call shape is documented from open.gsa.gov but
needs a real key for first run + schema confirmation. PRs welcome to
finalize once the key is provisioned.
"""
from __future__ import annotations
import argparse
import os
import pathlib
import sys
from datetime import datetime, timezone

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
TABLE = f"{PROJECT}.{DATASET}.sam_exclusions"
SAM_API_BASE = "https://api.sam.gov/exclusions/v1"
CSV_CACHE = "/tmp/sam_exclusions.csv"


def fetch_via_api(api_key: str) -> str:
    """Page through the SAM exclusions API, write a normalized CSV.

    SAM API uses `page` and `pageSize` query params. The full active list is
    ~70K rows; default pageSize 100, so ~700 paginated requests. The script
    must respect SAM rate limits (1000 req/hour for unauthenticated, 10000
    for authenticated).

    NOT YET IMPLEMENTED — needs a working API key for schema discovery.
    Until then, raise with the registration link.
    """
    raise NotImplementedError(
        "SAM.gov API ingestion path requires a free API key registered at\n"
        "  https://sam.gov/SAM/pages/public/searchRecords/search.jsf\n"
        "After registration:\n"
        "  1. Sign in → Account Details → Public API\n"
        "  2. Request a key (instant)\n"
        "  3. Add to GH Actions: gh secret set SAM_GOV_API_KEY < key.txt\n"
        "  4. Add to local env: export SAM_GOV_API_KEY=...\n"
        "  5. Re-run this script.\n\n"
        "Or use the --from-csv path: download from\n"
        "  https://sam.gov/data-services/Exclusions/Public%20V2?privacy=Public\n"
        "and pass the file with --from-csv /path/to/file.csv"
    )


def load_csv_to_bq(csv_path: str) -> int:
    """Load a manually-downloaded SAM exclusions CSV into BigQuery.

    SAM CSV columns (from data-services/Exclusions/Public%20V2):
      Classification, Name, Prefix, First, Middle, Last, Suffix, Title,
      Address 1, Address 2, City, State / Province, Country, ZIP/Postal Code,
      DUNS, Cage Code, NPI, NPI*, Cross-Reference, SAM Number,
      Exclusion Program, Exclusion Type, Excluding Agency,
      Active Date, Termination Date, Record Status,
      Cross-Reference Information, Additional Comments,
      CT Code, NAICS, SSN, Date of Birth, ULID

    This function is the production loader once a CSV is available. It maps
    SAM columns to a flat BQ schema and reports row counts.
    """
    from google.cloud import bigquery

    if not pathlib.Path(csv_path).exists():
        raise SystemExit(
            f"CSV not found at {csv_path}.\n"
            "  Download from: https://sam.gov/data-services/Exclusions/Public%20V2?privacy=Public\n"
            "  Drop at the path above and re-run."
        )

    client = bigquery.Client(project=PROJECT)

    # All-STRING schema mirrors the LEIE pattern — preserves fidelity for
    # date fields ('00000000' sentinels, partial dates, etc.) and lets the
    # downstream join script cast as needed.
    sam_columns = [
        "classification", "name", "prefix", "first_name", "middle_name",
        "last_name", "suffix", "title",
        "address_1", "address_2", "city", "state_province", "country", "zip_postal",
        "duns", "cage_code", "npi", "npi_alt", "cross_reference",
        "sam_number",
        "exclusion_program", "exclusion_type", "excluding_agency",
        "active_date", "termination_date", "record_status",
        "cross_reference_information", "additional_comments",
        "ct_code", "naics", "ssn", "date_of_birth", "ulid",
    ]
    schema = [bigquery.SchemaField(c, "STRING") for c in sam_columns]

    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.CSV,
        skip_leading_rows=1,
        schema=schema,
        write_disposition="WRITE_TRUNCATE",
        allow_quoted_newlines=True,
    )

    with open(csv_path, "rb") as fh:
        job = client.load_table_from_file(fh, TABLE, job_config=job_config, rewind=True)
    job.result()

    table = client.get_table(TABLE)
    print(f"Loaded {table.num_rows:,} SAM exclusion rows into {TABLE}")
    return int(table.num_rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-csv",
        help="Path to a manually-downloaded SAM exclusions CSV (fallback path).",
        default=None,
    )
    args = parser.parse_args()

    started = datetime.now(timezone.utc)

    if args.from_csv:
        rows = load_csv_to_bq(args.from_csv)
    else:
        api_key = os.environ.get("SAM_GOV_API_KEY")
        if not api_key:
            raise SystemExit(
                "No SAM_GOV_API_KEY in env, and no --from-csv path supplied.\n"
                "  See module docstring for both paths."
            )
        csv_path = fetch_via_api(api_key)  # writes CSV_CACHE
        rows = load_csv_to_bq(csv_path)

    print(f"Done in {(datetime.now(timezone.utc) - started).total_seconds():.1f}s. "
          f"{rows:,} rows in {TABLE}.")


if __name__ == "__main__":
    main()
