"""Unit tests for analysis/h26_mco_exposure_va.py.

Pure-function coverage only — HTTP and BigQuery are validated by running
the script end-to-end against live MCO endpoints.

Run:
    cd <repo-root>
    python -m pytest analysis/tests/test_h26_mco_exposure_va.py -v
"""
from __future__ import annotations
import sys
from pathlib import Path

# Add analysis/ to sys.path so we can import the module under test without
# packaging the analysis dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import h26_mco_exposure_va as h26  # noqa: E402


def test_filter_cohort_keeps_only_va_critical_excluded():
    rows = [
        # state=VA, critical, oig_excluded → KEEP
        {"npi": "1111111111", "name": "DOE, JANE", "state": "VA",
         "score": "1.5", "bucket": "critical", "reasons": "oig_excluded"},
        # state=VA, critical, sam_excluded → KEEP
        {"npi": "2222222222", "name": "ROE, JOHN", "state": "VA",
         "score": "1.5", "bucket": "critical", "reasons": "sam_excluded"},
        # state=VA, critical, oig+sam → KEEP
        {"npi": "3333333333", "name": "SMITH, A", "state": "VA",
         "score": "3.0", "bucket": "critical", "reasons": "oig_excluded|sam_excluded"},
        # state=VA, high (not critical) → DROP
        {"npi": "4444444444", "name": "JONES, B", "state": "VA",
         "score": "1.0", "bucket": "high", "reasons": "luhn_fail"},
        # state=NY, critical, oig_excluded → DROP (wrong state)
        {"npi": "5555555555", "name": "LEE, C", "state": "NY",
         "score": "1.5", "bucket": "critical", "reasons": "oig_excluded"},
        # state=VA, critical, but only luhn_fail → DROP (not federally excluded)
        {"npi": "6666666666", "name": "POE, D", "state": "VA",
         "score": "1.5", "bucket": "critical", "reasons": "luhn_fail"},
    ]
    kept = h26.filter_cohort(rows, state="VA")
    assert [r["npi"] for r in kept] == ["1111111111", "2222222222", "3333333333"]


def test_classify_response_matched_with_total_one():
    body = '{"resourceType":"Bundle","type":"searchset","total":1,"entry":[{}]}'
    assert h26.classify_response(200, body) == "matched"


def test_classify_response_matched_with_entries_no_total():
    body = '{"resourceType":"Bundle","type":"searchset","entry":[{"resource":{}}]}'
    assert h26.classify_response(200, body) == "matched"


def test_classify_response_not_in_directory_zero_total():
    body = '{"resourceType":"Bundle","type":"searchset","total":0}'
    assert h26.classify_response(200, body) == "not_in_directory"


def test_classify_response_not_in_directory_empty_entry():
    body = '{"resourceType":"Bundle","type":"searchset","entry":[]}'
    assert h26.classify_response(200, body) == "not_in_directory"


def test_classify_response_error_on_5xx():
    assert h26.classify_response(503, "service unavailable") == "error"


def test_classify_response_error_on_4xx_non_404():
    # 400 / 401 / 403 are auth/parse errors — never silently say "not in directory"
    assert h26.classify_response(401, "") == "error"


def test_classify_response_404_treated_as_not_in_directory():
    # Some FHIR servers return 404 for empty searches instead of empty Bundle
    assert h26.classify_response(404, "") == "not_in_directory"


def test_classify_response_error_on_malformed_json():
    assert h26.classify_response(200, "not json") == "error"


def test_classify_response_error_on_non_bundle_resource():
    body = '{"resourceType":"OperationOutcome","issue":[{"severity":"error"}]}'
    assert h26.classify_response(200, body) == "error"


def test_parse_cohort_name_standard():
    assert h26.parse_cohort_name("DOE, JANE") == ("DOE", "JANE")


def test_parse_cohort_name_multi_given():
    # The cohort export sometimes has multi-token given names — keep the
    # whole given chunk; FHIR servers handle the join.
    assert h26.parse_cohort_name("SMITH, A B") == ("SMITH", "A B")


def test_parse_cohort_name_empty():
    assert h26.parse_cohort_name("") == ("", "")
    assert h26.parse_cohort_name(None) == ("", "")


def test_parse_cohort_name_family_only():
    # Some cohort rows may have just a last name (e.g. organizations or
    # truncated entries). Keep family, given becomes empty.
    assert h26.parse_cohort_name("ACME CLINIC") == ("ACME CLINIC", "")


def test_bundle_contains_npi_match():
    body = (
        '{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Practitioner",'
        '"identifier":[{"system":"http://hl7.org/fhir/sid/us-npi","value":"1234567890"}]}}]}'
    )
    assert h26.bundle_contains_npi(body, "1234567890") is True


def test_bundle_contains_npi_no_match():
    body = (
        '{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Practitioner",'
        '"identifier":[{"system":"http://hl7.org/fhir/sid/us-npi","value":"9999999999"}]}}]}'
    )
    assert h26.bundle_contains_npi(body, "1234567890") is False


def test_bundle_contains_npi_tolerates_missing_system():
    # Some payers omit the `system` on the NPI identifier; accept value-only.
    body = (
        '{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Practitioner",'
        '"identifier":[{"value":"1234567890"}]}}]}'
    )
    assert h26.bundle_contains_npi(body, "1234567890") is True


def test_bundle_contains_npi_skips_non_practitioner_resources():
    # Cigna's name-search Bundle can include `Organization` entries; ignore
    # any non-Practitioner.
    body = (
        '{"resourceType":"Bundle","entry":['
        '{"resource":{"resourceType":"Organization",'
        '"identifier":[{"value":"1234567890"}]}}]}'
    )
    assert h26.bundle_contains_npi(body, "1234567890") is False


def test_bundle_contains_npi_empty_bundle():
    body = '{"resourceType":"Bundle","entry":[]}'
    assert h26.bundle_contains_npi(body, "1234567890") is False


def test_bundle_contains_npi_malformed_json():
    assert h26.bundle_contains_npi("not json", "1234567890") is False
