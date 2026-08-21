"""The NDH release this project's numbers are measured against.

Thirty-two analysis scripts hardcoded the release date as a string literal,
so every new release meant thirty-two edits and any one of them being missed
meant a finding quietly claiming the wrong provenance. This is the single
place it lives now.

`CURRENT_RELEASE` is a pinned constant rather than a live manifest read on
purpose. Findings must be reproducible: someone re-running a script six
months from now should get the release the finding was published against, not
whatever CMS is serving that day. Bump it deliberately when the warehouse is
reloaded, in the same commit as the reload.

`live_release()` is available for tools that genuinely want to know what CMS
is serving right now, such as a staleness check or a pre-ingest comparison.
It is never the default.
"""
from __future__ import annotations

# Bumped 2026-08-21 when the warehouse was reloaded from the 2026-08-20
# bulk export. Previous: 2026-05-08.
CURRENT_RELEASE = "2026-08-20"

# Releases this project has ingested, newest first. Kept so a delta can name
# its endpoints without a second source of truth.
KNOWN_RELEASES = ("2026-08-20", "2026-05-08", "2026-04-09")


def live_release() -> str:
    """What directory.cms.gov is serving right now. Not for findings."""
    from ndh_manifest import fetch_manifest, parse_release_date  # local import
    return parse_release_date(fetch_manifest())
