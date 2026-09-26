"""H27 — PII exposure in the NDH bulk export.

Independently verifies the 2026-04-30 Washington Post finding that the
2026-04-09 CMS National Provider Directory bulk export contains
provider Social Security Numbers, leaked through "incorrect entries
of provider or provider-representative-supplied information in the
wrong places" (CMS).

Scans every Practitioner and Organization resource for the dashed
SSN format `\\d{3}-\\d{2}-\\d{4}` anywhere in the FHIR JSON, then
classifies by JSON location:

  - SSN in `qualification[].identifier[].value`  — state-license slot
    (most common; provider entered SSN where state license number
    was supposed to go)
  - SSN in `name[].given[]`                       — middle-name slot
    (provider literally listed their SSN as a given name)
  - SSN-pattern as substring of an international phone number
    (e.g. Italy "39-XXX-XX-XXXX") — false positive, filtered out

Privacy:
  This script publishes COUNTS, JSON locations, NPIs (which are
  professional IDs, not PII per HIPAA), and state breakdowns. It
  NEVER republishes the SSN values themselves, even though they are
  technically already in the publicly-distributed NDH bulk file.
  Responsible-disclosure posture: the finding's value is in the
  count/location signal, not the leaked numbers.

Source citation:
  - Washington Post, "Medicare portal exposed health providers'
    Social Security numbers" (2026-04-30)
  - Becker's Hospital Review, secondary coverage (2026-05-01)
  - Underlying data: 2026-04-09 NDH bulk export from
    directory.cms.gov, ingested into BigQuery as
    thematic-fort-453901-t7.cms_npd.{practitioner,organization}

Run order:
  python analysis/h27_pii_exposure.py

Writes:
  frontend/public/api/v1/findings/pii-exposure-ndh.json
  frontend/public/api/v1/findings/pii-exposure-ndh-detail.json

Release watch, Practitioner.birthDate (added 2026-09-25): the HL7 NDH STU2
draft adds a warning-severity invariant that Practitioner.birthDate carry only
the year (Jira FHIR-57885). The published STU1 has no such rule. The positive
control query below already aggregates over practitioner.resource, so it also
counts birthDate present, year-only (length 4) and more precise (length > 4),
with gender present as the control in the same scan. No second scan. The
counts and a note go into both JSON files as `birthdate_watch`; a date more
precise than the year is called out as a disclosure beyond what the draft
allows. Counts only; the dates are never published.
"""
from __future__ import annotations
import json
import pathlib
import subprocess
from datetime import datetime, timezone
from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from claims_sources._cohorts import bq_job_config  # noqa: E402
from release import CURRENT_RELEASE as RELEASE_DATE  # noqa: E402
from release_watch import (  # noqa: E402
    BIRTHDATE_NOTE_MARKER,
    birthdate_summary,
    merge_note,
)
# Read from docs/methodology/index.md, like stats.json, rather than typed in:
# the literal here sat at 0.6.0 after the methodology moved on.
from build_stats import methodology_version  # noqa: E402
METHODOLOGY_VERSION = methodology_version()

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"


def get_commit_sha() -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            capture_output=True, text=True, cwd=REPO_ROOT, timeout=5,
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except (FileNotFoundError, subprocess.SubprocessError):
        pass
    return "pending"


def build_notes(*, release: str, confirmed: int, states: int, in_given_name: int,
                org_matches: int, qual_present: int, total: int) -> str:
    """Finding notes. Two branches, like the headline, because zero is a
    different finding: the hit template says most SSNs sit in the license slot
    and remain in the bulk file, which is false for a release with none."""
    if confirmed == 0 and org_matches == 0:
        return (
            f"Re-runs the scan that independently verified the 2026-04-30 "
            f"Washington Post finding, against the {release} NDH bulk export "
            f"(loaded into BigQuery as `cms_npd.practitioner`/"
            f"`cms_npd.organization`), matching the dashed SSN format "
            f"\\\\d{{3}}-\\\\d{{2}}-\\\\d{{4}} in the full resource JSON. It finds "
            f"no confirmed exposures in either resource type. Earlier releases "
            f"carried 46 (2026-04-09) and 41 (2026-05-08), most of them in "
            f"qualification.identifier.value, the state-license slot. The zero "
            f"is checked, not assumed: {qual_present:,} of {total:,} "
            f"Practitioner resources still carry the qualification array those "
            f"exposures were found in, so the scan is reading the right field. "
            f"Privacy posture is unchanged: AINPI publishes counts, JSON "
            f"locations, NPIs (professional IDs, not PII) and state breakdowns, "
            f"never SSN values."
        )
    return (
        f"Independently verifies the 2026-04-30 Washington Post finding by "
        f"scanning the {release} NDH bulk export (already loaded into "
        f"BigQuery as `cms_npd.practitioner`/`cms_npd.organization`) for "
        f"the dashed SSN format \\\\d{{3}}-\\\\d{{2}}-\\\\d{{4}} in the full "
        f"resource JSON. WaPo reported 'dozens'; the AINPI scan identifies "
        f"{confirmed} confirmed exposures across {states} "
        f"states. CMS attributed the leak to 'incorrect entries of provider "
        f"or provider-representative-supplied information in the wrong "
        f"places' — borne out by the JSON-location breakdown: most SSNs "
        f"are in qualification.identifier.value (the state-license slot), "
        f"with {in_given_name} cases of providers entering their "
        f"SSN literally as a name token. Privacy posture: AINPI publishes "
        f"counts, JSON locations, NPIs (professional IDs, not PII), and "
        f"state breakdowns. The SSN values themselves are NOT republished "
        f"in this finding's output, even though they remain in the public "
        f"NDH bulk file CMS distributed. State Medicaid PI teams that "
        f"want to validate or remediate should contact CMS NDH operations "
        f"directly."
    )


