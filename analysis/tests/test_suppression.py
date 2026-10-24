"""Unit tests for analysis/suppression.py. Synthetic NPIs only (valid
check digits, obviously fake): 1234567893, 1111111112, 2222222228."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import suppression as sp  # noqa: E402

A, B, C = "1234567893", "1111111112", "2222222228"


def test_parse_ignores_blanks_and_separators():
    assert sp.parse_npis(f" {A}, ,{B}\n{C} ") == {A, B, C}
    assert sp.parse_npis("") == set()
    assert sp.parse_npis(None) == set()


def test_parse_raises_on_malformed_without_echoing_it():
    with pytest.raises(sp.SuppressionError) as e:
        sp.parse_npis(f"{A},12345")
    assert "12345" not in str(e.value)


def test_load_merges_env_only_when_no_db(tmp_path):
    assert sp.load_suppressed({"SUPPRESSED_NPIS": A}, public_root=tmp_path) == {A}
    assert sp.load_suppressed({}, public_root=tmp_path) == set()


def _committed(tmp_path, n):
    root = tmp_path / f"pub{n}"
    root.mkdir()
    (root / "x.json").write_text(json.dumps({"numerator": 5, "suppressed_rows": n}, indent=2))
    return root


def test_positive_control_refuses_an_empty_list(tmp_path):
    root = _committed(tmp_path, 1)
    with pytest.raises(sp.SuppressionError):
        sp.load_suppressed({}, public_root=root)
    assert sp.load_suppressed({"SUPPRESSED_NPIS": A}, public_root=root) == {A}
    # Nothing committed yet: an empty list is fine.
    assert sp.load_suppressed({}, public_root=_committed(tmp_path, 0)) == set()


def test_positive_control_refuses_an_empty_table(tmp_path, monkeypatch):
    root = _committed(tmp_path, 2)
    monkeypatch.setattr(sp, "load_from_db", lambda url: set())
    env = {"SUPPRESSION_READER_URL": "postgresql://x", "SUPPRESSED_NPIS": A}
    with pytest.raises(sp.SuppressionError):
        sp.load_suppressed(env, public_root=root)
    monkeypatch.setattr(sp, "load_from_db", lambda url: {B})
    assert sp.load_suppressed(env, public_root=root) == {A, B}


def test_filter_rows_counts_and_keeps_order():
    rows = [{"npi": B}, {"npi": A}, {"npi": C}]
    kept, n = sp.filter_rows(rows, "npi", {A})
    assert kept == [{"npi": B}, {"npi": C}] and n == 1
    kept, n = sp.filter_rows(rows, ("npi", "org_npi"), set())
    assert kept == rows and n == 0


def test_csv_scrub_removes_only_the_matching_line_bytes():
    text = (
        "npi,name,state\r\n"
        f'{B},"DOE, JANE",PA\r\n'
        f'{A},"ROE, RICHARD",\r\n'
        f'{C},"MULTI\r\nLINE",VA\r\n'
    )
    out, n = sp.scrub_csv_text(text, {A})
    assert n == 1
    assert out == text.replace(f'{A},"ROE, RICHARD",\r\n', "")


def test_csv_scrub_ignores_non_npi_and_org_columns():
    # A suppressed value in a phone or organization-NPI column is not a match.
    text = f"npi,phone,org_npi\n{B},{A},{A}\n"
    assert sp.scrub_csv_text(text, {A}) == (text, 0)


def test_org_files_are_never_filtered(tmp_path, monkeypatch):
    public = tmp_path / "public"
    (public / "findings").mkdir(parents=True)
    monkeypatch.setattr(sp, "PUBLIC_ROOT", public)
    monkeypatch.setattr(sp, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(sp, "MIRROR_ROOT", tmp_path / "mirror")
    f = public / "findings" / "hospital-ownership-crosswalk.csv"
    f.write_text(f"npi,ccn\n{A},1\n")
    assert sp.scrub_file(f, {A}) == 0
    assert A in f.read_text()


def test_json_scrub_drops_records_and_counts():
    doc = {
        "headline": "x",
        "rows": [{"npi": A, "name": "R"}, {"npi": B, "name": "J"}],
        "featured": {"npi": A, "name": "R"},
        "single": {"npi": A},
        "owner": {"org_npi": A, "name": "Org"},
        "ids": [A, B],
        "by_npi": {A: 1, B: 2},
    }
    text = json.dumps(doc, indent=2) + "\n"
    out, n = sp.scrub_json_text(text, {A})
    got = json.loads(out)
    assert n == 5
    assert got["rows"] == [{"npi": B, "name": "J"}]
    # Matching records held under a key are removed, not blanked.
    assert "featured" not in got and "single" not in got
    # Organization NPI fields are never touched.
    assert got["owner"] == {"org_npi": A, "name": "Org"}
    assert got["ids"] == [B]
    assert got["by_npi"] == {B: 2}
    assert got["suppressed_rows"] == 5
    assert out.endswith("\n") and out.split("\n")[1].startswith("  ")


def test_scrub_file_keeps_mirror_and_bumps_sidecar(tmp_path, monkeypatch):
    public = tmp_path / "public"
    (public / "findings").mkdir(parents=True)
    monkeypatch.setattr(sp, "PUBLIC_ROOT", public)
    monkeypatch.setattr(sp, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(sp, "MIRROR_ROOT", tmp_path / "mirror")
    csv_path = public / "findings" / "high-risk-cohort-export.csv"
    original = f"npi,name\n{A},R\n{B},J\n"
    csv_path.write_text(original)
    sidecar = public / "findings" / "high-risk-cohort.json"
    sidecar.write_text(json.dumps({"numerator": 2}, indent=2) + "\n")

    assert sp.scrub_file(csv_path, {A}) == 1
    assert csv_path.read_text() == f"npi,name\n{B},J\n"
    assert json.loads(sidecar.read_text()) == {"numerator": 2, "suppressed_rows": 1}
    # Downstream inputs read the unfiltered copy while it matches.
    assert sp.input_path(csv_path).read_text() == original
    # Idempotent: a second pass removes nothing and leaves the count alone.
    assert sp.scrub_file(csv_path, {A}) == 0
    assert json.loads(sidecar.read_text())["suppressed_rows"] == 1
    # A changed public file invalidates the mirror.
    csv_path.write_text(f"npi,name\n{C},X\n")
    assert sp.input_path(csv_path) == csv_path


def test_check_reports_files_not_values(tmp_path, capsys):
    (tmp_path / "a.json").write_text(json.dumps({"npi": A}))
    (tmp_path / "b.csv").write_text(f"npi\n{B}\n")
    hits = sp.check([tmp_path], {A})
    assert list(hits.values()) == [1] and list(hits)[0].endswith("a.json")
    assert sp.check([tmp_path], set()) == {}


def test_main_check_passes_with_no_list(monkeypatch, tmp_path):
    for v in ("SUPPRESSED_NPIS", "SUPPRESSION_READER_URL", "SUPPRESSION_APPLY_URL"):
        monkeypatch.delenv(v, raising=False)
    assert sp.main(["--check", str(tmp_path)]) == 0


def test_main_check_fails_only_on_published_files(monkeypatch, tmp_path):
    public = tmp_path / "public"
    docs = tmp_path / "docs"
    public.mkdir()
    docs.mkdir()
    monkeypatch.setattr(sp, "PUBLIC_ROOT", public)
    monkeypatch.setattr(sp, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(sp, "WARN_ROOTS", (docs,))
    monkeypatch.setenv("SUPPRESSED_NPIS", A)
    monkeypatch.delenv("SUPPRESSION_READER_URL", raising=False)
    monkeypatch.delenv("SUPPRESSION_APPLY_URL", raising=False)
    (docs / "note.md").write_text(f"mentions {A}")
    report = tmp_path / "r.md"
    assert sp.main(["--check", "--report-file", str(report)]) == 0
    assert "docs/note.md" in report.read_text() and A not in report.read_text()
    (public / "x.json").write_text(json.dumps({"npi": A}))
    assert sp.main(["--check"]) == 1
