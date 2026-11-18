"""Copy every file CMS is serving for the current NDH release into the archive volume.

CMS serves only the latest bulk export, and it now publishes about weekly
(2026-10-07, 10-14, 10-28, 11-01, 11-03). Three of those were gone before
anyone downloaded them, because the only copy was taken by hand when the
warehouse was reloaded. This runs daily from `ndh-release-watch.yml` and keeps
the raw `.ndjson.zst` files, unchanged, so any release can be ingested later.

What it writes, per release:

    /Volumes/workspace/ainpi/staging/raw/release_date=<date>/manifest.json
    /Volumes/workspace/ainpi/staging/raw/release_date=<date>/<key>.zst

Every file the manifest lists is archived, not only the six the warehouse
ingests, because a file nobody kept cannot be ingested later.

Idempotent: a file whose remote size already equals the manifest's
`compressed_bytes` is skipped, so the daily run costs one directory listing
when nothing is new. A downloaded file whose size differs from the manifest
fails the run before anything is uploaded; a truncated download must never
replace a good copy. The manifest itself is uploaded last, so its presence
means every data file for that release arrived.

Cost: storage only (about 2.4 GB per release in Databricks-managed storage).
No SQL warehouse runs. Uploads are ingress.

Usage:

    python3 analysis/ndh_raw_archive.py              # archive what CMS serves now
    python3 analysis/ndh_raw_archive.py --dry-run    # print the plan, change nothing

Needs the Databricks CLI on PATH, authenticated (DATABRICKS_HOST and
DATABRICKS_TOKEN in CI, a profile locally).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ndh_manifest import MANIFEST_URL, fetch_manifest  # noqa: E402
from ndh_release_check import ReleaseCheckError, live_release_date  # noqa: E402

ARCHIVE_ROOT = "/Volumes/workspace/ainpi/staging/raw"
DOWNLOAD_BASE = MANIFEST_URL.rsplit("/", 1)[0]


class ArchiveError(RuntimeError):
    """A file could not be archived intact."""


@dataclass(frozen=True)
class ArchiveFile:
    key: str          # manifest key, e.g. "06-Practitioner.ndjson"
    url: str          # download URL
    size: int         # manifest compressed_bytes
    dest: str         # volume path


def release_dir(release: str) -> str:
    return f"{ARCHIVE_ROOT}/release_date={release}"


def plan(manifest: dict[str, Any]) -> tuple[str, list[ArchiveFile]]:
    """Return (release, files) for every file the manifest lists.

    Raises ArchiveError when the manifest is unusable or a file entry has no
    positive integer `compressed_bytes`, since the size is the only integrity
    check there is.
    """
    try:
        release = live_release_date(manifest).isoformat()
    except ReleaseCheckError as e:
        raise ArchiveError(str(e)) from e
    files = manifest["files"]
    out: list[ArchiveFile] = []
    for key in sorted(files):
        entry = files[key]
        size = entry.get("compressed_bytes") if isinstance(entry, dict) else None
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            raise ArchiveError(f"manifest entry {key!r} has no usable compressed_bytes: {size!r}")
        if "/" in key or key.startswith("."):
            raise ArchiveError(f"manifest key {key!r} is not a plain file name")
        name = f"{key}.zst"
        out.append(ArchiveFile(key, f"{DOWNLOAD_BASE}/{name}", size, f"{release_dir(release)}/{name}"))
    return release, out


def pending(files: list[ArchiveFile], remote_sizes: dict[str, int]) -> list[ArchiveFile]:
    """Files whose remote copy is missing or a different size from the manifest."""
    return [f for f in files if remote_sizes.get(f.dest.rsplit("/", 1)[1]) != f.size]


def check_size(path: Path, expected: int) -> None:
    actual = path.stat().st_size
    if actual != expected:
        raise ArchiveError(f"{path.name}: downloaded {actual:,} bytes, manifest says {expected:,}")


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def remote_sizes(release: str, run: Callable = _run) -> dict[str, int]:
    """name -> size for files already in the release's archive directory.

    A missing directory is an empty archive. Any other listing failure raises,
    so an auth or network error never reads as "nothing archived yet" and
    triggers a full re-upload, or as "all archived" and skips one.
    """
    r = run(["databricks", "fs", "ls", f"dbfs:{release_dir(release)}", "--long", "--output", "json"])
    if r.returncode != 0:
        msg = (r.stderr or r.stdout or "").strip()
        # The CLI words a missing directory as "no such directory" (v1.26);
        # older messages said "not found" or "does not exist".
        if any(m in msg.lower() for m in ("no such directory", "no such file", "not found", "does not exist")):
            return {}
        raise ArchiveError(f"could not list {release_dir(release)}: {msg[:300]}")
    try:
        entries = json.loads(r.stdout or "[]")
    except json.JSONDecodeError as e:
        raise ArchiveError(f"listing was not JSON: {(r.stdout or '')[:200]!r}") from e
    sizes: dict[str, int] = {}
    for e in entries if isinstance(entries, list) else []:
        name = (e.get("name") or e.get("path") or "").rstrip("/").rsplit("/", 1)[-1]
        if name and isinstance(e.get("file_size"), int):
            sizes[name] = e["file_size"]
    return sizes


def archive(manifest: dict[str, Any], workdir: Path, dry_run: bool = False, run: Callable = _run) -> int:
    release, files = plan(manifest)
    remote = remote_sizes(release, run)
    todo = pending(files, remote)
    # A run that died after the last data file but before the manifest leaves
    # nothing pending except the manifest, so check it separately.
    need_manifest = bool(todo) or "manifest.json" not in remote
    print(f"release {release}: {len(files)} files listed, {len(todo)} to archive"
          + (", manifest missing" if need_manifest and not todo else ""))
    for f in todo:
        print(f"  {f.key}: {f.size/1e6:,.1f} MB -> {f.dest}")
    if dry_run or not need_manifest:
        return len(todo)

    run(["databricks", "fs", "mkdir", f"dbfs:{release_dir(release)}"])
    for f in todo:
        local = workdir / f.dest.rsplit("/", 1)[1]
        r = run(["curl", "-sSfL", "--retry", "3", "--retry-delay", "10",
                 "--max-time", "3600", "-o", str(local), "--", f.url])
        if r.returncode != 0:
            raise ArchiveError(f"download failed for {f.key}: {(r.stderr or '').strip()[:300]}")
        check_size(local, f.size)
        r = run(["databricks", "fs", "cp", "--overwrite", str(local), f"dbfs:{f.dest}"])
        if r.returncode != 0:
            raise ArchiveError(f"upload failed for {f.key}: {(r.stderr or '').strip()[:300]}")
        local.unlink()
        print(f"  archived {f.key}")

    # Manifest last: its presence means every data file above arrived.
    mpath = workdir / "manifest.json"
    mpath.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    r = run(["databricks", "fs", "cp", "--overwrite", str(mpath), f"dbfs:{release_dir(release)}/manifest.json"])
    if r.returncode != 0:
        raise ArchiveError(f"manifest upload failed: {(r.stderr or '').strip()[:300]}")
    return len(todo)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--dry-run", action="store_true", help="print the plan; download and upload nothing")
    args = ap.parse_args(argv)
    try:
        manifest = fetch_manifest()
        with tempfile.TemporaryDirectory(dir=os.environ.get("RUNNER_TEMP")) as tmp:
            archive(manifest, Path(tmp), dry_run=args.dry_run)
    except (ArchiveError, RuntimeError) as e:
        print(f"::error::NDH raw archive failed: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
