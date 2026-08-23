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

# The six resources this project ingests, in the order most pipelines
# process them (small → large).
NDH_RESOURCES = (
    "Endpoint",
    "Location",
    "OrganizationAffiliation",
    "Organization",
    "PractitionerRole",
    "Practitioner",
)

# Added by CMS in the 2026-08-20 release. Kept separate from NDH_RESOURCES on
# purpose: callers iterate that tuple to drive ingestion, and there are no
# BigQuery tables for these yet, so folding them in would turn a discovery
# change into a failing load. Resolvable by name today; promote them once the
# tables exist.
#
#   HealthcareService  54,445 rows, and nearly empty. 100% carry only a
#                      network-reference extension; 0.5% carry a location and
#                      exactly one carries providedBy. Network membership,
#                      not a service description.
#   InsurancePlan         233 Medicare Advantage plans across 27 owning
#                      organizations, each with an ownedBy reference.
NDH_NEW_RESOURCES = (
    "HealthcareService",
    "InsurancePlan",
)

ALL_NDH_RESOURCES = NDH_RESOURCES + NDH_NEW_RESOURCES


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


# Match the resource as a whole filename stem, allowing an optional ordering
# prefix and an optional dated suffix. Three forms have shipped:
#
#   Practitioner_2026-05-07_2128.ndjson   through 2026-05-08
#   06-Practitioner.ndjson                2026-08-20 onward
#   Practitioner.ndjson                   undated form
#
# The 2026-08-20 release renumbered every key and broke the previous
# `startswith(f"{resource}_")` test, which resolved nothing at all.
#
# The boundary after the resource name is load-bearing: without it
# "Organization" also matches "08-OrganizationAffiliation.ndjson" and the
# affiliation file gets loaded into the organization table. The old underscore
# test got that right by accident; this gets it right on purpose.
#
# This lives in ONE place because it already drifted once. `resolve_file_url`
# was fixed for the new key format and `expected_compressed_size` was not, so
# the size lookup returned None for every file in the 2026-08-20 release and
# the partial-download integrity check silently stopped checking anything.
def _matching_keys(files: dict[str, Any], resource: str) -> list[str]:
    """Manifest keys naming `resource`, sorted so the latest sorts last."""
    pattern = re.compile(
        rf"^(?:\d+-)?{re.escape(resource)}(?:_[^/]*)?\.ndjson(?:\.zst)?$"
    )
    return sorted(k for k in files if isinstance(k, str) and pattern.match(k))


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

    # Match the resource as a whole filename stem, allowing an optional
    # ordering prefix and an optional dated suffix. Three forms have shipped:
    #
    #   Practitioner_2026-05-07_2128.ndjson   through 2026-05-08
    #   06-Practitioner.ndjson                2026-08-20 onward
    #   Practitioner.ndjson                   undated form
    #
    # The 2026-08-20 release renumbered every key and broke the previous
    # `startswith(f"{resource}_")` test, which resolved nothing at all.
    #
    # The boundary after the resource name is load-bearing: without it
    # "Organization" also matches "08-OrganizationAffiliation.ndjson" and the
    # affiliation file gets loaded into the organization table. The old
    # underscore test got that right by accident; this gets it right on
    # purpose.
    candidates = _matching_keys(files, resource)

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


def parse_release_date(source: "str | dict[str, Any]") -> str:
    """Extract the YYYY-MM-DD release date from a manifest or a filename.

    Accepts either, because the two releases carry it in different places:

      2026-05-08 and earlier  the date is embedded in each filename, as
                              `Practitioner_2026-05-07_2128.ndjson`
      2026-08-20 onward       filenames are `06-Practitioner.ndjson` with no
                              date at all, and the manifest carries a
                              top-level `generated_at` instead

    Passing the manifest is preferred: one authoritative date for the release
    beats six filenames that could in principle disagree. Passing a filename
    still works so callers holding only a name keep functioning.

    Returns the date string, or empty string if unparseable. Callers treat
    empty as unknown rather than crashing, because a missing release label
    should not stop an ingest that is otherwise fine.
    """
    if isinstance(source, dict):
        generated = source.get("generated_at") or ""
        m = re.search(r"(\d{4}-\d{2}-\d{2})", str(generated))
        if m:
            return m.group(1)
        # Fall back to any dated filename still present in the manifest.
        for key in source.get("files", {}):
            m = re.search(r"_(\d{4}-\d{2}-\d{2})_", str(key))
            if m:
                return m.group(1)
        return ""
    m = re.search(r"_(\d{4}-\d{2}-\d{2})_", source)
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
    if not isinstance(files, dict):
        return None
    for key in reversed(_matching_keys(files, resource)):
        entry = files.get(key)
        if isinstance(entry, dict):
            n = entry.get("compressed_bytes")
            if isinstance(n, int) and n > 0:
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
            date = parse_release_date(manifest) or parse_release_date(basename) or "?"
            sz = expected_compressed_size(manifest, resource)
            sz_str = f"{sz / 1e6:>8.1f} MB" if sz else "      ? MB"
            print(f"  {resource:25s} release={date}  {sz_str}  {basename}")
        except RuntimeError as e:
            print(f"  {resource:25s} ERROR: {e}", file=sys.stderr)
