"""Tests for the NDH data-quality runner (analysis/dq_run.py).

Only the pure functions and the pre-read refusals are tested here: the
ndh_quality package needs duckdb, which CI's analysis job does not install.
"""
import copy
import json
import os
import types

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from jsonschema import Draft202012Validator

from analysis import dq_run as D
from analysis.contract_schemas import SCHEMAS

FP = {"endpoint": {"rows": 10, "bytes": 100}, "export_sha": None}


def row(release, rule_id="r1", version=1, fp=None, **kw):
    base = {
        "release_date": release, "rule_id": rule_id, "rule_version": version,
        "hypotheses": ["H50"], "relation": "implements", "measure": None,
        "severity": "monitor", "threshold": None, "numerator": 1, "denominator": 2,
        "value": 0.5, "control_count": 2, "control_previous": None,
        "control_passed": True, "status": "recorded", "detail": "",
        "measure_value": None, "measure_agrees": "not_paired",
        "input_fingerprint": fp if fp is not None else FP,
        "engine": "duckdb 1.0", "git_sha": "abc", "run_at": "2026-11-03T00:00:00Z",
        "superseded_by": None,
    }
    base.update(kw)
    return base


def doc(rows):
    return {"schema_version": 1, "generated_at": "2026-11-03T00:00:00Z", "rows": rows}


def test_merge_keeps_unrun_releases():
    old = row("2026-05-08")
    before = json.dumps(old, sort_keys=True)
    out = D.merge_results(doc([old]), [row("2026-10-07", run_at="2026-11-04T00:00:00Z")])
    kept = [r for r in out["rows"] if r["release_date"] == "2026-05-08"]
    assert [json.dumps(r, sort_keys=True) for r in kept] == [before]
    assert len(out["rows"]) == 2


def test_merge_replaces_on_same_fingerprint():
    old = row("2026-10-07", value=0.1)
    new = row("2026-10-07", value=0.2, run_at="2026-11-04T00:00:00Z")
    out = D.merge_results(doc([old]), [new])
    assert len(out["rows"]) == 1
    assert out["rows"][0]["value"] == 0.2
    assert out["rows"][0]["superseded_by"] is None


def test_merge_supersedes_on_changed_fingerprint():
    old = row("2026-10-07")
    fp2 = {"endpoint": {"rows": 11, "bytes": 100}, "export_sha": None}
    new = row("2026-10-07", fp=fp2, run_at="2026-11-04T00:00:00Z")
    out = D.merge_results(doc([old]), [new])
    assert len(out["rows"]) == 2
    olds = [r for r in out["rows"] if r["superseded_by"]]
    assert len(olds) == 1 and olds[0]["superseded_by"] == "1@2026-11-04T00:00:00Z"
    assert olds[0]["input_fingerprint"] == FP
    live = [r for r in out["rows"] if not r["superseded_by"]]
    assert live[0]["input_fingerprint"] == fp2


def test_merge_does_not_mutate_inputs():
    existing = doc([row("2026-10-07")])
    snap = copy.deepcopy(existing)
    D.merge_results(existing, [row("2026-10-07", fp={"x": 1}, run_at="2026-11-04T00:00:00Z")])
    assert existing == snap


def test_merge_sorted():
    out = D.merge_results(doc([row("2026-10-07", "b")]), [row("2026-05-08", "z"), row("2026-10-07", "a")])
    keys = [(r["release_date"], r["rule_id"]) for r in out["rows"]]
    assert keys == sorted(keys)


MEASURES = {"measures": [
    {"slug": "npi-validation-failures", "definition_version": 1,
     "definitions": [{"version": 1}],
     "series": [{"release": "2026-08-20", "value": 3.4e-07, "numerator": 4,
                 "denominator": 11607656, "definition_version": 1}],
     "omitted": [{"release": "2026-10-07", "reason": "x"}]},
    {"slug": "endpoint-org-linkage", "definition_version": 1,
     "definitions": [{"version": 1}],
     "series": [{"release": "2026-10-07", "value": 0.146, "numerator": 16247,
                 "denominator": 111259, "definition_version": 1}],
     "omitted": []},
]}


def test_pair_npi_disagrees_2026_08_20():
    r = row("2026-08-20", measure="npi-validation-failures",
            numerator=11607656, denominator=11607656)
    out = D.pair_measure(r, MEASURES)
    assert out["measure_agrees"] == "false"
    assert out["measure_value"] == 3.4e-07


def test_pair_npi_agrees_when_failing_count_matches():
    r = row("2026-08-20", measure="npi-validation-failures",
            numerator=11607652, denominator=11607656)
    assert D.pair_measure(r, MEASURES)["measure_agrees"] == "true"


