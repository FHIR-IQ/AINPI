"""Tests for the detail-refresh helpers used by H49 (and the H27 text builders).

The published H49 JSON is written in two halves: headline, chart and notes by
h49_recheck_release.py, and `detail` by the BigQuery script. Before this, the
recheck path left `detail` alone and nothing else rewrote it, so every detail
field sat at the 2026-05-08 values while the headline described 2026-08-20.
These tests pin the merge (it may only touch `detail`, and only the keys it
measured) and the positive controls (a zero must come from a query that could
have seen something).
"""
import copy

import pytest

from analysis.finding_detail import (
    RefreshRefused,
    merge_detail,
    type_codings_control,
    control_probe_usable,
)

PUBLISHED = {
    "slug": "ndh-payer-endpoint-coverage",
    "release_date": "2026-08-20",
    "headline": "current headline",
    "numerator": 1,
    "denominator": 110973,
    "chart": {"type": "bar", "data": [{"label": "x", "value": 27}]},
    "notes": "current notes\n\nRelease watch, payer PIN: ...",
    "detail": {
        "organization_type_codings": [{"code": "prov", "display": "P", "count": 1}],
        "distinct_endpoint_hosts": 2962,
        "payer_pin_watch": {"payer_orgs": 27},
        "some_future_key": "kept",
    },
}


def test_merge_detail_replaces_only_measured_keys():
    measured = {"organization_type_codings": [{"code": "pay", "display": None, "count": 27}],
                "distinct_endpoint_hosts": 3000}
    out = merge_detail(copy.deepcopy(PUBLISHED), measured)
    assert out["detail"]["organization_type_codings"] == measured["organization_type_codings"]
    assert out["detail"]["distinct_endpoint_hosts"] == 3000
    # untouched detail keys survive
    assert out["detail"]["payer_pin_watch"] == {"payer_orgs": 27}
    assert out["detail"]["some_future_key"] == "kept"
    # every non-detail field is byte-for-byte the same
    for k in PUBLISHED:
        if k != "detail":
            assert out[k] == PUBLISHED[k]


def test_merge_detail_never_removes_a_key():
    out = merge_detail(copy.deepcopy(PUBLISHED), {})
    assert set(out["detail"]) == set(PUBLISHED["detail"])
    assert set(out) == set(PUBLISHED)


def test_merge_detail_creates_detail_when_missing_or_malformed():
    assert merge_detail({"slug": "x"}, {"a": 1})["detail"] == {"a": 1}
    assert merge_detail({"slug": "x", "detail": "junk"}, {"a": 1})["detail"] == {"a": 1}


ROWS = [
    {"code": "prov", "display": "Healthcare Provider", "n": 2_000_000},
    {"code": "pay", "display": "Payer", "n": 27},
    {"code": "team", "display": "Organizational team", "n": 600},
]


def test_type_codings_control_formats_rows_in_published_shape():
    out = type_codings_control(ROWS, payer_orgs=27)
    assert out == [
        {"code": "prov", "display": "Healthcare Provider", "count": 2_000_000},
        {"code": "pay", "display": "Payer", "count": 27},
        {"code": "team", "display": "Organizational team", "count": 600},
    ]


@pytest.mark.parametrize("rows", [[], None])
def test_type_codings_control_refuses_empty(rows):
    with pytest.raises(RefreshRefused):
        type_codings_control(rows, payer_orgs=27)


def test_type_codings_control_refuses_without_prov():
    # prov is the population: a result with no prov row means the walk broke.
    with pytest.raises(RefreshRefused):
        type_codings_control([{"code": "pay", "display": None, "n": 27}], payer_orgs=27)


def test_type_codings_control_refuses_when_pay_disagrees_with_pin_watch():
    # The PIN watch found 27 payer-typed orgs by walking the same field; a
    # codings table with fewer `pay` codings than that cannot both be right.
    rows = [r for r in ROWS if r["code"] != "pay"]
    with pytest.raises(RefreshRefused):
        type_codings_control(rows, payer_orgs=27)


def test_type_codings_control_accepts_no_pay_when_pin_watch_saw_none():
    rows = [r for r in ROWS if r["code"] != "pay"]
    assert len(type_codings_control(rows, payer_orgs=0)) == 2


@pytest.mark.parametrize("controls,usable", [
    ([{"http_status": 200, "bytes": 1821}], True),
    ([{"http_status": 404, "bytes": 10}], True),   # an answer, just not a live one
    ([{"http_status": 0, "bytes": 0}], False),     # curl failed: no answer at all
    ([{"http_status": 200, "bytes": 1}, {"http_status": 0, "bytes": 0}], False),
    ([], False),
])
def test_control_probe_usable(controls, usable):
    assert control_probe_usable(controls) is usable


def test_h27_notes_zero_branch_does_not_claim_exposures():
    from analysis.h27_pii_exposure import build_notes
    notes = build_notes(release="2026-08-20", confirmed=0, states=0, in_given_name=0,
                        org_matches=0, qual_present=7_371_126, total=7_373_232)
    assert "most SSNs are in" not in notes
    assert "remain in the public" not in notes
    assert "7,371,126" in notes and "7,373,232" in notes


def test_h27_notes_hit_branch_keeps_breakdown():
    from analysis.h27_pii_exposure import build_notes
    notes = build_notes(release="2026-05-08", confirmed=41, states=12, in_given_name=3,
                        org_matches=0, qual_present=1, total=2)
    assert "41 confirmed exposures across 12" in notes


def test_h27_remediation_limitation_has_no_literal_count():
    from analysis.h27_pii_exposure import remediation_limitation
    assert "45" not in remediation_limitation(0)
    assert "0 affected" not in remediation_limitation(0)
    assert "41 affected providers" in remediation_limitation(41)
