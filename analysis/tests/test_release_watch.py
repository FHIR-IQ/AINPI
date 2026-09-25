"""Tests for the release-watch checks (payer PIN, Practitioner.birthDate).

Both checks watch for a field that is absent today and may arrive in a later
release. A watch that reports zero is only worth publishing if it could have
reported something else, so the positive controls are tested as carefully as
the matchers, and every matcher must degrade to False or 0 on a malformed
resource rather than raise.
"""
import pytest

from analysis.release_watch import (
    PAYER_TYPE_CODE,
    PAYERID_CODE,
    birthdate_summary,
    classify_birth_date,
    coding_codes,
    has_identifier_type_code,
    identifier_count,
    is_payer_typed,
    merge_note,
    payer_pin_summary,
)

PAYER_ORG = {
    "resourceType": "Organization",
    "type": [{"coding": [{
        "system": "http://terminology.hl7.org/CodeSystem/organization-type",
        "code": "pay",
    }]}],
}

PIN = {
    "type": {"coding": [{
        "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
        "code": "PAYERID",
    }]},
    "value": "12345",
}

MALFORMED = [
    None,
    "Organization",
    [],
    {},
    {"type": None},
    {"type": "pay"},
    {"type": [None, "pay", 7]},
    {"type": [{"coding": None}]},
    {"type": [{"coding": "pay"}]},
    {"type": [{"coding": [None, 3, "pay"]}]},
    {"type": [{"coding": [{"system": "x"}]}]},
    {"type": [{"text": "pay"}]},
    {"identifier": None},
    {"identifier": "PAYERID"},
    {"identifier": [None, 1, "PAYERID"]},
    {"identifier": [{"type": None}]},
    {"identifier": [{"type": "PAYERID"}]},
    {"identifier": [{"type": {"coding": None}}]},
    {"identifier": [{"type": {"coding": [{"code": None}]}}]},
]


# --- coding walk ---------------------------------------------------------

def test_coding_codes_walks_every_concept_and_coding():
    concepts = [
        {"coding": [{"code": "prov"}, {"code": "pay"}]},
        {"coding": [{"code": "govt"}]},
    ]
    assert coding_codes(concepts) == ["prov", "pay", "govt"]


def test_coding_codes_accepts_a_single_concept():
    assert coding_codes({"coding": [{"code": "PAYERID"}]}) == ["PAYERID"]


@pytest.mark.parametrize("bad", [None, "x", 3, [None], [{"coding": "x"}],
                                 [{"coding": [None, {"code": 5}]}]])
def test_coding_codes_never_raises(bad):
    assert coding_codes(bad) == []


# --- payer type ----------------------------------------------------------

def test_payer_type_found_in_first_slot():
    assert is_payer_typed(PAYER_ORG)


def test_payer_type_found_in_a_later_concept_and_coding():
    org = {"type": [
        {"coding": [{"code": "prov"}]},
        {"coding": [{"system": "other", "code": "x"}, {"code": "pay"}]},
    ]}
    assert is_payer_typed(org)


def test_payer_type_ignores_system():
    # The watch matches the code under any system, so a system URL change
    # cannot turn the check into a silent zero.
    assert is_payer_typed({"type": [{"coding": [{"system": "urn:new", "code": "pay"}]}]})


def test_provider_is_not_payer():
    assert not is_payer_typed({"type": [{"coding": [{"code": "prov"}]}]})


def test_payer_text_without_code_is_not_payer():
    assert not is_payer_typed({"type": [{"text": "pay"}]})


@pytest.mark.parametrize("bad", MALFORMED)
def test_is_payer_typed_never_raises(bad):
    assert is_payer_typed(bad) is False


# --- identifiers ---------------------------------------------------------

def test_identifier_count():
    assert identifier_count({"identifier": [PIN, {"value": "x"}]}) == 2
    assert identifier_count(PAYER_ORG) == 0


def test_identifier_count_skips_non_dict_entries():
    assert identifier_count({"identifier": [None, "x", PIN]}) == 1


def test_payerid_found_on_any_identifier():
    org = {**PAYER_ORG, "identifier": [{"value": "1234567893"}, PIN]}
    assert has_identifier_type_code(org, PAYERID_CODE)


def test_payerid_found_under_any_system():
    org = {"identifier": [{"type": {"coding": [
        {"system": "urn:other", "code": "XX"},
        {"system": "urn:new-home", "code": "PAYERID"},
    ]}}]}
    assert has_identifier_type_code(org, PAYERID_CODE)


def test_payerid_is_matched_exactly():
    # FHIR codes are case-sensitive. A lower-case code is a different code and
    # counting it would overstate adoption of the slice.
    org = {"identifier": [{"type": {"coding": [{"code": "payerid"}]}}]}
    assert not has_identifier_type_code(org, PAYERID_CODE)


