"""Fetch the NDH bulk-export manifest and derive download URLs.

The manifest at https://directory.cms.gov/downloads/manifest.json is the
stable contract: download it on a poll cadence (e.g. daily), compare to
your previous snapshot, and only run the full ingest when its contents
change. Per Fred Trotter (CMS NDH team, 2026-06-05 Slack thread on the
CMS Health Tech Ecosystem): "the goal is to ensure that you do not need
to download a 5GB file to know that the 5GB needs to be re-downloaded."

Current manifest shape (2026-06-05):

    {
      "compression_algorithm": "zstd",
      "compression_level": 12,
      "files": {
        "Practitioner_2026-05-07_2128.ndjson": {
          "compressed_bytes": 1023813987,
          "compression_ratio_pct": 94.7,
          "original_bytes": 19302942125
        },
        ...
      },
      "totals": {...}
    }

Today the keys omit the `.zst` extension; Fred has filed a fix to add
the resolvable URLs directly inside the manifest entries. This module
handles either shape — if a `url` field appears on the entry, it wins;
otherwise we derive the URL by appending `.zst` to the key.

Usage:

    from analysis.ndh_manifest import fetch_manifest, resolve_file_url

    manifest = fetch_manifest()
    url, basename = resolve_file_url(manifest, 'Practitioner')
    # url = 'https://directory.cms.gov/downloads/Practitioner_2026-05-07_2128.ndjson.zst'

Run this module directly to print resolved URLs for all six resources:

    python analysis/ndh_manifest.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.request
from typing import Any

MANIFEST_URL = "https://directory.cms.gov/downloads/manifest.json"
DOWNLOADS_BASE = "https://directory.cms.gov/downloads"

# The six resources in the NDH bulk export, in the order most pipelines
# process them (small → large).
NDH_RESOURCES = (
    "Endpoint",
    "Location",
    "OrganizationAffiliation",
    "Organization",
    "PractitionerRole",
    "Practitioner",
)


def fetch_manifest(timeout: float = 30.0) -> dict[str, Any]:
    """Fetch and parse the NDH manifest.json.

    Uses curl rather than urllib because the manifest is served via S3
    presigned redirect that some Python TLS stacks mis-handle, and curl
    is on every dev box + GitHub Actions runner. Falls back to urllib if
    curl is unavailable (CI sandboxes, etc).
    """
    try:
        out = subprocess.run(
            ["curl", "-sSL", "--max-time", str(int(timeout)), MANIFEST_URL],
            check=True,
            capture_output=True,
            text=True,
        )
        body = out.stdout
    except FileNotFoundError:
        with urllib.request.urlopen(MANIFEST_URL, timeout=timeout) as resp:  # noqa: S310 — manifest URL is a CMS constant
            body = resp.read().decode("utf-8")

    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"manifest at {MANIFEST_URL} returned non-JSON ({len(body)} bytes): {body[:200]!r}"
        ) from e


def resolve_file_url(manifest: dict[str, Any], resource: str) -> tuple[str, str]:
    """Return (download_url, basename_with_extension) for an NDH resource.

    Picks the manifest entry whose key starts with `<resource>_`. If a
    future manifest schema exposes a `url` field on the entry directly,
    that wins (forward-compat for Fred's filed fix).

    Raises ValueError on unknown resource name, RuntimeError if no
    manifest entry resolves.
    """
    if resource not in NDH_RESOURCES:
        raise ValueError(
            f"unknown NDH resource: {resource!r}. "
            f"Expected one of {NDH_RESOURCES}."
        )

    files = manifest.get("files", {})
    if not isinstance(files, dict):
        raise RuntimeError(
            f"manifest.files is not a dict ({type(files).__name__}); manifest schema may have changed"
        )

    candidates = [
        k for k in files
        if isinstance(k, str)
        and k.startswith(f"{resource}_")
        and (k.endswith(".ndjson") or k.endswith(".ndjson.zst"))
    ]

    if not candidates:
        # Forward-compat: maybe Fred's fix puts the URL on a top-level
        # resource key directly.
        if resource in files and isinstance(files[resource], dict):
            entry = files[resource]
            if "url" in entry:
                return entry["url"], entry["url"].rsplit("/", 1)[-1]
        raise RuntimeError(
            f"no manifest entry for {resource}; "
            f"available keys = {sorted(files.keys())}"
        )

    # In practice the manifest carries exactly one file per resource per
    # release, but if multiple turn up pick the lexicographically latest
    # (filenames embed dates, so this sorts chronologically).
    candidates.sort()
    key = candidates[-1]

    entry = files[key]

    # Forward-compat: if the entry carries a `url` directly, use it.
    if isinstance(entry, dict) and "url" in entry:
        return entry["url"], entry["url"].rsplit("/", 1)[-1]

    # Today the keys omit `.zst`; append it for the download URL.
    basename = key if key.endswith(".zst") else f"{key}.zst"
    url = f"{DOWNLOADS_BASE}/{basename}"
    return url, basename


def parse_release_date(filename: str) -> str:
    """Extract the YYYY-MM-DD release date from a manifest filename.

    Filenames look like `Practitioner_2026-05-07_2128.ndjson(.zst)`.
    Returns the captured date string or empty string if unparseable.
    """
    m = re.search(r"_(\d{4}-\d{2}-\d{2})_", filename)
    return m.group(1) if m else ""


def resolve_all_files(manifest: dict[str, Any]) -> dict[str, str]:
    """Return {resource: download_url} for all 6 NDH resources."""
    return {r: resolve_file_url(manifest, r)[0] for r in NDH_RESOURCES}


def expected_compressed_size(manifest: dict[str, Any], resource: str) -> int | None:
    """Return the manifest-declared compressed_bytes for a resource, or None.

    Used by callers to integrity-check the downloaded file size matches
    what the manifest promised — cheap defense against partial downloads.
    """
    files = manifest.get("files", {})
    for key, entry in files.items():
        if isinstance(key, str) and key.startswith(f"{resource}_") and isinstance(entry, dict):
            n = entry.get("compressed_bytes")
            if isinstance(n, int):
                return n
    return None


if __name__ == "__main__":
    # Quick-check: print resolved URLs + sizes + release date for all six.
    manifest = fetch_manifest()
    print(f"manifest fetched OK ({len(manifest.get('files', {}))} files)")
    print(f"compression: {manifest.get('compression_algorithm', '?')}@{manifest.get('compression_level', '?')}")
    print()
    for resource in NDH_RESOURCES:
        try:
            url, basename = resolve_file_url(manifest, resource)
            date = parse_release_date(basename) or "?"
            sz = expected_compressed_size(manifest, resource)
            sz_str = f"{sz / 1e6:>8.1f} MB" if sz else "      ? MB"
            print(f"  {resource:25s} release={date}  {sz_str}  {basename}")
        except RuntimeError as e:
            print(f"  {resource:25s} ERROR: {e}", file=sys.stderr)
