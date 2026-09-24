"""Build the curated organization-to-endpoint table for the Databricks share.

WHAT THIS IS

One row per (base_url, org_npi, source): which FHIR endpoint belongs to which
organization, and which EHR vendor serves it. It merges two files this project
already publishes, so it adds no new measurement:

  source = 'ndh'          frontend/public/api/v1/findings/endpoint-org-crosswalk.csv
                          (H50). The endpoint's own managingOrganization in the
                          CMS NDH, resolved to an Organization and its NPI.
  source = 'vendor_file'  frontend/public/api/v1/findings/vendor-endpoint-attribution.csv
                          (H51). Attribution taken from the public endpoint files
                          EHR vendors publish. Not CMS data.

A URL both sources attribute appears twice, once per source, on purpose: when
they name different organizations a consumer should see the disagreement rather
than a silent choice between them.

URL NORMALIZATION (the join key)

  - surrounding whitespace stripped
  - scheme and host lower-cased; path, query and fragment left as published,
    because FHIR base paths are case-sensitive (tenant codes such as
    `/fhir/r4/EBAEAA` differ from their lower-cased form)
  - trailing slashes stripped from the path only, never from a query string

The normalized URL is what `base_url` holds, and `host` is derived from it for
both sources so there is one rule rather than two. Measured on the 2026-08-20
files, normalizing raises the NDH-to-vendor URL match from 7,253 to 7,967.

NULLS

CSV has no null, so the generators spell "absent" as the empty string. Here
every empty string becomes NULL, and a column a source does not carry at all
(`vendor` on an NDH row with no vendor match, `org_state` on every vendor row)
is NULL. `ndh_has_owner` is NULL on vendor rows whose URL is not in the NDH:
"not applicable" is not "no". NDH rows are in_ndh = true and
ndh_has_owner = true by construction, since the crosswalk only contains
endpoints whose managingOrganization resolved.

INVALID NPIS

Every NPI is checked with the CMS check-digit rule (`fhir_identifiers.
is_luhn_valid`). Rows that fail are kept with the value as published and
counted in the summary, because dropping them would hide a defect in the
source file. Vendor rows with no NPI at all are also kept (they still name an
organization) and counted separately.

POSITIVE CONTROL

The builder refuses to write anything if either input is missing or has zero
rows. An empty input would otherwise produce a table that looks like a finding
("the vendors attribute nothing"), which is the silent-zero failure this project
has hit repeatedly.

Output, gitignored, laid out like frontend/data/parquet-export/<release>/:
    analysis/data/org-endpoint/<CURRENT_RELEASE>/org_endpoint.parquet
    analysis/data/org-endpoint/<CURRENT_RELEASE>/org_endpoint_summary.parquet
    analysis/data/org-endpoint/<CURRENT_RELEASE>/summary.json

Each file carries release_date as a column so a downloaded copy states its own
release. The local directory is deliberately NOT named `release_date=<date>`:
a hive-style directory plus an in-file column of the same name makes pyarrow's
dataset reader fail with "Unable to merge: Field release_date has incompatible
types". databricks_publish.py uploads each file to the volume's
release_date=<date>/ directory like the six NDH tables, and its loader skips
appending release_date when the parquet already has one.

Run:
    python3 analysis/org_endpoint_table.py
"""
from __future__ import annotations

import json
import pathlib
import sys
from urllib.parse import urlsplit, urlunsplit

import pandas as pd

_HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
from fhir_identifiers import is_luhn_valid  # noqa: E402
from release import CURRENT_RELEASE  # noqa: E402

ROOT = _HERE.parent
FINDINGS = ROOT / "frontend" / "public" / "api" / "v1" / "findings"
NDH_CSV = FINDINGS / "endpoint-org-crosswalk.csv"
VENDOR_CSV = FINDINGS / "vendor-endpoint-attribution.csv"
OUT_DIR = ROOT / "analysis" / "data" / "org-endpoint"

