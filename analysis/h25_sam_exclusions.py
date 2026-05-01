"""H25 — SAM.gov-excluded providers appearing in the federal NDH.

The null hypothesis is that zero NPIs on SAM.gov's active exclusion list
also appear in the federal NDH bulk export. Any non-zero match is a
regulatory-significant finding under 42 CFR § 455.436 (federal database
checks), which names SAM as one of four federal databases state Medicaid
agencies must screen monthly.

Run order:
    1. analysis/ingest_sam_exclusions.py   (refreshes sam_exclusions BQ table)
    2. analysis/h25_sam_exclusions.py      (this script)

Match logic (NPI-keyed, conservative):
    - SAM rows where NPI is empty, NULL, or '0000000000' are dropped.
    - SAM rows where record_status != 'Active' are dropped (terminated
      exclusions = no longer barred).
    - Match on NDH practitioner._npi = SAM.npi for individuals; SAM
      organizational/entity exclusions almost never carry an NPI in the
      Public Extract V2, so the entity-side join is effectively empty.

Why H25 is independent from H24 (LEIE):
    SAM aggregates HHS LEIE + OPM FEHBP debarment + DOJ + EPA + others
    into a single feed. The HHS slice substantially overlaps with LEIE,
    but OPM-debarred providers (5 USC 8902a, FEHBP-only) are net-new
    federal-screening signal. The headline reports total + per-agency
    breakdown so consumers can separate the legs.

Writes:
    frontend/public/api/v1/findings/sam-exclusions.json
    frontend/public/api/v1/findings/sam-exclusions-detail.json
"""
from __future__ import annotations
import json
import pathlib
import subprocess
from datetime import datetime, timezone
from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
SAM_TABLE = f"{PROJECT}.{DATASET}.sam_exclusions"
RELEASE_DATE = "2026-04-09"
METHODOLOGY_VERSION = "0.4.0"

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

    # 1. SAM denominators.
    sam_stats = next(iter(client.query(f"""
        SELECT
          COUNT(*) AS total,
          COUNTIF(REGEXP_CONTAINS(npi, r'^[1-9]\\d{{9}}$')) AS with_real_npi,
          COUNTIF(REGEXP_CONTAINS(npi, r'^[1-9]\\d{{9}}$') AND record_status = 'Active')
            AS active_with_npi
        FROM `{SAM_TABLE}`
    """).result()))
    sam_total = int(sam_stats.total)
    sam_with_npi = int(sam_stats.with_real_npi)
    sam_active_with_npi = int(sam_stats.active_with_npi)
    print(f"SAM total rows: {sam_total:,}")
    print(f"  with real NPI:           {sam_with_npi:,}")
    print(f"  active + with real NPI:  {sam_active_with_npi:,}")

    # 2. Match against NDH practitioners (per-agency).
    pract_match_sql = f"""
    WITH active_sam AS (
      SELECT npi, first_name, middle_name, last_name, name,
             excluding_agency, exclusion_program, exclusion_type,
             active_date, termination_date,
             city, state_province
      FROM `{SAM_TABLE}`
      WHERE REGEXP_CONTAINS(npi, r'^[1-9]\\d{{9}}$')
        AND record_status = 'Active'
    )
    SELECT
      s.npi,
      s.first_name, s.middle_name, s.last_name, s.name,
      s.excluding_agency, s.exclusion_program, s.exclusion_type,
      s.active_date, s.termination_date,
      s.state_province AS sam_state,
      p._state         AS ndh_state,
      p._family_name, p._given_name,
      p._active        AS ndh_active
    FROM active_sam s
    INNER JOIN `{PROJECT}.{DATASET}.practitioner` p ON p._npi = s.npi
    """
    pract_matches = list(client.query(pract_match_sql).result())
    print(f"\nActive SAM NPIs matching NDH Practitioner: {len(pract_matches):,}")

    # 3. Per-agency rollup: total matches and still-active-in-NDH count.
    by_agency: dict[str, dict[str, set[str]]] = {}
    for r in pract_matches:
        agency = (r.excluding_agency or "(unattributed)").strip() or "(unattributed)"
        slot = by_agency.setdefault(agency, {"all": set(), "ndh_active": set()})
        slot["all"].add(r.npi)
        if r.ndh_active:
            slot["ndh_active"].add(r.npi)

    agency_rows = sorted(
        ({"agency": a, "matches": len(v["all"]), "ndh_active": len(v["ndh_active"])}
         for a, v in by_agency.items()),
        key=lambda r: -r["matches"],
    )
    print("\nPer-agency NDH match (distinct NPIs):")
    print(f"  {'agency':<14} {'matches':>10} {'still active in NDH':>22}")
    for row in agency_rows:
        print(f"  {row['agency']:<14} {row['matches']:>10,} {row['ndh_active']:>22,}")

    # 4. Per-state breakdown of matched practitioners (top 10).
    state_breakdown: dict[str, int] = {}
    seen_npis: set[str] = set()
    for r in pract_matches:
        if r.npi in seen_npis:
            continue
        seen_npis.add(r.npi)
        s = r.ndh_state or "UNKNOWN"
        state_breakdown[s] = state_breakdown.get(s, 0) + 1
    top_states = sorted(state_breakdown.items(), key=lambda kv: -kv[1])[:10]

    # 5. Sample 10 matched NPIs (verify-yourself block — each linkable to
    #    SAM and NPPES).
    samples = []
    seen_sample_npis: set[str] = set()
    for r in pract_matches:
        if r.npi in seen_sample_npis:
            continue
        seen_sample_npis.add(r.npi)
        family = (r._family_name or "").strip()
        given = (r._given_name or "").strip()
        display = f"{family}, {given}".strip(", ") or r.name or "(name not in NDH)"
        samples.append({
            "npi": r.npi,
            "display_name": display,
            "ndh_state": r.ndh_state or "",
            "sam_state": r.sam_state or "",
            "excluding_agency": r.excluding_agency or "",
            "exclusion_type": r.exclusion_type or "",
            "active_date": r.active_date or "",
            "sam_lookup_url": "https://sam.gov/search/?index=ex",
            "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{r.npi}",
        })
        if len(samples) >= 10:
            break

    # 6. Headline.
    distinct_match_npis = len({r.npi for r in pract_matches})
    distinct_active_in_ndh = len({r.npi for r in pract_matches if r.ndh_active})
    headline = (
        f"{distinct_match_npis:,} distinct NPIs on SAM.gov's active exclusion list "
        f"appear as NDH practitioners — {distinct_active_in_ndh:,} still flagged "
        f"`active=true` in the {RELEASE_DATE} bulk export. SAM aggregates HHS LEIE + "
        f"OPM FEHBP debarment + other federal-agency actions. The OPM slice is "
        f"net-new federal-screening signal beyond what LEIE alone surfaces."
    )

    payload = {
        "slug": "sam-exclusions",
        "title": "SAM.gov excluded providers in NDH",
        "hypotheses": ["H25"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": distinct_match_npis,
        "denominator": sam_active_with_npi,
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": row["agency"], "value": row["ndh_active"]}
                for row in agency_rows if row["ndh_active"] > 0
            ],
        },
        "notes": (
            f"SAM source: sam.gov/data-services/Exclusions/Public V2 (V2_26120 extract). "
            f"Total SAM rows: {sam_total:,}; with real-format NPI: {sam_with_npi:,} "
            f"({100*sam_with_npi/sam_total:.1f}%); active + with NPI: {sam_active_with_npi:,}. "
            f"The 96% of SAM rows without a populated NPI are non-healthcare exclusions "
            f"(OFAC sanctions, EPA contractor debarment, etc.) and are out of scope for "
            f"this NPI-keyed match. The HHS-slice match overlaps substantially with the "
            f"H24 LEIE finding by design — the same exclusion appears in both feeds. "
            f"Each match is a data-quality flag, not a fraud determination — investigation, "
            f"hearing rights, and reinstatement claims belong to the excluding agency. "
            f"sam.gov/search/?index=ex is the authoritative source for any individual "
            f"verification."
        ),
    }

    out = FINDINGS_DIR / "sam-exclusions.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")

    # Sidecar JSON for the finding page UI.
    sidecar = {
        "samples": samples,
        "agency_breakdown": agency_rows,
        "state_breakdown": [{"state": s, "n": n} for s, n in top_states],
    }
    sidecar_path = FINDINGS_DIR / "sam-exclusions-detail.json"
    sidecar_path.write_text(json.dumps(sidecar, indent=2) + "\n")
    print(f"Wrote {sidecar_path}")


if __name__ == "__main__":
    run()
