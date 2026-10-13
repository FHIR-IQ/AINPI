"""Tests for the measure-series generator (analysis/measures.py).

The generator's job is mostly refusal: no point without a source that names
its own release, no zero without a control, no ratio without a denominator,
no line across a break. Each refusal is tested against a fixture tree so the
tests do not depend on the committed data, plus one pass over the real
registry to pin the rules against what actually ships.
"""
import json

import pytest

from analysis import measures as M

RELEASES = ["2026-05-08", "2026-08-20"]


def write(root, rel, doc):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc))
    return rel


def finding(release, num, den, **extra):
    return {"release_date": release, "numerator": num, "denominator": den,
            "commit_sha": "abc1234", **extra}


def measure(sources, **kw):
    base = dict(
        slug="test-measure",
        question="What share?",
        unit="ratio",
        source="fixture",
        hypotheses=(),
        definitions=(M.Definition(1, "n", "d"),),
        sources=tuple(sources),
        ordinary_move={"kind": "absolute", "max": 0.05, "why": "fixture"},
    )
    base.update(kw)
    return M.Measure(**base)


def build_one(tmp_path, m):
    return M.build_measure(m, tmp_path, RELEASES)


# --- points come only from sources ---------------------------------------

def test_point_release_is_read_from_the_source(tmp_path):
    a = write(tmp_path, "a.json", finding("2026-05-08", 10, 100))
    b = write(tmp_path, "b.json", finding("2026-08-20", 12, 100))
    out = build_one(tmp_path, measure([M.Source(a, M.finding_ratio), M.Source(b, M.finding_ratio)]))
    assert [p["release"] for p in out["series"]] == RELEASES
    assert out["series"][0]["value"] == pytest.approx(0.10)
    assert out["series"][0]["source"] == {"file": "a.json", "field": "numerator / denominator",
                                          "commit": "abc1234", "vendored": False}
    assert out["omitted"] == []


def test_release_without_a_source_is_omitted_not_invented(tmp_path):
    b = write(tmp_path, "b.json", finding("2026-08-20", 12, 100))
    out = build_one(tmp_path, measure([M.Source(b, M.finding_ratio)]))
    assert [p["release"] for p in out["series"]] == ["2026-08-20"]
    assert out["omitted"] == [{"release": "2026-05-08",
                               "reason": "no source in the repo carries this release"}]
    # The lone point has no predecessor, so nothing is claimed about comparability.
    assert out["series"][0]["comparable_to_previous"] is None


def test_source_carrying_a_release_outside_the_series_is_ignored(tmp_path):
    a = write(tmp_path, "a.json", finding("2026-04-09", 46, 100))
    out = build_one(tmp_path, measure([M.Source(a, M.finding_ratio)]))
    assert out["series"] == []
    assert {o["release"] for o in out["omitted"]} == set(RELEASES)


def test_missing_source_file_is_an_omission_with_reason(tmp_path):
    out = build_one(tmp_path, measure([M.Source("nope.json", M.finding_ratio)]))
    assert out["series"] == []
    assert all("source file missing: nope.json" in o["reason"] for o in out["omitted"])


def test_declared_omission_reason_is_published(tmp_path):
    out = build_one(tmp_path, measure([], omission_reasons={"2026-05-08": "field did not exist"}))
    first = next(o for o in out["omitted"] if o["release"] == "2026-05-08")
    assert first["reason"].startswith("field did not exist")


@pytest.mark.parametrize("den", [None, 0, -5, "100"])
def test_ratio_without_a_positive_denominator_is_omitted_never_zero(tmp_path, den):
    a = write(tmp_path, "a.json", finding("2026-05-08", 10, den))
    out = build_one(tmp_path, measure([M.Source(a, M.finding_ratio)]))
    assert out["series"] == []
    assert "denominator missing or not positive" in out["omitted"][0]["reason"]


def test_numerator_above_denominator_is_rejected(tmp_path):
    a = write(tmp_path, "a.json", finding("2026-05-08", 101, 100))
    out = build_one(tmp_path, measure([M.Source(a, M.finding_ratio)]))
    assert out["series"] == []


def test_two_sources_for_one_release_is_an_error_unless_a_restatement(tmp_path):
    a = write(tmp_path, "a.json", finding("2026-05-08", 10, 100))
    b = write(tmp_path, "b.json", finding("2026-05-08", 11, 100))
    with pytest.raises(ValueError, match="neither is a restatement"):
        build_one(tmp_path, measure([M.Source(a, M.finding_ratio), M.Source(b, M.finding_ratio)]))


# --- zero needs a positive control ---------------------------------------

