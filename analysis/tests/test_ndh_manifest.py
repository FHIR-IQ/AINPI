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
    ALL_NDH_RESOURCES,
    NDH_NEW_RESOURCES,
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


class TestManifestKeyFormats:
    """The 2026-08-20 release renumbered every manifest key and resolved
    nothing under the previous `startswith(f"{resource}_")` test. These pin
    all three key formats that have shipped, and the boundary that keeps
    Organization off the OrganizationAffiliation file."""

    NUMBERED = {
        "files": {
            "01-Organization.ndjson": {},
            "02-Location.ndjson": {},
            "03-Endpoint.ndjson": {},
            "04-HealthcareService.ndjson": {},
            "05-InsurancePlan.ndjson": {},
            "06-Practitioner.ndjson": {},
            "07-PractitionerRole.ndjson": {},
            "08-OrganizationAffiliation.ndjson": {},
        }
    }
    DATED = {
        "files": {
            "Organization_2026-05-07_2128.ndjson": {},
            "OrganizationAffiliation_2026-05-07_2128.ndjson": {},
            "Practitioner_2026-05-07_2128.ndjson": {},
        }
    }
    PLAIN = {"files": {"Organization.ndjson": {}, "OrganizationAffiliation.ndjson": {}}}

    @pytest.mark.parametrize(
        "resource,expected",
        [
            ("Organization", "01-Organization.ndjson.zst"),
            ("Location", "02-Location.ndjson.zst"),
            ("Endpoint", "03-Endpoint.ndjson.zst"),
            ("Practitioner", "06-Practitioner.ndjson.zst"),
            ("PractitionerRole", "07-PractitionerRole.ndjson.zst"),
            ("OrganizationAffiliation", "08-OrganizationAffiliation.ndjson.zst"),
        ],
    )
    def test_numbered_keys_resolve(self, resource, expected):
        _, basename = resolve_file_url(self.NUMBERED, resource)
        assert basename == expected

    def test_organization_does_not_match_organization_affiliation(self):
        """The whole-stem boundary. Without it Organization also matches the
        affiliation file and 1.09M affiliation rows land in the organization
        table, which would look like a plausible number rather than an error."""
        for manifest in (self.NUMBERED, self.DATED, self.PLAIN):
            _, basename = resolve_file_url(manifest, "Organization")
            assert "Affiliation" not in basename

    def test_dated_keys_still_resolve(self):
        """The pre-2026-08-20 format must keep working: archived releases are
        still fetched by date."""
        _, basename = resolve_file_url(self.DATED, "Practitioner")
        assert basename == "Practitioner_2026-05-07_2128.ndjson.zst"

    def test_plain_keys_resolve(self):
        _, basename = resolve_file_url(self.PLAIN, "Organization")
        assert basename == "Organization.ndjson.zst"

    def test_new_resources_are_discoverable_but_not_in_ingest_tuple(self):
        """They have no BigQuery tables yet, so folding them into
        NDH_RESOURCES would turn a discovery change into a failing load."""
        assert "InsurancePlan" in NDH_NEW_RESOURCES
        assert "HealthcareService" in NDH_NEW_RESOURCES
        assert "InsurancePlan" not in NDH_RESOURCES
        assert set(ALL_NDH_RESOURCES) == set(NDH_RESOURCES) | set(NDH_NEW_RESOURCES)


# Captured shape of manifest.json as of 2026-08-20, sizes included. The
# earlier numbered-key fixtures carry empty dicts as values, which is exactly
# why the size regression below went unnoticed: they exercised URL resolution
# and never asked the manifest how big anything was.
AUGUST_MANIFEST = {
    "compression_algorithm": "zstd",
    "generated_at": "2026-08-20",
    "files": {
        "01-Organization.ndjson": {"compressed_bytes": 691252617},
        "02-Location.ndjson": {"compressed_bytes": 207143532},
        "03-Endpoint.ndjson": {"compressed_bytes": 48688162},
        "04-HealthcareService.ndjson": {"compressed_bytes": 1178275},
        "05-InsurancePlan.ndjson": {"compressed_bytes": 10714},
        "06-Practitioner.ndjson": {"compressed_bytes": 915281059},
        "07-PractitionerRole.ndjson": {"compressed_bytes": 1348118031},
        "08-OrganizationAffiliation.ndjson": {"compressed_bytes": 18800000},
    },
    "totals": {"compressed_bytes": 3230465033},
}


class TestSizeLookupAcrossKeyFormats:
    """`expected_compressed_size` kept the old `startswith(f"{resource}_")`
    matcher when `resolve_file_url` was fixed for the 2026-08-20 key format.
    It therefore returned None for every file in that release, and the
    partial-download integrity check that consumes it silently stopped
    checking anything. Both functions now share one matcher."""

    def test_reads_size_from_numbered_keys(self):
        assert expected_compressed_size(AUGUST_MANIFEST, "Practitioner") == 915281059
        assert expected_compressed_size(AUGUST_MANIFEST, "PractitionerRole") == 1348118031

    def test_size_lookup_respects_the_affiliation_boundary(self):
        # Organization must not pick up OrganizationAffiliation's size.
        assert expected_compressed_size(AUGUST_MANIFEST, "Organization") == 691252617
        assert (
            expected_compressed_size(AUGUST_MANIFEST, "OrganizationAffiliation")
            == 18800000
        )

    def test_still_reads_the_dated_key_format(self):
        assert expected_compressed_size(SAMPLE_MANIFEST, "Practitioner") == 1023813987

    def test_every_resource_resolves_a_size_in_both_formats(self):
        # A size that comes back None is the failure mode this guards: it does
        # not raise, it just turns the integrity check into a no-op.
        for resource in NDH_RESOURCES:
            assert expected_compressed_size(AUGUST_MANIFEST, resource) is not None
            assert expected_compressed_size(SAMPLE_MANIFEST, resource) is not None


class TestReleaseDateFromManifest:
    """Since 2026-08-20 the filenames carry no date, so callers that ask the
    filename get "unknown" and write the release into cms-npd-unknown. The
    manifest's top-level generated_at is the authoritative date."""

    def test_reads_generated_at(self):
        assert parse_release_date(AUGUST_MANIFEST) == "2026-08-20"

    def test_falls_back_to_dated_filenames_in_manifest(self):
        assert parse_release_date(SAMPLE_MANIFEST) == "2026-05-07"

    def test_returns_empty_rather_than_raising_on_junk(self):
        assert parse_release_date({}) == ""
        assert parse_release_date({"files": {"06-Practitioner.ndjson": {}}}) == ""
