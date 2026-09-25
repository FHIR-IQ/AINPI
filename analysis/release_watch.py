"""Release-watch checks: fields absent today that a later NDH release may add.

Two elements in the HL7 NDH STU2 draft have no counterpart in the published
STU1 (https://hl7.org/fhir/us/ndh/STU1/) and nothing in the 2026-08-20 release:

  - an Organization identifier slice for the Payer Identification Number
    (PIN), identifier.type = v2-0203#PAYERID  (Jira FHIR-57606)
  - a warning-severity invariant that Practitioner.birthDate carry only the
    year  (Jira FHIR-57885)

The measurements run inside the existing H49 and H27 scans. This module holds
the pure parts: the matchers, the positive controls, and the note text, so
they are tested without BigQuery.

Two rules, both learned the hard way in this project:

  1. Match codes by walking every CodeableConcept and every coding, under any
     system. A system URL moving underneath a literal match has already
     produced three silent zeros here (NPI system, taxonomy system, and the
     vendor downloads).
  2. A zero is reported only when the positive control proves the scan could
     have seen something. Otherwise the count is None and the note says why.
"""
from __future__ import annotations

PAYER_TYPE_CODE = "pay"
PAYERID_CODE = "PAYERID"
V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203"
STU1_URL = "https://hl7.org/fhir/us/ndh/STU1/"

PIN_NOTE_MARKER = "Release watch, payer PIN:"
BIRTHDATE_NOTE_MARKER = "Release watch, Practitioner.birthDate:"


def coding_codes(concepts) -> list[str]:
    """Every coding.code under one CodeableConcept or a list of them.

    Never raises: anything that is not the expected shape contributes nothing.
    """
    if isinstance(concepts, dict):
        concepts = [concepts]
    if not isinstance(concepts, list):
        return []
    codes: list[str] = []
    for concept in concepts:
        if not isinstance(concept, dict):
            continue
        codings = concept.get("coding")
        if not isinstance(codings, list):
            continue
        for coding in codings:
            if isinstance(coding, dict) and isinstance(coding.get("code"), str):
                codes.append(coding["code"])
    return codes


def is_payer_typed(resource) -> bool:
    """True if any Organization.type[].coding[].code is `pay`, any system."""
    if not isinstance(resource, dict):
        return False
    return PAYER_TYPE_CODE in coding_codes(resource.get("type"))


def _identifiers(resource) -> list[dict]:
    if not isinstance(resource, dict):
        return []
    idents = resource.get("identifier")
    if not isinstance(idents, list):
        return []
    return [i for i in idents if isinstance(i, dict)]


def identifier_count(resource) -> int:
    return len(_identifiers(resource))


def has_identifier_type_code(resource, code: str) -> bool:
    """True if any identifier[].type.coding[].code equals `code` exactly.

    Case-sensitive, because FHIR codes are. `type.text` alone does not count:
    a coded slice is what the draft defines, and free text is not that.
    """
    return any(code in coding_codes(i.get("type")) for i in _identifiers(resource))


def payer_pin_summary(resources) -> dict:
    """Count payer organizations carrying any identifier and a PAYERID one.

    `resources` are candidate Organization resources. Each is re-checked with
    is_payer_typed, so a loose SQL pre-filter cannot inflate the denominator.
    If no payer-typed organization is present the identifier counts are None,
    not zero: with nothing to look at, zero would be a fact about the query.
    """
    payers = [r for r in resources if is_payer_typed(r)]
    n = len(payers)
    if n == 0:
        return {
            "control_passed": False,
            "payer_orgs": 0,
            "payer_orgs_with_any_identifier": None,
            "payer_orgs_with_payerid": None,
            "note": (
                f"{PIN_NOTE_MARKER} not reported. No Organization in this release "
                f"carries a type coding with code '{PAYER_TYPE_CODE}', so a count "
                f"of payer identifiers would be zero by construction rather than "
                f"by measurement. Either the payer type was removed or the "
                f"matcher no longer finds it, and that needs checking before any "
                f"number is published."
            ),
        }
    with_any = sum(1 for r in payers if identifier_count(r) > 0)
    with_pin = sum(1 for r in payers if has_identifier_type_code(r, PAYERID_CODE))
    return {
        "control_passed": True,
        "payer_orgs": n,
        "payer_orgs_with_any_identifier": with_any,
        "payer_orgs_with_payerid": with_pin,
        "note": (
            f"{PIN_NOTE_MARKER} {with_any} of the {n} organizations typed "
            f"'{PAYER_TYPE_CODE}' carry an identifier of any kind, and {with_pin} "
            f"carry a Payer Identification Number (an identifier whose "
            f"type.coding has code {PAYERID_CODE}, from {V2_0203}). The PIN "
            f"slice is in the HL7 NDH STU2 draft (Jira FHIR-57606) and not in "
            f"the published STU1 ({STU1_URL}), so its absence is not a "
            f"conformance gap against the current standard. It is watched so the "
            f"first release that carries it is reported when that release is "
            f"measured. The match walks identifier[].type.coding[].code under any "
            f"system in the raw resource JSON; no flattened column is read. The "
            f"denominator is the positive control: {n} payer-typed organizations "
            f"were found, so these counts come from a query that could see them."
        ),
    }


