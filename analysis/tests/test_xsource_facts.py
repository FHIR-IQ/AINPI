"""Unit tests for analysis/xsource_facts.py over a fixture export. No network."""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pyarrow.parquet as pq
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import xsource_facts as xf  # noqa: E402
import xsource_norm as xn  # noqa: E402
from ndh_fixture import NUCC, P1, P2, P3, P4, P5, build_export, build_nppes  # noqa: E402

RELEASE, MONTH = "2026-10-07", "2026-11"
ROLE_ZIP = "PractitionerRole.location->Location.address"
PRAC_ZIP = "Practitioner.address(physical)"


@pytest.fixture
def facts_path(tmp_path):
    build_export(tmp_path / "export", RELEASE)
    build_nppes(tmp_path / "nppes", MONTH)
    return xf.build(RELEASE, MONTH, ["PA"],
                    parquet_root=tmp_path / "export", nppes_root=tmp_path / "nppes",
                    out_root=tmp_path / "out", taxonomy_map=NUCC)


def _rows(path):
    return pq.read_table(path).to_pylist()


def _vals(rows, npi, source, element, field):
    return {r["value_norm"] for r in rows
            if r["npi"] == npi and r["source"] == source
            and r["fhir_element"] == element and r["field"] == field}


def payer(npi, field, value, source="humana"):
    return {"npi": npi, "source": source, "field": field, "value_norm": value}


# --- build -------------------------------------------------------------------

def test_build_writes_rows_with_plan_columns(facts_path):
    assert facts_path.name == "facts.parquet"
    assert facts_path.parent.name == RELEASE
    t = pq.read_table(facts_path)
    assert t.column_names == ["npi", "source", "lineage", "fhir_element", "field",
                              "value_norm", "observed_at", "rule_version"]


def test_scope_is_active_practitioners_with_active_role_in_state(facts_path):
    npis = {r["npi"] for r in _rows(facts_path)}
    assert npis == {P1, P2}
    assert not npis & {P3, P4, P5}


def test_role_locations_all_kept_and_normalized(facts_path):
    rows = _rows(facts_path)
    assert _vals(rows, P1, "npd", ROLE_ZIP, "zip5") == {"15206", "15213"}
    assert _vals(rows, P1, "npd", "PractitionerRole.location->Location.telecom", "phone10") == {
        "4125550111", "4125550122"}


def test_practitioner_address_is_the_physical_one_not_address0(facts_path):
    rows = _rows(facts_path)
    assert _vals(rows, P1, "npd", PRAC_ZIP, "zip5") == {"15232"}
    assert _vals(rows, P1, "npd", "Practitioner.telecom", "phone10") == {"4125550101"}


def test_taxonomy_from_role_specialty_validated_by_nucc(facts_path):
    rows = _rows(facts_path)
    # "14-50" is the CMS Medicare form and is dropped, not kept as a value.
    assert _vals(rows, P1, "npd", "PractitionerRole.specialty", "taxonomy") == {"207Q00000X"}


def test_nppes_rows_and_lineage_columns(facts_path):
    rows = _rows(facts_path)
    n = [r for r in rows if r["source"] == "nppes" and r["npi"] == P1]
    assert {(r["field"], r["value_norm"]) for r in n} == {
        ("zip5", "15206"), ("phone10", "4125550111"), ("taxonomy", "207Q00000X")}
    assert {r["lineage"] for r in n} == {"root"}
    assert {r["observed_at"] for r in n} == {MONTH}
    npd = [r for r in rows if r["source"] == "npd"]
    assert {r["lineage"] for r in npd} == {"nppes|pecos"}
    assert {r["observed_at"] for r in npd} == {RELEASE}
    assert {r["rule_version"] for r in rows} == {xf.RULE_VERSION}


def test_build_refuses_dataless_input(tmp_path):
    build_export(tmp_path / "export", RELEASE)
    build_nppes(tmp_path / "nppes", MONTH)

    def fake_stat(p):
        flags = xn.SF_DATALESS if Path(p).name == "location.parquet" else 0
        return SimpleNamespace(st_flags=flags)

    with pytest.raises(RuntimeError, match="Download Now"):
        xf.build(RELEASE, MONTH, ["PA"], parquet_root=tmp_path / "export",
                 nppes_root=tmp_path / "nppes", out_root=tmp_path / "out",
                 taxonomy_map=NUCC, stat=fake_stat)


def test_build_raises_when_no_role_locations(tmp_path):
    build_export(tmp_path / "export", RELEASE)
    build_nppes(tmp_path / "nppes", MONTH)
    with pytest.raises(RuntimeError, match="zero"):
        xf.build(RELEASE, MONTH, ["WY"], parquet_root=tmp_path / "export",
                 nppes_root=tmp_path / "nppes", out_root=tmp_path / "out", taxonomy_map=NUCC)


def test_scope_npis_matches_build_scope(tmp_path):
    build_export(tmp_path / "export", RELEASE)
    assert xf.scope_npis(RELEASE, ["pa"], parquet_root=tmp_path / "export") == {P1, P2}


# --- compare -----------------------------------------------------------------

def test_zip_agrees_when_any_role_location_matches(facts_path):
    out = xf.compare(facts_path, {P1}, [payer(P1, "zip5", "15213")])
    z = out["zip5"]
    assert z["agree"] == 1 and z["disagree"] == 0
    assert z["by_element"][ROLE_ZIP]["agree"] == 1


