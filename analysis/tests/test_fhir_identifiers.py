"""Tests for the NPI extractor.

The cases below are not hypothetical. Each named shape was observed in a real
published directory, and each of the first three silently returned no NPI at
some point in this project's history.
"""
import pytest

from analysis.fhir_identifiers import (
    extract_npi,
    extract_npis,
    is_luhn_valid,
)

# NDH before the 2026-05-08 release, and most vendor files today.
FHIR_SID = {
    "identifier": [
        {"system": "http://hl7.org/fhir/sid/us-npi", "value": "1235223470"},
    ]
}

# NDH from the 2026-05-08 release onward. Broke the TS extractor.
TERMINOLOGY = {
    "identifier": [
        {"system": "http://terminology.hl7.org/NamingSystem/npi",
         "value": "1235223470"},
    ]
}

# Capital BlueCross: no identifier.system at all, marker in type.coding.
# Returned zero NPIs from 2,000 practitioners before the three-way match.
TYPE_CODING_SYSTEM = {
    "identifier": [
        {"use": "official", "type": {"coding": [{"code": "PRN"}]},
         "value": "50213276", "assigner": {"display": "Capital Blue Cross"}},
        {"use": "official", "assigner": {"display": "CMS"},
         "type": {"coding": [{"code": "NPI",
                              "system": "http://hl7.org/fhir/sid/us-npi"}]},
         "value": "1235223470"},
    ]
}

# Marker present as a bare code with no system anywhere.
TYPE_CODING_CODE_ONLY = {
    "identifier": [
        {"type": {"coding": [{"code": "NPI"}]}, "value": "1235223470"},
    ]
}


@pytest.mark.parametrize("resource", [
    FHIR_SID, TERMINOLOGY, TYPE_CODING_SYSTEM, TYPE_CODING_CODE_ONLY,
], ids=["fhir-sid", "terminology-namingsystem", "type-coding-system",
        "type-coding-code-only"])
def test_every_published_shape_yields_the_npi(resource):
    assert extract_npi(resource) == "1235223470"


def test_non_npi_identifiers_are_not_returned():
    """A payer-internal PRN is 8 digits and must never be read as an NPI."""
    resource = {"identifier": [
        {"type": {"coding": [{"code": "PRN"}]}, "value": "50213276"},
        {"type": {"coding": [{"code": "TAX"}]}, "value": "123456789"},
        {"type": {"coding": [{"code": "PN"},
                             {"system":
                              "http://terminology.hl7.org/CodeSystem/v2-0203"}]},
         "value": "9876543210"},
    ]}
    assert extract_npis(resource) == []


def test_wrong_length_values_are_rejected():
    for bad in ("123456789", "12345678901", "", "12345678AB", "  "):
        resource = {"identifier": [
            {"system": "http://hl7.org/fhir/sid/us-npi", "value": bad}]}
        assert extract_npis(resource) == [], bad


def test_whitespace_is_trimmed():
    resource = {"identifier": [
        {"system": "http://hl7.org/fhir/sid/us-npi", "value": " 1235223470 "}]}
    assert extract_npi(resource) == "1235223470"


def test_multiple_distinct_npis_kept_in_source_order():
    resource = {"identifier": [
        {"system": "http://hl7.org/fhir/sid/us-npi", "value": "1235223470"},
        {"type": {"coding": [{"code": "NPI"}]}, "value": "1356746895"},
        {"system": "http://hl7.org/fhir/sid/us-npi", "value": "1235223470"},
    ]}
    assert extract_npis(resource) == ["1235223470", "1356746895"]


def test_accepts_a_bare_identifier_list():
    assert extract_npi(FHIR_SID["identifier"]) == "1235223470"


MALFORMED = [
    None, {}, [], "", 0, {"identifier": None}, {"identifier": {}},
    {"identifier": [None]}, {"identifier": ["nope"]},
    {"identifier": [{"type": None, "value": "1235223470"}]},
    {"identifier": [{"type": {"coding": None}, "value": "1235223470"}]},
    {"identifier": [{"type": {"coding": [None]}, "value": "1235223470"}]},
    {"identifier": [{"type": {"coding": ["NPI"]}, "value": "1235223470"}]},
    {"identifier": [{"system": "http://hl7.org/fhir/sid/us-npi"}]},
    {"identifier": [{"system": "http://hl7.org/fhir/sid/us-npi", "value": 1235223470}]},
]


@pytest.mark.parametrize("resource", MALFORMED)
def test_malformed_input_degrades_to_empty_and_never_raises(resource):
    """These run inside bulk loops. An exception aborts the whole file."""
    assert extract_npis(resource) == []
    assert extract_npi(resource) is None


def test_luhn_accepts_known_valid_npis():
    """Real NPIs taken from the Capital BlueCross directory, not invented ones.

    Cross-checked against the independent implementation in h9_npi_luhn.py over
    3,317 harvested NPIs: both agree, and all 3,317 pass.
    """
    for npi in ("1235223470", "1356746895", "1376612689", "1164475745",
                "1851898662"):
        assert is_luhn_valid(npi), npi


def test_luhn_rejects_a_transposed_digit():
    assert is_luhn_valid("1235223470")
    assert not is_luhn_valid("1235223407")


def test_luhn_rejects_malformed_input():
    for bad in (None, "", "123", "abcdefghij", 1235223470):
        assert not is_luhn_valid(bad)


# Capital BlueCross organizations: no system, no type.coding, only an
# assigner. The strict extractor found zero NPIs across 81 sampled orgs.
CMS_ASSIGNER_ONLY = {
    "identifier": [
        {"use": "official",
         "type": {"coding": [{"system":
                              "http://terminology.hl7.org/CodeSystem/v2-0203",
                              "code": "PRN"}]},
         "value": "0005833290",
         "assigner": {"display": "NCPDP"}},
        {"use": "official", "value": "1811587348",
         "assigner": {"display": "CMS"}},
    ]
}


def test_assigner_hint_is_off_by_default():
    """A publisher convention must never silently widen the default match."""
    assert extract_npis(CMS_ASSIGNER_ONLY) == []


def test_assigner_hint_finds_the_cms_assigned_npi():
    assert extract_npis(CMS_ASSIGNER_ONLY, assigner_hint=True) == ["1811587348"]


def test_assigner_hint_ignores_a_ten_digit_ncpdp_value():
    """NCPDP identifiers are also 10 digits; 3 of 59 sampled passed Luhn."""
    resource = {"identifier": [
        {"value": "1811587348", "assigner": {"display": "NCPDP"}},
    ]}
    assert extract_npis(resource, assigner_hint=True) == []


def test_assigner_hint_requires_a_valid_check_digit():
    """Luhn is what rejects a malformed CMS-assigned value."""
    resource = {"identifier": [
        {"value": "1811587340", "assigner": {"display": "CMS"}},
    ]}
    assert extract_npis(resource, assigner_hint=True) == []


def test_assigner_hint_accepts_the_spelled_out_agency_name():
    resource = {"identifier": [
        {"value": "1811587348",
         "assigner": {"display": "Centers for Medicare & Medicaid Services"}},
    ]}
    assert extract_npis(resource, assigner_hint=True) == ["1811587348"]


@pytest.mark.parametrize("resource", MALFORMED)
def test_assigner_hint_also_degrades_to_empty(resource):
    assert extract_npis(resource, assigner_hint=True) == []

