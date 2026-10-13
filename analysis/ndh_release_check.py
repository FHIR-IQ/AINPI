"""Detect a new CMS NDH release by comparing the live manifest to the pinned one.

Not to be confused with `release_watch.py`, which watches for *fields* a later
release may add (payer PIN, birthDate precision) inside the H49 and H27 scans.
This module answers a different question: has CMS published a release newer
than the one the warehouse holds?

CMS serves only the current export, and every prior release disappears when a
new one lands. A release nobody noticed is a release whose snapshot was never
taken, so this runs daily from `.github/workflows/ndh-release-watch.yml`.

There are four outcomes, and only two of them exit zero:

    current   manifest `generated_at` == CURRENT_RELEASE     exit 0
    new       manifest `generated_at` >  CURRENT_RELEASE     exit 0, outputs set
    older     manifest `generated_at` <  CURRENT_RELEASE     exit 1
    error     manifest unreachable, not JSON, or malformed   exit 1

The error path is the point. `parse_release_date()` returns "" on failure by
contract, and "" sorts before every date, so routing through it would let a
broken fetch read as "nothing new". This module requires `generated_at` to be
a real ISO date and requires every ingested resource to resolve, so a manifest
the ingest would choke on (the 2026-08-20 key rename, for one) fails the job
rather than passing as current.

Usage:

    python3 analysis/ndh_release_check.py
    python3 analysis/ndh_release_check.py --issue-body-file /tmp/body.md

Under GitHub Actions it also writes `status`, `new_release` and
`release_date` to $GITHUB_OUTPUT.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ndh_manifest import MANIFEST_URL, fetch_manifest, resolve_all_files  # noqa: E402
from release import CURRENT_RELEASE  # noqa: E402


class ReleaseCheckError(RuntimeError):
    """The manifest could not be read or does not look like an NDH manifest."""


@dataclass(frozen=True)
class ReleaseStatus:
    status: str  # "current" or "new"
    live_release: str
    current_release: str

    @property
    def is_new(self) -> bool:
        return self.status == "new"


def _parse_iso_date(value: Any, what: str) -> dt.date:
    if not isinstance(value, str) or not value:
        raise ReleaseCheckError(f"{what} is missing or not a string: {value!r}")
    try:
        # Accept "2026-10-07" and "2026-10-07T12:00:00Z"; the date is the release.
        return dt.date.fromisoformat(value[:10])
    except ValueError as e:
        raise ReleaseCheckError(f"{what} is not an ISO date: {value!r}") from e


def live_release_date(manifest: Any) -> dt.date:
    """Validate the manifest and return its `generated_at` date.

    Raises ReleaseCheckError on any shape the ingest could not use.
    """
    if not isinstance(manifest, dict):
        raise ReleaseCheckError(
            f"manifest is a {type(manifest).__name__}, expected a JSON object"
        )
    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise ReleaseCheckError("manifest.files is missing, empty or not an object")
    try:
        resolve_all_files(manifest)
    except (RuntimeError, ValueError, KeyError, TypeError, AttributeError) as e:
        raise ReleaseCheckError(
            f"manifest does not resolve every ingested resource: {e}"
        ) from e
    return _parse_iso_date(manifest.get("generated_at"), "manifest.generated_at")


def check_release(
    fetch: Callable[[], Any] | None = None,
    current: str | None = None,
) -> ReleaseStatus:
    """Compare the live manifest's release date to the pinned release.

    Returns status "current" or "new". Raises ReleaseCheckError when the
    manifest is unreachable or malformed, or when it is older than the pinned
    release (CMS rolling back, or a stale cache, is not "nothing new").
    """
    # Looked up at call time so tests can patch the module attributes.
    fetch = fetch or fetch_manifest
    current = current or CURRENT_RELEASE
    try:
        manifest = fetch()
    except ReleaseCheckError:
        raise
    except Exception as e:  # noqa: BLE001 — every fetch failure must fail loudly
        raise ReleaseCheckError(
            f"could not fetch {MANIFEST_URL}: {type(e).__name__}: {e}"
        ) from e

    live = live_release_date(manifest)
    pinned = _parse_iso_date(current, "CURRENT_RELEASE")

    if live < pinned:
        raise ReleaseCheckError(
            f"manifest generated_at {live.isoformat()} is older than "
            f"CURRENT_RELEASE {pinned.isoformat()}; check the source before trusting it"
        )
    status = "new" if live > pinned else "current"
    return ReleaseStatus(status, live.isoformat(), pinned.isoformat())


def issue_title(live_release: str) -> str:
    return f"New CMS NDH release {live_release} detected"


def issue_body(status: ReleaseStatus) -> str:
    live, outgoing = status.live_release, status.current_release
    return f"""\
The NDH manifest at {MANIFEST_URL} reports `generated_at: {live}`. The warehouse is pinned to `{outgoing}` (`analysis/release.py`).

CMS serves only the current export, so the outgoing release must be snapshotted before anything is reloaded.

- [ ] Snapshot the outgoing release: `python3 analysis/release_snapshot.py --release {outgoing}`
- [ ] Ingest the new release: `python3 analysis/fast_ingest_ndh.py` (check `--print-manifest-only` first; key formats have changed between releases before)
- [ ] Bump `CURRENT_RELEASE` and `KNOWN_RELEASES` in `analysis/release.py` and `frontend/src/lib/release.ts` together, in the same commit as the reload (`frontend/tests/lib/release.test.ts` asserts they match)
- [ ] Load the new release as a partition of the Databricks archive (`analysis/databricks_publish.py`)
- [ ] Recompute the measures: weekly-refresh finding scripts, then `analysis/build_stats.py`, then `analysis/build_manifest.py`

Opened by `.github/workflows/ndh-release-watch.yml`.
"""


def _write_github_output(path: str, values: dict[str, str]) -> None:
    with open(path, "a", encoding="utf-8") as fh:
        for k, v in values.items():
            fh.write(f"{k}={v}\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--issue-body-file", help="write the issue body here on a new release")
    args = ap.parse_args(argv)

    try:
        status = check_release()
    except ReleaseCheckError as e:
        print(f"::error::NDH release check failed: {e}", file=sys.stderr)
        return 1

    print(
        f"status={status.status} live={status.live_release} "
        f"current={status.current_release}"
    )
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        _write_github_output(gh_out, {
            "status": status.status,
            "new_release": "true" if status.is_new else "false",
            "release_date": status.live_release,
            "issue_title": issue_title(status.live_release),
        })
    if status.is_new and args.issue_body_file:
        Path(args.issue_body_file).write_text(issue_body(status), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
