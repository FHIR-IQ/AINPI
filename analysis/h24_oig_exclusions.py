"""H24 — OIG LEIE-excluded providers appearing in the federal NDH.

The null hypothesis is that zero NPIs on the active OIG LEIE also appear
in the federal NDH bulk export. Any non-zero match is a regulatory-
significant finding under 42 CFR § 455.436 (federal database checks),
because it indicates the federal directory is publishing a provider
record for an individual or entity excluded from federal health care
program participation.

Run order:
    1. analysis/ingest_oig_leie.py   (refreshes oig_leie BQ table)
    2. analysis/h24_oig_exclusions.py (this script)

Match logic (NPI-keyed, conservative):
    - LEIE rows with NPI = '0000000000' or NULL are dropped (no match key).
    - LEIE rows with REINDATE != '00000000' are dropped (reinstatement = no
      longer excluded). This filter mirrors the OIG advisory FAQ.
    - Match on NDH practitioner._npi = LEIE.NPI for individuals, AND on
      NDH organization._npi = LEIE.NPI for entities.

Reports:
    - Total active LEIE rows + share with real NPI
    - Match counts: practitioner-side, organization-side, total
    - Per-state breakdown of matched practitioners
    - Sample of 10 matched NPIs for the verify-yourself block on the
      finding page (each linkable to the LEIE search portal)

Writes:
    frontend/public/api/v1/findings/oig-leie-exclusions.json
"""
from __future__ import annotations
import json
import pathlib
import subprocess
from datetime import datetime, timezone
from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
LEIE_TABLE = f"{PROJECT}.{DATASET}.oig_leie"
RELEASE_DATE = "2026-04-09"
METHODOLOGY_VERSION = "0.3.0"

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

    # 1. LEIE denominators.
    leie_stats = next(iter(client.query(f"""
        SELECT
          COUNT(*) AS total,
          COUNTIF(NPI != '' AND NPI != '0000000000') AS with_real_npi,
          COUNTIF(NPI != '' AND NPI != '0000000000'
                  AND (REINDATE = '00000000' OR REINDATE IS NULL OR REINDATE = ''))
            AS still_excluded_with_npi
        FROM `{LEIE_TABLE}`
    """).result()))
    leie_total = int(leie_stats.total)
    leie_with_npi = int(leie_stats.with_real_npi)
    leie_active_with_npi = int(leie_stats.still_excluded_with_npi)
    print(f"LEIE total rows: {leie_total:,}")
    print(f"  with real NPI:           {leie_with_npi:,}")
    print(f"  active + with real NPI:  {leie_active_with_npi:,}")

    # 2. Match against NDH practitioners.
    pract_match_sql = f"""
    WITH active_leie AS (
      SELECT NPI, LASTNAME, FIRSTNAME, BUSNAME, EXCLTYPE, EXCLDATE, GENERAL, SPECIALTY,
             ADDRESS, CITY, STATE
      FROM `{LEIE_TABLE}`
      WHERE NPI != '' AND NPI != '0000000000'
        AND (REINDATE = '00000000' OR REINDATE IS NULL OR REINDATE = '')
    )
    SELECT
      l.NPI,
      l.LASTNAME, l.FIRSTNAME, l.BUSNAME,
      l.EXCLTYPE, l.EXCLDATE,
      l.GENERAL, l.SPECIALTY,
      l.STATE AS leie_state,
      p._state AS ndh_state,
      p._family_name, p._given_name
    FROM active_leie l
    INNER JOIN `{PROJECT}.{DATASET}.practitioner` p ON p._npi = l.NPI
    """
    pract_matches = list(client.query(pract_match_sql).result())
    print(f"\nActive LEIE NPIs matching NDH Practitioner: {len(pract_matches):,}")

    # 3. Match against NDH organizations.
    org_match_sql = f"""
    WITH active_leie AS (
      SELECT NPI, BUSNAME, EXCLTYPE, EXCLDATE, GENERAL, SPECIALTY, STATE
      FROM `{LEIE_TABLE}`
      WHERE NPI != '' AND NPI != '0000000000'
        AND (REINDATE = '00000000' OR REINDATE IS NULL OR REINDATE = '')
    )
    SELECT
      l.NPI, l.BUSNAME, l.EXCLTYPE, l.EXCLDATE, l.GENERAL, l.SPECIALTY,
      l.STATE AS leie_state,
      o._state AS ndh_state,
      o._name
    FROM active_leie l
    INNER JOIN `{PROJECT}.{DATASET}.organization` o ON o._npi = l.NPI
    """
    org_matches = list(client.query(org_match_sql).result())
    print(f"Active LEIE NPIs matching NDH Organization: {len(org_matches):,}")

    # 4. Per-state breakdown of matched practitioners.
    state_breakdown: dict[str, int] = {}
    for r in pract_matches:
        s = r.ndh_state or "UNKNOWN"
        state_breakdown[s] = state_breakdown.get(s, 0) + 1
    top_states = sorted(state_breakdown.items(), key=lambda kv: -kv[1])[:10]

    # 5. Sample 10 matched NPIs (verify-yourself block — each linkable to LEIE search).
    samples = []
    for r in pract_matches[:10]:
        family = (r._family_name or "").strip()
        given = (r._given_name or "").strip()
        display = f"{family}, {given}".strip(", ") or r.BUSNAME or "(name not in NDH)"
        samples.append({
            "npi": r.NPI,
            "display_name": display,
            "ndh_state": r.ndh_state or "",
            "leie_state": r.leie_state or "",
            "exclusion_type": r.EXCLTYPE or "",
            "exclusion_date": r.EXCLDATE or "",
            "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
            "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{r.NPI}",
        })

    total_matches = len(pract_matches) + len(org_matches)
    headline = (
        f"{total_matches:,} of {leie_active_with_npi:,} actively-excluded LEIE NPIs "
        f"({100*total_matches/leie_active_with_npi:.2f}%) appear in the {RELEASE_DATE} "
        f"NDH bulk export — {len(pract_matches):,} as Practitioner resources, "
        f"{len(org_matches):,} as Organization resources. Each match warrants "
        f"immediate state Medicaid revalidation under 42 CFR § 455.436."
    )

    payload = {
        "slug": "oig-leie-exclusions",
        "title": "OIG LEIE excluded providers in NDH",
        "hypotheses": ["H24"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": total_matches,
        "denominator": leie_active_with_npi,
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": s, "value": n} for s, n in top_states
            ],
        },
        "notes": (
            f"LEIE source: oig.hhs.gov/exclusions/downloadables/UPDATED.csv. "
            f"Total LEIE rows: {leie_total:,}; with real NPI: {leie_with_npi:,} "
            f"({100*leie_with_npi/leie_total:.1f}%); still actively excluded: "
            f"{leie_active_with_npi:,}. The 89% of LEIE rows without a populated NPI "
            f"(pre-NPI-era exclusions) require demographic match logic in the state "
            f"MMIS — out of scope for AINPI's NPI-keyed methodology. "
            f"Each match here is a data-quality flag, not a fraud determination — "
            f"investigation, hearing rights, and reinstatement claims belong to "
            f"the state PI unit and the OIG. The LEIE search portal at "
            f"exclusions.oig.hhs.gov is the authoritative source for any individual "
            f"verification."
        ),
    }

    out = FINDINGS_DIR / "oig-leie-exclusions.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")

    # Also persist samples + state breakdown as a separate sidecar JSON for
    # the eventual UI surface.
    sidecar = {
        "samples": samples,
        "state_breakdown": [{"state": s, "n": n} for s, n in top_states],
    }
    sidecar_path = FINDINGS_DIR / "oig-leie-exclusions-detail.json"
    sidecar_path.write_text(json.dumps(sidecar, indent=2) + "\n")
    print(f"Wrote {sidecar_path}")


if __name__ == "__main__":
    run()
