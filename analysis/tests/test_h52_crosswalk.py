"""Tests for the H52 edge collapse and confidence banding.

These are the two steps that decide what gets published as a directory linkage,
so they are tested against the shapes Capital BlueCross actually emits: roles
duplicated under one id, roles naming the payer as the organization, and
organizations whose NPI is only inferable from `assigner.display`.
"""
import csv
import gzip
import json

import pytest

from analysis.h52_payer_affiliation_gap import build_edges, write_crosswalk

PAYER = {"name": "Capital BlueCross"}


def _role(rid, pid, oid, locations=(), specialty=None):
    res = {
        "resourceType": "PractitionerRole",
        "id": rid,
        "practitioner": {"reference": f"https://x/r4/Practitioner/{pid}"},
        "organization": {"reference": f"https://x/r4/Organization/{oid}"},
        "location": [{"reference": f"https://x/r4/Location/{l}"} for l in locations],
    }
    if specialty:
        res["specialty"] = [{"coding": [{"system": "http://nucc.org/provider-taxonomy",
                                         "code": specialty[0],
                                         "display": specialty[1]}]}]
    return res


@pytest.fixture
def harvest(tmp_path):
    """A directory laid out the way the harvester writes it."""
    roles = [
        # Same role id twice: one copy names the payer, one the real practice.
        _role("900", "1001", "1003"),
        _role("900", "1001", "5001", locations=["L1", "L2"],
              specialty=("207R00000X", "Internal Medicine")),
        # Second organization for the same practitioner.
        _role("901", "1001", "5002", locations=["L3"]),
        # Different practitioner, org with no NPI at all.
        _role("902", "1002", "5003", locations=["L4"]),
        # Practitioner the harvest never resolved to an NPI.
        _role("903", "9999", "5001"),
    ]
    path = tmp_path / "PractitionerRole.part0001.ndjson.gz"
    with gzip.open(path, "wt") as fh:
        for r in roles:
            fh.write(json.dumps(r) + "\n")
    return tmp_path


ORGS = {
    "1003": {"name": "Capital Blue Cross", "npi": None, "npi_basis": None,
             "city": None, "state": None},
    "5001": {"name": "Penn Medicine LGHP Geriatrics", "npi": "1235223470",
             "npi_basis": "coded", "city": "Lancaster", "state": "PA"},
    "5002": {"name": "Geisinger Lewistown", "npi": "1356746895",
             "npi_basis": "cms-assigner", "city": "Lewistown", "state": "PA"},
    "5003": {"name": "Reading Pediatrics", "npi": None, "npi_basis": None,
             "city": "Reading", "state": "PA"},
}

PRAC = {"npi_to_ids": {"1111111111": {"1001"}, "2222222222": {"1002"}}}

GAP_ROWS = [
    {"npi": "1111111111", "family_name": "SMITH", "given_name": "ANN",
     "state": "PA", "in_cms_dac": False},
    {"npi": "2222222222", "family_name": "JONES", "given_name": "LEE",
     "state": "PA", "in_cms_dac": True},
]


def test_payer_named_roles_are_dropped(harvest):
    """"Contracted with the payer" is not an affiliation a directory can route on."""
    edges, stats = build_edges(harvest, PRAC, ORGS)
    assert stats["roles_naming_the_payer"] == 1
    assert ("1111111111", "1003") not in edges


def test_duplicate_role_ids_do_not_duplicate_edges(harvest):
    """The two copies of role 900 collapse to the one real-practice edge."""
    edges, _ = build_edges(harvest, PRAC, ORGS)
    assert ("1111111111", "5001") in edges
    assert len(edges[("1111111111", "5001")]["locations"]) == 2


def test_unresolvable_practitioner_is_counted_not_silently_dropped(harvest):
    edges, stats = build_edges(harvest, PRAC, ORGS)
    assert stats["roles_with_unresolvable_practitioner"] == 1
    assert all(npi in PRAC["npi_to_ids"] for npi, _ in edges)


def test_locations_and_specialty_are_carried(harvest):
    edges, _ = build_edges(harvest, PRAC, ORGS)
    edge = edges[("1111111111", "5001")]
    assert edge["locations"] == {"L1", "L2"}
    assert ("207R00000X", "Internal Medicine") in edge["specialties"]


def test_edge_count_matches_distinct_pairs(harvest):
    edges, stats = build_edges(harvest, PRAC, ORGS)
    assert stats["distinct_edges"] == len(edges) == 3


def _rows(path):
    with open(path) as fh:
        return list(csv.DictReader(fh))


def test_confidence_bands(harvest, tmp_path):
    edges, _ = build_edges(harvest, PRAC, ORGS)
    out = tmp_path / "crosswalk.csv"
    # 5001's NPI resolves in the NDH; 5002's does not.
    bands = write_crosswalk(edges, ORGS, GAP_ROWS, PAYER, out, {"1235223470"})
    by_org = {r["payer_org_id"]: r for r in _rows(out)}

    # Coded NPI that resolves: deterministic on both ends.
    assert by_org["5001"]["confidence"] == "green"
    assert by_org["5001"]["org_resolves_in_ndh"] == "yes"

    # NPI only inferred from the assigner convention: one end is not coded.
    assert by_org["5002"]["confidence"] == "yellow"

    # No organization NPI at all: the link rests on a name string.
    assert by_org["5003"]["confidence"] == "red"
    assert bands == {"green": 1, "yellow": 1, "red": 1}


def test_a_coded_npi_that_does_not_resolve_is_not_green(harvest, tmp_path):
    edges, _ = build_edges(harvest, PRAC, ORGS)
    out = tmp_path / "crosswalk.csv"
    bands = write_crosswalk(edges, ORGS, GAP_ROWS, PAYER, out, set())
    assert bands.get("green", 0) == 0


def test_practitioners_outside_the_gap_cohort_are_not_published(harvest, tmp_path):
    """The crosswalk publishes what the NDH is missing, not the whole directory."""
    edges, _ = build_edges(harvest, PRAC, ORGS)
    out = tmp_path / "crosswalk.csv"
    write_crosswalk(edges, ORGS, [GAP_ROWS[0]], PAYER, out, {"1235223470"})
    assert {r["npi"] for r in _rows(out)} == {"1111111111"}


def test_verify_url_is_present_on_every_row(harvest, tmp_path):
    edges, _ = build_edges(harvest, PRAC, ORGS)
    out = tmp_path / "crosswalk.csv"
    write_crosswalk(edges, ORGS, GAP_ROWS, PAYER, out, {"1235223470"})
    for r in _rows(out):
        assert r["nppes_verify_url"].endswith(r["npi"])
