"""National rural hospital baseline, one row per state (H48).

Answers a question the federal directory cannot: where are the country's rural
hospitals, and how much of each state's hospital capacity is rural? Two public
files, joined on county:

  1. CMS Hospital General Information: every hospital CMS lists, with its
     county and whether it carries the Critical Access designation.
  2. USDA ERS Rural-Urban Continuum Codes 2023: county metro/nonmetro status.
     Codes 1 to 3 are metro, 4 to 9 are nonmetro.

County names disagree between the two sources on spacing and punctuation
("MC KEAN" against "McKean"), so the join normalizes to alphanumerics only.
Anything still unmatched is counted and reported rather than dropped, because a
silent join failure is how a hospital disappears from a state rollup.

Cost: zero. Both inputs are public files, no BigQuery, no paid API.

Usage:
    python analysis/rural_health_national.py
    python analysis/rural_health_national.py --refresh

Output:
    frontend/public/api/v1/rural-health.json
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import pathlib
import re

from pa_rural_health import CACHE_DIR, ERS_RUCC, fetch, norm_county, resolve_cms_csv_url

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "rural-health.json"

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota",
    "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}


def load_rucc(refresh: bool) -> tuple[dict, dict]:
    """(state, normalized county) -> RUCC, and the same key -> population."""
    text = fetch(ERS_RUCC, "rucc2023.csv", refresh, "latin-1")
    rucc, pop = {}, {}
    for r in csv.DictReader(io.StringIO(text)):
        key = (r["State"], norm_county(r["County_Name"].replace(" County", "")))
        if r["Attribute"] == "RUCC_2023":
            rucc[key] = int(float(r["Value"]))
        elif r["Attribute"] == "Population_2020":
            pop[key] = int(float(r["Value"]))
    return rucc, pop


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    rucc, pop = load_rucc(args.refresh)
    hospitals = list(
        csv.DictReader(io.StringIO(fetch(resolve_cms_csv_url(), "hospitals_all.csv", args.refresh, "utf-8-sig")))
    )

    states: dict[str, dict] = {}
    unmatched = 0
    for h in hospitals:
        st = (h.get("State") or "").strip()
        if st not in STATE_NAMES:
            continue  # territories and military addresses have no RUCC row
        key = (st, norm_county(h.get("County/Parish")))
        code = rucc.get(key)
        s = states.setdefault(
            st,
            {"state": st, "name": STATE_NAMES[st], "hospitals": 0, "rural": 0,
             "critical_access": 0, "rural_cah": 0, "unmatched": 0},
        )
        s["hospitals"] += 1
        if code is None:
            s["unmatched"] += 1
            unmatched += 1
            continue
        cah = h.get("Hospital Type") == "Critical Access Hospitals"
        if cah:
            s["critical_access"] += 1
        if code >= 4:
            s["rural"] += 1
            if cah:
                s["rural_cah"] += 1

    # County-side rollup: how much of each state is nonmetro, and how many people live there.
    for (st, _c), code in rucc.items():
        if st not in states:
            continue
        s = states[st]
        s.setdefault("counties", 0)
        s.setdefault("rural_counties", 0)
        s.setdefault("population", 0)
        s.setdefault("rural_population", 0)
        s["counties"] += 1
        p = pop.get((st, _c), 0)
        s["population"] += p
        if code >= 4:
            s["rural_counties"] += 1
            s["rural_population"] += p

    for s in states.values():
        s["rural_share"] = round(100 * s["rural"] / s["hospitals"], 1) if s["hospitals"] else 0.0
        s["rural_pop_share"] = (
            round(100 * s["rural_population"] / s["population"], 1) if s.get("population") else 0.0
        )

    rows = sorted(states.values(), key=lambda s: -s["rural_share"])
    tot = sum(s["hospitals"] for s in rows)
    rur = sum(s["rural"] for s in rows)
    cah = sum(s["critical_access"] for s in rows)
    rpop = sum(s.get("rural_population", 0) for s in rows)
    tpop = sum(s.get("population", 0) for s in rows)

    payload = {
        "slug": "rural-health",
        "hypotheses": ["H48"],
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "methodology_version": "0.7.2-draft",
        "summary": {
            "hospitals": tot,
            "rural_hospitals": rur,
            "rural_share": round(100 * rur / tot, 1),
            "critical_access": cah,
            "rural_population": rpop,
            "population": tpop,
            "rural_pop_share": round(100 * rpop / tpop, 1),
            "unmatched_county": unmatched,
        },
        "states": rows,
        "notes": (
            "Rural means the hospital's county carries USDA ERS Rural-Urban Continuum Code "
            "4 to 9 (nonmetro) for 2023. Critical Access is the CMS facility-level designation. "
            f"{unmatched} hospitals could not be matched to a county code and are counted in "
            "each state's unmatched field rather than assigned to either group. Territories are "
            "excluded because ERS publishes no continuum code for them."
        ),
        "sources": {
            "hospitals": "CMS Hospital General Information (data.cms.gov provider-data catalog)",
            "rural_classification": "USDA ERS Rural-Urban Continuum Codes 2023",
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")

    print(f"states: {len(rows)} | hospitals {tot:,} | rural {rur:,} ({payload['summary']['rural_share']}%)")
    print(f"critical access {cah:,} | rural population {rpop:,} of {tpop:,} ({payload['summary']['rural_pop_share']}%)")
    print(f"unmatched to a county code: {unmatched}")
    print("\nmost rural-dependent states by hospital share:")
    for s in rows[:6]:
        print(f"  {s['state']}  {s['rural']:>3}/{s['hospitals']:<4} {s['rural_share']:>5}%  CAH {s['critical_access']}")
    print(f"\nwrote {OUT}")
    # Also publish under findings/<slug>.json.
    #
    # This finding writes its full payload to /api/v1/rural-health.json, which
    # the /rural-health page reads. But /findings/<slug> reads
    # findings/<slug>.json, so the finding page rendered the pre-registration
    # placeholder while the numbers had been published for two weeks. The
    # contract validator caught it; a reader arriving from the findings hub
    # would have concluded the work was not done.
    nat = payload["summary"]
    finding = {
        "slug": "rural-hospital-baseline",
        "title": "Rural hospital baseline",
        "hypotheses": ["H48"],
        "status": "published",
        # Not an NDH release: this finding derives from the CMS Hospital
        # General Information file joined to USDA ERS continuum codes.
        "release_date": "CMS Hospital General Information + USDA ERS 2023",
        "generated_at": payload["generated_at"],
        "methodology_version": payload["methodology_version"],
        "commit_sha": payload.get("commit_sha", "pending"),
        "headline": (
            f"{nat['rural_hospitals']:,} of {nat['hospitals']:,} US hospitals "
            f"({nat['rural_share']}%) sit in nonmetro counties, which hold "
            f"{nat['rural_pop_share']}% of the population. "
            f"{nat['critical_access']:,} are Critical Access. "
            f"{nat['unmatched_county']:,} hospitals could not be matched to a "
            f"county continuum code and are reported per state rather than "
            f"assigned to either group."
        ),
        "numerator": nat["rural_hospitals"],
        "denominator": nat["hospitals"],
        "chart": {
            "type": "bar",
            "unit": "percent",
            "data": [
                {"label": "Hospitals in nonmetro counties", "value": nat["rural_share"]},
                {"label": "Population in nonmetro counties", "value": nat["rural_pop_share"]},
            ],
        },
        "notes": payload["notes"],
    }
    fp = OUT.parent / "findings" / "rural-hospital-baseline.json"
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(json.dumps(finding, indent=2) + "\n")
    print(f"wrote {fp}")



if __name__ == "__main__":
    main()
