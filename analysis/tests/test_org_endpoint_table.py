"""Tests for the curated organization-to-endpoint table.

The builder merges two published CSVs that disagree on URL spelling, use the
empty string for "absent", and carry some NPIs that fail the check digit. Each
of those is a way to publish a plausible table that is quietly wrong, so each
has a test here.
"""
import csv

import pandas as pd
import pyarrow.parquet as pq
import pytest

from analysis.org_endpoint_table import (
    EmptyInputError,
    build,
    build_summary,
    normalize_url,
    write,
)

NDH_COLS = ["endpoint_id", "base_url", "host", "status", "org_id", "org_npi",
            "org_name", "org_state"]
VENDOR_COLS = ["url", "org_name", "org_npi", "vendor", "in_ndh", "ndh_has_owner"]

# Luhn-valid NPIs (checked against the CMS 80840-prefix rule).
NPI_A = "1467910828"
NPI_B = "1841826278"
NPI_BAD = "1234567890"  # fails the check digit


def _csv(path, cols, rows):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        w.writerows(rows)
    return path


def _ndh_row(url, npi=NPI_A, name="ORG A", state="PA", eid="Endpoint-1"):
    return [eid, url, "ignored", "active", f"Organization-{npi}", npi, name, state]


@pytest.fixture
def inputs(tmp_path):
    ndh = _csv(tmp_path / "ndh.csv", NDH_COLS, [
        _ndh_row("https://FHIR.Example.com/r4/ABC/"),
        # Same endpoint, trailing slash dropped: collapses to one row.
        _ndh_row("https://fhir.example.com/r4/ABC", eid="Endpoint-2"),
        # No state published.
        _ndh_row("https://other.example.org/fhir", npi=NPI_B, name="ORG B", state=""),
    ])
    vendor = _csv(tmp_path / "vendor.csv", VENDOR_COLS, [
        # Same URL as the NDH row, differently spelled: joins, gets a vendor.
        ["https://fhir.example.com/r4/ABC/", "Org A Clinic", NPI_A, "Vendor One", "yes", "yes"],
        # Vendor names an owner the NDH does not.
        ["https://v.example.net/api/1", "Org C", NPI_B, "Vendor Two", "yes", "no"],
        # Not in the NDH: ndh_has_owner is not applicable.
        ["https://v.example.net/api/2", "Org D", "", "Vendor Two", "no", ""],
        # Invalid check digit: kept, counted.
        ["https://v.example.net/api/3", "Org E", NPI_BAD, "Vendor Two", "no", ""],
    ])
    return ndh, vendor


# --- normalization -----------------------------------------------------------

def test_normalize_lowercases_scheme_and_host_only():
    assert (normalize_url("HTTPS://FHIR4.Example.COM/fhir/r4/EBAEAA")
            == "https://fhir4.example.com/fhir/r4/EBAEAA")


def test_normalize_strips_trailing_slash_from_path_not_query():
    assert normalize_url("https://x.org/r4/") == "https://x.org/r4"
    assert normalize_url("https://x.org/r4///") == "https://x.org/r4"
    assert normalize_url("https://x.org/r4/?a=b/") == "https://x.org/r4?a=b/"


def test_normalize_strips_whitespace_and_keeps_bare_host():
    assert normalize_url("  https://X.org/  ") == "https://x.org"


def test_normalize_empty_is_none():
    assert normalize_url("") is None
    assert normalize_url(None) is None


# --- build: dedup, tagging, nulls -------------------------------------------

def test_dedup_collapses_url_variants_within_a_source(inputs):
    df, s = build(*inputs, release="2026-08-20")
    ndh = df[df.source == "ndh"]
    assert len(ndh) == 2
    assert s["duplicates_collapsed"]["ndh"] == 1


def test_source_tagging_and_one_row_per_source(inputs):
    df, s = build(*inputs, release="2026-08-20")
    assert set(df.source) == {"ndh", "vendor_file"}
    a = df[(df.base_url == "https://fhir.example.com/r4/ABC") & (df.org_npi == NPI_A)]
    # One row per source: a URL both sources attribute is not collapsed across them.
    assert sorted(a.source) == ["ndh", "vendor_file"]
    assert s["rows_by_source"] == {"ndh": 2, "vendor_file": 4}


def test_ndh_rows_take_vendor_from_the_normalized_join(inputs):
    df, _ = build(*inputs, release="2026-08-20")
    row = df[(df.source == "ndh") & (df.org_npi == NPI_A)].iloc[0]
    assert row.vendor == "Vendor One"
    other = df[(df.source == "ndh") & (df.org_npi == NPI_B)].iloc[0]
    assert pd.isna(other.vendor)


def test_ndh_rows_are_in_ndh_with_owner_by_construction(inputs):
    df, _ = build(*inputs, release="2026-08-20")
    ndh = df[df.source == "ndh"]
    assert ndh.in_ndh.all()
    assert ndh.ndh_has_owner.all()


def test_null_is_not_empty_string(inputs):
    df, _ = build(*inputs, release="2026-08-20")
    b = df[(df.source == "ndh") & (df.org_npi == NPI_B)].iloc[0]
    assert pd.isna(b.org_state)
    d = df[df.base_url == "https://v.example.net/api/2"].iloc[0]
    assert pd.isna(d.org_npi)
    assert pd.isna(d.ndh_has_owner)          # not applicable, not False
    assert d.in_ndh is False or d.in_ndh == False  # noqa: E712
    c = df[df.base_url == "https://v.example.net/api/1"].iloc[0]
    assert c.ndh_has_owner == False  # noqa: E712  (a real "no")
    # vendor rows carry no state at all
    assert df[df.source == "vendor_file"].org_state.isna().all()
    # No column anywhere holds an empty string.
    for col in df.columns:
        assert not (df[col].astype(object) == "").any(), col


