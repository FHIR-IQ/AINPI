import os
import types

import duckdb
import pytest

from ndh_quality.base import (NdhRule, assert_not_dataless, evaluate, field_control,
                              open_engine, parquet_source)


def test_field_control_rejects_zero():
    assert field_control(0, None) is False


def test_field_control_first_run_nonzero_passes():
    assert field_control(5, None) is True


def test_field_control_floor():
    assert field_control(49, 100) is False
    assert field_control(50, 100) is True


def test_evaluate_order():
    t = {'op': '>=', 'value': 0.999}
    assert evaluate(t, 1.0, False, 'expect') == 'control_failed'
    assert evaluate(None, 0.14, True, 'monitor') == 'recorded'
    assert evaluate(t, 0.998, True, 'expect') == 'fail'
    assert evaluate(t, 0.9995, True, 'expect') == 'pass'


def test_assert_not_dataless_names_path(monkeypatch, tmp_path):
    p = tmp_path / "x.parquet"
    p.write_text("")
    monkeypatch.setattr(os, "stat", lambda path, *a, **k: types.SimpleNamespace(st_flags=0x40000000))
    with pytest.raises(RuntimeError, match='dataless') as e:
        assert_not_dataless([p])
    assert str(p) in str(e.value)


def test_parquet_source():
    assert parquet_source("/a", "practitioner") == "read_parquet('/a/practitioner.parquet')"


class _Rule(NdhRule):
    rule_id = "t"
    hypotheses = ["H0"]
    measure_name = "m"
    severity = "expect"
    threshold = {"op": ">=", "value": 0.8}
    resources = ["practitioner"]

    @classmethod
    def measure_sql(cls, settings):
        src = parquet_source(settings["release_dir"], "practitioner")
        return (f"select count(*) filter (where _npi is not null) as numerator, count(*) as denominator, "
                f"count(*) as control_count, 'd' as detail from {src}")


def test_rule_measure_and_run(release_dir):
    d = release_dir({"practitioner": [{"_npi": "1"}, {"_npi": "2"}, {"_npi": None}, {"_npi": "4"}]})
    eng = open_engine()
    s = {"release_dir": str(d)}
    m = _Rule.measure(eng, s, previous=4)
    assert (m["numerator"], m["denominator"], m["value"]) == (3, 4, 0.75)
    assert m["status"] == "fail" and m["control_passed"] and m["control_previous"] == 4
    assert _Rule.run(eng, s).startswith("t: 3/4")
    d2 = release_dir({"practitioner": [{"_npi": "1"}, {"_npi": "2"}]})
    assert _Rule.run(eng, {"release_dir": str(d2)}) is True


def test_empty_table_is_readable(release_dir):
    d = release_dir({"organization": []})
    n = duckdb.connect().execute(f"select count(_npi) from {parquet_source(d, 'organization')}").fetchone()[0]
    assert n == 0
