"""H39 — Multi-enrollment NPIs with conflicting state addresses (PECOS).

The CMS Public Provider Enrollment Extract (PPEF) has ~2.98M enrollment
records but only ~2.47M individual NPIs. That means a meaningful subset
of NPIs have MULTIPLE enrollment records. Many of those are legitimate
(telehealth, multi-state practice, hospital + private practice splits).

A meaningful subset have CONFLICTING state addresses that signal stale
records: partnership move never refiled, retirement never closed, group-
practice split where one half kept the legacy enrollment alive.

Under the CMS 2026 verification rules (PECOS designated as the
authoritative source for Medicare enrollment), stale practice locations
are a flag. State Medicaid systems must demonstrate alignment with PECOS.
A stale-record-winning-the-check is a real risk.

Method:
    1. Stream PPEF once.
    2. Build NPI → list of (ENRLMT_ID, STATE_CD, PROVIDER_TYPE_DESC) tuples.
    3. For each NPI: if it has ≥2 enrollments AND ≥2 distinct STATE_CD
       values, it's a multi-state record.
    4. Partition output by each state the NPI is enrolled in (so a
       NPI with VA + MD enrollments appears in both states' per-state
       CSVs).

Source: frontend/data/cms-claims/PPEF_Enrollment_Extract_2026.04.01.csv

Writes:
    frontend/public/api/v1/findings/pecos-multi-enrollment-state-mismatch.json
    frontend/public/api/v1/findings/pecos-multi-enrollment-state-mismatch-detail.json
    frontend/public/api/v1/states/<state>/h39-pecos-multi-state.csv
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from collections import defaultdict
from datetime import datetime, timezone

METHODOLOGY_VERSION = "0.7.0-draft"
DATA_SOURCE_RELEASE = "PPEF 2026-04-01"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
PPEF_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "PPEF_Enrollment_Extract_2026.04.01.csv"
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
STATES_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states"

# Same whitelist as analysis/build_state_cohort.py and analysis/claims_sources/_cohorts.py.
# NPPES allows international addresses; we only emit per-state output for US
# jurisdictions.
VALID_US_JURISDICTIONS = frozenset({
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY", "DC", "PR", "VI", "GU", "MP", "AS",
})


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


def main() -> None:
    # NPI -> list of (enrlmt_id, state_cd, provider_type_desc, first_name, last_name, org_name)
    npi_enrollments: dict[str, list[dict]] = defaultdict(list)
    total_rows = 0

    print(f"Streaming {PPEF_CSV.name}...")
    with open(PPEF_CSV, newline="", encoding="latin-1") as fh:
        for row in csv.DictReader(fh):
            total_rows += 1
            npi = (row.get("NPI") or "").strip()
            if not npi or len(npi) != 10:
                continue
            state = (row.get("STATE_CD") or "").strip().upper()
            npi_enrollments[npi].append({
                "enrlmt_id": (row.get("ENRLMT_ID") or "").strip(),
                "state": state,
                "provider_type_cd": (row.get("PROVIDER_TYPE_CD") or "").strip(),
                "provider_type_desc": (row.get("PROVIDER_TYPE_DESC") or "").strip(),
                "first_name": (row.get("FIRST_NAME") or "").strip(),
                "last_name": (row.get("LAST_NAME") or "").strip(),
                "org_name": (row.get("ORG_NAME") or "").strip(),
            })
    print(f"  total PPEF rows: {total_rows:,}")
    print(f"  distinct NPIs:   {len(npi_enrollments):,}")

    # Identify NPIs with multiple distinct STATE_CDs across enrollments.
    multi_state_npis: list[dict] = []
    for npi, enrollments in npi_enrollments.items():
        states_used = {e["state"] for e in enrollments if e["state"]}
        if len(states_used) < 2:
            continue
        # Skip NPIs whose distinct states are all non-US (shouldn't happen often
        # but PPEF does carry rare international addresses).
        valid_states = states_used & VALID_US_JURISDICTIONS
        if len(valid_states) < 2:
            continue
        # Pick a representative name for output (prefer first non-empty org/first/last triple)
        first_name = next((e["first_name"] for e in enrollments if e["first_name"]), "")
        last_name = next((e["last_name"] for e in enrollments if e["last_name"]), "")
        org_name = next((e["org_name"] for e in enrollments if e["org_name"]), "")
        display = (
            org_name if org_name and not (first_name or last_name)
            else f"{last_name}, {first_name}".strip(", ")
        )
        multi_state_npis.append({
            "npi": npi,
            "name": display,
            "states": sorted(valid_states),
            "enrollment_count": len(enrollments),
            "provider_types": sorted({
                e["provider_type_desc"] for e in enrollments if e["provider_type_desc"]
            }),
            "enrollments": enrollments,
        })

    multi_state_npis.sort(key=lambda r: (-len(r["states"]), -r["enrollment_count"], r["npi"]))
    print(f"\nMulti-state NPIs (≥2 distinct US STATE_CDs): {len(multi_state_npis):,}")

    # Per-state output: a NPI appears in every state's CSV where it has an enrollment.
    per_state_rows: dict[str, list[dict]] = defaultdict(list)
    for entry in multi_state_npis:
        for st in entry["states"]:
            per_state_rows[st].append({
                "npi": entry["npi"],
                "name": entry["name"],
                "this_state": st,
                "other_states": ",".join(s for s in entry["states"] if s != st),
                "enrollment_count": entry["enrollment_count"],
                "provider_types": " | ".join(entry["provider_types"]),
                "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{entry['npi']}",
            })

    fields = [
        "npi", "name", "this_state", "other_states", "enrollment_count",
        "provider_types", "nppes_lookup_url",
    ]
    for state, rows in per_state_rows.items():
        rows.sort(key=lambda r: (-r["enrollment_count"], r["npi"]))
        state_dir = STATES_DIR / state.lower()
        state_dir.mkdir(parents=True, exist_ok=True)
        with open(state_dir / "h39-pecos-multi-state.csv", "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in fields})
    print(f"  per-state CSVs written: {len(per_state_rows)}")

    # National rollup CSV
    national_csv = FINDINGS_DIR / "pecos-multi-enrollment-state-mismatch-detail.csv"
    with open(national_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["npi", "name", "states", "enrollment_count", "provider_types", "nppes_lookup_url"])
        w.writeheader()
        for entry in multi_state_npis:
            w.writerow({
                "npi": entry["npi"],
                "name": entry["name"],
                "states": ",".join(entry["states"]),
                "enrollment_count": entry["enrollment_count"],
                "provider_types": " | ".join(entry["provider_types"]),
                "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{entry['npi']}",
            })

    # Top states by count
    state_counts = sorted(
        ({"state": s, "matches": len(rs)} for s, rs in per_state_rows.items()),
        key=lambda d: -d["matches"],
    )

    print("\nTop 10 states by multi-state-NPI count:")
    for s in state_counts[:10]:
        print(f"  {s['state']:2s}  {s['matches']:>7,}")

    print("\nTop 10 NPIs by number of distinct states enrolled in:")
    for entry in multi_state_npis[:10]:
        print(f"  {entry['npi']}  {entry['name'][:30]:30s}  {len(entry['states'])} states  {entry['enrollment_count']} enrollments")

    headline = (
        f"{len(multi_state_npis):,} of {len(npi_enrollments):,} individual NPIs "
        f"in the CMS Public Provider Enrollment Extract (PPEF, {DATA_SOURCE_RELEASE}) "
        f"have enrollment records in 2 or more distinct US states. Many are "
        f"legitimate multi-state practitioners (telehealth, hospital + private, "
        f"split-state practices); a subset are stale records from partnership "
        f"moves or retirements that never refiled. Under CMS's 2026 verification "
        f"rules (PECOS designated as authoritative for Medicare enrollment), "
        f"every multi-state enrollment is a flag requiring state-Medicaid "
        f"triage: telehealth (verify and document) · stale (file CMS-855I to "
        f"close legacy enrollment) · fraudulent (refer to PI). Per-state CSVs "
        f"at /api/v1/states/<state>/h39-pecos-multi-state.csv list each NPI in "
        f"the state's cohort with the other states they're also enrolled in."
    )

    payload = {
        "slug": "pecos-multi-enrollment-state-mismatch",
        "title": "Multi-enrollment NPIs with conflicting state addresses (PECOS)",
        "hypotheses": ["H39"],
        "status": "published",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(multi_state_npis),
        "denominator": len(npi_enrollments),
        "denominator_note": (
            f"Denominator = {len(npi_enrollments):,} distinct individual NPIs "
            f"in PPEF {DATA_SOURCE_RELEASE}. Numerator = NPIs with ≥2 distinct "
            f"US-jurisdiction STATE_CD values across their enrollment records. "
            f"Non-US addresses (PPEF allows them) are filtered out so per-state "
            f"output only contains routable US state codes."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://data.cms.gov/provider-characteristics/medicare-provider-supplier-enrollment/medicare-fee-for-service-public-provider-enrollment",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "Multi-state NPIs", "value": len(multi_state_npis)},
                {"label": "Single-state NPIs", "value": len(npi_enrollments) - len(multi_state_npis)},
            ],
        },
        "per_state": state_counts,
        "notes": (
            "Multi-state enrollment is not inherently a problem. The signal is "
            "ambiguous between legitimate multi-state practice (telehealth, "
            "hospital + private practice split) and stale records (partnership "
            "move, retirement, group-practice split where the legacy enrollment "
            "was never closed). Under the CMS 2026 verification rules, every "
            "multi-state enrollment is a flag — your PI team's job is to "
            "categorize: telehealth (document the practice arrangement) · "
            "stale (file CMS-855I to close the legacy record) · fraudulent "
            "(refer). The detail file at /api/v1/findings/pecos-multi-enrollment-"
            "state-mismatch-detail.csv lists all matches nationally; per-state "
            "CSVs at /api/v1/states/<state>/h39-pecos-multi-state.csv carry the "
            "rows your state owns triage on."
        ),
    }
    out = FINDINGS_DIR / "pecos-multi-enrollment-state-mismatch.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")

    detail = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total_ppef_rows": total_rows,
        "distinct_npis": len(npi_enrollments),
        "multi_state_npis": len(multi_state_npis),
        "states_with_matches": len(per_state_rows),
        "top_states": state_counts[:15],
        "top_10_npis_by_state_count": [
            {
                "npi": e["npi"],
                "name": e["name"],
                "state_count": len(e["states"]),
                "enrollment_count": e["enrollment_count"],
                "states": e["states"],
                "provider_types": e["provider_types"],
            }
            for e in multi_state_npis[:10]
        ],
        "csv_url_national": "/api/v1/findings/pecos-multi-enrollment-state-mismatch-detail.csv",
        "csv_url_pattern": "/api/v1/states/<state>/h39-pecos-multi-state.csv",
    }
    (FINDINGS_DIR / "pecos-multi-enrollment-state-mismatch-detail.json").write_text(
        json.dumps(detail, indent=2) + "\n"
    )
    print(f"Wrote {FINDINGS_DIR / 'pecos-multi-enrollment-state-mismatch-detail.json'}")


if __name__ == "__main__":
    main()
