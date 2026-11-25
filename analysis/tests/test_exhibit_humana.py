import pytest

pytest.importorskip("duckdb")
pytest.importorskip("pyarrow")

from exhibit_humana_2026_11 import analyse, release_change, release_changes, three_way, wilson  # noqa: E402
from xsource_facts import EL_NPPES_LOC, EL_PRAC_ADDR, ROLE_ELEMENT  # noqa: E402

A, B = "1234567893", "1245319599"


def fact(npi, source, el, field, v):
    return {"npi": npi, "source": source, "fhir_element": el, "field": field, "value_norm": v}


def sample(npi, status="listed", zips=(), phones=(), truncated=False, missing=False):
    return {"npi": npi, "status": status, "zips": list(zips), "phones": list(phones),
            "truncated": truncated, "locations_missing": missing}


def test_wilson_known_value():
    lo, hi = wilson(50, 100)
    assert lo == pytest.approx(0.4038, abs=1e-4)
    assert hi == pytest.approx(0.5962, abs=1e-4)
    assert wilson(0, 0) is None
    assert wilson(0, 10)[0] == 0.0


def test_three_way_patterns():
    assert three_way({"1"}, {"2"}, {"2"}) == "payer_differs_npd_nppes_match"
    assert three_way({"1"}, {"1"}, {"1"}) == "all_three_match"
    assert three_way({"1"}, {"2"}, {"3"}) == "all_differ"
    assert three_way({"1"}, {"2"}, {"1"}) == "npd_differs"
    assert three_way({"1"}, {"1"}, {"2"}) == "nppes_differs"
    assert three_way({"1"}, {"1", "2"}, {"2"}) == "two_pairs_match"
    assert three_way(set(), {"1"}, {"1"}) is None


def test_release_change():
    assert release_change({"1"}, {"1"}, set()) == "unchanged"
    assert release_change({"1"}, {"1", "2"}, set()) == "added_only"
    assert release_change({"1", "2"}, {"1"}, {"2"}) == "dropped_still_in_nppes"
    assert release_change({"1", "2"}, {"1"}, {"3"}) == "dropped_not_in_nppes"


def test_analyse_uses_role_location_and_excludes_truncated():
    z = ROLE_ELEMENT["zip5"]
    facts = [
        fact(A, "npd", z, "zip5", "15213"), fact(A, "npd", z, "zip5", "15206"),
        fact(A, "npd", EL_PRAC_ADDR, "zip5", "19104"),
        fact(A, "nppes", EL_NPPES_LOC, "zip5", "15206"),
        fact(B, "npd", z, "zip5", "17547"),
    ]
    s = [sample(A, zips=["15213"]), sample(B, zips=["99999"], truncated=True),
         sample("1000000004", status="not_listed")]
    out = analyse(facts, s)
    assert out["sample"]["excluded_truncated"] == 1
    assert out["sample"]["compared"] == 1
    f = out["fields"]["zip5"]
    assert f["agree"] == 1 and f["disagree"] == 0
    # payer matches one NPD role location, NPPES matches the other: two pairs
    assert f["three_way"]["two_pairs_match"]["k"] == 1
    assert f["three_way"]["payer_differs_npd_nppes_match"]["k"] == 0
    assert f["three_way_n"] == 1


def test_release_changes_counts():
    z = ROLE_ELEMENT["zip5"]
    earlier = [fact(A, "npd", z, "zip5", "15213"), fact(A, "npd", z, "zip5", "15206"),
               fact(B, "npd", z, "zip5", "17547")]
    later = [fact(A, "npd", z, "zip5", "15213"), fact(A, "nppes", EL_NPPES_LOC, "zip5", "15206"),
             fact(B, "npd", z, "zip5", "17547")]
    r = release_changes(later, earlier)
    assert r["in_scope_both"] == 2
    assert r["zip5"]["unchanged"] == 1
    assert r["zip5"]["dropped_still_in_nppes"] == 1
