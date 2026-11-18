"""Offline tests for analysis/ndh_raw_archive.py. No network, no Databricks."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import ndh_raw_archive as ra  # noqa: E402

KEYS = {
    "01-Organization.ndjson": 300,
    "02-Location.ndjson": 200,
    "03-Endpoint.ndjson": 50,
    "04-HealthcareService.ndjson": 10,
    "05-InsurancePlan.ndjson": 5,
    "06-Practitioner.ndjson": 800,
    "07-PractitionerRole.ndjson": 900,
    "08-OrganizationAffiliation.ndjson": 20,
}


def manifest(**over):
    m = {"generated_at": "2026-11-03",
         "files": {k: {"compressed_bytes": v} for k, v in KEYS.items()}}
    m.update(over)
    return m


def test_plan_lists_every_file_including_non_ingested():
    release, files = ra.plan(manifest())
    assert release == "2026-11-03"
    assert len(files) == 8
    hs = next(f for f in files if f.key == "04-HealthcareService.ndjson")
    assert hs.url == "https://directory.cms.gov/downloads/04-HealthcareService.ndjson.zst"
    assert hs.dest == "/Volumes/workspace/ainpi/staging/raw/release_date=2026-11-03/04-HealthcareService.ndjson.zst"
    assert hs.size == 10


@pytest.mark.parametrize("bad", [None, 0, -1, "300", True, 1.5])
def test_plan_rejects_unusable_size(bad):
    m = manifest()
    m["files"]["03-Endpoint.ndjson"] = {"compressed_bytes": bad}
    with pytest.raises(ra.ArchiveError):
        ra.plan(m)


@pytest.mark.parametrize("key", ["../evil.ndjson", "a/b.ndjson", ".hidden"])
def test_plan_rejects_path_like_keys(key):
    m = manifest()
    m["files"][key] = {"compressed_bytes": 5}
    with pytest.raises(ra.ArchiveError):
        ra.plan(m)


def test_plan_rejects_bad_release_date():
    with pytest.raises(ra.ArchiveError):
        ra.plan(manifest(generated_at="not-a-date"))


def test_pending_skips_exact_size_matches_only():
    _, files = ra.plan(manifest())
    remote = {"01-Organization.ndjson.zst": 300, "02-Location.ndjson.zst": 199}
    names = {f.key for f in ra.pending(files, remote)}
    assert "01-Organization.ndjson" not in names
    assert "02-Location.ndjson" in names  # truncated remote copy is redone
    assert len(names) == 7


def test_check_size(tmp_path):
    p = tmp_path / "x.zst"
    p.write_bytes(b"abc")
    ra.check_size(p, 3)
    with pytest.raises(ra.ArchiveError):
        ra.check_size(p, 4)


def cp(rc=0, out="", err=""):
    return subprocess.CompletedProcess([], rc, out, err)


@pytest.mark.parametrize("err", [
    # Verbatim from Databricks CLI v1.26.0 against a missing volume directory.
    "Error: no such directory: /Volumes/workspace/ainpi/staging/raw/release_date=2026-11-03",
    "Error: Resource not found",
    "Error: path does not exist",
])
def test_remote_sizes_missing_dir_is_empty(err):
    run = lambda cmd: cp(1, err=err)  # noqa: E731
    assert ra.remote_sizes("2026-11-03", run) == {}


def test_remote_sizes_other_failure_raises():
    run = lambda cmd: cp(1, err="Error: invalid access token")  # noqa: E731
    with pytest.raises(ra.ArchiveError):
        ra.remote_sizes("2026-11-03", run)


def test_remote_sizes_parses_listing():
    listing = [{"name": "03-Endpoint.ndjson.zst", "file_size": 50},
               {"path": "dbfs:/Volumes/x/manifest.json", "file_size": 9}]
    run = lambda cmd: cp(0, out=json.dumps(listing))  # noqa: E731
    assert ra.remote_sizes("2026-11-03", run) == {"03-Endpoint.ndjson.zst": 50, "manifest.json": 9}


class FakeRunner:
    """Records commands; curl writes a file of the size named in the fake manifest."""

    def __init__(self, listing, short=None):
        self.listing, self.short, self.cmds = listing, short, []

    def __call__(self, cmd):
        self.cmds.append(cmd)
        if cmd[:3] == ["databricks", "fs", "ls"]:
            return cp(0, out=json.dumps(self.listing))
        if cmd[0] == "curl":
            out = Path(cmd[cmd.index("-o") + 1])
            key = cmd[-1].rsplit("/", 1)[1][: -len(".zst")]
            n = KEYS[key] - (1 if key == self.short else 0)
            out.write_bytes(b"x" * n)
        return cp(0)


def uploads(runner):
    return [c[-1].rsplit("/", 1)[1] for c in runner.cmds if c[:3] == ["databricks", "fs", "cp"]]


def test_archive_uploads_missing_files_then_manifest_last(tmp_path):
    have = [{"name": f"{k}.zst", "file_size": v} for k, v in KEYS.items() if k != "03-Endpoint.ndjson"]
    r = FakeRunner(have)
    assert ra.archive(manifest(), tmp_path, run=r) == 1
    assert uploads(r) == ["03-Endpoint.ndjson.zst", "manifest.json"]
    assert not (tmp_path / "03-Endpoint.ndjson.zst").exists()  # local copy removed


def test_archive_nothing_to_do(tmp_path):
    have = [{"name": f"{k}.zst", "file_size": v} for k, v in KEYS.items()]
    have.append({"name": "manifest.json", "file_size": 100})
    r = FakeRunner(have)
    assert ra.archive(manifest(), tmp_path, run=r) == 0
    assert uploads(r) == []
    assert not any(c[0] == "curl" for c in r.cmds)


def test_archive_uploads_manifest_when_only_it_is_missing(tmp_path):
    have = [{"name": f"{k}.zst", "file_size": v} for k, v in KEYS.items()]
    r = FakeRunner(have)
    ra.archive(manifest(), tmp_path, run=r)
    assert uploads(r) == ["manifest.json"]


def test_archive_short_download_fails_before_upload(tmp_path):
    r = FakeRunner([], short="01-Organization.ndjson")
    with pytest.raises(ra.ArchiveError, match="manifest says"):
        ra.archive(manifest(), tmp_path, run=r)
    assert uploads(r) == []


def test_dry_run_changes_nothing(tmp_path):
    r = FakeRunner([])
    assert ra.archive(manifest(), tmp_path, dry_run=True, run=r) == 8
    assert [c[:3] for c in r.cmds] == [["databricks", "fs", "ls"]]


def test_curl_url_follows_double_dash():
    r = FakeRunner([])
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        ra.archive(manifest(), Path(d), run=r)
    curl = next(c for c in r.cmds if c[0] == "curl")
    assert curl[-2] == "--" and curl[-1].startswith("https://directory.cms.gov/downloads/")
