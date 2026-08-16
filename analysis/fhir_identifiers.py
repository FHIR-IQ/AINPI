"""Extract NPIs from FHIR identifier arrays, whatever shape the publisher used.

This exists because the same bug has now bitten three times, each time silently:

1. The 2026-05-08 NDH release changed the NPI system URL from
   `http://hl7.org/fhir/sid/us-npi` to
   `http://terminology.hl7.org/NamingSystem/npi`. A parser matching only the
   old URL lost every NPI in the release and reported no error.
2. `provider-search` was patched for that, and the fix is documented in
   CLAUDE.md as a three-way match.
3. The first Capital BlueCross sample returned zero NPIs from 2,000
   practitioners. Capital BlueCross leaves `identifier.system` unset entirely
   and puts the marker in `identifier.type.coding[]`. A parser reading only
   `identifier.system` concludes "this payer does not publish NPIs", which is
   the opposite of the truth: 91% of them do.

Every one of those failures returns an empty list rather than raising, so
nothing downstream notices. The only defence is to match all three signals and
to test the extractor against the shapes real publishers actually emit.

The three accepted signals, any one of which marks an identifier as an NPI:

    identifier.system                    in NPI_SYSTEMS
    identifier.type.coding[].system      in NPI_SYSTEMS
    identifier.type.coding[].code        == "NPI"

A value is only returned if it also looks like an NPI: exactly 10 digits. Luhn
validation is available separately via `is_luhn_valid` but is deliberately not
applied by the extractor, because "the publisher printed a malformed NPI" is a
finding worth keeping rather than a row worth dropping.
"""
from __future__ import annotations

import re

# Both URLs are current in the wild. The terminology.hl7.org form is what the
# NDH switched to in May 2026; the fhir/sid form is still what most payers and
# vendors publish.
NPI_SYSTEMS = frozenset({
    "http://hl7.org/fhir/sid/us-npi",
    "http://terminology.hl7.org/NamingSystem/npi",
})

_TEN_DIGITS = re.compile(r"^\d{10}$")


def _is_npi_identifier(ident):
    """True if this identifier is marked as an NPI by any of the three signals."""
    if not isinstance(ident, dict):
        return False
    if ident.get("system") in NPI_SYSTEMS:
        return True
    type_ = ident.get("type")
    if not isinstance(type_, dict):
        return False
    for coding in type_.get("coding") or []:
        if not isinstance(coding, dict):
            continue
        if coding.get("system") in NPI_SYSTEMS:
            return True
        if coding.get("code") == "NPI":
            return True
    return False


def _assigned_by_cms(ident):
    """True if the identifier says CMS assigned it.

    Capital BlueCross marks organization NPIs with neither `system` nor
    `type.coding`. The only signal is `assigner.display: "CMS"`. Measured on 81
    sampled organizations: the strict extractor found zero NPIs, while 80 of 81
    carried a CMS-assigned 10-digit value and all 80 were Luhn-valid.

    This is a publisher convention rather than a coded marker, so it is never
    on by default. It is also not safe on its own: the same organizations carry
    NCPDP identifiers that are also 10 digits, and 3 of 59 sampled NCPDP values
    happened to be Luhn-valid. The assigner check is what excludes those, and
    the Luhn check is what excludes malformed CMS values. Both are required.
    """
    assigner = ident.get("assigner")
    if not isinstance(assigner, dict):
        return False
    display = assigner.get("display")
    if not isinstance(display, str):
        return False
    display = display.strip().lower()
    return display == "cms" or "centers for medicare" in display


def extract_npis(resource, assigner_hint=False):
    """Every distinct well-formed NPI on a FHIR resource, in source order.

    Accepts a resource dict or a bare identifier list. Never raises: a
    malformed resource yields an empty list, because these extractors run
    inside bulk loops where one bad record must not abort the file.

    `assigner_hint` additionally accepts an unmarked identifier whose assigner
    is CMS and whose value passes the NPI check digit. Publishers that omit the
    system need it; leaving it off is the safe default. Callers that turn it on
    should report the strict and lenient counts separately, because the
    difference measures how much of the result rests on a convention rather
    than a coded marker.
    """
    if isinstance(resource, dict):
        identifiers = resource.get("identifier")
    elif isinstance(resource, list):
        identifiers = resource
    else:
        return []
    if not isinstance(identifiers, list):
        return []

    out = []
    for ident in identifiers:
        if not isinstance(ident, dict):
            continue
        value = ident.get("value")
        if not isinstance(value, str):
            continue
        value = value.strip()
        if not _TEN_DIGITS.match(value):
            continue
        if _is_npi_identifier(ident):
            pass
        elif assigner_hint and _assigned_by_cms(ident) and is_luhn_valid(value):
            pass
        else:
            continue
        if value not in out:
            out.append(value)
    return out


def extract_npi(resource, assigner_hint=False):
    """The first well-formed NPI on a resource, or None."""
    npis = extract_npis(resource, assigner_hint=assigner_hint)
    return npis[0] if npis else None


def is_luhn_valid(npi):
    """NPI check-digit validation per the CMS NPI standard.

    The NPI is a Luhn-checked number computed over the constant prefix 80840
    concatenated with the first 9 digits. Used by H9; kept here so callers do
    not reimplement it.
    """
    if not isinstance(npi, str) or not _TEN_DIGITS.match(npi):
        return False
    digits = [int(c) for c in "80840" + npi[:9]]
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (total + int(npi[9])) % 10 == 0
