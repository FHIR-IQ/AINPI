"""Unit tests for the NDH ingest flatteners.

Two things are being protected here.

Correctness: the flattened `_*` columns exist so consumers do not have to scan
the resource JSON. If `_phone` silently became "first telecom entry" rather
than "first phone entry", every downstream phone query would quietly pick up
fax numbers, and nothing would fail loudly.

Robustness: these functions run inside a streaming transform over millions of
NDJSON lines. An exception aborts the whole file. It is NOT absorbed by
`--max_bad_records`, which only covers rows bq itself rejects. So one malformed
record in a 7.4M-row export would kill the load. Every extractor must degrade
to None rather than raise, on any shape.

Run: python -m pytest analysis/tests/test_fast_ingest_flatteners.py
"""
from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from fast_ingest_ndh import (  # noqa: E402
    extract_endpoint,
    extract_location,
    extract_organization,
    extract_practitioner,
    extract_practitioner_role,
    first_address,
    physical_address,
)

ALL_EXTRACTORS = [
    extract_practitioner,
    extract_organization,
    extract_location,
    extract_practitioner_role,
    extract_endpoint,
]

# Shapes observed or plausible in a self-attested bulk export. None may raise.
MALFORMED = [
    {"id": "X"},
    {"id": "X", "address": "nope"},
    {"id": "X", "address": []},
    {"id": "X", "address": ["a string, not an Address"]},
    {"id": "X", "address": [None]},
    {"id": "X", "address": {"line": "not-a-list"}},
    {"id": "X", "telecom": "nope"},
    {"id": "X", "telecom": [None]},
    {"id": "X", "telecom": [{"system": "phone"}]},
    {"id": "X", "name": "nope"},
    {"id": "X", "type": "nope"},
    {"id": "X", "position": {"latitude": "abc", "longitude": None}},
    {"id": "X", "identifier": "nope"},
    {"id": "X", "specialty": "nope"},
    {"id": "X", "specialty": []},
    {"id": "X", "specialty": ["a string, not a CodeableConcept"]},
    {"id": "X", "specialty": [None]},
    {"id": "X", "specialty": [{"coding": "nope"}]},
    {"id": "X", "specialty": [{"coding": []}]},
    {"id": "X", "specialty": [{"coding": [None]}]},
    {"id": "X", "specialty": [{"coding": [{"display": "no code"}]}]},
    {"id": "X", "specialty": [{"coding": [{"code": 12345}]}]},
    {"id": "X", "address": [{"type": ["physical"]}, {"use": {"x": 1}}]},
    {"id": "X", "address": [None, "junk", {"type": None, "use": None}]},
    {"id": "X", "address": [{"type": "physical", "line": "not-a-list"}]},
]


class TestTelecom:
    def test_phone_is_first_phone_not_first_telecom(self):
        """Fax often precedes phone in NDH records. _phone must skip it."""
        r = extract_practitioner({"id": "P", "telecom": [
            {"system": "fax", "value": "412-555-0002"},
            {"system": "phone", "value": "412-555-0001"},
            {"system": "phone", "value": "412-555-0003"},
        ]})
        assert r["_phone"] == "412-555-0001"

    def test_telecom_preserves_system_and_order(self):
        r = extract_practitioner({"id": "P", "telecom": [
            {"system": "fax", "value": "1"}, {"system": "phone", "value": "2"},
        ]})
        assert r["_telecom"] == "fax:1|phone:2"

    def test_entry_without_value_is_dropped(self):
        r = extract_practitioner({"id": "P", "telecom": [{"system": "phone"}]})
        assert r["_phone"] is None and r["_telecom"] is None

    def test_missing_system_is_labelled_not_dropped(self):
        """A value with no system is still reachable, flagged as unknown."""
        r = extract_practitioner({"id": "P", "telecom": [{"value": "5551212"}]})
        assert r["_telecom"] == "unknown:5551212"
        assert r["_phone"] is None

    def test_absent_telecom_is_none_not_empty_string(self):
        r = extract_practitioner({"id": "P"})
        assert r["_phone"] is None and r["_telecom"] is None


