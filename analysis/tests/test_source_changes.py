"""Tests for the curated source-changes log (analysis/source_changes.py)."""
import copy
import json
import re

import pytest
from jsonschema import Draft202012Validator

from analysis import source_changes as S
from analysis.contract_schemas import SCHEMAS

ENTRIES = S.load_entries(S.YAML_PATH)


def good():
    return {
        "id": "sc-2026-05-08-example", "first_release": "2026-05-08",
        "resource": "Practitioner", "element": "identifier.system",
        "kind": "identifier", "before": "a", "after": "b",
        "detected": "2026-05-09, a check", "impact": "something broke",
        "handled_by": "analysis/fhir_identifiers.py:extract_npis",
        "evidence": "analysis/fhir_identifiers.py", "status": "active",
    }


def test_seed_entries_validate():
    assert S.validate(ENTRIES) == []


def test_seed_is_not_empty_and_ids_unique():
    ids = [e["id"] for e in ENTRIES]
    assert ids and len(ids) == len(set(ids))


def test_every_entry_has_all_fields():
    for e in ENTRIES:
        for f in S.REQUIRED:
            assert e.get(f), (e["id"], f)


def test_id_pattern_and_date_match():
    for e in ENTRIES:
        assert re.match(r"^sc-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$", e["id"]), e["id"]
        assert e["id"][3:13] == e["first_release"], e["id"]


def test_kind_in_allowed_set():
    for e in ENTRIES:
        assert e["kind"] in S.KINDS


def test_handled_by_paths_and_symbols_exist():
    for e in ENTRIES:
        assert S.validate([e]) == [], e["id"]


def test_upstream_file_entries_exist():
    assert {e["id"] for e in ENTRIES if e["kind"] == "upstream-file"}


def test_validate_rejects_bad_entries():
    cases = {
        "missing field": lambda e: e.pop("impact"),
        "bad id": lambda e: e.update(id="SC-1"),
        "bad kind": lambda e: e.update(kind="other"),
        "bad status": lambda e: e.update(status="done"),
        "missing handled_by file": lambda e: e.update(handled_by="analysis/nope.py:f"),
        "missing symbol": lambda e: e.update(handled_by="analysis/fhir_identifiers.py:nope_fn"),
        "missing evidence path": lambda e: e.update(evidence="docs/nope.md"),
        "unknown extra field": lambda e: e.update(surprise=1),
    }
    for name, mutate in cases.items():
        e = copy.deepcopy(good())
        mutate(e)
        assert S.validate([e]), name
    assert S.validate([good()]) == []


def test_duplicate_ids_rejected():
    assert S.validate([good(), good()])


def test_new_entries_need_evidence_ref():
    e = good()
    e.update(id="sc-2026-11-05-x", first_release="2026-11-05")
    assert any("evidence_ref" in m for m in S.validate([e]))
    e["evidence_ref"] = "dq-results:endpoint-fhir-rest-share"
    assert S.validate([e]) == []


def test_evidence_ainpi_url_accepted():
    e = good()
    e["evidence"] = "https://ainpi.dev/api/v1/release-deltas.json"
    assert S.validate([e]) == []


def test_payload_has_no_wall_clock_and_is_sorted():
    p = S.build_payload(ENTRIES)
    assert p["schema_version"] == 1
    assert "generated_at" not in p
    keys = [(e["first_release"], e["id"]) for e in p["entries"]]
    assert keys == sorted(keys)


def test_committed_json_equals_generator_output():
    assert S.JSON_PATH.read_text() == S.render(S.build_payload(ENTRIES))


def test_committed_json_matches_schema():
    payload = json.loads(S.JSON_PATH.read_text())
    Draft202012Validator(SCHEMAS["source_changes"]).validate(payload)
