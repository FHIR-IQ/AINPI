"""Build per-state federally-excluded cohort CSV for any state.

Generalized from build_va_briefing.py — same filter logic, parameterized
on the state code. Used by /for-state-medicaid/<state> CMO-facing pages
so the lede "here are N federally-excluded providers in [state] still
listed in the federal directory" can interpolate the real N.

Reads the existing national cohort export and writes:

    frontend/public/api/v1/states/<state>-cohort-critical.csv

CSV schema matches va-cohort-critical.csv exactly so any downstream
tooling that consumes the VA file can consume any state file with no
shape change. Columns:

    npi, name, state, score, bucket, reasons,
    leie_excldate, sam_active_date, nppes_deactivation_date,
    leie_lookup_url, sam_lookup_url, nppes_lookup_url

Usage:
    python analysis/build_state_cohort.py VA
    python analysis/build_state_cohort.py SC
    python analysis/build_state_cohort.py --all   # every state with ≥1 critical NPI
"""
from __future__ import annotations
import argparse
import csv
import pathlib
import sys
from collections import defaultdict

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
COHORT_CSV = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings" / "high-risk-cohort-export.csv"
STATES_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states"

# 50 states + DC + the 5 US territories NPPES uses. Other 2-char strings
# in the cohort (e.g. "XX") are NPPES placeholders, not jurisdictions.
VALID_STATE_CODES: frozenset[str] = frozenset({
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
    "VA","WA","WV","WI","WY","DC","PR","VI","GU","MP","AS",
})


def critical_for_state(cohort: list[dict], state: str) -> list[dict]:
    state = state.upper()
    out = [
        r for r in cohort
        if r["state"] == state
        and r["bucket"] == "critical"
        and (
            "oig_excluded" in (r.get("reasons") or "")
            or "sam_excluded" in (r.get("reasons") or "")
        )
    ]
    out.sort(key=lambda r: (-float(r["score"]), r["npi"]))
    return out


def write_state_csv(state: str, rows: list[dict]) -> pathlib.Path:
    state = state.upper()
    out_path = STATES_DIR / f"{state.lower()}-cohort-critical.csv"
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow([
            "npi", "name", "state", "score", "bucket", "reasons",
            "leie_excldate", "sam_active_date", "nppes_deactivation_date",
            "leie_lookup_url", "sam_lookup_url", "nppes_lookup_url",
        ])
        for r in rows:
            w.writerow([
                r["npi"], r["name"], r["state"], r["score"],
                r["bucket"], r["reasons"],
                r.get("leie_excldate", ""),
                r.get("sam_active_date", ""),
                r.get("nppes_deactivation_date", ""),
                "https://exclusions.oig.hhs.gov/",
                "https://sam.gov/search/?index=ex",
                f"https://npiregistry.cms.hhs.gov/provider-view/{r['npi']}",
            ])
    return out_path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("states", nargs="*", help="State codes, e.g. VA SC")
    ap.add_argument("--all", action="store_true",
                    help="Emit a CSV for every state with ≥1 critical NPI")
    args = ap.parse_args()

    if not args.states and not args.all:
        ap.error("provide one or more state codes, or --all")

    with open(COHORT_CSV, newline="", encoding="utf-8") as fh:
        cohort = list(csv.DictReader(fh))

    if args.all:
        by_state: dict[str, int] = defaultdict(int)
        for r in cohort:
            st = (r.get("state") or "").strip().upper()
            if st not in VALID_STATE_CODES:
                continue
            if r["bucket"] == "critical" and (
                "oig_excluded" in (r.get("reasons") or "")
                or "sam_excluded" in (r.get("reasons") or "")
            ):
                by_state[st] += 1
        targets = sorted(by_state.keys())
    else:
        targets = [s.upper() for s in args.states]

    if not targets:
        print("No states with critical NPIs.", file=sys.stderr)
        sys.exit(1)

    for state in targets:
        rows = critical_for_state(cohort, state)
        if not rows:
            print(f"{state}: 0 critical NPIs — skipping")
            continue
        out = write_state_csv(state, rows)
        print(f"{state}: {len(rows):>4} critical NPIs → {out}")


if __name__ == "__main__":
    main()