class TestAddressLine:
    def test_multiple_lines_are_pipe_joined(self):
        r = extract_practitioner({"id": "P", "address": [
            {"line": ["100 Main St", "Suite 200"], "city": "Pittsburgh", "state": "PA"}]})
        assert r["_address_line"] == "100 Main St|Suite 200"
        assert r["_state"] == "PA" and r["_city"] == "Pittsburgh"

    def test_location_takes_a_single_address_object(self):
        """Location.address is 0..1, unlike Practitioner/Organization."""
        r = extract_location({"id": "L", "address": {"line": ["1 Hospital Dr"], "state": "PA"}})
        assert r["_address_line"] == "1 Hospital Dr" and r["_state"] == "PA"

    def test_empty_line_array_yields_none(self):
        r = extract_organization({"id": "O", "address": [{"city": "Erie"}]})
        assert r["_address_line"] is None and r["_city"] == "Erie"

    def test_first_address_skips_non_dict_entries(self):
        assert first_address(["junk", {"city": "Erie"}]) == {"city": "Erie"}
        assert first_address("nope") == {}
        assert first_address(None) == {}


BILLING = {"type": "postal", "use": "billing", "line": ["1 Cvs Dr", "#1075"],
           "city": "Woonsocket", "state": "RI"}
PHYSICAL = {"type": "physical", "use": "work", "line": ["5125 Jonestown Rd", "Ste 331"],
            "city": "Harrisburg", "state": "PA"}


class TestOrganizationPhysicalAddress:
    """FHI-84. Organization.address is 0..* and the NDH often lists the postal
    billing address first (NPI 1548282270: billing in Woonsocket, RI, practice
    in Harrisburg, PA). Reading address[0] put 63,194 of 2,058,500
    organizations in the wrong state on the 2026-10-07 release."""

    def test_billing_first_reads_the_physical_address(self):
        r = extract_organization({"id": "O", "address": [BILLING, PHYSICAL]})
        assert (r["_state"], r["_city"]) == ("PA", "Harrisburg")
        assert r["_address_line"] == "5125 Jonestown Rd|Ste 331"

    def test_physical_first_is_unchanged(self):
        r = extract_organization({"id": "O", "address": [PHYSICAL, BILLING]})
        assert r["_state"] == "PA"

    def test_physical_without_use(self):
        a = {"type": "physical", "state": "OH", "city": "Akron"}
        r = extract_organization({"id": "O", "address": [BILLING, a]})
        assert r["_state"] == "OH"

    def test_use_work_without_type(self):
        a = {"use": "work", "state": "VA", "city": "Richmond"}
        r = extract_organization({"id": "O", "address": [BILLING, a]})
        assert r["_state"] == "VA"

    def test_type_both_counts_as_physical(self):
        """FHIR Address.type is postal | physical | both."""
        a = {"type": "both", "use": "billing", "state": "NJ"}
        w = {"use": "work", "state": "NY"}
        r = extract_organization({"id": "O", "address": [BILLING, w, a]})
        assert r["_state"] == "NJ"

    def test_type_outranks_use(self):
        w = {"use": "work", "state": "NY"}
        r = extract_organization({"id": "O", "address": [BILLING, w, PHYSICAL]})
        assert r["_state"] == "PA"

    def test_first_physical_wins_among_several(self):
        a = dict(PHYSICAL, state="MD", city="Columbia")
        r = extract_organization({"id": "O", "address": [BILLING, PHYSICAL, a]})
        assert r["_state"] == "PA"

    def test_neither_marker_falls_back_to_first_entry(self):
        r = extract_organization({"id": "O", "address": [
            {"state": "DE", "city": "Dover"}, {"state": "MD"}]})
        assert (r["_state"], r["_city"]) == ("DE", "Dover")

    def test_only_billing_falls_back_to_first_entry(self):
        r = extract_organization({"id": "O", "address": [BILLING]})
        assert r["_state"] == "RI"

    def test_non_dict_entry_before_the_physical_one(self):
        r = extract_organization({"id": "O", "address": ["junk", None, BILLING, PHYSICAL]})
        assert r["_state"] == "PA"

    def test_single_object_instead_of_list(self):
        r = extract_organization({"id": "O", "address": BILLING})
        assert r["_state"] == "RI"

    def test_picker_degrades_to_empty(self):
        assert physical_address(None) == {}
        assert physical_address("nope") == {}
        assert physical_address([]) == {}
        assert physical_address([None, "x"]) == {}

    def test_practitioner_still_reads_address_zero(self):
        """Practitioner has the same billing-first pattern (119,906 state
        changes measured on 2026-10-07) but its _state is the denominator of
        every per-state number, so it is changed separately. Pinned here so
        the two cannot drift apart by accident."""
        r = extract_practitioner({"id": "P", "address": [BILLING, PHYSICAL]})
        assert r["_state"] == "RI"


