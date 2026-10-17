"""Tests for the summary step of analysis/pa_reach_same_method.py.

Offline: the fixtures are the `summary` and `confidence` blocks of the two
pa-connectivity.json runs recorded in
docs/methodology/runs/2026-10-16-pa-reach-same-method.md. No DuckDB, no
parquet, no network.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pa_reach_same_method import (  # noqa: E402
    build_side_by_side,
    check_summary,
    release_summary,
    translate,
)

AUG = {
    "release_date": "2026-08-20",
    "summary": {
        "practitioners": 230837, "with_role": 100918, "with_role_pct": 43.7,
        "reaches_endpoint": 52802, "reaches_endpoint_pct": 22.9,
        "reaches_endpoint_deterministic": 8117,
        "reaches_endpoint_deterministic_pct": 3.5,
        "affiliated_any_source": 101255,
        "reaches_endpoint_pct_of_affiliated": 52.1,
    },
    "confidence": {
        "green": 2461, "yellow": 5656, "vendor_list": 10038, "resolved": 27665,
        "resolved_by_tier": {"alias": 11240, "name-state": 5884, "brand-state": 10541},
        "enrolled": 6982, "candidate": 1808, "red": 40626, "none": 135601,
    },
}
OCT = {
    "release_date": "2026-10-07",
    "summary": {
        "practitioners": 227917, "with_role": 100379, "with_role_pct": 44.0,
        "reaches_endpoint": 50812, "reaches_endpoint_pct": 22.3,
        "reaches_endpoint_deterministic": 6555,
        "reaches_endpoint_deterministic_pct": 2.9,
        "affiliated_any_source": 100974,
        "reaches_endpoint_pct_of_affiliated": 50.3,
    },
    "confidence": {
        "green": 1907, "yellow": 4648, "vendor_list": 8967, "resolved": 27214,
        "resolved_by_tier": {"alias": 11393, "name-state": 5548, "brand-state": 10273},
        "enrolled": 8076, "candidate": 1693, "red": 41588, "none": 133824,
    },
}

PUBLISHED = (Path(__file__).resolve().parents[2]
             / "frontend/public/api/v1/states/pa-reach-same-method.json")


def build():
    return build_side_by_side(AUG, OCT, source_commit="b5aa33a",
                              generated_at="2026-10-16T00:00:00+00:00")


def test_release_summary_is_internally_consistent():
    for p in (AUG, OCT):
        assert check_summary(release_summary(p)) == []


def test_side_by_side_numbers():
    out = build()
    a, b = out["releases"]["2026-08-20"], out["releases"]["2026-10-07"]
    assert (a["reaches_endpoint"], b["reaches_endpoint"]) == (52802, 50812)
    assert (a["reaches_endpoint_pct"], b["reaches_endpoint_pct"]) == (22.9, 22.3)
    assert (a["reaches_endpoint_deterministic"], b["reaches_endpoint_deterministic"]) == (8117, 6555)
    assert a["tiers"]["resolved_alias"] == 11240 and b["tiers"]["enrollment_only"] == 8076
    assert out["change"]["reaches_endpoint"] == -1990
    assert out["change"]["reaches_endpoint_pct"] == -0.6
    assert out["change"]["tiers"]["enrollment_only"] == 1094
    assert out["change"]["tiers"]["ndh_only"] == -554


def test_refuses_inconsistent_tiers():
    bad = copy.deepcopy(OCT)
    bad["confidence"]["enrolled"] += 1
    with pytest.raises(ValueError, match="tiers sum"):
        build_side_by_side(AUG, bad, source_commit="x", generated_at="t")


def test_refuses_same_release():
    with pytest.raises(ValueError, match="same release"):
        build_side_by_side(OCT, OCT, source_commit="x", generated_at="t")


def test_published_file_matches_builder():
    pub = json.loads(PUBLISHED.read_text())
    out = build_side_by_side(AUG, OCT, source_commit=pub["source_commit"],
                             generated_at=pub["generated_at"])
    assert pub == out


def test_translate_rewrites_and_refuses():
    s = translate("SELECT COUNTIF(x) FROM `thematic-fort-453901-t7.cms_npd.endpoint` "
                  "WHERE s = @state")
    assert s == "SELECT count_if(x) FROM endpoint WHERE s = $state"
    with pytest.raises(RuntimeError):
        translate("SELECT a[OFFSET(0)] FROM t")