def classify_birth_date(value) -> str:
    """'absent', 'year_only' (YYYY) or 'finer_than_year' (YYYY-MM, YYYY-MM-DD).

    Mirrors the SQL split on LENGTH(birthDate): = 4 or > 4.
    """
    if not isinstance(value, str) or not value:
        return "absent"
    return "year_only" if len(value) == 4 else "finer_than_year"


def birthdate_summary(*, total: int, gender_present: int, birth_date_present: int,
                      year_only: int, full_date: int) -> dict:
    """Practitioner.birthDate counts, gated on gender from the same scan.

    Gender is the control because it is the sibling demographic element and
    every Practitioner carries it today. If the scan cannot see gender, it
    cannot be trusted to see birthDate either, and the counts are None.
    """
    definitions = {
        "year_only": "birthDate is exactly four characters (YYYY)",
        "full_date": "birthDate is longer than four characters (YYYY-MM or YYYY-MM-DD)",
    }
    if total <= 0 or gender_present <= 0:
        return {
            "control_passed": False,
            "practitioners": total,
            "gender_present": gender_present,
            "birth_date_present": None,
            "year_only": None,
            "full_date": None,
            "definitions": definitions,
            "note": (
                f"{BIRTHDATE_NOTE_MARKER} not reported. The positive control "
                f"failed: {gender_present:,} of {total:,} Practitioner resources "
                f"carry gender in the same scan, so a birthDate count of zero "
                f"could not be told apart from a query that reads nothing."
            ),
        }
    note = (
        f"{BIRTHDATE_NOTE_MARKER} {birth_date_present:,} of {total:,} "
        f"Practitioner resources carry birthDate ({year_only:,} year only, "
        f"{full_date:,} more precise than the year). The positive control is "
        f"gender, read in the same scan: {gender_present:,} carry it, so a zero "
        f"here is an empty field and not an empty query. The HL7 NDH STU2 draft "
        f"adds a warning-severity invariant that birthDate carry only the year "
        f"(Jira FHIR-57885); the published STU1 ({STU1_URL}) has no such "
        f"constraint. AINPI publishes counts only, never the dates."
    )
    if full_date > 0:
        note += (
            f" {full_date:,} Practitioner resources publish a birth date more "
            f"precise than the year, a disclosure beyond what the STU2 draft "
            f"allows. The draft rule is a warning, not an error, so these "
            f"resources would still validate, but the date is personal "
            f"information in a public bulk file."
        )
    return {
        "control_passed": True,
        "practitioners": total,
        "gender_present": gender_present,
        "birth_date_present": birth_date_present,
        "year_only": year_only,
        "full_date": full_date,
        "definitions": definitions,
        "note": note,
    }


def merge_note(notes, marker: str, paragraph: str) -> str:
    """Append `paragraph` to `notes`, replacing any earlier paragraph with `marker`.

    Idempotent, so re-running a watch updates its paragraph instead of
    stacking a second copy under the first.
    """
    paras = [p for p in (notes or "").split("\n\n") if p and not p.startswith(marker)]
    paras.append(paragraph)
    return "\n\n".join(paras)
