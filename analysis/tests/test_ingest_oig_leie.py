import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from ingest_oig_leie import check_control, normalize_row, preload_counts  # noqa: E402


def test_bare_zero_blanks_become_the_sentinels_queries_test():
    row = {"NPI": "0", "REINDATE": "0", "WAIVERDATE": "0", "EXCLDATE": "20200319",
           "UPIN": "0", "DOB": "0", "LASTNAME": "X"}
    n = normalize_row(row)
    assert n["NPI"] == "0000000000"
    assert n["REINDATE"] == "00000000"
    assert n["WAIVERDATE"] == "00000000"
    assert n["EXCLDATE"] == "20200319"
    assert n["UPIN"] == "" and n["DOB"] == ""


def test_real_values_and_old_format_are_untouched():
    row = {"NPI": "1801839139", "REINDATE": "00000000", "EXCLDATE": "20081120",
           "WAIVERDATE": "", "UPIN": "", "DOB": "19600101"}
    assert normalize_row(row) == row


def test_a_real_reinstatement_date_is_kept():
    assert normalize_row({"REINDATE": "20240105"})["REINDATE"] == "20240105"


def test_control_refuses_the_unnormalized_file_before_any_load():
    raw = [{"NPI": "0", "REINDATE": "0"}] * 10 + [{"NPI": "1801839139", "REINDATE": "0"}]
    with pytest.raises(SystemExit):
        check_control(preload_counts(raw))


def test_control_passes_the_normalized_file():
    rows = [normalize_row({"NPI": "0", "REINDATE": "0"})] * 10 + [
        normalize_row({"NPI": "1801839139", "REINDATE": "0"})]
    c = preload_counts(rows)
    assert c == {"total": 11, "still_excluded": 11, "with_real_npi": 1}
    check_control(c)
