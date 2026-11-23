"""Unit tests for analysis/xsource_norm.py. Pure functions, no network.

The NUCC lookup is exercised through a fixture dict: a fresh checkout has no
cached NUCC file, and `load_taxonomy()` would otherwise fetch nucc.org.
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import xsource_norm as xn  # noqa: E402

NUCC = {"207Q00000X": {"code": "207Q00000X"}, "363LF0000X": {"code": "363LF0000X"}}


# --- relation / lineage ----------------------------------------------------

def test_npd_against_nppes_is_upstream():
    assert xn.relation("npd", "nppes") == "upstream"
    assert xn.relation("nppes", "npd") == "upstream"


def test_npd_against_pecos_is_upstream():
    assert xn.relation("npd", "pecos") == "upstream"


def test_nppes_against_pecos_is_independent():
    assert xn.relation("nppes", "pecos") == "independent"


def test_payer_lineage_is_unknown():
    assert xn.relation("npd", "humana") == "unknown"
    assert xn.relation("humana", "nppes") == "unknown"
    assert xn.relation("optum_flex", "humana") == "unknown"


def test_relation_rejects_same_source_and_unknown_names():
    with pytest.raises(ValueError):
        xn.relation("npd", "npd")
    with pytest.raises(ValueError):
        xn.relation("npd", "cigna")


def test_lineage_table_matches_plan():
    assert xn.LINEAGE == {
        "npd": ["nppes", "pecos"],
        "nppes": [],
        "pecos": [],
        "humana": ["unknown"],
        "optum_flex": ["unknown"],
    }


def test_lineage_label():
    assert xn.lineage_label("npd") == "nppes|pecos"
    assert xn.lineage_label("nppes") == "root"
    assert xn.lineage_label("humana") == "unknown"


# --- zip5 ------------------------------------------------------------------

@pytest.mark.parametrize("raw,want", [
    ("15206-1234", "15206"),
    ("152061234", "15206"),
    ("15206", "15206"),
    (" 15206 ", "15206"),
    (15206, "15206"),
    ("021341234", "02134"),
    ("1520", None),
    ("1520612", None),
    ("00000", None),
    ("", None),
    (None, None),
    ("ABCDE", None),
])
def test_zip5(raw, want):
    assert xn.zip5(raw) == want


# --- phone10 ---------------------------------------------------------------

@pytest.mark.parametrize("raw,want", [
    ("1 (412) 345-5134", "4123455134"),
    ("412.345.5134", "4123455134"),
    ("4123455134", "4123455134"),
    ("14123455134", "4123455134"),
    ("345-5134", None),
    ("24123455134", None),         # 11 digits not starting with 1
    ("412-345-5134 x12", None),    # extension: 12 digits, rule rejects
    ("", None),
    (None, None),
])
def test_phone10(raw, want):
    assert xn.phone10(raw) == want


# --- taxonomy --------------------------------------------------------------

def test_taxonomy_valid_and_normalized():
    assert xn.taxonomy("207Q00000X", NUCC) == "207Q00000X"
    assert xn.taxonomy(" 207q00000x ", NUCC) == "207Q00000X"


def test_taxonomy_rejects_unknown_and_malformed():
    assert xn.taxonomy("207R00000X", NUCC) is None   # well-formed, not in the set
    assert xn.taxonomy("14-50", NUCC) is None        # CMS Medicare specialty form
    assert xn.taxonomy("", NUCC) is None
    assert xn.taxonomy(None, NUCC) is None


def test_taxonomy_without_map_uses_lazy_loader(monkeypatch):
    calls = []

    def fake_loader():
        calls.append(1)
        return NUCC

    monkeypatch.setattr(xn, "_NUCC_CACHE", None)
    monkeypatch.setattr(xn, "_load_nucc", fake_loader)
    assert xn.taxonomy("363LF0000X") == "363LF0000X"
    assert xn.taxonomy("207Q00000X") == "207Q00000X"
    assert calls == [1]  # loaded once, cached


# --- telecom parsing -------------------------------------------------------

def test_phones_from_telecom_keeps_phone_system_only():
    raw = "fax:4125559998|phone:1-412-555-0177|phone:345-5134|email:a@b.c"
    assert xn.phones_from_telecom(raw) == ["4125550177"]
    assert xn.phones_from_telecom(None) == []


# --- dataless guard --------------------------------------------------------

def test_assert_materialized_raises_on_dataless(tmp_path):
    p = tmp_path / "location.parquet"
    p.write_bytes(b"x")
    fake = lambda _p: SimpleNamespace(st_flags=xn.SF_DATALESS)  # noqa: E731
    with pytest.raises(RuntimeError, match="Download Now"):
        xn.assert_materialized(p, stat=fake)


def test_assert_materialized_passes_local_file(tmp_path):
    p = tmp_path / "x.parquet"
    p.write_bytes(b"x")
    xn.assert_materialized(p)  # real stat, no flag


def test_assert_materialized_raises_on_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        xn.assert_materialized(tmp_path / "nope.parquet")