def test_zero_without_control_is_omitted(tmp_path):
    a = write(tmp_path, "a.json", finding("2026-08-20", 0, 100))
    out = build_one(tmp_path, measure([M.Source(a, M.finding_ratio)]))
    assert out["series"] == []
    assert "zero with no positive control" in out["omitted"][-1]["reason"]


def test_zero_with_control_publishes_and_carries_the_control(tmp_path):
    notes = "Nothing found. 99 of 100 Practitioner resources still carry the qualification array those exposures were in."
    a = write(tmp_path, "a.json", finding("2026-08-20", 0, 100, notes=notes))
    out = build_one(tmp_path, measure([M.Source(a, M.ssn_with_control)], unit="count"))
    [p] = out["series"]
    assert p["value"] == 0
    assert "still carry the qualification array" in p["zero_control"]


def test_ssn_zero_loses_its_point_if_the_source_stops_asserting_the_control(tmp_path):
    a = write(tmp_path, "a.json", finding("2026-08-20", 0, 100, notes="No exposures."))
    out = build_one(tmp_path, measure([M.Source(a, M.ssn_with_control)], unit="count"))
    assert out["series"] == []


# --- breaks, priors, reviews ---------------------------------------------

def two_version_measure(tmp_path, comparable=False):
    a = write(tmp_path, "a.json", finding("2026-05-08", 9, 100))
    b = write(tmp_path, "b.json", finding("2026-08-20", 99, 100))
    return measure(
        [M.Source(a, M.finding_ratio, definition_version=1),
         M.Source(b, M.finding_ratio, definition_version=2)],
        definitions=(M.Definition(1, "old n", "d"), M.Definition(2, "new n", "d")),
        breaks=(M.Break("2026-08-20", 1, 2, "vocabulary changed", comparable_across_break=comparable),),
    )


def test_break_puts_different_versions_on_each_side_and_blocks_the_line(tmp_path):
    out = build_one(tmp_path, two_version_measure(tmp_path))
    first, second = out["series"]
    assert (first["definition_version"], second["definition_version"]) == (1, 2)
    assert second["comparable_to_previous"] is False
    assert "vocabulary changed" in second["comparability_reason"]
    assert out["definition_version"] == 2
    assert out["breaks"][0]["comparable_across_break"] is False
    hashes = {d["definition_hash"] for d in out["definitions"]}
    assert len(hashes) == 2


def test_reviewed_break_may_be_comparable(tmp_path):
    out = build_one(tmp_path, two_version_measure(tmp_path, comparable=True))
    assert out["series"][1]["comparable_to_previous"] is True


def test_version_change_without_a_declared_break_is_an_error(tmp_path):
    m = two_version_measure(tmp_path)
    m = M.Measure(**{**m.__dict__, "breaks": ()})
    with pytest.raises(ValueError, match="no declared break"):
        build_one(tmp_path, m)


def test_move_beyond_the_declared_prior_is_unreviewed(tmp_path):
    a = write(tmp_path, "a.json", finding("2026-05-08", 10, 100))
    b = write(tmp_path, "b.json", finding("2026-08-20", 30, 100))
    out = build_one(tmp_path, measure([M.Source(a, M.finding_ratio), M.Source(b, M.finding_ratio)]))
    assert out["series"][1]["comparable_to_previous"] == "unreviewed"


def test_review_upgrades_an_unreviewed_move(tmp_path):
    a = write(tmp_path, "a.json", finding("2026-05-08", 10, 100))
    b = write(tmp_path, "b.json", finding("2026-08-20", 30, 100))
    out = build_one(tmp_path, measure([M.Source(a, M.finding_ratio), M.Source(b, M.finding_ratio)],
                                      reviews=(M.Review("2026-08-20", "real"),)))
    assert out["series"][1]["comparable_to_previous"] is True
    assert out["series"][1]["comparability_reason"] == "reviewed: real"


def test_relative_prior_on_a_count(tmp_path):
    a = write(tmp_path, "a.json", finding("2026-05-08", 40, 1000))
    b = write(tmp_path, "b.json", finding("2026-08-20", 44, 1000))
    out = build_one(tmp_path, measure([M.Source(a, M.finding_ratio), M.Source(b, M.finding_ratio)],
                                      unit="count", ordinary_move={"kind": "relative", "max": 0.2, "why": "x"}))
    assert out["series"][1]["value"] == 44
    assert out["series"][1]["comparable_to_previous"] is True


# --- restatements --------------------------------------------------------

