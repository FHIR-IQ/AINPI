"""Tests for the long-format measures export behind the `measures` Delta table.

The table comment promises three things a consumer will rely on: one row per
published point, no row (never a zero) where the generator refused a point,
and restatements carrying the as-published value. Each has a test here, and
the real measures.json is checked against the first two.
"""
import json
import pathlib

import pyarrow.parquet as pq
import pytest

from analysis.measures_parquet import COLUMNS, SRC_PATH, build_rows, write_parquet


def _fixture() -> dict:
    src = {"file": "findings/x.json", "field": "numerator / denominator",
           "commit": "abc1234", "vendored": False}
    return {
        "generated_at": "2026-10-14T00:00:00+00:00",
        "measures": [
            {
                "slug": "share-a", "question": "What share?", "unit": "ratio",
                "source": "NDH (H1)",
                "definitions": [
                    {"version": 1, "numerator": "n1", "denominator": "d1"},
                    {"version": 2, "numerator": "n2", "denominator": "d2"},
                ],
                "series": [
                    {"release": "2026-05-08", "value": 0.5, "numerator": 5, "denominator": 10,
                     "definition_version": 1, "source": src, "comparable_to_previous": None},
                    {"release": "2026-08-20", "value": 0.9, "numerator": 9, "denominator": 10,
                     "definition_version": 2, "source": src, "comparable_to_previous": False,
                     "comparability_reason": "definition break",
                     "restatements": [{"as_published_value": 0.8, "as_published_numerator": 8,
                                       "as_published_denominator": 10, "reason": "first read",
                                       "source": {"file": "snap@old.json", "commit": "old0001",
                                                  "field": "f", "vendored": True}}]},
                    {"release": "2026-10-07", "value": 0.99, "numerator": 99, "denominator": 100,
                     "definition_version": 2, "source": src,
                     "comparable_to_previous": "unreviewed",
                     "comparability_reason": "moved 0.09; not yet reviewed"},
                ],
                "omitted": [],
            },
            {
                "slug": "count-b", "question": "How many?", "unit": "count", "source": "NDH (H27)",
                "definitions": [{"version": 1, "numerator": "hits", "denominator": None}],
                "series": [
                    {"release": "2026-05-08", "value": 0, "numerator": 0, "denominator": None,
                     "definition_version": 1, "source": src, "comparable_to_previous": None,
                     "zero_control": {"field_present": 7}},
                ],
                "omitted": [{"release": "2026-08-20", "reason": "zero with no positive control"}],
            },
        ],
    }


def test_one_row_per_point_and_none_for_omitted():
    rows = build_rows(_fixture())
    assert [(r["slug"], r["release_date"]) for r in rows] == [
        ("share-a", "2026-05-08"), ("share-a", "2026-08-20"),
        ("share-a", "2026-10-07"), ("count-b", "2026-05-08")]
    assert ("count-b", "2026-08-20") not in {(r["slug"], r["release_date"]) for r in rows}


def test_comparable_is_a_nullable_string():
    rows = build_rows(_fixture())
    assert [r["comparable_to_previous"] for r in rows[:3]] == [None, "false", "unreviewed"]


def test_restatement_carries_the_as_published_value():
    r = build_rows(_fixture())[1]
    assert r["restated"] is True
    assert r["value"] == 0.9 and r["as_published_value"] == 0.8
    assert r["as_published_numerator"] == 8.0
    assert r["restatement_source_commit"] == "old0001"
    assert r["restatement_reason"] == "first read"
    plain = build_rows(_fixture())[0]
    assert plain["restated"] is False and plain["as_published_value"] is None


def test_definition_text_follows_the_point_version():
    rows = build_rows(_fixture())
    assert rows[0]["numerator_definition"] == "n1"
    assert rows[2]["numerator_definition"] == "n2"


def test_zero_control_and_null_denominator():
    r = build_rows(_fixture())[3]
    assert json.loads(r["zero_control"]) == {"field_present": 7}
    assert r["denominator"] is None and r["value"] == 0.0


def test_two_restatements_raise_rather_than_drop_one():
    doc = _fixture()
    p = doc["measures"][0]["series"][1]
    p["restatements"] = p["restatements"] * 2
    with pytest.raises(ValueError, match="2 restatements"):
        build_rows(doc)


def test_duplicate_point_raises():
    doc = _fixture()
    doc["measures"][0]["series"].append(dict(doc["measures"][0]["series"][0]))
    with pytest.raises(ValueError, match="two points"):
        build_rows(doc)


def test_unknown_comparable_value_raises():
    doc = _fixture()
    doc["measures"][0]["series"][0]["comparable_to_previous"] = "maybe"
    with pytest.raises(ValueError):
        build_rows(doc)


def test_parquet_round_trip_keeps_schema(tmp_path):
    out = tmp_path / "measures" / "measures.parquet"
    n = write_parquet(build_rows(_fixture()), out)
    t = pq.read_table(out)
    assert n == 4 and t.num_rows == 4
    assert t.schema.names == COLUMNS
    assert str(t.schema.field("release_date").type) == "string"
    assert str(t.schema.field("comparable_to_previous").type) == "string"
    assert t.column("comparable_to_previous").to_pylist()[:3] == [None, "false", "unreviewed"]


def test_empty_export_refuses_to_write(tmp_path):
    with pytest.raises(SystemExit):
        write_parquet([], tmp_path / "m.parquet")


def test_real_measures_json_every_point_exactly_once():
    doc = json.loads(pathlib.Path(SRC_PATH).read_text())
    rows = build_rows(doc)
    expected = [(m["slug"], p["release"]) for m in doc["measures"] for p in m["series"]]
    got = [(r["slug"], r["release_date"]) for r in rows]
    assert len(rows) == sum(len(m["series"]) for m in doc["measures"])
    assert sorted(got) == sorted(expected)
    assert len(set(got)) == len(got)
    # A refused point stays absent: no row, and in particular no zero.
    omitted = {(m["slug"], o["release"]) for m in doc["measures"] for o in m["omitted"]}
    assert not omitted & set(got)
    # Restatements reach the table with their as-published value.
    n_restated = sum(1 for m in doc["measures"] for p in m["series"] if p.get("restatements"))
    assert sum(r["restated"] for r in rows) == n_restated
    assert all(r["release_date"] in doc["releases"] for r in rows)