class TestPosition:
    def test_lat_lng_extracted_as_floats(self):
        r = extract_location({"id": "L", "position": {"latitude": 42.1292, "longitude": -80.0851}})
        assert r["_position_lat"] == pytest.approx(42.1292)
        assert r["_position_lng"] == pytest.approx(-80.0851)

    def test_non_numeric_coordinates_become_none(self):
        r = extract_location({"id": "L", "position": {"latitude": "abc", "longitude": None}})
        assert r["_position_lat"] is None and r["_position_lng"] is None

    def test_partial_position_keeps_the_valid_half(self):
        r = extract_location({"id": "L", "position": {"latitude": 42.1}})
        assert r["_position_lat"] == pytest.approx(42.1)
        assert r["_position_lng"] is None

    def test_position_only_on_location(self):
        """Only Location carries geo in the NDH; others must not invent it."""
        assert "_position_lat" not in extract_practitioner({"id": "P"})
        assert "_position_lat" not in extract_organization({"id": "O"})


class TestSpecialty:
    """PractitionerRole.specialty is 0..*, and the first entry is not the whole
    story: 421,613 role records in the 2026-08-20 release carry two or more, up
    to 17. Measuring through the first-entry column undercounted providers
    whose specialty differs by organization by 40.6%."""

    def test_every_specialty_is_pipe_joined(self):
        out = extract_practitioner_role({
            "id": "R",
            "specialty": [
                {"coding": [{"code": "207R00000X", "display": "INTERNAL MEDICINE"}]},
                {"coding": [{"code": "208M00000X", "display": "HOSPITALIST"}]},
            ],
        })
        assert out["_specialty_codes"] == "207R00000X|208M00000X"

    def test_singular_column_keeps_first_entry_semantics(self):
        """It has always held the first entry. Widening it during a backfill
        would rewrite values external consumers already read."""
        out = extract_practitioner_role({
            "id": "R",
            "specialty": [
                {"coding": [{"display": "no code here"}]},
                {"coding": [{"code": "208M00000X"}]},
            ],
        })
        assert out["_specialty_code"] is None
        assert out["_specialty_codes"] == "208M00000X"

    def test_single_specialty_has_no_separator(self):
        out = extract_practitioner_role(
            {"id": "R", "specialty": [{"coding": [{"code": "207R00000X"}]}]})
        assert out["_specialty_codes"] == "207R00000X"
        assert out["_specialty_code"] == "207R00000X"

    def test_absent_specialty_is_none_not_empty_string(self):
        out = extract_practitioner_role({"id": "R"})
        assert out["_specialty_codes"] is None

    def test_a_non_dict_entry_does_not_lose_the_rest(self):
        """The previous extractor raised AttributeError here, which would abort
        a 16M-row load rather than dropping one bad entry."""
        out = extract_practitioner_role({
            "id": "R",
            "specialty": ["not a CodeableConcept", {"coding": [{"code": "207R00000X"}]}],
        })
        assert out["_specialty_codes"] == "207R00000X"

    def test_no_parallel_displays_column(self):
        """Codes only. A displays column would misalign whenever one entry has
        no display, silently pairing a code with another specialty's name."""
        out = extract_practitioner_role({
            "id": "R",
            "specialty": [
                {"coding": [{"code": "A"}]},
                {"coding": [{"code": "B", "display": "Beta"}]},
            ],
        })
        assert out["_specialty_codes"] == "A|B"
        assert "_specialty_displays" not in out


@pytest.mark.parametrize("extractor", ALL_EXTRACTORS, ids=lambda f: f.__name__)
@pytest.mark.parametrize("record", MALFORMED, ids=range(len(MALFORMED)))
def test_extractors_never_raise_on_malformed_input(extractor, record):
    """One raise here aborts a multi-million-row load. Degrade, never throw."""
    out = extractor(record)
    assert out["_id"] == "X"
