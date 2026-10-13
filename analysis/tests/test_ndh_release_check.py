"""Tests for analysis/ndh_release_check.py. The fetch is always mocked."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import ndh_release_check as nrc  # noqa: E402
from ndh_release_check import (  # noqa: E402
    ReleaseCheckError,
    check_release,
    issue_body,
    issue_title,
)

# Key shape of the live manifest since 2026-08-20.
FILES = {
    "01-Organization.ndjson": {"compressed_bytes": 1},
    "02-Location.ndjson": {"compressed_bytes": 1},
    "03-Endpoint.ndjson": {"compressed_bytes": 1},
    "04-HealthcareService.ndjson": {"compressed_bytes": 1},
    "05-InsurancePlan.ndjson": {"compressed_bytes": 1},
    "06-Practitioner.ndjson": {"compressed_bytes": 1},
    "07-PractitionerRole.ndjson": {"compressed_bytes": 1},
    "08-OrganizationAffiliation.ndjson": {"compressed_bytes": 1},
}


def manifest(generated_at="2026-08-20", files=None):
    m = {"compression_algorithm": "zstd", "files": FILES if files is None else files}
    if generated_at is not None:
        m["generated_at"] = generated_at
    return m


def run(m, current="2026-08-20"):
    return check_release(fetch=lambda: m, current=current)


# --- comparison -------------------------------------------------------------

def test_same_release_is_current():
    s = run(manifest("2026-08-20"))
    assert s.status == "current"
    assert not s.is_new


def test_newer_release_is_new():
    s = run(manifest("2026-10-07"))
    assert s.status == "new"
    assert s.is_new
    assert s.live_release == "2026-10-07"
    assert s.current_release == "2026-08-20"


def test_timestamp_form_is_accepted():
    assert run(manifest("2026-10-07T03:14:00Z")).live_release == "2026-10-07"


def test_comparison_is_by_date_not_string_length():
    # A string compare would still get this right, but a date compare is the
    # contract; pin it across a month boundary.
    assert run(manifest("2026-09-01"), current="2026-08-31").is_new


def test_older_manifest_fails_loudly():
    with pytest.raises(ReleaseCheckError, match="older than"):
        run(manifest("2026-05-08"))


# --- malformed --------------------------------------------------------------

@pytest.mark.parametrize("value", [None, "", "unknown", "2026-13-01", 20261007])
def test_bad_generated_at_fails(value):
    with pytest.raises(ReleaseCheckError, match="generated_at"):
        run(manifest(value))


def test_json_list_fails():
    with pytest.raises(ReleaseCheckError, match="expected a JSON object"):
        run([manifest("2026-10-07")])


@pytest.mark.parametrize("files", [{}, [], "x"])
def test_missing_or_empty_files_fails(files):
    with pytest.raises(ReleaseCheckError, match="files"):
        run(manifest("2026-10-07", files=files))


def test_files_missing_a_resource_fails():
    files = {k: v for k, v in FILES.items() if "Practitioner.ndjson" not in k}
    with pytest.raises(ReleaseCheckError, match="resolve"):
        run(manifest("2026-10-07", files=files))


def test_renamed_keys_fail_rather_than_read_as_current():
    # A key-format change like the 2026-08-20 rename must not pass silently.
    files = {f"{k}.v2": v for k, v in FILES.items()}
    with pytest.raises(ReleaseCheckError):
        run(manifest("2026-08-20", files=files))


# --- unreachable ------------------------------------------------------------

@pytest.mark.parametrize("exc", [
    subprocess.CalledProcessError(6, ["curl"], stderr="Could not resolve host"),
    RuntimeError("manifest returned non-JSON (0 bytes): ''"),
    OSError("network down"),
    TimeoutError("timed out"),
])
def test_fetch_failure_is_wrapped(exc):
    def boom():
        raise exc
    with pytest.raises(ReleaseCheckError, match="could not fetch"):
        check_release(fetch=boom, current="2026-08-20")


# --- CLI --------------------------------------------------------------------

def _patch_fetch(monkeypatch, m=None, exc=None):
    def fake(*_a, **_k):
        if exc:
            raise exc
        return m
    monkeypatch.setattr(nrc, "fetch_manifest", fake)
    monkeypatch.setattr(nrc, "CURRENT_RELEASE", "2026-08-20")


def test_cli_new_release_writes_outputs(monkeypatch, tmp_path):
    _patch_fetch(monkeypatch, manifest("2026-10-07"))
    out = tmp_path / "gh_output"
    body = tmp_path / "body.md"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    assert nrc.main(["--issue-body-file", str(body)]) == 0
    text = out.read_text()
    assert "status=new" in text
    assert "new_release=true" in text
    assert "release_date=2026-10-07" in text
    assert "issue_title=New CMS NDH release 2026-10-07 detected" in text
    assert "release_snapshot.py --release 2026-08-20" in body.read_text()


def test_cli_current_writes_no_body(monkeypatch, tmp_path):
    _patch_fetch(monkeypatch, manifest("2026-08-20"))
    out = tmp_path / "gh_output"
    body = tmp_path / "body.md"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    assert nrc.main(["--issue-body-file", str(body)]) == 0
    assert "new_release=false" in out.read_text()
    assert not body.exists()


def test_cli_unreachable_exits_nonzero_and_writes_nothing(monkeypatch, tmp_path):
    _patch_fetch(monkeypatch, exc=OSError("network down"))
    out = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    assert nrc.main([]) == 1
    assert not out.exists()


# --- issue text -------------------------------------------------------------

def test_issue_title_matches_contract():
    assert issue_title("2026-10-07") == "New CMS NDH release 2026-10-07 detected"


def test_issue_body_carries_the_checklist():
    body = issue_body(run(manifest("2026-10-07")))
    for needle in (
        "release_snapshot.py --release 2026-08-20",
        "fast_ingest_ndh.py",
        "analysis/release.py",
        "frontend/src/lib/release.ts",
        "databricks_publish.py",
        "build_stats.py",
        "build_manifest.py",
    ):
        assert needle in body
    assert body.count("- [ ]") == 5
