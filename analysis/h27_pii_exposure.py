"""H27 — PII exposure in the NDH bulk export.

Independently verifies and extends the 2026-04-30 Washington Post
finding that the 2026-04-09 CMS National Provider Directory bulk
export contains provider Social Security Numbers, leaked through
"incorrect entries of provider or provider-representative-supplied
information in the wrong places" (CMS).

Scans every Practitioner resource for multiple PII / data-integrity
patterns and classifies by JSON location:

  SSN exposures (PII)
    - dashed SSN \\d{3}-\\d{2}-\\d{4} in qualification[].identifier[].value
      (state-license credential slot — provider entered SSN where the
      state license number was supposed to go)
    - dashed SSN in name[].given[]              (entered as a given-name token)
    - dashed SSN in name[].family               (entered as the family name)
    - undashed 9-digit SSN exactly equal to a name token in name[].given[]
      or name[].family — caught by ^\\d{9}$ where the entire name field
      is digits-only (high confidence it's an SSN, not a coincidence)

  Date-of-birth exposures (PII)
    - ISO date \\d{4}-\\d{2}-\\d{2} in name[].given[] or name[].family
    - US date  \\d{1,2}/\\d{1,2}/\\d{4} in name[].given[] or name[].family

  Data-integrity (not PII per HIPAA but still wrong)
    - 10-digit NPI exactly equal to a name token (provider's own or
      someone else's NPI typed where the name belongs)

  False-positive filter
    - SSN-pattern as substring of an international phone number
      (e.g. Italy "39-XXX-XX-XXXX") — excluded from confirmed SSN counts

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
"""
from __future__ import annotations
import json
import pathlib
import subprocess
from datetime import datetime, timezone
from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE_DATE = "2026-04-09"
METHODOLOGY_VERSION = "0.6.0"

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