def test_restatement_is_attached_when_it_differs(tmp_path):
    cur = write(tmp_path, "cur.json", finding("2026-08-20", 90, 100))
    old = write(tmp_path, "old.json", finding("2026-08-20", 80, 100))
    out = build_one(tmp_path, measure([
        M.Source(cur, M.finding_ratio),
        M.Source(old, M.finding_ratio, restatement_of="2026-08-20", restatement_reason="first entry only",
                 vendored_from="deadbee"),
    ]))
    [p] = out["series"]
    assert p["numerator"] == 90
    [r] = p["restatements"]
    assert r["as_published_numerator"] == 80
    assert r["source"]["commit"] == "deadbee" and r["source"]["vendored"] is True
    assert r["reason"] == "first entry only"


def test_restatement_for_the_wrong_release_is_an_error(tmp_path):
    old = write(tmp_path, "old.json", finding("2026-05-08", 80, 100))
    with pytest.raises(ValueError, match="declared for"):
        build_one(tmp_path, measure([M.Source(old, M.finding_ratio, restatement_of="2026-08-20",
                                              restatement_reason="x")]))


# --- extractors ----------------------------------------------------------

def test_snapshot_extractor_refuses_when_kinds_do_not_sum_to_rows(tmp_path):
    snap = {"release": "2026-05-08",
            "tables": {"endpoint": {"rows": 100}},
            "shape": {"endpoint_connection_types": [{"kind": "hl7-fhir-rest", "n": 10},
                                                    {"kind": "direct-project", "n": 80}]}}
    a = write(tmp_path, "snap.json", snap)
    out = build_one(tmp_path, measure([M.Source(a, M.snapshot_fhir_rest)]))
    assert out["series"] == []
    assert "sum to 90" in out["omitted"][0]["reason"]


def test_coded_org_type_counts_text_and_null_against(tmp_path):
    snap = {"release": "2026-08-20",
            "tables": {"organization": {"rows": 10}},
            "shape": {"organization_types": [{"kind": "prov", "n": 5}, {"kind": "text:ein", "n": 3},
                                             {"kind": None, "n": 1}, {"kind": "pay", "n": 1}]}}
    a = write(tmp_path, "snap.json", snap)
    out = build_one(tmp_path, measure([M.Source(a, M.snapshot_coded_org_type)]))
    assert out["series"][0]["numerator"] == 6


def test_h9_extractor_refuses_the_slug_once_h13_has_overwritten_it(tmp_path):
    a = write(tmp_path, "a.json", finding("2026-05-08", 206603, 2270482, headline="9.1% of pairs agree"))
    out = build_one(tmp_path, measure([M.Source(a, M.h9_from_shared_slug)]))
    assert out["series"] == []
    assert "no longer carries H9" in out["omitted"][0]["reason"]


def test_role_gap_delta_yields_both_releases(tmp_path):
    doc = {"from": "2026-05-08", "to": "2026-08-20", "state": "PA",
           "overall": {"before": {"active": 100, "with_role": 38}, "after": {"active": 100, "with_role": 44}}}
    a = write(tmp_path, "rgd.json", doc)
    out = build_one(tmp_path, measure([M.Source(a, M.role_gap_delta_pa)]))
    assert [p["numerator"] for p in out["series"]] == [38, 44]


# The shape the next reload produces: the outgoing role-gap-delta.json is
# vendored as published (2026-05-08 -> 2026-08-20) and the live file is
# regenerated for the next pair (2026-08-20 -> 2026-10-07). Three releases,
# two files, one release shared between them.
THREE_RELEASES = ["2026-05-08", "2026-08-20", "2026-10-07"]


def rgd(frm, to, before, after, state="PA"):
    return {"from": frm, "to": to, "state": state,
            "overall": {"before": {"active": 1000, "with_role": before},
                        "after": {"active": 1000, "with_role": after}}}


def test_role_gap_delta_regenerated_for_a_new_release_adds_a_point(tmp_path):
    vendored = write(tmp_path, "published/role-gap-delta@abc1234.json",
                     rgd("2026-05-08", "2026-08-20", 381, 437))
    live = write(tmp_path, "role-gap-delta.json", rgd("2026-08-20", "2026-10-07", 437, 460))
    m = measure([M.Source(vendored, M.role_gap_delta_pa_side("before"), vendored_from="abc1234"),
                 M.Source(live, M.role_gap_delta_pa)])
    out = M.build_measure(m, tmp_path, THREE_RELEASES)
    assert [p["release"] for p in out["series"]] == THREE_RELEASES
    assert [p["numerator"] for p in out["series"]] == [381, 437, 460]
    assert out["omitted"] == []
    may, aug, octo = out["series"]
    assert may["source"] == {"file": vendored, "field": "overall.before.with_role / overall.before.active",
                             "commit": "abc1234", "vendored": True}
    assert aug["source"]["file"] == live and aug["source"]["field"].startswith("overall.before.")
    assert octo["source"]["file"] == live and octo["source"]["field"].startswith("overall.after.")


