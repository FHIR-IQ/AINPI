"""The listing copy in the script must match docs/marketplace-listings.md.

The script's docstring promised this test before the test existed. Two copies of
the same paragraph in two files drift the moment one of them is edited, and the
one a consumer reads is the one in the script.

Also pins the two API limits that were learned by hitting them: the 120-character
subtitle cap, which the API enforces, and the category enum, which it does not.
"""
from __future__ import annotations

import importlib.util
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent.parent
DOC = REPO / "docs" / "marketplace-listings.md"

_spec = importlib.util.spec_from_file_location(
    "marketplace_publish", REPO / "analysis" / "marketplace_publish.py")
mp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mp)


def _flat(text: str) -> str:
    """Collapse whitespace so a wrapped markdown line matches an unwrapped one."""
    return re.sub(r"\s+", " ", text).strip()


def test_subtitle_matches_the_doc():
    doc = _flat(DOC.read_text())
    for spec in mp.LISTINGS:
        assert _flat(spec["subtitle"]) in doc


def test_subtitle_fits_the_api_cap():
    # Measured: create fails with "exceeds 120 characters". A 144-character
    # draft was rejected outright.
    for spec in mp.LISTINGS:
        assert len(spec["subtitle"]) <= 120, spec["name"]


def test_categories_are_real_enum_members():
    # Enumerated from the live consumer listings. An unknown value is dropped
    # silently by the API, so a typo here costs the listing its audience with
    # no error anywhere. HEALTH_AND_LIFE_SCIENCES is the one that already did.
    known = {
        "ADVERTISING_AND_MARKETING", "CLIMATE_AND_ENVIRONMENT", "COMMERCE",
        "DEMOGRAPHICS", "ECONOMICS", "EDUCATION", "ENERGY", "FINANCIAL",
        "GAMING", "GEOSPATIAL", "HEALTH", "LOOKUP_TABLES", "MANUFACTURING",
        "MEDIA", "OPEN_SOURCE", "OTHER", "PUBLIC_SECTOR", "RETAIL",
        "SCIENCE_AND_RESEARCH", "SECURITY", "SPORTS",
        "TRANSPORTATION_AND_LOGISTICS", "TRAVEL_AND_TOURISM",
    }
    for spec in mp.LISTINGS:
        assert set(spec["categories"]) <= known, spec["categories"]
        assert "HEALTH" in spec["categories"], "healthcare data needs HEALTH"


def test_description_headline_sentences_match_the_doc():
    doc = _flat(DOC.read_text())
    checked = 0
    for spec in mp.LISTINGS:
        for para in spec["description"].split("\n\n"):
            # Strip the ALLCAPS lead-in the script uses where the markdown uses
            # bold, before splitting, or the lead-in is the whole sentence.
            body = re.sub(r"^[A-Z][A-Z ,]+\.\s*", "", _flat(para))
            first = body.split(". ")[0]
            if len(first) < 40:
                continue
            assert first in doc, first[:80]
            checked += 1
    assert checked >= 5, f"only {checked} sentences compared; the test is not doing its job"


def test_policy_urls_are_the_published_ones():
    for spec in mp.LISTINGS:
        assert spec["terms_of_service"] == "https://ainpi.dev/terms"
        assert spec["privacy_policy_link"] == "https://ainpi.dev/privacy"
