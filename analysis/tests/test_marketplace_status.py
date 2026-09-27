"""`--status` must describe every listing the provider owns, not only the spec.

The script manages one listing today, the release archive. A second listing
(for example an MCP server) may be created in the console first, before it has
a spec here. It has no share, and it may still be a draft, which the API marks
by omitting `status` entirely. The status report has to render that listing
honestly rather than as `share=None status=None`, and has to say it is not
managed by this script.
"""
from __future__ import annotations

import importlib.util
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent.parent
_spec = importlib.util.spec_from_file_location(
    "marketplace_publish", REPO / "analysis" / "marketplace_publish.py")
mp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mp)

PID = "1391b933-c642-420e-86a6-98c1283a4b57"

ARCHIVE = {
    "id": "6cf064b7-1fca-4a8f-addf-03ffd8bfdfd6",
    "summary": {
        "name": "CMS National Provider Directory: Release Archive",
        "listingType": "STANDARD",
        "provider_id": PID,
        "setting": {"visibility": "PUBLIC"},
        "share": {"name": "ainpi-ndh-archive", "type": "FULL"},
        "status": "PUBLISHED",
    },
    "detail": {"assets": ["ASSET_TYPE_DATA_TABLE", "ASSET_TYPE_NOTEBOOK"]},
}

# Shape of a console-created draft with no share: no `status` key at all.
MCP_DRAFT = {
    "id": "00000000-0000-0000-0000-000000000001",
    "summary": {
        "name": "AINPI MCP server",
        "listingType": "STANDARD",
        "provider_id": PID,
        "setting": {"visibility": "PUBLIC"},
    },
    "detail": {"assets": ["ASSET_TYPE_MCP"]},
}

SPEC_NAMES = {s["name"] for s in mp.LISTINGS}


def test_archive_row_matches_the_existing_output_fields():
    row = mp.listing_row(ARCHIVE, SPEC_NAMES)
    assert row["id"] == ARCHIVE["id"]
    assert row["name"] == "CMS National Provider Directory: Release Archive"
    assert row["status"] == "PUBLISHED"
    assert row["visibility"] == "PUBLIC"
    assert row["kind"] == "share=ainpi-ndh-archive"
    assert row["in_spec"] is True
    assert row["provider_id"] == PID
    assert row["published"] is True


def test_absent_status_reads_as_draft():
    row = mp.listing_row(MCP_DRAFT, SPEC_NAMES)
    assert row["status"] == "DRAFT (absent)"
    assert row["published"] is False


def test_listing_without_share_reports_its_assets():
    row = mp.listing_row(MCP_DRAFT, SPEC_NAMES)
    assert row["kind"] == "assets=ASSET_TYPE_MCP"


def test_listing_outside_the_spec_is_flagged_unmanaged():
    row = mp.listing_row(MCP_DRAFT, SPEC_NAMES)
    assert row["in_spec"] is False
    assert "not managed by this script" in mp.format_row(row)


def test_listing_with_neither_share_nor_assets_says_so():
    bare = {"id": "x", "summary": {"name": "bare"}, "detail": {}}
    row = mp.listing_row(bare, SPEC_NAMES)
    assert row["kind"] == "kind=unknown"
    assert row["visibility"] is None


def test_format_row_keeps_the_archive_line_shape():
    line = mp.format_row(mp.listing_row(ARCHIVE, SPEC_NAMES))
    assert line == ("    CMS National Provider Directory: Release Archive"
                    "  status=PUBLISHED  visibility=PUBLIC  share=ainpi-ndh-archive")


def test_owned_by_filters_to_our_provider_and_keeps_unknown_owner():
    other = {"id": "y", "summary": {"name": "other", "provider_id": "someone-else"}}
    no_owner = {"id": "z", "summary": {"name": "no owner"}}
    kept = mp.owned_by([ARCHIVE, MCP_DRAFT, other, no_owner], PID)
    assert [l["id"] for l in kept] == [ARCHIVE["id"], MCP_DRAFT["id"], "z"]
    # With no provider id resolved, nothing is filtered out.
    assert len(mp.owned_by([ARCHIVE, other], None)) == 2


def test_status_verdict_fails_only_on_a_published_listing_consumers_cannot_see():
    pub = mp.listing_row(ARCHIVE, SPEC_NAMES)
    draft = mp.listing_row(MCP_DRAFT, SPEC_NAMES)
    assert mp.status_ok([(pub, True), (draft, False)]) is True
    assert mp.status_ok([(pub, False), (draft, False)]) is False
    assert mp.status_ok([]) is True