def test_payerid_in_text_only_does_not_count():
    org = {"identifier": [{"type": {"text": "PAYERID"}, "value": "1"}]}
    assert not has_identifier_type_code(org, PAYERID_CODE)


@pytest.mark.parametrize("bad", MALFORMED)
def test_identifier_helpers_never_raise(bad):
    assert has_identifier_type_code(bad, PAYERID_CODE) is False
    assert identifier_count(bad) >= 0


# --- payer PIN summary + positive control ---------------------------------

def test_pin_summary_counts_the_current_release_shape():
    orgs = [dict(PAYER_ORG) for _ in range(27)]
    s = payer_pin_summary(orgs)
    assert s["control_passed"] is True
    assert s["payer_orgs"] == 27
    assert s["payer_orgs_with_any_identifier"] == 0
    assert s["payer_orgs_with_payerid"] == 0
    assert "FHIR-57606" in s["note"]
    assert "STU2 draft" in s["note"]


def test_pin_summary_counts_identifiers_and_pins():
    orgs = [
        {**PAYER_ORG, "identifier": [PIN]},
        {**PAYER_ORG, "identifier": [{"value": "x"}]},
        dict(PAYER_ORG),
    ]
    s = payer_pin_summary(orgs)
    assert s["payer_orgs"] == 3
    assert s["payer_orgs_with_any_identifier"] == 2
    assert s["payer_orgs_with_payerid"] == 1


def test_pin_summary_drops_rows_that_are_not_payer_typed():
    # SQL selects the rows; Python re-checks them with the tested matcher so a
    # loose SQL filter cannot inflate the denominator.
    s = payer_pin_summary([PAYER_ORG, {"type": [{"coding": [{"code": "prov"}]}]}])
    assert s["payer_orgs"] == 1


def test_pin_summary_refuses_zero_without_payer_orgs():
    s = payer_pin_summary([])
    assert s["control_passed"] is False
    assert s["payer_orgs"] == 0
    assert s["payer_orgs_with_any_identifier"] is None
    assert s["payer_orgs_with_payerid"] is None
    assert "not reported" in s["note"]


def test_pin_note_does_not_link_a_build_or_fork():
    note = payer_pin_summary([PAYER_ORG])["note"]
    assert "build.fhir.org" not in note
    assert "github.com" not in note
    assert "STU1" in note
    assert "—" not in note


# --- birthDate -----------------------------------------------------------

@pytest.mark.parametrize("value,expected", [
    (None, "absent"),
    ("", "absent"),
    ("1970", "year_only"),
    ("1970-04", "finer_than_year"),
    ("1970-04-01", "finer_than_year"),
    (1970, "absent"),
])
def test_classify_birth_date(value, expected):
    assert classify_birth_date(value) == expected


def test_birthdate_summary_current_release():
    s = birthdate_summary(total=7_373_232, gender_present=7_373_232,
                          birth_date_present=0, year_only=0, full_date=0)
    assert s["control_passed"] is True
    assert s["birth_date_present"] == 0
    assert s["full_date"] == 0
    assert "FHIR-57885" in s["note"]
    assert "beyond" not in s["note"]


def test_birthdate_summary_calls_out_full_dates_plainly():
    s = birthdate_summary(total=100, gender_present=100,
                          birth_date_present=10, year_only=4, full_date=6)
    assert s["full_date"] == 6
    assert "6 " in s["note"]
    assert "beyond what the STU2 draft allows" in s["note"]
    assert "warning" in s["note"]


def test_birthdate_summary_refuses_zero_when_control_fails():
    s = birthdate_summary(total=7_373_232, gender_present=0,
                          birth_date_present=0, year_only=0, full_date=0)
    assert s["control_passed"] is False
    assert s["birth_date_present"] is None
    assert s["year_only"] is None
    assert s["full_date"] is None
    assert "not reported" in s["note"]


def test_birthdate_summary_refuses_when_population_is_empty():
    s = birthdate_summary(total=0, gender_present=0,
                          birth_date_present=0, year_only=0, full_date=0)
    assert s["control_passed"] is False


def test_birthdate_note_has_no_em_dash():
    s = birthdate_summary(total=100, gender_present=100,
                          birth_date_present=10, year_only=4, full_date=6)
    assert "—" not in s["note"]


# --- note merge ----------------------------------------------------------

def test_merge_note_appends_once_and_replaces_on_rerun():
    base = "Original notes."
    once = merge_note(base, "Release watch, payer PIN:", "Release watch, payer PIN: 0 of 27.")
    twice = merge_note(once, "Release watch, payer PIN:", "Release watch, payer PIN: 1 of 27.")
    assert once == "Original notes.\n\nRelease watch, payer PIN: 0 of 27."
    assert twice == "Original notes.\n\nRelease watch, payer PIN: 1 of 27."


def test_merge_note_handles_empty_notes():
    assert merge_note(None, "M:", "M: x") == "M: x"
    assert merge_note("", "M:", "M: x") == "M: x"