COLUMNS = [
    "base_url", "host", "org_npi", "org_name", "org_state", "vendor",
    "source", "in_ndh", "ndh_has_owner", "release_date",
]
KEY = ["base_url", "org_npi", "source"]
SOURCES = ("ndh", "vendor_file")


class EmptyInputError(RuntimeError):
    """An input was missing or had no rows. Nothing was written."""


def normalize_url(url):
    """Join-key form of an endpoint URL. See the module docstring."""
    if url is None or (isinstance(url, float) and pd.isna(url)):
        return None
    url = str(url).strip()
    if not url:
        return None
    s = urlsplit(url)
    return urlunsplit((s.scheme.lower(), s.netloc.lower(), s.path.rstrip("/"),
                       s.query, s.fragment))


def _host(url):
    return urlsplit(url).netloc or None if url else None


def _read(path) -> pd.DataFrame:
    path = pathlib.Path(path)
    if not path.exists():
        raise EmptyInputError(f"{path} does not exist")
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    if len(df) == 0:
        raise EmptyInputError(f"{path} has zero rows; refusing to build")
    # Empty string is the CSV spelling of absent.
    return df.replace({"": None})


def _yes_no(v):
    if v is None:
        return pd.NA
    v = v.strip().lower()
    if v in ("yes", "true", "1"):
        return True
    if v in ("no", "false", "0"):
        return False
    return pd.NA


def build(ndh_csv=NDH_CSV, vendor_csv=VENDOR_CSV, release=CURRENT_RELEASE):
    """Return (table, summary). Raises EmptyInputError before doing any work."""
    ndh_raw = _read(ndh_csv)
    ven_raw = _read(vendor_csv)

    ven = pd.DataFrame({
        "base_url": ven_raw["url"].map(normalize_url),
        "org_npi": ven_raw["org_npi"],
        "org_name": ven_raw["org_name"],
        "org_state": None,
        "vendor": ven_raw["vendor"],
        "source": "vendor_file",
        "in_ndh": ven_raw["in_ndh"].map(_yes_no),
        "ndh_has_owner": ven_raw["ndh_has_owner"].map(_yes_no),
    })

    # Vendor for an NDH row comes from the vendor file on the normalized URL.
    # A URL listed by more than one vendor is not expected; if it occurs, the
    # vendors are joined with '; ' rather than one being picked silently.
    url_vendor = (ven.dropna(subset=["base_url", "vendor"])
                  .groupby("base_url")["vendor"]
                  .agg(lambda s: "; ".join(sorted(set(s)))))

    ndh_url = ndh_raw["base_url"].map(normalize_url)
    ndh = pd.DataFrame({
        "base_url": ndh_url,
        "org_npi": ndh_raw["org_npi"],
        "org_name": ndh_raw["org_name"],
        "org_state": ndh_raw["org_state"],
        "vendor": ndh_url.map(url_vendor),
        "source": "ndh",
        "in_ndh": True,
        "ndh_has_owner": True,
    })

    dupes = {}
    parts = []
    for name, df in (("ndh", ndh), ("vendor_file", ven)):
        before = len(df)
        df = df.drop_duplicates(subset=KEY, keep="first")
        dupes[name] = before - len(df)
        parts.append(df)

    out = pd.concat(parts, ignore_index=True)
    out["host"] = out["base_url"].map(_host)
    out["release_date"] = release
    out["in_ndh"] = out["in_ndh"].astype("boolean")
    out["ndh_has_owner"] = out["ndh_has_owner"].astype("boolean")
    for c in ("base_url", "host", "org_npi", "org_name", "org_state", "vendor",
              "source", "release_date"):
        out[c] = out[c].astype(object).where(out[c].notna(), None)
    out = out[COLUMNS].sort_values(["base_url", "source", "org_npi"],
                                   na_position="last").reset_index(drop=True)

    npi_present = out["org_npi"].notna()
    npi_valid = out["org_npi"].map(lambda n: is_luhn_valid(n) if n else False)
    summary = {
        "release_date": release,
        "rows": int(len(out)),
        "rows_by_source": {s: int((out.source == s).sum()) for s in SOURCES},
        "input_rows": {"ndh": int(len(ndh_raw)), "vendor_file": int(len(ven_raw))},
        "duplicates_collapsed": dupes,
        "invalid_npi": {s: int(((out.source == s) & npi_present & ~npi_valid).sum())
                        for s in SOURCES},
        "null_npi": {s: int(((out.source == s) & ~npi_present).sum()) for s in SOURCES},
        "null_base_url": int(out["base_url"].isna().sum()),
        "ndh_rows_with_vendor": int(((out.source == "ndh") & out.vendor.notna()).sum()),
        "distinct_base_urls": int(out["base_url"].nunique()),
        "distinct_org_npis": int(out["org_npi"].nunique()),
    }
    return out, summary


