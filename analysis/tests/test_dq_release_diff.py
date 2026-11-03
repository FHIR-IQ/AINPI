"""Tests for analysis/dq_release_diff.py. report() is pure."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dq_release_diff import report  # noqa: E402

PREV, NEW = "2026-08-20", "2026-10-07"


def row(rel, rule, status="pass", value=0.5, measure=None, agrees="not_paired", **kw):
    r = {"release_date": rel, "rule_id": rule, "rule_version": 1, "status": status,
         "value": value, "numerator": None, "denominator": None,
         "measure": measure, "measure_agrees": agrees}
    r.update(kw)
    return r


def dq(*rows):
    return {"schema_version": 1, "generated_at": "x", "rows": list(rows)}


MEASURES = {"measures": [
    {"slug": "m1", "ordinary_move": {"kind": "absolute", "max": 0.01}},
    {"slug": "m2", "ordinary_move": {"kind": "relative", "max": 0.5}},
]}


def test_status_change_pass_to_fail_appears():
    d = dq(row(PREV, "r1", "pass"), row(NEW, "r1", "fail"))
    out = report(PREV, NEW, d, [], MEASURES)
    assert "r1" in out and "pass -> fail" in out


def test_unchanged_status_not_listed_as_change():
    d = dq(row(PREV, "r1", "pass"), row(NEW, "r1", "pass"))
    assert "pass -> pass" not in report(PREV, NEW, d, [], MEASURES)


def test_move_under_default_threshold_not_listed():
    d = dq(row(PREV, "r1", value=0.50), row(NEW, "r1", value=0.54))
    out = report(PREV, NEW, d, [], MEASURES)
    assert "0.5000 -> 0.5400" not in out


def test_move_over_default_threshold_listed():
    d = dq(row(PREV, "r1", value=0.50), row(NEW, "r1", value=0.60))
    assert "0.5000 -> 0.6000" in report(PREV, NEW, d, [], MEASURES)


def test_measure_threshold_used():
    d = dq(row(PREV, "r1", value=0.50, measure="m1"), row(NEW, "r1", value=0.52, measure="m1"))
    assert "0.5000 -> 0.5200" in report(PREV, NEW, d, [], MEASURES)


def test_relative_threshold():
    under = dq(row(PREV, "r1", value=0.10, measure="m2"), row(NEW, "r1", value=0.14, measure="m2"))
    over = dq(row(PREV, "r1", value=0.10, measure="m2"), row(NEW, "r1", value=0.16, measure="m2"))
    assert "0.1000 -> 0.1400" not in report(PREV, NEW, under, [], MEASURES)
    assert "0.1000 -> 0.1600" in report(PREV, NEW, over, [], MEASURES)


def test_measure_agrees_false_listed():
    d = dq(row(NEW, "r9", measure="m1", agrees="false"), row(NEW, "r8", agrees="true"))
    out = report(PREV, NEW, d, [], MEASURES)
    assert "r9" in out and "r8" not in out


def test_control_failed_listed():
    d = dq(row(NEW, "r7", status="control_failed", value=None))
    assert "r7" in report(PREV, NEW, d, [], MEASURES)


def test_superseded_rows_ignored():
    d = dq(row(NEW, "r1", "fail", superseded_by="1@t"), row(NEW, "r1", "pass"), row(PREV, "r1", "pass"))
    assert "pass -> fail" not in report(PREV, NEW, d, [], MEASURES)


def test_fingerprint_diff_listed():
    fp = [{"resource": "endpoint", "kind": "vanished", "item": "path:a.b", "prev": 5, "new": 0}]
    out = report(PREV, NEW, dq(), fp, MEASURES)
    assert "vanished" in out and "a.b" in out


def test_fingerprint_missing_says_so():
    out = report(PREV, NEW, dq(), None, MEASURES)
    assert "not available" in out


def test_empty_sections_say_none():
    out = report(PREV, NEW, dq(), [], MEASURES)
    assert out.count("None.") >= 4
