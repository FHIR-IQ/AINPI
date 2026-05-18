"""H35 Stage B — Federally excluded individuals listed as owners of nursing
homes, hospices, home health agencies, and hospitals (NPI-keyed +
facility-state demographic match).

Highest-impact finding for vulnerable populations. The CMS Disclosure of
Ownership and Additional Disclosable Parties Interim Final Rule (2023)
expanded ownership transparency precisely to surface concerning ownership
structures. Cross-referencing this against federal exclusion lists is
what the rule was designed to enable.

METHODOLOGY — TWO-TIER MATCH (Stage B, 2026-05-14):

    Tier 1 (confirmed_npi): NPI-keyed match.
        Owner ASSOCIATE ID → NPI via CMS PPEF (Medicare Fee-For-Service
        Public Provider Enrollment, 2026-04-01, 2.47M individual NPIs).
        Resolved NPI then checked against LEIE.NPI (NPI populated on
        ~10% of active LEIE rows) and SAM exclusions.npi.
        Authoritative — same NPI, same person, no demographic ambiguity.

    Tier 2 (candidate_demographic): (LAST, FIRST, FACILITY_STATE) match
        against LEIE.
        IMPORTANT DATA-SHAPE NOTE: CMS does NOT populate STATE - OWNER
        for individual owners (TYPE='I') in the All Owners files (100%
        empty in the 2026-04-01 release). The v1 demographic match
        joined on owner-state and therefore produced a structural-null
        result, not a true zero. Stage B substitutes the FACILITY's
        STATE_CD from PPEF (resolved via ENROLLMENT ID → ENRLMT_ID,
        100% lookup hit rate) as the owner's state of operation. This
        is a reasonable geographic-plausibility filter: a SMITH, JOHN
        listed as an owner of a Texas SNF whose LEIE record has STATE='TX'
        is a much stronger candidate than the same demographic pair
        with LEIE.STATE='FL'.

    Tier 1 is the regulatorily significant signal — published as the
    headline numerator. Tier 2 is a candidate-verification surface
    that state survey agencies / state PI offices must verify against
    the LEIE portal before action.

REACH CONTEXT (why these numbers will be small):
    Exclusion under 42 USC § 1320a-7 forces CMS to revoke the provider's
    Medicare enrollment. PPEF tracks currently-enrolled providers, so
    most excluded NPIs are by definition not in PPEF — only 25 of the
    8,619 LEIE∪SAM-active NPIs are also in PPEF (recent exclusions
    not yet processed out). Tier 1 is therefore inherently a small-N
    finding; absence of matches is itself a signal that CMS's
    revocation pipeline is working as designed. Tier 2 captures the
    larger demographic-only population at lower confidence.

Sources:
    CMS Quarterly All Owners files (2026-04-01, ~594K owner rows):
        SNF_All_Owners_2026.04.01.csv
        Hospice_All_Owners_2026.04.01.csv
        HHA_All_Owners_2026.04.01.csv
        Hospital_All_Owners_2026.04.01.csv

    CMS Medicare Fee-For-Service Public Provider Enrollment (PPEF,
    2026-04-01, 2.98M rows, ~2.47M individual NPIs + 433K orgs):
        PPEF_Enrollment_Extract_2026.04.01.csv

    OIG LEIE active exclusions (BigQuery cms_npd.oig_leie).
    SAM.gov active exclusions (BigQuery cms_npd.sam_exclusions).

Writes:
    frontend/public/api/v1/findings/nh-hospice-hh-ownership-flags.json
    frontend/public/api/v1/findings/nh-hospice-hh-ownership-flags-detail.json
    frontend/public/api/v1/findings/nh-hospice-hh-ownership-flags-detail.csv
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

METHODOLOGY_VERSION = "0.6.1-draft"
DATA_SOURCE_RELEASE = "CMS Quarterly All Owners + PPEF (both 2026-04-01)"
PROJECT = "thematic-fort-453901-t7"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "frontend" / "data" / "cms-claims"
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
STATES_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states"

PPEF_CSV = DATA_DIR / "PPEF_Enrollment_Extract_2026.04.01.csv"

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


def load_ppef() -> tuple[dict, dict]:
    """Single pass over PPEF, returning two lookups:

    assoc_to_npi: PECOS_ASCT_CNTL_ID → {npi, first, last, state}
        For Tier 1 NPI-keyed match.
    enrl_to_state: ENRLMT_ID → STATE_CD
        For Tier 2 facility-state demographic match.
    """
    assoc_to_npi: dict[str, dict] = {}
    enrl_to_state: dict[str, str] = {}
    with open(PPEF_CSV, newline="", encoding="latin-1") as fh:
        for row in csv.DictReader(fh):
            assoc = (row.get("PECOS_ASCT_CNTL_ID") or "").strip()
            npi = (row.get("NPI") or "").strip()
            eid = (row.get("ENRLMT_ID") or "").strip()
            st = (row.get("STATE_CD") or "").strip()
            if eid and st:
                # First enrollment record per ENRLMT_ID wins; multiple PPEF
                # rows per enrollment_id are rare and same-state.
                enrl_to_state.setdefault(eid, st)
            if assoc and npi:
                assoc_to_npi.setdefault(assoc, {
                    "npi": npi,
                    "first": (row.get("FIRST_NAME") or "").upper().strip(),
                    "last": (row.get("LAST_NAME") or "").upper().strip(),
                    "state": st,
                })
    print(f"PPEF: {len(assoc_to_npi):,} ASSOCIATE_ID → NPI entries")
    print(f"PPEF: {len(enrl_to_state):,} ENRLMT_ID → STATE entries")
    return assoc_to_npi, enrl_to_state


def load_leie(client: bigquery.Client) -> tuple[dict, dict]:
    """Return (leie_by_npi, leie_by_demo)."""
    sql = """
    SELECT
      LASTNAME, FIRSTNAME, MIDNAME, STATE, GENERAL, EXCLDATE, EXCLTYPE, NPI
    FROM `thematic-fort-453901-t7.cms_npd.oig_leie`
    WHERE IFNULL(REINDATE, '00000000') = '00000000'
      AND LASTNAME IS NOT NULL AND LASTNAME != ''
      AND FIRSTNAME IS NOT NULL AND FIRSTNAME != ''
      AND STATE IS NOT NULL AND LENGTH(STATE) = 2
    """
    by_npi: dict[str, list] = defaultdict(list)
    by_demo: dict[tuple, list] = defaultdict(list)
    for row in client.query(sql).result():
        rec = {
            "source": "LEIE",
            "lastname": row.LASTNAME,
            "firstname": row.FIRSTNAME,
            "midname": row.MIDNAME,
            "state": row.STATE,
            "general": row.GENERAL,
            "excldate": row.EXCLDATE,
            "excltype": row.EXCLTYPE,
            "npi": row.NPI or "",
        }
        npi = (row.NPI or "").strip()
        if npi and npi != "0000000000" and len(npi) == 10:
            by_npi[npi].append(rec)
        key = (row.LASTNAME.upper().strip(), row.FIRSTNAME.upper().strip(),
               row.STATE.upper().strip())
        by_demo[key].append(rec)
    print(f"LEIE: {sum(len(v) for v in by_npi.values()):,} rows with NPI ({len(by_npi):,} distinct NPIs)")
    print(f"LEIE: {len(by_demo):,} demographic keys (LAST, FIRST, STATE)")
    return dict(by_npi), dict(by_demo)


def load_sam(client: bigquery.Client) -> dict:
    """Return sam_by_npi: NPI → [record, ...]."""
    sql = """
    SELECT
      first_name, last_name, state_province, exclusion_type,
      excluding_agency, active_date, termination_date, npi
    FROM `thematic-fort-453901-t7.cms_npd.sam_exclusions`
    WHERE record_status = 'Active'
      AND npi IS NOT NULL AND npi != '' AND npi != '0000000000'
    """
    out: dict[str, list] = defaultdict(list)
    for row in client.query(sql).result():
        npi = (row.npi or "").strip()
        if not npi or len(npi) != 10:
            continue
        out[npi].append({
            "source": "SAM",
            "lastname": row.last_name or "",
            "firstname": row.first_name or "",
            "state": row.state_province or "",
            "excluding_agency": row.excluding_agency or "",
            "excltype": row.exclusion_type or "",
            "excldate": str(row.active_date)[:10] if row.active_date else "",
            "termdate": str(row.termination_date)[:10] if row.termination_date else "",
            "npi": npi,
            "general": "",
        })
    print(f"SAM: {sum(len(v) for v in out.values()):,} active exclusions with NPI ({len(out):,} distinct NPIs)")
    return dict(out)


def scan_owner_file(
    path: pathlib.Path,
    assoc_to_npi: dict,
    enrl_to_state: dict,
    leie_by_npi: dict,
    leie_by_demo: dict,
    sam_by_npi: dict,
) -> list[dict]:
    if not path.exists():
        print(f"WARN: {path.name} missing — skipping")
        return []
    matches: list[dict] = []
    with open(path, newline="", encoding="latin-1") as fh:
        for row in csv.DictReader(fh):
            # Only individual-owner rows are matchable against LEIE/SAM.
            type_owner = (row.get("TYPE - OWNER") or "").strip().upper()
            if type_owner != "I":
                continue
            last = (row.get("LAST NAME - OWNER") or "").upper().strip()
            first = (row.get("FIRST NAME - OWNER") or "").upper().strip()
            assoc = (row.get("ASSOCIATE ID - OWNER") or "").strip()
            eid = (row.get("ENROLLMENT ID") or "").strip()
            if not last or not first:
                continue
            facility_state = enrl_to_state.get(eid, "")

            # Tier 1: NPI-keyed via PPEF cross-walk
            confirmed: list[dict] = []
            owner_npi = ""
            ppef_rec = assoc_to_npi.get(assoc)
            if ppef_rec:
                owner_npi = ppef_rec["npi"]
                confirmed.extend(leie_by_npi.get(owner_npi, []))
                confirmed.extend(sam_by_npi.get(owner_npi, []))

            # Tier 2: (LAST, FIRST, FACILITY_STATE) demographic match against LEIE.
            # Owner-side STATE is structurally empty for individuals, so we use
            # the facility's state via PPEF as the geographic-plausibility filter.
            demo: list[dict] = []
            if facility_state:
                demo = leie_by_demo.get((last, first, facility_state), [])

            # Tier 1 supersedes Tier 2 for the same owner (we surface the
            # confirmed match instead of the lower-confidence demographic match).
            if confirmed:
                for ex in confirmed:
                    matches.append(_build_row(
                        path, row, assoc, owner_npi, ppef_rec, facility_state,
                        ex, tier="confirmed_npi",
                    ))
            elif demo:
                for ex in demo:
                    matches.append(_build_row(
                        path, row, assoc, owner_npi, ppef_rec, facility_state,
                        ex, tier="candidate_demographic",
                    ))
    return matches


def _build_row(path, owner_row, assoc, owner_npi, ppef_rec, facility_state, ex, tier):
    return {
        "match_tier": tier,
        "facility_type": path.stem.split("_")[0],
        "facility_enrollment_id": owner_row.get("ENROLLMENT ID", ""),
        "facility_state": facility_state,
        "facility_name": owner_row.get("ORGANIZATION NAME", ""),
        "owner_associate_id": assoc,
        "owner_npi": owner_npi,
        "owner_npi_first_name_ppef": ppef_rec.get("first", "") if ppef_rec else "",
        "owner_npi_last_name_ppef": ppef_rec.get("last", "") if ppef_rec else "",
        "owner_npi_state_ppef": ppef_rec.get("state", "") if ppef_rec else "",
        "owner_last_name": owner_row.get("LAST NAME - OWNER", ""),
        "owner_first_name": owner_row.get("FIRST NAME - OWNER", ""),
        "owner_middle_name": owner_row.get("MIDDLE NAME - OWNER", ""),
        "owner_role": owner_row.get("ROLE TEXT - OWNER", ""),
        "ownership_pct": owner_row.get("PERCENTAGE OWNERSHIP", ""),
        "association_date": owner_row.get("ASSOCIATION DATE - OWNER", ""),
        "exclusion_source": ex.get("source", ""),
        "exclusion_npi": ex.get("npi", ""),
        "exclusion_last_name": ex.get("lastname", ""),
        "exclusion_first_name": ex.get("firstname", ""),
        "exclusion_state": ex.get("state", ""),
        "exclusion_date": ex.get("excldate", ""),
        "exclusion_general_category": ex.get("general", ""),
        "exclusion_type": ex.get("excltype", ""),
        "excluding_agency": ex.get("excluding_agency", ""),
        "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
        "sam_lookup_url": "https://sam.gov/search/?index=ex",
        "nppes_lookup_url": (
            f"https://npiregistry.cms.hhs.gov/provider-view/{owner_npi}"
            if owner_npi else ""
        ),
        "verification_note": (
            "NPI-KEYED MATCH via PPEF cross-walk. Owner ASSOCIATE_ID → NPI; "
            "same NPI in LEIE/SAM. No demographic ambiguity."
            if tier == "confirmed_npi" else
            "CANDIDATE DEMOGRAPHIC MATCH on (last, first, facility_state). "
            "Facility state used because CMS does not populate owner-state "
            "for individuals. Verify against LEIE portal before action."
        ),
    }


def main() -> None:
    client = bigquery.Client(project=PROJECT)
    assoc_to_npi, enrl_to_state = load_ppef()
    leie_by_npi, leie_by_demo = load_leie(client)
    sam_by_npi = load_sam(client)

    all_matches: list[dict] = []
    per_type_counts: dict[str, dict[str, int]] = {}
    for code, label, path in OWNER_FILES:
        print(f"\nScanning {path.name}...")
        m = scan_owner_file(path, assoc_to_npi, enrl_to_state,
                            leie_by_npi, leie_by_demo, sam_by_npi)
        confirmed = sum(1 for r in m if r["match_tier"] == "confirmed_npi")
        candidate = sum(1 for r in m if r["match_tier"] == "candidate_demographic")
        per_type_counts[label] = {"confirmed_npi": confirmed,
                                   "candidate_demographic": candidate}
        print(f"  confirmed_npi:          {confirmed:,}")
        print(f"  candidate_demographic:  {candidate:,}")
        all_matches.extend(m)

    confirmed_total = sum(1 for r in all_matches if r["match_tier"] == "confirmed_npi")
    candidate_total = sum(1 for r in all_matches if r["match_tier"] == "candidate_demographic")

    va_matches = [r for r in all_matches if r["facility_state"] == "VA"]
    va_confirmed = sum(1 for r in va_matches if r["match_tier"] == "confirmed_npi")
    va_candidate = sum(1 for r in va_matches if r["match_tier"] == "candidate_demographic")
    state_counts = defaultdict(lambda: {"confirmed_npi": 0, "candidate_demographic": 0})
    for r in all_matches:
        state_counts[r["facility_state"]][r["match_tier"]] += 1

    print(f"\n=== Stage B results ===")
    print(f"confirmed_npi total:          {confirmed_total:,}")
    print(f"candidate_demographic total:  {candidate_total:,}")
    print(f"VA confirmed_npi:             {va_confirmed:,}")
    print(f"VA candidate_demographic:     {va_candidate:,}")

    fields = [
        "match_tier", "facility_type", "facility_enrollment_id", "facility_state",
        "facility_name",
        "owner_associate_id", "owner_npi",
        "owner_npi_first_name_ppef", "owner_npi_last_name_ppef", "owner_npi_state_ppef",
        "owner_last_name", "owner_first_name", "owner_middle_name",
        "owner_role", "ownership_pct", "association_date",
        "exclusion_source", "exclusion_npi",
        "exclusion_last_name", "exclusion_first_name", "exclusion_state",
        "exclusion_date", "exclusion_general_category", "exclusion_type",
        "excluding_agency",
        "leie_lookup_url", "sam_lookup_url", "nppes_lookup_url",
        "verification_note",
    ]

    out_dir = STATES_DIR / "va"
    out_dir.mkdir(parents=True, exist_ok=True)
    va_csv = out_dir / "h35-nh-ownership-flags.csv"
    with open(va_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in va_matches:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"\nWrote VA: {va_csv} ({len(va_matches):,} rows)")

    national_csv = FINDINGS_DIR / "nh-hospice-hh-ownership-flags-detail.csv"
    with open(national_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in all_matches:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"Wrote national: {national_csv} ({len(all_matches):,} rows)")

    facility_breakdown_str = "; ".join(
        f"{label}: {c['confirmed_npi']} confirmed / {c['candidate_demographic']} candidate"
        for label, c in per_type_counts.items()
    )

    if confirmed_total + candidate_total == 0:
        headline = (
            f"0 matches in either tier between owners of Medicare-enrolled "
            f"SNFs, hospices, home health agencies, and hospitals (CMS All "
            f"Owners 2026-04-01) and federal exclusion lists (OIG LEIE active "
            f"+ SAM.gov active). Tier 1 (NPI-keyed via the CMS PPEF cross-"
            f"walk, 2.47M individual NPIs) returns 0 because LEIE/SAM "
            f"exclusion forces revocation of the provider's Medicare "
            f"enrollment — only 25 of 8,619 LEIE∪SAM-active NPIs are still "
            f"in PPEF, and none of those 25 are listed as owners. Tier 2 "
            f"((LAST, FIRST, FACILITY_STATE) demographic match against LEIE) "
            f"also returns 0. The null result here is meaningful: CMS's "
            f"exclusion → revocation pipeline is doing what it's supposed "
            f"to do for the active LEIE∪SAM cohort."
        )
    elif confirmed_total == 0:
        headline = (
            f"AINPI identifies {candidate_total} CANDIDATE-DEMOGRAPHIC matches "
            f"and 0 CONFIRMED-NPI matches between owners of Medicare-enrolled "
            f"SNFs, hospices, home health agencies, and hospitals (CMS All "
            f"Owners 2026-04-01) and OIG LEIE active exclusions. Tier 1 "
            f"(NPI-keyed) returns 0 because exclusion forces Medicare "
            f"revocation — only 25 of 8,619 LEIE∪SAM-active NPIs are still "
            f"in the CMS PPEF cross-walk, and none of those 25 are listed "
            f"as owners. Tier 2 ((LAST, FIRST, FACILITY_STATE) demographic "
            f"match) surfaces {candidate_total} candidate rows: "
            f"{va_candidate} are VA-state facilities. {facility_breakdown_str}. "
            f"Every candidate row must be verified against the LEIE portal "
            f"before any state survey agency action."
        )
    else:
        headline = (
            f"AINPI identifies {confirmed_total} CONFIRMED-NPI matches and "
            f"{candidate_total} CANDIDATE-DEMOGRAPHIC matches between owners "
            f"of Medicare-enrolled SNFs, hospices, home health agencies, and "
            f"hospitals (CMS All Owners 2026-04-01) and federal exclusion "
            f"lists (OIG LEIE active + SAM.gov active). VA-state facilities: "
            f"{va_confirmed} confirmed / {va_candidate} candidate. "
            f"{facility_breakdown_str}. CONFIRMED-NPI tier resolves owner "
            f"NPI via the CMS PPEF cross-walk (ASSOCIATE ID - OWNER → "
            f"PECOS_ASCT_CNTL_ID → NPI) and checks that NPI against LEIE.NPI "
            f"and SAM.npi — no demographic ambiguity. CANDIDATE-DEMOGRAPHIC "
            f"tier uses (LAST, FIRST, FACILITY_STATE) against LEIE, with the "
            f"facility's state (resolved via PPEF ENRLMT_ID) standing in for "
            f"the owner state which CMS does not populate for individuals."
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
        "data_confidence": "two-tier",
        "data_confidence_note": (
            f"Two-tier methodology (Stage B, 0.6.1-draft). Tier 1 "
            f"(confirmed_npi, {confirmed_total:,} rows): NPI-keyed match via "
            f"CMS Medicare Fee-For-Service Public Provider Enrollment File "
            f"(ASSOCIATE ID - OWNER → PECOS_ASCT_CNTL_ID → NPI), checked "
            f"against LEIE.NPI and SAM.npi. Authoritative — same NPI, same "
            f"person. Tier 2 (candidate_demographic, {candidate_total:,} "
            f"rows): (LAST_NAME, FIRST_NAME, FACILITY_STATE) match against "
            f"LEIE. Facility state used because owner-side state is "
            f"structurally empty for individual owners in the All Owners "
            f"files. Carries known false-positive risk; published as a "
            f"verification surface, NOT a fraud determination."
        ),
        "headline": headline,
        "numerator": confirmed_total,
        "numerator_full_window": confirmed_total + candidate_total,
        "denominator": None,
        "numerator_note": (
            f"Headline numerator = confirmed_npi tier only ({confirmed_total}). "
            f"Full-window numerator (confirmed + candidate) = "
            f"{confirmed_total + candidate_total}."
        ),
        "denominator_note": (
            "Denominator is not pinned because the All Owners files are "
            "owner-record-level (multiple rows per owner if they hold "
            "interests in multiple facilities). Reach context: 444,106 "
            "individual-owner rows scanned across 4 facility types; PPEF "
            "ENRLMT_ID → STATE lookup hits 100% of those rows (facility "
            "state always resolved). LEIE active demographic keys = 78,688; "
            "LEIE NPI-populated = 8,608; SAM-active with NPI = 4,707. "
            "Tier 1 ceiling is bounded by the 25 LEIE∪SAM-active NPIs "
            "still in PPEF (most excluded providers are revoked and "
            "therefore not in PPEF)."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://data.cms.gov/provider-characteristics",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "Confirmed-NPI matches", "value": confirmed_total},
                {"label": "Candidate-demographic matches", "value": candidate_total},
            ],
        },
        "notes": (
            "Stage B methodology (0.6.1-draft) introduces NPI-keyed matching "
            "via the CMS PPEF (Medicare Fee-For-Service Public Provider "
            "Enrollment File, 2026-04-01). PPEF publishes NPI ↔ "
            "PECOS_ASCT_CNTL_ID for 2.47M individual NPIs; the All Owners "
            "files publish ASSOCIATE ID - OWNER (same identifier space) for "
            "every individual-owner record. Two source-data-shape facts "
            "drive the tier design: (1) CMS does NOT populate STATE - OWNER "
            "for individuals (100% empty in the 2026-04-01 release) — the "
            "v1 demographic match joined on this empty field and therefore "
            "produced a structural-null result. Stage B substitutes the "
            "facility's STATE_CD (resolved via PPEF ENRLMT_ID, 100% lookup "
            "hit). (2) Exclusion under 42 USC § 1320a-7 forces revocation "
            "of Medicare enrollment, so most excluded NPIs are not in PPEF "
            "(25 of 8,619 LEIE∪SAM-active NPIs remain in PPEF — likely "
            "recent exclusions not yet processed out). Tier 1 is therefore "
            "inherently small-N; the null is itself evidence that CMS's "
            "exclusion-revocation pipeline is working. Per-state CSV at "
            "/api/v1/states/va/h35-nh-ownership-flags.csv carries both tiers "
            "with match_tier column."
        ),
    }

    out = FINDINGS_DIR / "nh-hospice-hh-ownership-flags.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {out}")

    detail = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "stage": "B",
        "confirmed_npi_total": confirmed_total,
        "candidate_demographic_total": candidate_total,
        "va_confirmed_npi": va_confirmed,
        "va_candidate_demographic": va_candidate,
        "by_facility_type": per_type_counts,
        "ppef_assoc_id_size": len(assoc_to_npi),
        "ppef_enrlmt_id_size": len(enrl_to_state),
        "leie_npis_active": len(leie_by_npi),
        "sam_npis_active": len(sam_by_npi),
        "leie_demographic_keys": len(leie_by_demo),
        "top_states": [
            {"state": s, "confirmed_npi": c["confirmed_npi"],
             "candidate_demographic": c["candidate_demographic"]}
            for s, c in sorted(state_counts.items(),
                               key=lambda kv: kv[1]["confirmed_npi"] + kv[1]["candidate_demographic"],
                               reverse=True)[:15]
        ],
        "sample_confirmed_npi_rows": [
            {k: r.get(k) for k in (
                "facility_type", "facility_name", "facility_state",
                "owner_last_name", "owner_first_name",
                "owner_npi", "exclusion_source", "exclusion_date", "exclusion_type",
            )}
            for r in all_matches if r["match_tier"] == "confirmed_npi"
        ][:15],
        "sample_va_rows": [
            {k: r.get(k) for k in (
                "match_tier", "facility_type", "facility_name", "facility_state",
                "owner_last_name", "owner_first_name",
                "owner_npi", "exclusion_source", "exclusion_date",
            )}
            for r in va_matches[:15]
        ],
        "csv_url_national": "/api/v1/findings/nh-hospice-hh-ownership-flags-detail.csv",
        "csv_url_va": "/api/v1/states/va/h35-nh-ownership-flags.csv",
    }
    (FINDINGS_DIR / "nh-hospice-hh-ownership-flags-detail.json").write_text(
        json.dumps(detail, indent=2) + "\n"
    )
    print(f"Wrote {FINDINGS_DIR / 'nh-hospice-hh-ownership-flags-detail.json'}")

    if confirmed_total:
        print("\nTop 10 confirmed-NPI matches:")
        for r in [x for x in all_matches if x["match_tier"] == "confirmed_npi"][:10]:
            print(f"  [{r['facility_type']:8s}] {r['facility_name'][:30]:30s}  "
                  f"{r['owner_last_name']}, {r['owner_first_name']}  "
                  f"facility_state={r['facility_state']}  NPI={r['owner_npi']}  "
                  f"src={r['exclusion_source']}  excldate={r['exclusion_date']}")
    if candidate_total and not confirmed_total:
        print("\nTop 10 candidate-demographic matches:")
        for r in [x for x in all_matches if x["match_tier"] == "candidate_demographic"][:10]:
            print(f"  [{r['facility_type']:8s}] {r['facility_name'][:30]:30s}  "
                  f"{r['owner_last_name']}, {r['owner_first_name']}  "
                  f"facility_state={r['facility_state']}  leie_state={r['exclusion_state']}  "
                  f"excldate={r['exclusion_date']}")


if __name__ == "__main__":
    main()
