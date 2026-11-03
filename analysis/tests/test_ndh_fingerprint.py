"""Tests for analysis/ndh_fingerprint.py on tiny fixture parquet files."""
from __future__ import annotations

import json
import pathlib
import sys

import duckdb
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import ndh_fingerprint as nf  # noqa: E402


def write_parquet(path, resources):
    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("CREATE TABLE t (_id VARCHAR, resource VARCHAR)")
    for rid, res in resources:
        con.execute("INSERT INTO t VALUES (?, ?)", [rid, json.dumps(res)])
    con.execute(f"COPY t TO '{path}' (FORMAT PARQUET)")


@pytest.fixture
def release(tmp_path):
    d = tmp_path / "2026-01-01"
    write_parquet(d / "endpoint.parquet", [
        ("Endpoint-1234567890", {"id": "Endpoint-1234567890", "connectionType": {
            "system": "http://x/ct", "code": "hl7-fhir-rest"},
            "payloadType": [{"coding": [{"system": "http://x/pt"}, {"system": "http://x/pt"}]}]}),
        ("Endpoint-3f2b8c1e-1111-4222-8333-444455556666", {
            "id": "Endpoint-3f2b8c1e-1111-4222-8333-444455556666",
            "connectionType": {"system": "http://x/ct", "code": "direct-project"}}),
        ("weird", {"id": "weird"}),
    ])
    write_parquet(d / "organization.parquet", [
        ("a", {"id": "Organization-1518732023", "identifier": [{"system": "http://npi", "value": "SECRET"}],
               "type": [{"coding": [{"system": "http://t", "code": "prov"}, {"code": "prov"}]}]}),
        ("b", {"id": "Organization-1518732024", "type": [{"coding": [{"system": "http://t", "code": "pay"}]}]}),
    ])
    return d


def test_fingerprint_counts(release):
    fp = nf.fingerprint(release)
    ep = fp["endpoint"]
    assert ep["records"] == 3
    assert ep["id_patterns"] == {"npi": 1, "uuid": 1, "other": 1}
    assert ep["key_paths"]["connectionType.code"] == 2
    # a repeated path inside an array counts the record once
    assert ep["key_paths"]["payloadType[].coding[].system"] == 1
    assert ep["systems"] == {"http://x/ct": 2, "http://x/pt": 1}
    assert ep["codes"]["connectionType"] == {"hl7-fhir-rest": 1, "direct-project": 1}
    org = fp["organization"]
    assert org["codes"]["org_type"] == {"prov": 1, "pay": 1}
    assert org["systems"] == {"http://npi": 1, "http://t": 2}


def test_no_values_leak(release):
    assert "SECRET" not in json.dumps(nf.fingerprint(release))


def test_missing_resources_skipped(release):
    assert set(nf.fingerprint(release)) == {"endpoint", "organization"}


def fp(records, paths=None, systems=None, codes=None):
    return {"endpoint": {"records": records, "key_paths": paths or {}, "systems": systems or {},
                         "codes": codes or {}, "id_patterns": {}}}


def test_diff_vanished_path():
    out = nf.diff(fp(100, {"a.b": 100, "c": 100}), fp(100, {"c": 100}))
    assert len(out) == 1
    assert out[0]["kind"] == "vanished" and out[0]["resource"] == "endpoint"
    assert out[0]["item"] == "key_path a.b" and out[0]["prev"] == 100 and out[0]["new"] == 0


def test_diff_appeared_system():
    out = nf.diff(fp(100, systems={"http://a": 100}), fp(100, systems={"http://a": 100, "http://b": 5}))
    assert [(d["kind"], d["item"]) for d in out] == [("appeared", "system http://b")]


def test_diff_moved():
    out = nf.diff(fp(100, {"x": 100}), fp(100, {"x": 50}))
    assert [(d["kind"], d["prev"], d["new"]) for d in out] == [("moved", 100, 50)]
    assert nf.diff(fp(100, {"x": 100}), fp(100, {"x": 95})) == []


def test_diff_uses_share_of_records():
    # record count halves and the path halves with it: the share did not move
    assert nf.diff(fp(100, {"x": 100}), fp(50, {"x": 50})) == []


def test_diff_codes():
    out = nf.diff(fp(10, codes={"connectionType": {"a": 10}}), fp(10, codes={"connectionType": {"b": 10}}))
    assert sorted((d["kind"], d["item"]) for d in out) == [
        ("appeared", "code connectionType=b"), ("vanished", "code connectionType=a")]


def test_placeholder_file_raises(release, monkeypatch):
    target = str(release / "endpoint.parquet")
    real = nf._stat_flags
    monkeypatch.setattr(nf, "_stat_flags", lambda p: 0x40000000 if str(p) == target else real(p))
    with pytest.raises(RuntimeError, match="endpoint.parquet"):
        nf.fingerprint(release)
