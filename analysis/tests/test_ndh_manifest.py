"""Tests for analysis/ndh_manifest.py — pure-function parsing only.

Network-dependent paths (fetch_manifest) are not covered here. To verify
those run `python analysis/fast_ingest_ndh.py --print-manifest-only`
against the live CMS endpoint.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# analysis/ isn't a package; sys.path injection so the test can import.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ndh_manifest import (  # noqa: E402
    NDH_RESOURCES,
    expected_compressed_size,
    parse_release_date,
    resolve_all_files,
    resolve_file_url,
)


# Captured shape of manifest.json as of 2026-06-05.
SAMPLE_MANIFEST = {
    "compression_algorithm": "zstd",
    "compression_level": 12,
    "files": {
        "Endpoint_2026-05-07_2128.ndjson": {
            "compressed_bytes": 53865376,
            "compression_ratio_pct": 95.15,
            "original_bytes": 1109710271,
        },
        "Location_2026-05-07_2128.ndjson": {
            "compressed_bytes": 86899120,
            "compression_ratio_pct": 87.34,
            "original_bytes": 686658605,
        },
        "OrganizationAffiliation_2026-05-07_2128.ndjson": {
            "compressed_bytes": 38479658,
            "compression_ratio_pct": 90.04,
            "original_bytes": 386506213,
        },
        "Organization_2026-05-07_2128.ndjson": {
            "compressed_bytes": 469767088,
            "compression_ratio_pct": 93.92,
            "original_bytes": 7728005472,
        },
        "PractitionerRole_2026-05-07_2128.ndjson": {
            "compressed_bytes": 566386875,
            "compression_ratio_pct": 90.42,
            "original_bytes": 5912611754,
        },
        "Practitioner_2026-05-07_2128.ndjson": {
            "compressed_bytes": 1023813987,
            "compression_ratio_pct": 94.7,
            "original_bytes": 19302942125,
        },
    },
}


class TestResolveFileUrl:
    def test_resolves_dated_filename_with_zst_appended(self):
        url, basename = resolve_file_url(SAMPLE_MANIFEST, "Practitioner")
        assert basename == "Practitioner_2026-05-07_2128.ndjson.zst"
        assert url == (
            "https://directory.cms.gov/downloads/"
            "Practitioner_2026-05-07_2128.ndjson.zst"
        )

    def test_all_six_resources_resolve(self):
        for resource in NDH_RESOURCES:
            url, basename = resolve_file_url(SAMPLE_MANIFEST, resource)
            assert resource in basename
            assert basename.endswith(".ndjson.zst")
            assert url.startswith("https://directory.cms.gov/downloads/")

    def test_unknown_resource_raises(self):
        with pytest.raises(ValueError, match="unknown NDH resource"):
            resolve_file_url(SAMPLE_MANIFEST, "Patient")

    def test_no_matching_entry_raises(self):
        empty = {"files": {"Practitioner_2026-05-07.ndjson": {}}}
        with pytest.raises(RuntimeError, match="no manifest entry for Endpoint"):
            resolve_file_url(empty, "Endpoint")

    def test_picks_latest_when_multiple_releases(self):
        """If the manifest carries multiple releases for the same resource,
        pick the lexicographically latest (dates sort chronologically)."""
        manifest = {
            "files": {
                "Practitioner_2026-04-09_1200.ndjson": {"compressed_bytes": 1},
                "Practitioner_2026-05-07_2128.ndjson": {"compressed_bytes": 2},
            }
        }
        _, basename = resolve_file_url(manifest, "Practitioner")
        assert "2026-05-07" in basename

    def test_forward_compat_url_field_on_entry(self):
        """When Fred's filed fix lands and entries carry `url` directly,
        we should use it verbatim rather than reconstruct."""
        manifest = {
            "files": {
                "Practitioner_2026-05-07_2128.ndjson.zst": {
                    "url": "https://example.com/some/other/path.ndjson.zst",
                    "compressed_bytes": 1,
                }
            }
        }
        url, basename = resolve_file_url(manifest, "Practitioner")
        assert url == "https://example.com/some/other/path.ndjson.zst"
        assert basename == "path.ndjson.zst"


class TestParseReleaseDate:
    def test_parses_standard_filename(self):
        assert parse_release_date("Practitioner_2026-05-07_2128.ndjson.zst") == "2026-05-07"

    def test_parses_without_extension(self):
        assert parse_release_date("Practitioner_2026-05-07_2128.ndjson") == "2026-05-07"

    def test_returns_empty_when_no_date(self):
        assert parse_release_date("manifest.json") == ""
        assert parse_release_date("Practitioner.ndjson.zst") == ""


class TestExpectedCompressedSize:
    def test_returns_declared_size(self):
        assert expected_compressed_size(SAMPLE_MANIFEST, "Practitioner") == 1023813987

    def test_returns_none_for_unknown_resource(self):
        # NB: this passes a resource name that's NOT in the manifest.
        # The helper is intentionally permissive — it doesn't raise.
        assert expected_compressed_size({"files": {}}, "Practitioner") is None

    def test_returns_none_when_size_field_missing(self):
        manifest = {"files": {"Practitioner_2026-05-07.ndjson": {}}}
        assert expected_compressed_size(manifest, "Practitioner") is None


class TestResolveAllFiles:
    def test_returns_url_per_resource(self):
        urls = resolve_all_files(SAMPLE_MANIFEST)
        assert set(urls.keys()) == set(NDH_RESOURCES)
        for url in urls.values():
            assert url.startswith("https://directory.cms.gov/downloads/")
            assert url.endswith(".ndjson.zst")
