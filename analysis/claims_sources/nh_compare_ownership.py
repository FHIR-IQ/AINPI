"""H35 — Federally excluded individuals listed as owners of nursing homes,
hospices, home health agencies, and hospitals.

Highest-impact finding for vulnerable populations. The CMS Disclosure of
Ownership and Additional Disclosable Parties Interim Final Rule (2023)
expanded ownership transparency precisely to surface concerning ownership
structures. Cross-referencing this against federal exclusion lists is
what the rule was designed to enable.

IMPORTANT METHODOLOGY NOTE — DEMOGRAPHIC MATCHING:
    The CMS "All Owners" files do not carry an owner-NPI column. The
    only join keys available are (LAST_NAME, FIRST_NAME, STATE) from
    the owner record matched against (LASTNAME, FIRSTNAME, STATE) in
    OIG LEIE. This is a DEMOGRAPHIC MATCH which has known false-positive
    risk (two people with the same name in the same state are not the
    same person).

    Per the cross-audit roadmap §8 ("not fraud determinations") this
    finding publishes CANDIDATE MATCHES that DMAS / state survey
    agencies / consumers must verify against the LEIE portal directly.
    Confidence flag is set in the JSON. Each row in the per-state CSV
    carries the LEIE lookup URL so verification is one click away.

Sources:
    CMS Provider Enrollment Datasets — Quarterly "All Owners" files
    (data.cms.gov, monthly cadence per the public-data data dictionary):
        HHA_All_Owners_2026.04.01.csv
        Hospice_All_Owners_2026.04.01.csv
        Hospital_All_Owners_2026.04.01.csv
        SNF_All_Owners_2026.04.01.csv

    OIG LEIE active rows (BigQuery cms_npd.oig_leie).

Writes:
    frontend/public/api/v1/findings/nh-hospice-hh-ownership-flags.json
    frontend/public/api/v1/findings/nh-hospice-hh-ownership-flags-detail.json
    frontend/public/api/v1/states/va/h35-nh-ownership-flags.csv
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from collections import defaultdict
from datetime import datetime, timezone

from google.cloud import bigquery

METHODOLOGY_VERSION = "0.6.0-draft"
DATA_SOURCE_RELEASE = "CMS Quarterly All Owners files (2026-04-01)"
PROJECT = "thematic-fort-453901-t7"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "frontend" / "data" / "cms-claims"
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
STATES_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states"

OWNER_FILES = [
    ("SNF", "Skilled Nursing Facilities", DATA_DIR / "SNF_All_Owners_2026.04.01.csv"),
    ("HOSPICE", "Hospices", DATA_DIR / "Hospice_All_Owners_2026.04.01.csv"),
    ("HHA", "Home Health Agencies", DATA_DIR / "HHA_All_Owners_2026.04.01.csv"),
    ("HOSPITAL", "Hospitals", DATA_DIR / "Hospital_All_Owners_2026.04.01.csv"),
]


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


def load_leie_demographics(client: bigquery.Client) -> dict[tuple, list[dict]]:
    """Build (LAST|FIRST|STATE) -> list of LEIE records.

    A single key can map to multiple records if there are multiple
    exclusions for the same demographic triple — that's fine; we surface
    all of them in the candidate-match output.
    """
    sql = """
    SELECT
      LASTNAME, FIRSTNAME, MIDNAME, STATE, GENERAL, EXCLDATE, EXCLTYPE, NPI
    FROM `thematic-fort-453901-t7.cms_npd.oig_leie`
    WHERE IFNULL(REINDATE, '00000000') = '00000000'
      AND LASTNAME IS NOT NULL AND LASTNAME != ''
      AND FIRSTNAME IS NOT NULL AND FIRSTNAME != ''
      AND STATE IS NOT NULL AND LENGTH(STATE) = 2
    """
    out: dict[tuple, list[dict]] = defaultdict(list)
    for row in client.query(sql).result():
        key = (row.LASTNAME.upper().strip(), row.FIRSTNAME.upper().strip(), row.STATE.upper().strip())
        out[key].append({
            "lastname": row.LASTNAME,
            "firstname": row.FIRSTNAME,
            "midname": row.MIDNAME,
            "state": row.STATE,
            "general": row.GENERAL,
            "excldate": row.EXCLDATE,
            "excltype": row.EXCLTYPE,
            "npi": row.NPI,
        })
    print(f"LEIE active demographic keys (last, first, state): {len(out)}")
    return out


def scan_owner_file(path: pathlib.Path, leie_keys: dict) -> list[dict]:
    """Return candidate matches with all owner-side context."""
    if not path.exists():
        print(f"WARN: {path.name} missing — skipping")
        return []
    matches = []
    with open(path, newline="", encoding="latin-1") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            last = (row.get("LAST NAME - OWNER") or "").upper().strip()
            first = (row.get("FIRST NAME - OWNER") or "").upper().strip()
            state = (row.get("STATE - OWNER") or "").upper().strip()
            if not last or not first or len(state) != 2:
                continue
            key = (last, first, state)
            leie_recs = leie_keys.get(key)
            if not leie_recs:
                continue
            # Add one row per (owner record × LEIE record) match — these are
            # the candidate flags. Most pairs will collapse to a single record
            # but if LEIE has multiple exclusion entries for the same name, we
            # surface them all so DMAS sees the right exclusion to verify.
            for leie in leie_recs:
                matches.append({
                    "facility_type": path.stem.split("_")[0],
                    "enrollment_id": row.get("ENROLLMENT ID", ""),
                    "facility_name": row.get("ORGANIZATION NAME", ""),
                    "owner_last_name": row.get("LAST NAME - OWNER", ""),
                    "owner_first_name": row.get("FIRST NAME - OWNER", ""),
                    "owner_middle_name": row.get("MIDDLE NAME - OWNER", ""),
                    "owner_state": row.get("STATE - OWNER", ""),
                    "owner_city": row.get("CITY - OWNER", ""),
                    "owner_role": row.get("ROLE TEXT - OWNER", ""),
                    "ownership_pct": row.get("PERCENTAGE OWNERSHIP", ""),
                    "association_date": row.get("ASSOCIATION DATE - OWNER", ""),
                    "leie_last_name": leie["lastname"],
                    "leie_first_name": leie["firstname"],
                    "leie_state": leie["state"],
                    "leie_exclusion_date": leie["excldate"],
                    "leie_general_category": leie["general"],
                    "leie_exclusion_type": leie["excltype"],
                    "leie_npi": leie["npi"] or "",
                    "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
                    "verification_note": (
                        "CANDIDATE MATCH on (last, first, state). "
                        "Verify against LEIE portal before action."
                    ),
                })
    return matches


def main() -> None:
    client = bigquery.Client(project=PROJECT)
    leie_keys = load_leie_demographics(client)

    all_matches: list[dict] = []
    per_type_counts: dict[str, int] = {}
    for code, label, path in OWNER_FILES:
        print(f"\nScanning {path.name}...")
        m = scan_owner_file(path, leie_keys)
        per_type_counts[label] = len(m)
        print(f"  candidate matches: {len(m)}")
        all_matches.extend(m)

    # Per-state breakdown
    va_matches = [r for r in all_matches if r["owner_state"] == "VA"]
    facility_state_counts = defaultdict(int)
    for r in all_matches:
        facility_state_counts[r["owner_state"]] += 1

    print(f"\nTotal candidate matches nationally: {len(all_matches)}")
    print(f"  VA-state owners: {len(va_matches)}")
    print(f"  Per facility type: {per_type_counts}")

    # Write VA per-state CSV
    fields = [
        "facility_type", "enrollment_id", "facility_name",
        "owner_last_name", "owner_first_name", "owner_middle_name",
        "owner_state", "owner_city", "owner_role", "ownership_pct",
        "association_date",
        "leie_last_name", "leie_first_name", "leie_state",
        "leie_exclusion_date", "leie_general_category", "leie_exclusion_type",
        "leie_npi", "leie_lookup_url", "verification_note",
    ]
    out_dir = STATES_DIR / "va"
    out_dir.mkdir(parents=True, exist_ok=True)
    va_csv = out_dir / "h35-nh-ownership-flags.csv"
    with open(va_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in va_matches:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"Wrote VA: {va_csv} ({len(va_matches)} rows)")

    national_csv = FINDINGS_DIR / "nh-hospice-hh-ownership-flags-detail.csv"
    with open(national_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in all_matches:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"Wrote national: {national_csv} ({len(all_matches)} rows)")

    if len(all_matches) == 0:
        headline = (
            f"0 (LAST, FIRST, STATE) demographic matches between owners of "
            f"Medicare-enrolled nursing homes (SNFs), hospices, home health "
            f"agencies, and hospitals (CMS Quarterly All Owners files, "
            f"2026-04-01 release) and the {len(leie_keys):,} active OIG LEIE "
            f"demographic keys. This NULL RESULT is meaningful but limited: "
            f"the demographic-match key catches obvious cases (full name + "
            f"state alignment) but not aliases, DBA names listed in the owner "
            f"slot, name variants, or anyone whose listed owner state differs "
            f"from their LEIE state. The right next step is the Stage B "
            f"NPI-keyed match against PECOS owner-NPI fields once those are "
            f"in scope. By facility type: {', '.join(f'{k} {v}' for k, v in per_type_counts.items())}."
        )
    else:
        headline = (
            f"AINPI identifies {len(all_matches)} CANDIDATE matches between "
            f"owners of Medicare-enrolled nursing homes (SNFs), hospices, "
            f"home health agencies, and hospitals (CMS Quarterly All Owners "
            f"files, 2026-04-01 release) and the OIG LEIE active exclusion "
            f"list — keyed on (LAST, FIRST, STATE) demographic match. "
            f"{len(va_matches)} of those are VA-state owners. By facility "
            f"type: {', '.join(f'{k} {v}' for k, v in per_type_counts.items())}. "
            f"IMPORTANT: this is a DEMOGRAPHIC MATCH, not an NPI-keyed match — "
            f"two people with the same name in the same state are not the same "
            f"person. Every candidate row must be verified against the LEIE "
            f"portal before any state survey agency or DMAS action. The data "
            f"surface is provided so consumers (\"is the nursing home for my "
            f"parent owned by someone with sanctions?\") and state survey "
            f"agencies can run the verification themselves; AINPI does not "
            f"make a fraud determination from a demographic match alone."
        )

    payload = {
        "slug": "nh-hospice-hh-ownership-flags",
        "title": "Nursing home, hospice, home health, hospital owners on federal exclusion lists",
        "hypotheses": ["H35"],
        "status": "published",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "data_confidence": "candidate",
        "data_confidence_note": (
            "Demographic match on (last_name, first_name, state). Owner "
            "records do not carry NPI; LEIE records carry NPI inconsistently. "
            "This is a candidate-match surface, NOT a confirmed match. Verify "
            "each row against the LEIE portal directly before acting."
        ),
        "headline": headline,
        "numerator": len(all_matches),
        "denominator": None,
        "denominator_note": (
            "Denominator is not pinned because the CMS All Owners files are "
            "owner-record-level (multiple rows per owner if they hold "
            "interests in multiple facilities); the right denominator depends "
            "on the consuming workflow. Total owner records scanned across "
            "the four files is in the millions; per-LEIE-key match rate is "
            "what should be cited rather than a single percentage."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://data.cms.gov/provider-characteristics",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": label, "value": count}
                for label, count in per_type_counts.items()
            ],
        },
        "notes": (
            "Methodology: demographic match on UPPER(LAST_NAME) || '|' || "
            "UPPER(FIRST_NAME) || '|' || UPPER(STATE) between the CMS All "
            "Owners files and OIG LEIE active exclusions. False-positive "
            "rate is non-trivial because common-name pairs in large states "
            "(e.g., SMITH, JOHN, CA) will inevitably collide. Each candidate "
            "match row in the per-state CSV carries the LEIE state, exclusion "
            "date, exclusion type, and LEIE category so DMAS / state survey "
            "agency staff can verify in seconds. Per the cross-audit roadmap "
            "§8 (\"not fraud determinations\") and §10 (\"publish when "
            "available and high confidence\") this finding is published as a "
            "verification surface for human review, not as a confirmed "
            "ownership-by-excluded-individual claim. Stage B work: cross-walk "
            "LEIE NPI (where present) to CMS PECOS owner-NPI fields to lift "
            "the confidence tier; that requires PECOS owner-NPI data which "
            "is not currently in scope."
        ),
    }

    out = FINDINGS_DIR / "nh-hospice-hh-ownership-flags.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {out}")

    detail = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_confidence": "candidate",
        "data_confidence_note": payload["data_confidence_note"],
        "leie_demographic_keys": len(leie_keys),
        "candidate_matches_total": len(all_matches),
        "candidate_matches_va": len(va_matches),
        "by_facility_type": per_type_counts,
        "top_states_by_matches": [
            {"state": s, "candidate_matches": c}
            for s, c in sorted(facility_state_counts.items(), key=lambda kv: kv[1], reverse=True)[:15]
        ],
        "sample_va_rows": [
            {k: r.get(k) for k in (
                "facility_type", "facility_name", "owner_last_name",
                "owner_first_name", "owner_state", "owner_city", "owner_role",
                "leie_exclusion_date", "leie_general_category", "leie_exclusion_type",
            )}
            for r in va_matches[:10]
        ],
        "csv_url_national": "/api/v1/findings/nh-hospice-hh-ownership-flags-detail.csv",
        "csv_url_va": "/api/v1/states/va/h35-nh-ownership-flags.csv",
    }
    (FINDINGS_DIR / "nh-hospice-hh-ownership-flags-detail.json").write_text(
        json.dumps(detail, indent=2) + "\n"
    )
    print(f"Wrote {FINDINGS_DIR / 'nh-hospice-hh-ownership-flags-detail.json'}")

    if va_matches:
        print("\nTop 10 VA candidate matches:")
        for r in va_matches[:10]:
            print(f"  [{r['facility_type']}]  {r['facility_name'][:35]:35s}  {r['owner_last_name']}, {r['owner_first_name']}  ({r['leie_exclusion_date']})")


if __name__ == "__main__":
    main()
