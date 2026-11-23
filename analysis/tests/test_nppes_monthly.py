"""Unit tests for analysis/nppes_monthly.py. Fixtures only, no download.

Synthetic check-digit-valid NPIs: 1234567893, 1111111112, 2222222228,
3333333334, 4444444440.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

import pyarrow.parquet as pq
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import nppes_monthly as nm  # noqa: E402

LISTING = """
<html><body>
<h3>Full Replacement Monthly NPI File</h3>
<a href="https://download.cms.gov/nppes/NPPES_Data_Dissemination_October_2026_V2.zip">NPPES Data Dissemination (October 2026) (1,071 MB)</a>
<a href="./NPPES_Data_Dissemination_November_2026_V2.zip">NPPES Data Dissemination (November 2026) (1,078 MB)</a>
<a href="./NPPES_Data_Dissemination_November_2026.zip">NPPES Data Dissemination V.1 (November 2026)</a>
<h3>Weekly Incremental NPI Files</h3>
<a href="./NPPES_Data_Dissemination_110226_110826_Weekly_V2.zip">Weekly (55 MB)</a>
<a href="./NPPES_Data_Dissemination_110926_111526_Weekly_V2.zip">Weekly (57 MB)</a>
<a href="./NPPES_Deactivated_NPI_Report_111026_V2.zip">Deactivated</a>
</body></html>
"""

HEADER = [
    "NPI", "Entity Type Code", "Replacement NPI",
    "Provider Organization Name (Legal Business Name)",
    "Provider Last Name (Legal Name)", "Provider First Name",
    "Provider First Line Business Practice Location Address",
    "Provider Business Practice Location Address City Name",
    "Provider Business Practice Location Address State Name",
    "Provider Business Practice Location Address Postal Code",
    "Provider Business Practice Location Address Telephone Number",
    "Provider Enumeration Date", "Last Update Date", "NPI Deactivation Date",
]
for i in range(1, 16):
    HEADER += [f"Healthcare Provider Taxonomy Code_{i}",
               f"Healthcare Provider Primary Taxonomy Switch_{i}"]


def _row(npi, et, last, first, org, line1, city, st, zp, phone, enum, upd, deact, tax):
    """tax: list of (code, switch) for the first slots."""
    r = [npi, et, "", org, last, first, line1, city, st, zp, phone, enum, upd, deact]
    slots = list(tax) + [("", "")] * (15 - len(tax))
    for code, sw in slots:
        r += [code, sw]
    return r


ROWS = [
    _row("1234567893", "1", "MÜLLER", "José", "", "1 MAIN ST", "PITTSBURGH", "PA",
         "152061234", "(412) 345-5134", "05/23/2005", "07/01/2026", "",
         [("207Q00000X", "N"), ("363LF0000X", "Y")]),
    _row("1111111112", "1", "DOE", "JANE", "", "2 OAK AVE", "ERIE", "PA",
         "16501", "1-814-555-0100", "10/15/2026", "10/20/2026", "",
         [("207Q00000X", "")]),
    _row("2222222228", "2", "", "", "SAMPLE CLINIC LLC", "3 ELM", "HARRISBURG", "PA",
         "17101", "717555010", "03/02/2010", "03/02/2010", "",
         []),
    _row("3333333334", "", "", "", "", "", "", "", "", "", "", "", "01/05/2020", []),
    _row("4444444440", "1", "ROE", "RICK", "", "4 PINE", "PHILADELPHIA", "PA",
         "19103", "2155550199", "11/01/2026", "11/01/2026", "",
         [("1223G0001X", "Y")]),
]


def _csv_bytes(rows, encoding):
    import csv
    import io
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    w.writerow(HEADER)
    for r in rows:
        w.writerow(r)
    return buf.getvalue().encode(encoding)


@pytest.fixture
def nppes_zip(tmp_path):
    p = tmp_path / "NPPES_Data_Dissemination_November_2026_V2.zip"
    with zipfile.ZipFile(p, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("npidata_pfile_20050523-20261109_fileheader.csv",
                   _csv_bytes([], "utf-8"))
        z.writestr("othername_pfile_20050523-20261109.csv", b'"NPI","Other Name"\r\n')
        z.writestr("npidata_pfile_20050523-20261109.csv", _csv_bytes(ROWS, "latin-1"))
    return p


# --- pick_full_file ---------------------------------------------------------

def test_pick_full_file_returns_monthly_v2_never_weekly():
    href = nm.pick_full_file(LISTING)
    assert href.endswith("NPPES_Data_Dissemination_November_2026_V2.zip")
    assert "Weekly" not in href


def test_pick_full_file_picks_latest_month_by_date_not_string_order():
    # "October" sorts after "November" as a string; the parsed month must win.
    listing = LISTING.replace("November_2026_V2", "September_2026_V2")
    assert nm.pick_full_file(listing).endswith("October_2026_V2.zip")
    across_year = (
        '<a href="NPPES_Data_Dissemination_December_2025_V2.zip">x</a>'
        '<a href="NPPES_Data_Dissemination_January_2026_V2.zip">y</a>'
    )
    assert nm.pick_full_file(across_year) == "NPPES_Data_Dissemination_January_2026_V2.zip"


def test_pick_full_file_raises_with_only_weekly_links():
    only_weekly = '<a href="NPPES_Data_Dissemination_110926_111526_Weekly_V2.zip">w</a>'
    with pytest.raises(ValueError, match="no full replacement"):
        nm.pick_full_file(only_weekly)


def test_file_month_and_url_resolution():
    assert nm.file_month("NPPES_Data_Dissemination_November_2026_V2.zip") == "2026-11"
    assert nm.resolve_url("./NPPES_Data_Dissemination_November_2026_V2.zip") == (
        "https://download.cms.gov/nppes/NPPES_Data_Dissemination_November_2026_V2.zip"
    )


def test_listed_size_reads_the_page_figure():
    href = nm.pick_full_file(LISTING)
    assert nm.listed_size_mb(LISTING, href) == 1078


# --- load -------------------------------------------------------------------

def test_load_reads_main_csv_with_latin1_fallback(nppes_zip, tmp_path):
    out = tmp_path / "out"
    summary = nm.load(nppes_zip, out)
    assert summary["rows"] == 5
    assert summary["encoding"] == "latin-1"
    assert summary["csv_member"] == "npidata_pfile_20050523-20261109.csv"
    assert summary["file"] == nppes_zip.name
    assert summary["size"] == nppes_zip.stat().st_size
    # Parsed as dates, not compared as MM/DD/YYYY strings ("11/01" < "10/15" is false
    # either way, but "05/23/2005" > "03/02/2010" as a string).
    assert summary["max_enumeration_date"] == "2026-11-01"

    t = pq.read_table(out / "nppes.parquet")
    assert t.column_names == nm.COLUMNS
    rows = {r["npi"]: r for r in t.to_pylist()}
    a = rows["1234567893"]
    assert a["last_name"] == "MÜLLER" and a["first_name"] == "José"
    assert a["practice_zip5"] == "15206"
    assert a["practice_phone10"] == "4123455134"
    assert a["primary_taxonomy"] == "363LF0000X"      # the slot switched Y
    assert str(a["enumeration_date"]) == "2005-05-23"
    b = rows["1111111112"]
    assert b["practice_phone10"] == "8145550100"
    assert b["primary_taxonomy"] == "207Q00000X"      # no Y: first populated slot
    c = rows["2222222228"]
    assert c["entity_type"] == "2" and c["org_name"] == "SAMPLE CLINIC LLC"
    assert c["practice_phone10"] is None              # 9 digits
    d = rows["3333333334"]
    assert str(d["deactivation_date"]) == "2020-01-05"
    assert d["entity_type"] is None and d["practice_zip5"] is None


def test_load_reads_utf8(tmp_path):
    p = tmp_path / "NPPES_Data_Dissemination_November_2026_V2.zip"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("npidata_pfile_20050523-20261109.csv", b"\xef\xbb\xbf" + _csv_bytes(ROWS, "utf-8"))
    s = nm.load(p, tmp_path / "o")
    assert s["encoding"] == "utf-8-sig" and s["rows"] == 5


def test_load_raises_on_missing_header(tmp_path):
    p = tmp_path / "NPPES_Data_Dissemination_November_2026_V2.zip"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("npidata_pfile_20050523-20261109.csv", b'"NPI","Entity Type Code"\r\n"1234567893","1"\r\n')
    with pytest.raises(ValueError, match="missing NPPES column"):
        nm.load(p, tmp_path / "o")
    assert not (tmp_path / "o" / "nppes.parquet").exists()


def test_load_refuses_dataless_zip(nppes_zip, tmp_path, monkeypatch):
    import xsource_norm
    from types import SimpleNamespace
    monkeypatch.setattr(nm, "_stat", lambda _p: SimpleNamespace(st_flags=xsource_norm.SF_DATALESS))
    with pytest.raises(RuntimeError, match="dataless"):
        nm.load(nppes_zip, tmp_path / "o")


def _zip_with(tmp_path, rows, name="NPPES_Data_Dissemination_November_2026_V2.zip"):
    p = tmp_path / name
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("npidata_pfile_20050523-20261109.csv", _csv_bytes(rows, "utf-8"))
    return p


FUTURE = _row("5555555556", "1", "TYPO", "TINA", "", "5 ASH", "ERIE", "PA",
              "16501", "8145550111", "01/05/2031", "11/01/2026", "", [("207Q00000X", "Y")])


def test_load_ignores_future_enumeration_dates_for_the_max(tmp_path):
    s = nm.load(_zip_with(tmp_path, ROWS + [FUTURE]), tmp_path / "o")
    assert s["rows"] == 6                                  # the row is kept
    assert s["max_enumeration_date"] == "2026-11-01"       # the typo is not the max
    assert s["future_enumeration_dates_ignored"] == 1
    assert nm.control(s, "2026-11") is True


def test_stale_file_with_a_future_typo_still_fails_the_control(tmp_path):
    stale = [r for r in ROWS if r[11] not in ("10/15/2026", "11/01/2026")]
    s = nm.load(_zip_with(tmp_path, stale + [FUTURE]), tmp_path / "o")
    assert s["max_enumeration_date"] == "2010-03-02"
    assert s["future_enumeration_dates_ignored"] == 1
    assert nm.control(s, "2026-11") is False


def test_month_end_handles_december(tmp_path):
    dec_last = _row("5555555556", "1", "LATE", "LEE", "", "5 ASH", "ERIE", "PA",
                    "16501", "8145550111", "12/31/2026", "12/31/2026", "", [])
    s = nm.load(_zip_with(tmp_path, ROWS + [dec_last],
                          name="NPPES_Data_Dissemination_December_2026_V2.zip"), tmp_path / "o")
    assert s["max_enumeration_date"] == "2026-12-31"
    assert s["future_enumeration_dates_ignored"] == 0


def test_load_takes_an_explicit_month(tmp_path):
    p = tmp_path / "renamed.zip"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("npidata_pfile_20050523-20261109.csv", _csv_bytes(ROWS + [FUTURE], "utf-8"))
    s = nm.load(p, tmp_path / "o", month="2026-11")
    assert s["future_enumeration_dates_ignored"] == 1


# --- control ----------------------------------------------------------------

def test_control_fails_when_snapshot_is_60_days_behind():
    assert nm.control({"rows": 10, "max_enumeration_date": "2026-09-02"}, "2026-11") is False


def test_control_passes_when_recent():
    assert nm.control({"rows": 10, "max_enumeration_date": "2026-11-01"}, "2026-11") is True
    assert nm.control({"rows": 10, "max_enumeration_date": "2026-10-10"}, "2026-11") is True


def test_control_fails_when_max_is_after_the_file_month():
    # An unfiltered max past the month's last day can only be a typo.
    assert nm.control({"rows": 10, "max_enumeration_date": "2031-01-05"}, "2026-11") is False
    assert nm.control({"rows": 10, "max_enumeration_date": "2026-11-30"}, "2026-11") is True


def test_control_fails_on_empty_or_missing():
    assert nm.control({"rows": 0, "max_enumeration_date": "2026-11-01"}, "2026-11") is False
    assert nm.control({"rows": 10, "max_enumeration_date": None}, "2026-11") is False


# --- download guard ---------------------------------------------------------

def test_download_refuses_without_confirm(tmp_path, capsys):
    calls = []
    with pytest.raises(SystemExit):
        nm.download("https://download.cms.gov/nppes/NPPES_Data_Dissemination_November_2026_V2.zip",
                    tmp_path, listed_mb=1078, confirm=False, run=lambda *a, **k: calls.append(a))
    assert calls == []
    out = capsys.readouterr().out
    assert "NPPES_Data_Dissemination_November_2026_V2.zip" in out and "1078 MB" in out