def remediation_limitation(confirmed: int) -> str:
    """The remediation caveat, with the count measured rather than typed in."""
    who = (f"The {confirmed} affected providers" if confirmed
           else "Any provider affected in an earlier release")
    return (f"Remediation belongs to CMS NDH operations. AINPI is a verification "
            f"surface, not a notification mechanism. {who} should be contacted "
            f"by CMS or their state board, not by AINPI.")


def run() -> None:
    client = bigquery.Client(project=PROJECT)

    # Practitioner-side scan with location classification.
    pract_sql = f"""
    WITH flagged AS (
      SELECT
        _id, _npi, _family_name, _given_name, _state,
        TO_JSON_STRING(resource) AS json
      FROM `{PROJECT}.{DATASET}.practitioner`
      WHERE REGEXP_CONTAINS(TO_JSON_STRING(resource), r'\\b\\d{{3}}-\\d{{2}}-\\d{{4}}\\b')
    ),
    classified AS (
      SELECT
        _npi, _family_name, _given_name, _state,
        REGEXP_CONTAINS(json, r'"value":"[^"]*\\d{{3}}-\\d{{2}}-\\d{{4}}"')
          AS ssn_in_identifier_value,
        REGEXP_CONTAINS(json, r'"given":\\[[^\\]]*\\d{{3}}-\\d{{2}}-\\d{{4}}')
          AS ssn_in_given_name,
        REGEXP_CONTAINS(json, r'"family":"[^"]*\\d{{3}}-\\d{{2}}-\\d{{4}}"')
          AS ssn_in_family_name,
        -- Italy / other intl phone patterns: 39-XXX-XX-XXXX, 49-XXX-XX-XXXX, etc.
        REGEXP_CONTAINS(json, r'\\d{{2}}-\\d{{3}}-\\d{{2}}-\\d{{4}}')
          AS likely_intl_phone_fp
      FROM flagged
    )
    SELECT
      _npi, _family_name, _given_name, _state,
      ssn_in_identifier_value, ssn_in_given_name, ssn_in_family_name,
      likely_intl_phone_fp
    FROM classified
    """
    billed: dict[str, int] = {}
    pract_job = client.query(pract_sql, job_config=bq_job_config())
    pract_rows = list(pract_job.result())
    billed["practitioner_ssn_scan"] = int(pract_job.total_bytes_billed or 0)

    # Positive control. A scan that returns nothing is indistinguishable from a
    # scan pointed at the wrong field, and this project has already been bitten
    # once by a field moving underneath a matcher. Confirm the population and
    # the container element are both still there before reporting a zero.
    #
    # The same aggregate carries the birthDate release watch (FHIR-57885), so
    # it costs no extra scan. birthDate is read from the raw resource JSON,
    # never a flattened column; gender is its positive control.
    control_job = client.query(f"""
    SELECT
      COUNT(*) AS total_practitioners,
      COUNTIF(JSON_EXTRACT_ARRAY(resource, '$.qualification') IS NOT NULL) AS qual_present,
      COUNTIF(JSON_VALUE(resource, '$.gender') IS NOT NULL) AS gender_present,
      COUNTIF(JSON_VALUE(resource, '$.birthDate') IS NOT NULL) AS birth_date_present,
      COUNTIF(LENGTH(JSON_VALUE(resource, '$.birthDate')) = 4) AS birth_date_year_only,
      COUNTIF(LENGTH(JSON_VALUE(resource, '$.birthDate')) > 4) AS birth_date_full
    FROM `{PROJECT}.{DATASET}.practitioner`
    """, job_config=bq_job_config())
    control_row = next(iter(control_job.result()))
    billed["practitioner_control_and_birthdate"] = int(control_job.total_bytes_billed or 0)
    total_practitioners = int(control_row.total_practitioners)
    qual_present = int(control_row.qual_present)
    print(f"  control: {total_practitioners:,} practitioners, "
          f"{qual_present:,} carry a qualification array")
    birthdate_watch = birthdate_summary(
        total=total_practitioners,
        gender_present=int(control_row.gender_present),
        birth_date_present=int(control_row.birth_date_present),
        year_only=int(control_row.birth_date_year_only),
        full_date=int(control_row.birth_date_full),
    )
    birthdate_watch["release_date"] = RELEASE_DATE
    print(f"  birthDate watch: present={birthdate_watch['birth_date_present']} "
          f"year_only={birthdate_watch['year_only']} "
          f"full_date={birthdate_watch['full_date']} "
          f"gender_control={birthdate_watch['gender_present']:,} "
          f"(control_passed={birthdate_watch['control_passed']})")

    # Bucket and tally.
    real_in_qualification = []  # SSN in qualification.identifier.value
    real_in_given_name = []     # SSN in name.given (literal middle-name slot)
    real_in_family_name = []    # SSN in family
    false_positive_phones = []

    for r in pract_rows:
        is_phone_fp = bool(r.likely_intl_phone_fp)
        if r.ssn_in_given_name:
            real_in_given_name.append(r)
        elif r.ssn_in_family_name:
            real_in_family_name.append(r)
        elif r.ssn_in_identifier_value and not is_phone_fp:
            real_in_qualification.append(r)
        elif is_phone_fp:
            false_positive_phones.append(r)

    confirmed = real_in_qualification + real_in_given_name + real_in_family_name

    # Organization-side scan (lighter — far fewer hits historically).
    org_sql = f"""
    SELECT
      _id, _npi, _name, _state,
      TO_JSON_STRING(resource) AS json
    FROM `{PROJECT}.{DATASET}.organization`
    WHERE REGEXP_CONTAINS(TO_JSON_STRING(resource), r'\\b\\d{{3}}-\\d{{2}}-\\d{{4}}\\b')
      AND NOT REGEXP_CONTAINS(TO_JSON_STRING(resource), r'\\d{{2}}-\\d{{3}}-\\d{{2}}-\\d{{4}}')
    """
    org_job = client.query(org_sql, job_config=bq_job_config())
    org_rows = list(org_job.result())
    billed["organization_ssn_scan"] = int(org_job.total_bytes_billed or 0)
    for k, v in billed.items():
        print(f"  bytes billed {k}: {v:,}")

    # Per-state confirmed counts.
    state_counter: dict[str, int] = {}
    for r in confirmed:
        s = r._state or "(unknown)"
        state_counter[s] = state_counter.get(s, 0) + 1
    state_breakdown = sorted(
        ({"state": s, "count": c} for s, c in state_counter.items()),
        key=lambda x: (-x["count"], x["state"]),
    )

    # Privacy-preserving samples: NPI + JSON location ONLY. Never the SSN value.
    samples = []
    for r in real_in_qualification[:5]:
        samples.append({
            "npi": r._npi,
            "name": f"{r._family_name or ''}, {r._given_name or ''}".strip(", "),
            "state": r._state or "",
            "exposure_location": "qualification[].identifier[].value (state-license slot — provider entered SSN where license number belongs)",
            "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{r._npi}",
        })
    for r in real_in_given_name[:5]:
        samples.append({
            "npi": r._npi,
            "name": f"{r._family_name or ''}, {r._given_name or ''}".strip(", "),
            "state": r._state or "",
            "exposure_location": "name[].given[] (literal first/middle name slot — provider entered SSN as a name token)",
            "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{r._npi}",
        })

    # Two headlines, because zero is a different finding from a count.
    #
    # A template written for hits renders "0 of 0 flagged resources contain a
    # Social Security Number, independently verifying the Washington Post
    # finding", which reads as a broken script and states the opposite of what
    # happened. When the scan comes back empty the finding is the remediation,
    # and the control that proves the scan still works belongs in the headline
    # rather than buried in the notes.
    if not confirmed and not org_rows:
        headline = (
            f"No Social Security Numbers remain in the {RELEASE_DATE} NDH bulk "
            f"export. The dashed-SSN pattern matches zero of "
            f"{total_practitioners:,} Practitioner and zero Organization "
            f"resources, against 46 confirmed exposures in 2026-04-09 and 41 in "
            f"2026-05-08. CMS has now removed them rather than partially "
            f"scrubbing them. The scan is unchanged and still reads the same "
            f"fields: {qual_present:,} of those Practitioner resources still "
            f"carry the qualification array the exposures were found in, so the "
            f"zero is an empty result and not an empty query."
        )
    else:
        headline = (
            f"{len(confirmed)} of {len(pract_rows):,} flagged Practitioner resources "
            f"in the {RELEASE_DATE} NDH bulk export contain a Social Security Number, "
            f"independently verifying the 2026-04-30 Washington Post finding. "
            f"Of those, {len(real_in_qualification)} appear in the "
            f"qualification[].identifier[].value slot (state-license credential), "
            f"{len(real_in_given_name)} are embedded in the name[].given[] slot "
            f"(literally as a name token), and {len(real_in_family_name)} in name[].family. "
            f"{len(false_positive_phones)} additional matches are international phone-format "
            f"false positives (e.g. Italy 39-XXX-XX-XXXX), filtered out. "
            f"{len(org_rows)} Organization resources also carry SSN-pattern strings."
        )

    public_payload = {
        "slug": "pii-exposure-ndh",
        "title": "Social Security Numbers exposed in the NDH bulk export",
        "hypotheses": ["H27"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(confirmed),
        "denominator": total_practitioners,  # live Practitioner row count
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": s["state"], "value": s["count"]}
                for s in state_breakdown[:15]
            ],
        },
        "notes": build_notes(
            release=RELEASE_DATE,
            confirmed=len(confirmed),
            states=len(state_breakdown),
            in_given_name=len(real_in_given_name),
            org_matches=len(org_rows),
            qual_present=qual_present,
            total=total_practitioners,
        ),
        "birthdate_watch": birthdate_watch,
    }
    public_payload["notes"] = merge_note(
        public_payload["notes"], BIRTHDATE_NOTE_MARKER, birthdate_watch["note"])

    detail_payload = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "release_date": RELEASE_DATE,
        "denominator_practitioners": total_practitioners,  # measured, same control query
        "totals": {
            "flagged_pattern_match": len(pract_rows),
            "confirmed_ssn_exposures": len(confirmed),
            "in_qualification_identifier_value": len(real_in_qualification),
            "in_given_name": len(real_in_given_name),
            "in_family_name": len(real_in_family_name),
            "intl_phone_false_positives": len(false_positive_phones),
            "organization_pattern_matches": len(org_rows),
        },
        "state_breakdown": state_breakdown,
        "birthdate_watch": birthdate_watch,
        "samples": samples,
        "limitations": [
            "Detection regex is the dashed SSN format \\d{3}-\\d{2}-\\d{4}. Undashed 9-digit SSNs are NOT detected here because they collide with too many other 9-digit identifiers (EINs, account numbers, claim IDs). True coverage is therefore a lower bound — actual SSN exposure may be higher.",
            "False positive guard: international phone-number formats (Italy '39-XXX-XX-XXXX', etc.) match the same regex. We classify any record whose JSON also contains the prefix-extended pattern \\d{2}-\\d{3}-\\d{2}-\\d{4} as a phone false positive and exclude it from the confirmed total.",
            "Privacy: the SSN values themselves are not published in this finding output, despite being in the underlying NDH bulk file CMS distributed publicly. The finding reports counts, JSON locations, NPIs (which are professional credentials, not PII per HIPAA), and state breakdowns only.",
            "Source attribution: original reporting is by the Washington Post (2026-04-30, paywalled). AINPI's value-add is an independent, reproducible scan of the same public file, with a precise location-and-count breakdown the WaPo article did not publish.",
            remediation_limitation(len(confirmed)),
        ],
        "source_articles": [
            {
                "outlet": "Washington Post",
                "title": "Medicare portal exposed health providers' Social Security numbers",
                "date": "2026-04-30",
                "url": "https://www.washingtonpost.com/health/2026/04/30/medicare-portal-social-security-numbers-exposed/",
            },
            {
                "outlet": "Becker's Hospital Review",
                "title": "CMS' Medicare provider directory released Social Security numbers: Washington Post",
                "date": "2026-05-01",
                "url": "https://www.beckershospitalreview.com/quality/hospital-physician-relationships/cms-medicare-provider-directory-released-social-security-numbers-washington-post/",
            },
        ],
    }

    out_public = FINDINGS_DIR / "pii-exposure-ndh.json"
    out_detail = FINDINGS_DIR / "pii-exposure-ndh-detail.json"
    out_public.write_text(json.dumps(public_payload, indent=2) + "\n")
    out_detail.write_text(json.dumps(detail_payload, indent=2) + "\n")
    print(f"Wrote {out_public}")
    print(f"Wrote {out_detail}")
    print()
    print(f"Headline: {headline}")
    print()
    print(f"Per-state confirmed exposures (top 10):")
    for s in state_breakdown[:10]:
        print(f"  {s['state']:<10} {s['count']:>4}")


if __name__ == "__main__":
    run()
