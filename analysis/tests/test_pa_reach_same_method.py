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

# The published pair since 2026-10-27: both releases rerun on the physical
# address (FHI-84) with the 2026-10-26 vendor download held constant.
AUG_FHI84 = {
    "release_date": "2026-08-20",
    "summary": {
        "practitioners": 228445, "with_role": 99091, "with_role_pct": 43.4,
        "reaches_endpoint": 52530, "reaches_endpoint_pct": 23.0,
        "reaches_endpoint_deterministic": 8034,
        "reaches_endpoint_deterministic_pct": 3.5,
        "affiliated_any_source": 99428,
        "reaches_endpoint_pct_of_affiliated": 52.8,
    },
    "confidence": {
        "green": 2408, "yellow": 5626, "vendor_list": 9634, "resolved": 27824,
        "resolved_by_tier": {"alias": 11383, "name-state": 5933, "brand-state": 10508},
        "enrolled": 7038, "candidate": 1823, "red": 39089, "none": 135003,
    },
}
OCT_FHI84 = {
    "release_date": "2026-10-07",
    "summary": {
        "practitioners": 225413, "with_role": 97848, "with_role_pct": 43.4,
        "reaches_endpoint": 49997, "reaches_endpoint_pct": 22.2,
        "reaches_endpoint_deterministic": 6381,
        "reaches_endpoint_deterministic_pct": 2.8,
        "affiliated_any_source": 98444,
        "reaches_endpoint_pct_of_affiliated": 50.8,
    },
    "confidence": {
        "green": 1845, "yellow": 4536, "vendor_list": 8366, "resolved": 27157,
        "resolved_by_tier": {"alias": 11339, "name-state": 5605, "brand-state": 10213},
        "enrolled": 8093, "candidate": 1670, "red": 39923, "none": 133823,
    },
}
LEDGER_OCT = {"summary": {"practitioners": 225413, "reaches_endpoint": 49995,
                          "reaches_endpoint_deterministic": 6352}}

PUBLISHED = (Path(__file__).resolve().parents[2]
             / "frontend/public/api/v1/states/pa-reach-same-method.json")


def build():
    return build_side_by_side(AUG, OCT, source_commit="b5aa33a", run_commit="4ba909a",
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
        build_side_by_side(AUG, bad, source_commit="x", run_commit="x", generated_at="t")


def test_refuses_same_release():
    with pytest.raises(ValueError, match="same release"):
        build_side_by_side(OCT, OCT, source_commit="x", run_commit="x", generated_at="t")


def test_published_file_matches_builder():
    pub = json.loads(PUBLISHED.read_text())
    out = build_side_by_side(AUG_FHI84, OCT_FHI84, source_commit=pub["source_commit"],
                             run_commit=pub["run_commit"],
                             generated_at=pub["generated_at"],
                             vendor_download="2026-10-26", address_rule="physical",
                             ledger=LEDGER_OCT)
    assert pub == out


def test_fhi84_pair_states_its_inputs():
    out = build_side_by_side(AUG_FHI84, OCT_FHI84, source_commit="x", run_commit="x",
                             generated_at="t", vendor_download="2026-10-26",
                             address_rule="physical", ledger=LEDGER_OCT)
    assert "2026-10-26 download" in out["method"]
    assert "physical address" in out["method"]
    assert "2026-10-13" not in out["method"]
    lim = " ".join(out["limits"])
    assert "49,997" in lim and "49,995" in lim and "6,381" in lim and "6,352" in lim
    assert "reproduces" not in lim
    assert out["change"]["reaches_endpoint_pct"] == -0.8


def test_translate_rewrites_and_refuses():
    s = translate("SELECT COUNTIF(x) FROM `thematic-fort-453901-t7.cms_npd.endpoint` "
                  "WHERE s = @state")
    assert s == "SELECT count_if(x) FROM endpoint WHERE s = $state"
    with pytest.raises(RuntimeError):
        translate("SELECT a[OFFSET(0)] FROM t")


def test_name_candidates_are_not_reach():
    out = build()
    assert "name_candidate_only" not in out["tier_notes"]["reaching"]
    t = out["releases"]["2026-08-20"]["tiers"]
    assert sum(t[k] for k in out["tier_notes"]["reaching"]) == 52802