def test_pair_npi_no_point_when_omitted():
    r = row("2026-10-07", measure="npi-validation-failures", numerator=1, denominator=1)
    out = D.pair_measure(r, MEASURES)
    assert out["measure_agrees"] == "no_point" and out["measure_value"] is None


def test_pair_linkage_agrees():
    r = row("2026-10-07", measure="endpoint-org-linkage", numerator=16247, denominator=111259)
    assert D.pair_measure(r, MEASURES)["measure_agrees"] == "true"


def test_pair_linkage_disagrees():
    r = row("2026-10-07", measure="endpoint-org-linkage", numerator=16248, denominator=111259)
    assert D.pair_measure(r, MEASURES)["measure_agrees"] == "false"


def test_pair_definition_mismatch():
    m = copy.deepcopy(MEASURES)
    m["measures"][1]["series"][0]["definition_version"] = 2
    r = row("2026-10-07", measure="endpoint-org-linkage", numerator=16247, denominator=111259)
    assert D.pair_measure(r, m)["measure_agrees"] == "definition_mismatch"


def test_unpaired_rule():
    assert D.pair_measure(row("2026-10-07", measure=None), MEASURES)["measure_agrees"] == "not_paired"
    other = row("2026-10-07", measure="fhir-rest-endpoint-share")
    assert D.pair_measure(other, MEASURES)["measure_agrees"] == "not_paired"


def test_schema_valid():
    d = D.merge_results(doc([]), [row("2026-10-07", measure_agrees="false", measure_value=0.1)])
    assert list(Draft202012Validator(SCHEMAS["dq_results"]).iter_errors(d)) == []
    bad = copy.deepcopy(d)
    bad["rows"][0]["measure_agrees"] = "maybe"
    assert list(Draft202012Validator(SCHEMAS["dq_results"]).iter_errors(bad))


def _dataless_stat(bad_name):
    real = os.stat

    def fake(path, *a, **k):
        st = real(path, *a, **k)
        if str(path).endswith(bad_name):
            return types.SimpleNamespace(st_flags=D.SF_DATALESS, st_size=st.st_size)
        return st
    return fake


def _tiny_release(root, release):
    d = root / release
    d.mkdir(parents=True)
    for res in D.RUNNER_RESOURCES:
        pq.write_table(pa.table({"a": [1, 2, 3]}), d / f"{res}.parquet")
    return d


def test_fingerprint_reads_footer_and_size(tmp_path):
    d = _tiny_release(tmp_path, "2026-10-07")
    (d / "_export.json").write_text(json.dumps({"export_sha": "deadbeef"}))
    fp = D.input_fingerprint(d, ["endpoint"])
    assert fp["endpoint"]["rows"] == 3
    assert fp["endpoint"]["bytes"] == (d / "endpoint.parquet").stat().st_size
    assert fp["export_sha"] == "deadbeef"
    assert D.input_fingerprint(d, ["endpoint"])["export_sha"] == "deadbeef"


def test_fingerprint_without_export_json(tmp_path):
    d = _tiny_release(tmp_path, "2026-10-07")
    assert D.input_fingerprint(d, ["endpoint"])["export_sha"] is None


def test_fingerprint_refuses_dataless_before_reading(tmp_path, monkeypatch):
    d = _tiny_release(tmp_path, "2026-10-07")
    monkeypatch.setattr(D.os, "stat", _dataless_stat("endpoint.parquet"))

    def boom(*a, **k):
        raise AssertionError("parquet was read")
    monkeypatch.setattr(D.pq, "ParquetFile", boom)
    with pytest.raises(RuntimeError, match="endpoint.parquet"):
        D.input_fingerprint(d, ["endpoint"])


def test_cli_stops_on_dataless_input_naming_the_file(tmp_path, monkeypatch, capsys):
    _tiny_release(tmp_path, "2026-10-07")
    monkeypatch.setattr(D, "PARQUET_ROOT", tmp_path)
    monkeypatch.setattr(D.os, "stat", _dataless_stat("organization.parquet"))

    def boom(*a, **k):
        raise AssertionError("parquet was read")
    monkeypatch.setattr(D.pq, "ParquetFile", boom)
    monkeypatch.setattr(D, "RESULTS", tmp_path / "dq-results.json")
    code = D.main(["--release", "2026-10-07"])
    assert code != 0
    assert "organization.parquet" in capsys.readouterr().err
    assert not (tmp_path / "dq-results.json").exists()


def test_previous_release_skips_retired_and_missing(tmp_path):
    for r in ("2026-05-08", "2026-08-20", "2026-10-07"):
        (tmp_path / r).mkdir()
    assert D.previous_release("2026-10-07", tmp_path) == "2026-08-20"
    assert D.previous_release("2026-05-08", tmp_path) is None
    (tmp_path / "2026-08-20").rmdir()
    assert D.previous_release("2026-10-07", tmp_path) == "2026-05-08"