def test_host_is_derived_from_the_normalized_url(inputs):
    df, _ = build(*inputs, release="2026-08-20")
    assert set(df.host) == {"fhir.example.com", "other.example.org", "v.example.net"}


def test_release_date_is_stamped(inputs):
    df, _ = build(*inputs, release="2026-08-20")
    assert (df.release_date == "2026-08-20").all()


def test_columns_are_the_contract(inputs):
    df, _ = build(*inputs, release="2026-08-20")
    assert list(df.columns) == [
        "base_url", "host", "org_npi", "org_name", "org_state", "vendor",
        "source", "in_ndh", "ndh_has_owner", "release_date",
    ]


# --- invalid NPIs --------------------------------------------------------------

def test_invalid_npis_are_counted_not_dropped(inputs):
    df, s = build(*inputs, release="2026-08-20")
    assert NPI_BAD in set(df.org_npi.dropna())
    assert s["invalid_npi"] == {"ndh": 0, "vendor_file": 1}
    assert s["null_npi"] == {"ndh": 0, "vendor_file": 1}


# --- zero-row refusal (positive control) ----------------------------------------

@pytest.mark.parametrize("which", ["ndh", "vendor"])
def test_refuses_when_an_input_is_empty(tmp_path, inputs, which):
    ndh, vendor = inputs
    empty = _csv(tmp_path / "empty.csv", NDH_COLS if which == "ndh" else VENDOR_COLS, [])
    args = (empty, vendor) if which == "ndh" else (ndh, empty)
    out = tmp_path / "out"
    with pytest.raises(EmptyInputError):
        write(*args, out_dir=out, release="2026-08-20")
    assert not out.exists() or not any(out.rglob("*.parquet"))


def test_refuses_when_an_input_is_missing(tmp_path, inputs):
    with pytest.raises(EmptyInputError):
        build(tmp_path / "nope.csv", inputs[1], release="2026-08-20")


# --- summary table ------------------------------------------------------------

def test_summary_one_row_per_npi_with_sorted_arrays(inputs):
    df, _ = build(*inputs, release="2026-08-20")
    sm = build_summary(df)
    assert sm.org_npi.is_unique
    assert sm.org_npi.notna().all()           # null-NPI rows cannot be grouped
    b = sm[sm.org_npi == NPI_B].iloc[0]
    assert b.n_endpoints == 2                  # other.example.org + v.example.net/api/1
    assert list(b.vendors) == ["Vendor Two"]
    assert list(b.sources) == ["ndh", "vendor_file"]
    a = sm[sm.org_npi == NPI_A].iloc[0]
    assert a.n_endpoints == 1                  # same URL from both sources counts once
    assert (sm.release_date == "2026-08-20").all()


# --- writing ------------------------------------------------------------------

def test_write_emits_partition_ready_parquet(tmp_path, inputs):
    out = tmp_path / "out"
    s = write(*inputs, out_dir=out, release="2026-08-20")
    part = out / "2026-08-20"
    t = pq.read_table(part / "org_endpoint.parquet")
    assert t.num_rows == 6
    assert "release_date" in t.schema.names
    assert pq.read_table(part / "org_endpoint_summary.parquet").num_rows == s["summary_rows"]
    assert s["parquet_bytes"]["org_endpoint"] > 0
    assert (part / "summary.json").exists()


# --- wiring into databricks_publish -------------------------------------------
# No network: these only exercise path resolution and SQL text.

from analysis import databricks_publish as dp  # noqa: E402


def test_new_tables_are_registered_with_comments():
    for t in ("org_endpoint", "org_endpoint_summary"):
        assert t in dp.ALL_TABLES
        assert t not in dp.TABLES          # the six NDH tables are unchanged
        c = dp.TABLE_COMMENTS[t]
        assert "not a CMS file" in c and "Sample:" in c
    assert "vendor_file" in dp.TABLE_COMMENTS["org_endpoint"]


def test_derived_parquet_resolves_outside_the_ndh_export(tmp_path, monkeypatch):
    monkeypatch.setattr(dp, "DERIVED_DIR", tmp_path)
    assert dp.local_parquet("2026-08-20", "org_endpoint") == (
        tmp_path / "2026-08-20" / "org_endpoint.parquet")
    assert dp.local_parquet("2026-08-20", "endpoint").parent.parent == dp.PARQUET_DIR


def test_release_date_is_not_appended_twice(tmp_path, inputs, monkeypatch):
    write(*inputs, out_dir=tmp_path, release="2026-08-20")
    monkeypatch.setattr(dp, "DERIVED_DIR", tmp_path)
    sel = dp.select_from_parquet("2026-08-20", "org_endpoint")
    assert sel.startswith("SELECT * FROM parquet.`")
    assert "AS release_date" not in sel
    assert "release_date=2026-08-20/org_endpoint.parquet" in sel


def test_ndh_tables_still_get_release_date_appended(tmp_path, monkeypatch):
    import pyarrow as pa
    rel = tmp_path / "2026-08-20"
    rel.mkdir()
    pq.write_table(pa.table({"_id": ["x"]}), rel / "endpoint.parquet")
    monkeypatch.setattr(dp, "PARQUET_DIR", tmp_path)
    sel = dp.select_from_parquet("2026-08-20", "endpoint")
    assert "'2026-08-20' AS release_date" in sel
