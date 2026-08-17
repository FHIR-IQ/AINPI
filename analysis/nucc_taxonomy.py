"""NUCC provider taxonomy: code to grouping, and grouping to a plain category.

Every "N providers" headline in this project has been carrying an unexamined
denominator. The NDH's active Practitioner set is not a set of clinicians who
see patients and hold records. Measured on Pennsylvania, it also contains
8,789 NPIs whose taxonomy is "Student in an Organized Health Care
Education/Training Program", 12,347 individual pharmacists, 706 nurse's aides
and 79 doulas. Those NPIs are real and correctly enumerated. They are not
people a patient-record endpoint would ever route to, and leaving them in the
denominator makes every coverage number look worse than it is.

This module supplies the categorization so a denominator can be stated rather
than assumed. It does two things and deliberately not a third:

  1. Maps a taxonomy code to the NUCC grouping, classification and section
     (Individual or Non-Individual). This is a lookup, not a judgement.
  2. Maps a grouping to a coarse `category` for reporting.

It does **not** decide which categories "should" reach an endpoint. That is an
empirical question, and answering it by assertion here would bake an opinion
into a denominator. Callers measure reach per category and report it.

Source: NUCC publishes the code set twice a year as a CSV. The version in the
filename is `<year><release>`, so 251 is the first 2025 release. Newer
versions are tried first and the newest that returns a usable file wins,
because a hardcoded version silently 404s six months after it is written.

Usage:
    from analysis.nucc_taxonomy import load_taxonomy, categorize

    tax = load_taxonomy()
    info = tax.get("207Q00000X")
    info["grouping"]        # 'Allopathic & Osteopathic Physicians'
    info["category"]        # 'physician'
    info["individual"]      # True
"""
from __future__ import annotations

import csv
import io
import pathlib
import subprocess

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = REPO_ROOT / "analysis" / "data" / "nucc"
UA = "ainpi-research/1.0 (+https://ainpi.dev)"
URL = "https://www.nucc.org/images/stories/CSV/nucc_taxonomy_{}.csv"

# Tried newest first. Each NUCC release is <two-digit year><release number>,
# two per year. Listing a window rather than one value means this keeps working
# across a release boundary instead of failing on a fixed version.
CANDIDATE_VERSIONS = ["261", "260", "251", "250", "241", "240"]

# NUCC grouping -> reporting category. Groupings are stable; new codes arrive
# inside existing groupings far more often than new groupings appear.
GROUPING_CATEGORY = {
    "Allopathic & Osteopathic Physicians": "physician",
    "Physician Assistants & Advanced Practice Nursing Providers": "advanced-practice",
    "Nursing Service Providers": "nursing",
    "Behavioral Health & Social Service Providers": "behavioral-health",
    "Respiratory, Developmental, Rehabilitative and Restorative Service Providers": "rehab-therapy",
    "Speech, Language and Hearing Service Providers": "rehab-therapy",
    "Dental Providers": "dental",
    "Pharmacy Service Providers": "pharmacy",
    "Eye and Vision Services Providers": "eye-vision",
    "Podiatric Medicine & Surgery Service Providers": "podiatry",
    "Chiropractic Providers": "chiropractic",
    "Dietary & Nutritional Service Providers": "dietary",
    "Emergency Medical Service Providers": "emergency-medical",
    "Student, Health Care": "student",
    "Nursing Service Related Providers": "support",
    "Technologists, Technicians & Other Technical Service Providers": "support",
    "Other Service Providers": "other-clinical",
    "Transportation Services": "transport",
    "Suppliers": "supplier",
    "Agencies": "agency",
    "Ambulatory Health Care Facilities": "facility",
    "Hospitals": "facility",
    "Hospital Units": "facility",
    "Laboratories": "facility",
    "Managed Care Organizations": "payer",
    "Nursing & Custodial Care Facilities": "facility",
    "Residential Treatment Facilities": "facility",
    "Respite Care Facility": "facility",
    "Group": "group",
    "Other": "other",
}


def _fetch(version):
    proc = subprocess.run(
        ["curl", "-sL", "-m", "120", "-H", f"User-Agent: {UA}", URL.format(version)],
        capture_output=True,
    )
    if proc.returncode != 0:
        return None
    text = proc.stdout.decode("utf-8-sig", errors="replace")
    # A 404 from this host returns an HTML error page with a 200-ish body in
    # some CDN states, so validate the shape rather than trusting the status.
    if "Code,Grouping,Classification" not in text[:200]:
        return None
    return text


def load_taxonomy(refresh=False):
    """Return {taxonomy_code: {...}} for the newest available NUCC release."""
    CACHE.mkdir(parents=True, exist_ok=True)
    text = None
    version = None

    if not refresh:
        cached = sorted(CACHE.glob("nucc_taxonomy_*.csv"), reverse=True)
        if cached:
            text = cached[0].read_text(encoding="utf-8-sig", errors="replace")
            version = cached[0].stem.rsplit("_", 1)[-1]

    if text is None:
        for candidate in CANDIDATE_VERSIONS:
            text = _fetch(candidate)
            if text:
                version = candidate
                (CACHE / f"nucc_taxonomy_{candidate}.csv").write_text(text)
                break
    if text is None:
        raise RuntimeError("could not retrieve any NUCC taxonomy release")

    out = {}
    for row in csv.DictReader(io.StringIO(text)):
        code = (row.get("Code") or "").strip()
        if not code:
            continue
        grouping = (row.get("Grouping") or "").strip()
        section = (row.get("Section") or "").strip()
        out[code] = {
            "code": code,
            "grouping": grouping,
            "classification": (row.get("Classification") or "").strip(),
            "specialization": (row.get("Specialization") or "").strip(),
            "display": (row.get("Display Name") or "").strip(),
            "section": section,
            "individual": section.lower().startswith("individual"),
            "category": GROUPING_CATEGORY.get(grouping, "other"),
            "version": version,
        }
    return out


def categorize(code, taxonomy):
    """Category for a taxonomy code. Unknown and missing are distinct.

    A code the current NUCC release does not contain is not the same as a
    provider with no taxonomy on file: the first is a retired or mistyped
    code, the second is an incomplete record. Collapsing them would hide a
    data-quality signal inside a category label.
    """
    if not code:
        return "no-taxonomy"
    info = taxonomy.get(code)
    if info is None:
        return "unknown-code"
    return info["category"]


def primary_taxonomy(codes, switches):
    """Pick the primary taxonomy from the 15 NPPES slots.

    NPPES marks one slot with a 'Y' switch. Records exist with no 'Y' at all,
    in which case the first populated slot is used, and the caller is told
    which happened so it is not reported as an authoritative primary.
    """
    first = None
    for code, switch in zip(codes, switches):
        code = (code or "").strip()
        if not code:
            continue
        if first is None:
            first = code
        if (switch or "").strip().upper() == "Y":
            return code, True
    return first, False