def test_role_gap_delta_both_files_read_whole_is_the_hazard_the_side_extractor_avoids(tmp_path):
    vendored = write(tmp_path, "v.json", rgd("2026-05-08", "2026-08-20", 381, 437))
    live = write(tmp_path, "l.json", rgd("2026-08-20", "2026-10-07", 437, 460))
    m = measure([M.Source(vendored, M.role_gap_delta_pa), M.Source(live, M.role_gap_delta_pa)])
    with pytest.raises(ValueError, match="two sources for 2026-08-20"):
        M.build_measure(m, tmp_path, THREE_RELEASES)


def test_role_gap_delta_vendored_copy_as_restatement_publishes_a_difference(tmp_path):
    # The other legal registration: the vendored copy's shared side declared a
    # restatement. If the regenerated file restates the shared release, the
    # difference is published rather than resolved silently.
    vendored = write(tmp_path, "v.json", rgd("2026-05-08", "2026-08-20", 381, 437))
    live = write(tmp_path, "l.json", rgd("2026-08-20", "2026-10-07", 439, 460))
    m = measure([M.Source(vendored, M.role_gap_delta_pa_side("before"), vendored_from="abc1234"),
                 M.Source(vendored, M.role_gap_delta_pa_side("after"), vendored_from="abc1234",
                          restatement_of="2026-08-20", restatement_reason="fixture"),
                 M.Source(live, M.role_gap_delta_pa)])
    out = M.build_measure(m, tmp_path, THREE_RELEASES)
    assert [p["numerator"] for p in out["series"]] == [381, 439, 460]
    assert out["series"][1]["restatements"][0]["as_published_numerator"] == 437


def test_role_gap_delta_side_before_new_release_is_listed_is_ignored_not_raised(tmp_path):
    # Between the regenerated file landing and KNOWN_RELEASES naming the new
    # release, the new side is outside the series and must be skipped quietly.
    live = write(tmp_path, "l.json", rgd("2026-08-20", "2026-10-07", 437, 460))
    out = build_one(tmp_path, measure([M.Source(live, M.role_gap_delta_pa)]))
    assert [p["release"] for p in out["series"]] == ["2026-08-20"]
    assert [o["release"] for o in out["omitted"]] == ["2026-05-08"]


def test_role_gap_delta_side_rejects_unknown_side_and_other_states(tmp_path):
    with pytest.raises(ValueError):
        M.role_gap_delta_pa_side("middle")
    a = write(tmp_path, "oh.json", rgd("2026-05-08", "2026-08-20", 1, 2, state="OH"))
    out = build_one(tmp_path, measure([M.Source(a, M.role_gap_delta_pa_side("before"))]))
    assert out["series"] == []
    assert "not PA" in out["omitted"][0]["reason"]


# --- the real registry against the committed tree ------------------------

def test_series_starts_at_may_and_excludes_april():
    assert M.series_releases(("2026-08-20", "2026-05-08", "2026-04-09")) == RELEASES


def test_real_registry_builds_and_obeys_the_rules():
    doc = M.build(generated_at="fixed")
    assert 8 <= len(doc["measures"]) <= 10
    for m in doc["measures"]:
        assert m["series"], f"{m['slug']} has no points"
        seen = [p["release"] for p in m["series"]] + [o["release"] for o in m["omitted"]]
        assert sorted(seen) == doc["releases"], m["slug"]
        for p in m["series"]:
            assert p["release"] in doc["releases"]
            assert p["denominator"] > 0
            assert p["source"]["file"]
            if p["numerator"] == 0:
                assert p.get("zero_control"), m["slug"]
        if m["breaks"]:
            for b in m["breaks"]:
                after = next(p for p in m["series"] if p["release"] == b["at"])
                assert after["comparable_to_previous"] == b["comparable_across_break"]
    by_slug = {m["slug"]: m for m in doc["measures"]}
    agreement = by_slug["role-specialty-agreement"]
    assert agreement["series"][-1]["comparable_to_previous"] is False
    assert agreement["series"][-1]["restatements"][0]["as_published_numerator"] == 5275554


def test_committed_measures_json_matches_the_generator():
    """Corrections go in the generator; the JSON must be its output."""
    committed = json.loads((M.REPO_ROOT / M.OUT_PATH).read_text())
    fresh = M.build(generated_at=committed["generated_at"])
    assert committed == fresh
