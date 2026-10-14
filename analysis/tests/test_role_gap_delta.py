import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from role_gap_delta import build, multiple, pct  # noqa: E402

PUBLISHED = pathlib.Path(__file__).resolve().parent.parent / "release-snapshots/published"


def _h54(release, active, with_role, cats):
    return {"release_date": release, "states": {"PA": {
        "active_practitioners": active, "with_ndh_role": with_role,
        "role_coverage_by_category": [
            {"category": c, "with_role": w, "total": t, "pct": None} for c, w, t in cats]}}}


def test_overall_and_categories():
    before = _h54("2026-08-20", 1000, 400, [("physician", 300, 400), ("pharmacy", 1, 500)])
    after = _h54("2026-10-07", 1100, 550, [("physician", 330, 400), ("pharmacy", 50, 500)])
    d = build(before, after)
    assert (d["from"], d["to"], d["state"]) == ("2026-08-20", "2026-10-07", "PA")
    assert d["overall"]["before"] == {"active": 1000, "with_role": 400, "pct": 40.0}
    assert d["overall"]["after"]["pct"] == 50.0
    assert [r["category"] for r in d["by_category"]] == ["physician", "pharmacy"]
    ph = d["by_category"][1]
    assert ph["before_pct"] == 0.2 and ph["after_pct"] == 10.0 and ph["multiple"] == 50.0


def test_multiple_is_a_count_ratio_and_none_from_zero():
    assert multiple(1, 526) == 526.0
    assert multiple(6, 105) == 17.5
    assert multiple(0, 5) is None


def test_small_percentages_keep_precision():
    assert pct(1, 12995) == 0.008
    assert pct(0, 0) is None


def test_category_in_one_release_only_is_named_not_dropped_silently():
    before = _h54("2026-08-20", 10, 5, [("physician", 5, 10)])
    after = _h54("2026-10-07", 10, 6, [("physician", 5, 10), ("dental", 1, 10)])
    d = build(before, after)
    assert d["categories_in_one_release_only"] == ["dental"]


def test_refuses_reversed_releases():
    a = _h54("2026-08-20", 10, 5, [])
    b = _h54("2026-10-07", 10, 5, [])
    with pytest.raises(SystemExit):
        build(b, a)


def test_reproduces_the_hand_written_overall():
    """The 2026-05-08 -> 2026-08-20 file was written by hand. The generator
    must agree with it on the fields measures.py reads."""
    vendored = sorted(PUBLISHED.glob("role-gap-delta@*.json"))
    if not vendored:
        pytest.skip("no vendored role-gap-delta")
    old = json.loads(vendored[0].read_text())
    for side in ("before", "after"):
        o = old["overall"][side]
        assert pct(o["with_role"], o["active"]) == o["pct"]
    for r in old["by_category"]:
        assert multiple(r["before_with_role"], r["after_with_role"]) == r["multiple"]