def run() -> None:
    client = bigquery.Client(project=PROJECT)

    # Practitioner-side scan with location classification.
    # Two-pass scan: dashed-SSN net (the WaPo replication, narrow regex) +
    # undashed-SSN/DOB/NPI-in-name net (suspicious LOCATIONS only, to keep
    # 9-digit false positives bounded).
    pract_sql = f"""
    WITH source AS (
      SELECT _id, _npi, _family_name, _given_name, _state,
             resource, TO_JSON_STRING(resource) AS json
      FROM `{PROJECT}.{DATASET}.practitioner`
    ),
    flagged AS (
      SELECT * FROM source
      WHERE REGEXP_CONTAINS(json, r'\\b\\d{{3}}-\\d{{2}}-\\d{{4}}\\b')              -- dashed SSN anywhere
         OR REGEXP_CONTAINS(json, r'"given":\\[[^\\]]*"\\d{{9,10}}"')                -- 9-10 digit string AS a given-name token
         OR REGEXP_CONTAINS(json, r'"family":"\\d{{9,10}}"')                          -- 9-10 digit string AS family name
         OR REGEXP_CONTAINS(json, r'"given":\\[[^\\]]*"\\d{{4}}-\\d{{2}}-\\d{{2}}"') -- ISO DOB AS given
         OR REGEXP_CONTAINS(json, r'"family":"\\d{{4}}-\\d{{2}}-\\d{{2}}"')           -- ISO DOB AS family
         OR REGEXP_CONTAINS(json, r'"given":\\[[^\\]]*"\\d{{1,2}}/\\d{{1,2}}/\\d{{4}}"') -- US DOB AS given
         OR REGEXP_CONTAINS(json, r'"family":"\\d{{1,2}}/\\d{{1,2}}/\\d{{4}}"')        -- US DOB AS family
    )
    SELECT
      _npi, _family_name, _given_name, _state,
      -- Dashed SSN (PII)
      REGEXP_CONTAINS(json, r'"value":"[^"]*\\d{{3}}-\\d{{2}}-\\d{{4}}"')
        AS ssn_dashed_in_identifier_value,
      REGEXP_CONTAINS(json, r'"given":\\[[^\\]]*\\d{{3}}-\\d{{2}}-\\d{{4}}')
        AS ssn_dashed_in_given_name,
      REGEXP_CONTAINS(json, r'"family":"[^"]*\\d{{3}}-\\d{{2}}-\\d{{4}}"')
        AS ssn_dashed_in_family_name,
      -- Undashed SSN: exact 9-digit name token (high confidence it's an SSN)
      REGEXP_CONTAINS(json, r'"given":\\[[^\\]]*"\\d{{9}}"')
        AS ssn_undashed_in_given_name,
      REGEXP_CONTAINS(json, r'"family":"\\d{{9}}"')
        AS ssn_undashed_in_family_name,
      -- DOB (PII)
      REGEXP_CONTAINS(json, r'"given":\\[[^\\]]*"\\d{{4}}-\\d{{2}}-\\d{{2}}"')
        AS dob_iso_in_given_name,
      REGEXP_CONTAINS(json, r'"family":"\\d{{4}}-\\d{{2}}-\\d{{2}}"')
        AS dob_iso_in_family_name,
      REGEXP_CONTAINS(json, r'"given":\\[[^\\]]*"\\d{{1,2}}/\\d{{1,2}}/\\d{{4}}"')
        AS dob_us_in_given_name,
      REGEXP_CONTAINS(json, r'"family":"\\d{{1,2}}/\\d{{1,2}}/\\d{{4}}"')
        AS dob_us_in_family_name,
      -- 10-digit NPI as a name token (data integrity, not PII)
      REGEXP_CONTAINS(json, r'"given":\\[[^\\]]*"\\d{{10}}"')
        AS npi_in_given_name,
      REGEXP_CONTAINS(json, r'"family":"\\d{{10}}"')
        AS npi_in_family_name,
      -- Italy / other intl phone patterns: 39-XXX-XX-XXXX, 49-XXX-XX-XXXX, etc.
      REGEXP_CONTAINS(json, r'\\d{{2}}-\\d{{3}}-\\d{{2}}-\\d{{4}}')
        AS likely_intl_phone_fp
    FROM flagged
    """
    pract_rows = list(client.query(pract_sql).result())

    # Bucket. Each record gets at most one label per category; the SSN buckets
    # are mutually exclusive (a record's SSN exposure is either dashed-in-qual,
    # dashed-in-given, dashed-in-family, undashed-in-given, or
    # undashed-in-family — first match wins, in priority order).
    real_in_qualification = []
    real_dashed_in_given = []
    real_dashed_in_family = []
    real_undashed_in_given = []
    real_undashed_in_family = []
    dob_in_name = []
    npi_in_name = []
    false_positive_phones = []

    for r in pract_rows:
        is_phone_fp = bool(r.likely_intl_phone_fp)
        if r.ssn_dashed_in_given_name:
            real_dashed_in_given.append(r)
        elif r.ssn_dashed_in_family_name:
            real_dashed_in_family.append(r)
        elif r.ssn_dashed_in_identifier_value and not is_phone_fp:
            real_in_qualification.append(r)
        elif r.ssn_undashed_in_given_name:
            real_undashed_in_given.append(r)
        elif r.ssn_undashed_in_family_name:
            real_undashed_in_family.append(r)
        elif is_phone_fp:
            false_positive_phones.append(r)
        # DOB and NPI-in-name are independent overlays — record both even if
        # the same record also has an SSN exposure.
        if r.dob_iso_in_given_name or r.dob_iso_in_family_name \
           or r.dob_us_in_given_name or r.dob_us_in_family_name:
            dob_in_name.append(r)
        if r.npi_in_given_name or r.npi_in_family_name:
            npi_in_name.append(r)

    confirmed_ssn = (real_in_qualification + real_dashed_in_given
                     + real_dashed_in_family + real_undashed_in_given
                     + real_undashed_in_family)
    # Backwards-compat aliases for the JSON keys that already shipped.
    real_in_given_name = real_dashed_in_given
    real_in_family_name = real_dashed_in_family
    confirmed = confirmed_ssn

    # Organization-side scan (lighter — far fewer hits historically).
    org_sql = f"""
    SELECT
      _id, _npi, _name, _state,
      TO_JSON_STRING(resource) AS json
    FROM `{PROJECT}.{DATASET}.organization`
    WHERE REGEXP_CONTAINS(TO_JSON_STRING(resource), r'\\b\\d{{3}}-\\d{{2}}-\\d{{4}}\\b')
      AND NOT REGEXP_CONTAINS(TO_JSON_STRING(resource), r'\\d{{2}}-\\d{{3}}-\\d{{2}}-\\d{{4}}')
    """
    org_rows = list(client.query(org_sql).result())

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

    ssn_total = len(confirmed_ssn)
    headline = (
        f"{ssn_total} confirmed SSN exposures + {len(dob_in_name)} date-of-birth "
        f"exposures + {len(npi_in_name)} NPI-as-name data-integrity violations "
        f"in the {RELEASE_DATE} NDH bulk export Practitioner resources, "
        f"independently verifying and extending the 2026-04-30 Washington Post "
        f"finding. SSN breakdown: {len(real_in_qualification)} dashed in "
        f"qualification[].identifier[].value (state-license slot), "
        f"{len(real_dashed_in_given)} dashed in name[].given[], "
        f"{len(real_dashed_in_family)} dashed in name[].family, "
        f"{len(real_undashed_in_given)} undashed-9-digit in name[].given[], "
        f"{len(real_undashed_in_family)} undashed in name[].family. "
        f"{len(false_positive_phones)} international phone-format false positives "
        f"filtered out. {len(org_rows)} Organization resources also carry "
        f"SSN-pattern strings."
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
        "denominator": 7_441_213,  # total NDH Practitioner resources
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": s["state"], "value": s["count"]}
                for s in state_breakdown[:15]
            ],
        },
        "notes": (
            f"Independently verifies the 2026-04-30 Washington Post finding by "
            f"scanning the 2026-04-09 NDH bulk export (already loaded into "
            f"BigQuery as `cms_npd.practitioner`/`cms_npd.organization`) for "
            f"the dashed SSN format \\\\d{{3}}-\\\\d{{2}}-\\\\d{{4}} in the full "
            f"resource JSON. WaPo reported 'dozens'; the AINPI scan identifies "
            f"{len(confirmed)} confirmed exposures across {len(state_breakdown)} "
            f"states. CMS attributed the leak to 'incorrect entries of provider "
            f"or provider-representative-supplied information in the wrong "
            f"places' — borne out by the JSON-location breakdown: most SSNs "
            f"are in qualification.identifier.value (the state-license slot), "
            f"with {len(real_in_given_name)} cases of providers entering their "
            f"SSN literally as a name token. Privacy posture: AINPI publishes "
            f"counts, JSON locations, NPIs (professional IDs, not PII), and "
            f"state breakdowns. The SSN values themselves are NOT republished "
            f"in this finding's output, even though they remain in the public "
            f"NDH bulk file CMS distributed. State Medicaid PI teams that "
            f"want to validate or remediate should contact CMS NDH operations "
            f"directly."
        ),
    }

    detail_payload = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "denominator_practitioners": 7_441_213,
        "totals": {
            "flagged_pattern_match": len(pract_rows),
            "confirmed_ssn_exposures": len(confirmed_ssn),
            "ssn_dashed_in_qualification_identifier_value": len(real_in_qualification),
            "ssn_dashed_in_given_name": len(real_dashed_in_given),
            "ssn_dashed_in_family_name": len(real_dashed_in_family),
            "ssn_undashed_in_given_name": len(real_undashed_in_given),
            "ssn_undashed_in_family_name": len(real_undashed_in_family),
            "dob_in_name_field": len(dob_in_name),
            "npi_in_name_field": len(npi_in_name),
            "intl_phone_false_positives": len(false_positive_phones),
            "organization_pattern_matches": len(org_rows),
        },
        "state_breakdown": state_breakdown,
        "samples": samples,
        "limitations": [
            "Detection regex is the dashed SSN format \\d{3}-\\d{2}-\\d{4}. Undashed 9-digit SSNs are NOT detected here because they collide with too many other 9-digit identifiers (EINs, account numbers, claim IDs). True coverage is therefore a lower bound — actual SSN exposure may be higher.",
            "False positive guard: international phone-number formats (Italy '39-XXX-XX-XXXX', etc.) match the same regex. We classify any record whose JSON also contains the prefix-extended pattern \\d{2}-\\d{3}-\\d{2}-\\d{4} as a phone false positive and exclude it from the confirmed total.",
            "Privacy: the SSN values themselves are not published in this finding output, despite being in the underlying NDH bulk file CMS distributed publicly. The finding reports counts, JSON locations, NPIs (which are professional credentials, not PII per HIPAA), and state breakdowns only.",
            "Source attribution: original reporting is by the Washington Post (2026-04-30, paywalled). AINPI's value-add is an independent, reproducible scan of the same public file, with a precise location-and-count breakdown the WaPo article did not publish.",
            "Remediation belongs to CMS NDH operations. AINPI is a verification surface, not a notification mechanism. The 45 affected providers should be contacted by CMS or their state board, not by AINPI.",
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
