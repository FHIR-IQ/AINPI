"""Tests for the Genie space spec builder.

The space is only as good as the rules written into it. Each rule tested here
corresponds to a query this project has already got wrong once: joining
endpoints on a regenerated _id, reading the first-specialty column, joining a
reference column to a bare id. The tests are offline and never call Databricks.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent.parent

_spec = importlib.util.spec_from_file_location(
    "databricks_genie", REPO / "analysis" / "databricks_genie.py")
genie = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(genie)

_pub_spec = importlib.util.spec_from_file_location(
    "databricks_publish", REPO / "analysis" / "databricks_publish.py")
publish = importlib.util.module_from_spec(_pub_spec)
_pub_spec.loader.exec_module(publish)

SPEC = genie.build_space_spec()
TEXT = SPEC["instructions"]


def test_every_space_table_is_a_published_table():
    published = {f"{publish.CATALOG}.{publish.SCHEMA}.{t}"
                 for t in publish.TABLES + publish.DERIVED_TABLES}
    assert set(SPEC["tables"]) == published


def test_every_table_has_a_column_list():
    for t in publish.TABLES + publish.DERIVED_TABLES:
        cols = genie.TABLE_COLUMNS[t]
        assert "release_date" in cols, t


def test_instructions_name_the_endpoint_address_join():
    assert "join on _address, never on _id" in TEXT


def test_instructions_name_the_specialty_codes_trap():
    assert "_specialty_codes" in TEXT
    assert "_specialty_code holds only the FIRST specialty" in TEXT


def test_instructions_carry_the_reference_join_form():
    assert "CONCAT('Organization/', o._id)" in TEXT
    assert "CONCAT('Practitioner/', p._id)" in TEXT


def test_instructions_say_location_has_no_reliable_key():
    assert "location: there is no reliable cross-release key" in TEXT


def test_instructions_require_a_release_filter():
    assert "Always filter release_date" in TEXT
    assert "Never add counts across releases" in TEXT


def test_instructions_have_no_em_dash():
    assert "—" not in TEXT


def test_sample_count_and_fields():
    assert 8 <= len(SPEC["samples"]) <= 12
    for s in SPEC["samples"]:
        assert s["question"].strip() and s["sql"].strip()
        assert s["expected"].strip(), s["question"]
        assert s["verified"].strip(), s["question"]


def test_sample_sql_names_only_space_tables():
    allowed = set(SPEC["tables"])
    for s in SPEC["samples"]:
        named = set(re.findall(r"workspace\.ainpi\.\w+", s["sql"]))
        assert named, s["question"]
        assert named <= allowed, s["question"]


def test_every_sample_filters_a_release():
    for s in SPEC["samples"]:
        # Sample 1 is the per-release breakdown, which groups instead.
        assert ("release_date =" in s["sql"]
                or "GROUP BY release_date" in s["sql"]), s["question"]


def test_no_sample_reads_the_first_specialty_column():
    for s in SPEC["samples"]:
        assert not re.search(r"_specialty_code\b", s["sql"]), s["question"]


def test_cross_release_endpoint_sample_joins_on_address():
    multi = [s for s in SPEC["samples"]
             if "2026-08-20" in s["sql"] and "endpoint" in s["sql"]]
    assert multi
    for s in multi:
        assert "USING (_address)" in s["sql"]
        assert "USING (_id)" not in s["sql"]


def test_split_uses_a_regex_safe_pipe():
    # split() takes a regex; a bare '|' splits between every character.
    for s in SPEC["samples"]:
        assert "split(" not in s["sql"] or "'[|]'" in s["sql"], s["question"]
        assert "split(_specialty_codes, '|')" not in s["sql"]


def test_serialized_space_shape():
    payload = genie.serialize_space(SPEC)
    assert payload["version"] == 2
    tables = payload["data_sources"]["tables"]
    idents = [t["identifier"] for t in tables]
    assert idents == sorted(idents)
    hexid = re.compile(r"^[0-9a-f]{32}$")
    for path in (("config", "sample_questions"),
                 ("instructions", "example_question_sqls"),
                 ("instructions", "text_instructions"),
                 ("benchmarks", "questions")):
        items = payload[path[0]][path[1]]
        ids = [i["id"] for i in items]
        assert all(hexid.match(i) for i in ids), path
        assert ids == sorted(ids), path
        assert len(set(ids)) == len(ids), path
    assert len(payload["config"]["sample_questions"]) == len(SPEC["samples"])
    # Expected answers are for the reviewer and must not be sent.
    blob = json.dumps(payload)
    assert "expected" not in blob and "verified" not in blob


def test_entity_matching_off_for_resource_and_references():
    payload = genie.serialize_space(SPEC)
    for t in payload["data_sources"]["tables"]:
        for c in t["column_configs"]:
            if c["column_name"] in ("resource", "_id", "_org_id",
                                    "_practitioner_id", "_managing_org_id"):
                assert not c.get("enable_entity_matching"), (t["identifier"], c)


def test_instruction_text_round_trips_through_lines():
    payload = genie.serialize_space(SPEC)
    content = payload["instructions"]["text_instructions"][0]["content"]
    assert "".join(content) == TEXT


def test_payload_is_deterministic():
    a = json.dumps(genie.serialize_space(genie.build_space_spec()), sort_keys=True)
    b = json.dumps(genie.serialize_space(genie.build_space_spec()), sort_keys=True)
    assert a == b