def build_summary(table: pd.DataFrame) -> pd.DataFrame:
    """One row per org_npi: name, distinct endpoints, vendors, sources.

    Rows with no NPI cannot be grouped by NPI and are left out; the builder
    summary counts them. Arrays are sorted so the output is deterministic.
    `org_name` is the NDH name when the NDH has one, otherwise the most common
    vendor-file name.
    """
    t = table[table["org_npi"].notna()]

    def pick_name(g):
        ndh = g.loc[g.source == "ndh", "org_name"].dropna()
        names = ndh if len(ndh) else g["org_name"].dropna()
        return names.value_counts().index[0] if len(names) else None

    rows = []
    for npi, g in t.groupby("org_npi", sort=True):
        rows.append({
            "org_npi": npi,
            "org_name": pick_name(g),
            "n_endpoints": int(g["base_url"].dropna().nunique()),
            "vendors": sorted(set(g["vendor"].dropna())),
            "sources": sorted(set(g["source"])),
            "release_date": g["release_date"].iloc[0],
        })
    return pd.DataFrame(rows, columns=["org_npi", "org_name", "n_endpoints",
                                       "vendors", "sources", "release_date"])


def write(ndh_csv=NDH_CSV, vendor_csv=VENDOR_CSV, out_dir=OUT_DIR,
          release=CURRENT_RELEASE) -> dict:
    """Build and write both parquet files plus summary.json. Returns the summary.

    Everything is built before the directory is created, so a refusal leaves
    nothing on disk.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    table, summary = build(ndh_csv, vendor_csv, release)
    org = build_summary(table)

    table_schema = pa.schema([
        ("base_url", pa.string()), ("host", pa.string()),
        ("org_npi", pa.string()), ("org_name", pa.string()),
        ("org_state", pa.string()), ("vendor", pa.string()),
        ("source", pa.string()), ("in_ndh", pa.bool_()),
        ("ndh_has_owner", pa.bool_()), ("release_date", pa.string()),
    ])
    summary_schema = pa.schema([
        ("org_npi", pa.string()), ("org_name", pa.string()),
        ("n_endpoints", pa.int64()), ("vendors", pa.list_(pa.string())),
        ("sources", pa.list_(pa.string())), ("release_date", pa.string()),
    ])
    t1 = pa.Table.from_pandas(table, schema=table_schema, preserve_index=False)
    t2 = pa.Table.from_pandas(org, schema=summary_schema, preserve_index=False)

    part = pathlib.Path(out_dir) / release
    part.mkdir(parents=True, exist_ok=True)
    p1 = part / "org_endpoint.parquet"
    p2 = part / "org_endpoint_summary.parquet"
    pq.write_table(t1, p1)
    pq.write_table(t2, p2)

    summary["summary_rows"] = int(len(org))
    summary["parquet_bytes"] = {
        "org_endpoint": p1.stat().st_size,
        "org_endpoint_summary": p2.stat().st_size,
    }
    (part / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main() -> None:
    s = write()
    print(json.dumps(s, indent=2))


if __name__ == "__main__":
    main()
