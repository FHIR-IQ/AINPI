"""Unit tests for the NUCC taxonomy categorization.

Pure functions only: no network, no BigQuery. `load_taxonomy` is exercised
through a fixture dict rather than a live fetch, because a test that depends
on nucc.org being up is a test that fails for the wrong reason.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent.parent))

from analysis.nucc_taxonomy import (  # noqa: E402
    GROUPING_CATEGORY,
    categorize,
    primary_taxonomy,
)


TAXONOMY = {
    "207Q00000X": {"code": "207Q00000X", "category": "physician",
                   "grouping": "Allopathic & Osteopathic Physicians",
                   "individual": True},
    "390200000X": {"code": "390200000X", "category": "student",
                   "grouping": "Student, Health Care", "individual": True},
    "341600000X": {"code": "341600000X", "category": "transport",
                   "grouping": "Transportation Services", "individual": False},
}


def test_known_code_returns_its_category():
    assert categorize("207Q00000X", TAXONOMY) == "physician"
    assert categorize("390200000X", TAXONOMY) == "student"


@pytest.mark.parametrize("missing", ["", None])
def test_absent_taxonomy_is_not_an_unknown_code(missing):
    """A provider with no taxonomy on file is an incomplete record. A code the
    release does not contain is a retired or mistyped code. Collapsing the two
    would hide a data-quality signal inside a category label."""
    assert categorize(missing, TAXONOMY) == "no-taxonomy"


def test_unrecognised_code_is_distinct_from_missing():
    assert categorize("999999999X", TAXONOMY) == "unknown-code"


def test_every_mapped_category_is_a_plain_string():
    for grouping, category in GROUPING_CATEGORY.items():
        assert isinstance(category, str) and category
        assert category == category.lower()
        assert " " not in category, f"{grouping} maps to a spaced label"


class TestPrimaryTaxonomy:
    def test_switch_y_wins_over_slot_order(self):
        codes = ["390200000X", "207Q00000X", ""]
        switches = ["N", "Y", ""]
        assert primary_taxonomy(codes, switches) == ("207Q00000X", True)

    def test_falls_back_to_first_populated_slot(self):
        """Records exist with no 'Y' in any slot. The caller is told the value
        is a fallback so it is not reported as an authoritative primary."""
        codes = ["", "390200000X", "207Q00000X"]
        switches = ["", "N", "N"]
        assert primary_taxonomy(codes, switches) == ("390200000X", False)

    def test_no_codes_at_all(self):
        assert primary_taxonomy(["", "", ""], ["", "", ""]) == (None, False)

    def test_whitespace_only_slots_are_empty(self):
        assert primary_taxonomy(["   ", "\t"], ["", ""]) == (None, False)

    def test_none_values_do_not_raise(self):
        """NPPES slots arrive as None from BigQuery when unpopulated. An
        exception here would abort a whole state's run."""
        assert primary_taxonomy([None, "207Q00000X"], [None, "Y"]) == (
            "207Q00000X", True)

    def test_lowercase_switch_is_honoured(self):
        assert primary_taxonomy(["207Q00000X"], ["y"]) == ("207Q00000X", True)

    def test_switch_shorter_than_codes_does_not_raise(self):
        """zip() stops at the shorter sequence rather than raising, which is
        the degradation we want: a truncated switch list loses the primary
        marker, it does not lose the practitioner."""
        assert primary_taxonomy(["207Q00000X", "390200000X"], ["N"]) == (
            "207Q00000X", False)