def test_practitioner_address_only_match_is_counted_separately(facts_path):
    # P2's payer ZIP equals the practitioner address, not the role location.
    out = xf.compare(facts_path, {P2}, [payer(P2, "zip5", "16501")])
    z = out["zip5"]
    assert z["agree"] == 0 and z["disagree"] == 1          # role-location comparison
    assert z["by_element"][PRAC_ZIP]["agree"] == 1          # labelled, separate
    assert z["by_element"][ROLE_ZIP]["disagree"] == 1


def test_npd_equal_to_nppes_is_upstream_not_agreement(facts_path):
    out = xf.compare(facts_path, {P1}, [])
    z = out["zip5"]
    assert z["agree"] == 0
    assert z["one_sided"] == 1                              # NPD has a value, payer none
    assert z["by_relation"]["upstream"]["match"] == 1
    assert "agree" not in z["by_relation"]["upstream"]
    assert z["by_relation"]["independent"]["match"] == 0


def test_payer_pairs_are_unknown_lineage(facts_path):
    out = xf.compare(facts_path, {P1}, [payer(P1, "zip5", "15206")])
    rel = out["zip5"]["by_relation"]
    assert rel["unknown"]["match"] == 2                     # payer vs NPD, payer vs NPPES
    assert rel["upstream"]["match"] == 1


def _rel(match=0, differ=0, one_sided=0, neither=0, locations_missing=0):
    return {"match": match, "differ": differ, "one_sided": one_sided,
            "neither": neither, "locations_missing": locations_missing}


def test_buckets_sum_to_compared_set(facts_path):
    npis = {P1, P2, P4}  # P4 is not in the facts at all
    out = xf.compare(facts_path, npis, [payer(P1, "phone10", "4125550122")])
    for field in xf.FIELDS:
        f = out[field]
        assert (f["agree"] + f["disagree"] + f["one_sided"] + f["neither"]
                + f["locations_missing"]) == len(npis)
    assert out["phone10"]["agree"] == 1
    # Exact per-relation tallies, derived by hand from ndh_fixture:
    #   P1 role zip {15206, 15213}, role phone {..0111, ..0122}, role tax 207Q;
    #      NPPES 15206 / ..0111 / 207Q.
    #   P2 role zip {17101}, no role phone, role tax 363LF; NPPES 16501 / none / 363LF.
    #   P4 nothing. The only payer value is P1's phone ..0122.
    # upstream is NPD role vs NPPES (one pair per NPI); unknown is payer vs NPD
    # plus payer vs NPPES (two pairs per NPI).
    rel = {f: out[f]["by_relation"] for f in xf.FIELDS}
    assert rel["zip5"] == {"upstream": _rel(match=1, differ=1, neither=1),
                           "independent": _rel(),
                           "unknown": _rel(one_sided=4, neither=2)}
    assert rel["phone10"] == {"upstream": _rel(match=1, neither=2),
                              "independent": _rel(),
                              "unknown": _rel(match=1, differ=1, neither=4)}
    assert rel["taxonomy"] == {"upstream": _rel(match=2, neither=1),
                               "independent": _rel(),
                               "unknown": _rel(one_sided=4, neither=2)}


def test_locations_missing_is_counted_apart_from_one_sided(facts_path):
    # P2 is listed by the payer, but its role Locations were not returned, so
    # the payer side holds no ZIP or phone. That is not "payer has no value".
    out = xf.compare(facts_path, {P1, P2}, [payer(P1, "zip5", "15213")],
                     locations_missing={P2})
    z = out["zip5"]
    assert z["agree"] == 1 and z["one_sided"] == 0 and z["locations_missing"] == 1
    assert z["by_element"][ROLE_ZIP]["locations_missing"] == 1
    assert z["by_element"][ROLE_ZIP]["one_sided"] == 0
    assert z["by_relation"]["unknown"]["locations_missing"] == 2
    assert z["by_relation"]["upstream"]["locations_missing"] == 0
    assert out["phone10"]["locations_missing"] == 1
    # The payer never supplies taxonomy, so the flag does not apply to it.
    assert out["taxonomy"]["locations_missing"] == 0


def test_locations_missing_without_any_payer_rows(facts_path):
    out = xf.compare(facts_path, {P2}, [], locations_missing={P2})
    assert out["zip5"]["locations_missing"] == 1 and out["zip5"]["one_sided"] == 0
    assert out["zip5"]["by_relation"]["unknown"]["locations_missing"] == 2


def test_compare_labels_nppes_taxonomy_as_primary_only(facts_path):
    out = xf.compare(facts_path, {P1}, [])
    assert out["nppes_taxonomy_scope"] == "primary_only"
    assert "primary" in xf.compare.__doc__


def test_compare_ignores_rows_outside_npi_set(facts_path):
    out = xf.compare(facts_path, {P2}, [payer(P1, "zip5", "15213")])
    assert out["zip5"]["agree"] == 0


def test_compare_accepts_rows_and_rejects_mixed_payers(facts_path):
    rows = _rows(facts_path)
    assert xf.compare(rows, {P1}, [payer(P1, "zip5", "15213")])["zip5"]["agree"] == 1
    with pytest.raises(ValueError, match="one payer"):
        xf.compare(rows, {P1}, [payer(P1, "zip5", "1"), payer(P1, "zip5", "2", "optum_flex")])
