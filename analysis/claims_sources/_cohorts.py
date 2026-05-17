"""Shared helpers for the claims-side cross-audit scripts.

All claims-side findings (H29, H30a, H30b, H32) share the same
prerequisite: a set of federally-excluded NPIs grouped by state. This
module loads those cohorts once and provides them in the shape the
streaming scripts need.

Design constraint: stream each big source ONCE per refresh. The cohort
must be loaded as a single in-memory structure so a single pass over
the source file can partition matches across every state. Doing the
naive thing (50 separate runs, one per state) re-reads the same 4 GB
of source data 50 times.
"""
from __future__ import annotations
import csv
import pathlib
from typing import Iterable

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
STATES_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states"

# 50 states + DC + the 5 US territories NPPES uses. NPPES allows
# international addresses (CA-province codes like AB / BC, MX-state codes,
# etc.) so claims-side scripts must whitelist before writing per-state
# output or the static-page generator throws on missing routes.
VALID_US_JURISDICTIONS: frozenset[str] = frozenset({
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY", "DC", "PR", "VI", "GU", "MP", "AS",
})


def is_valid_us_state(code: str | None) -> bool:
    """True if `code` is a recognized US state, DC, or US territory."""
    return bool(code) and code.upper() in VALID_US_JURISDICTIONS


def load_state_cohort(state: str) -> dict[str, dict]:
    """Load `<state>-cohort-critical.csv` as {npi: cohort_row}.

    Returns empty dict if the state has no cohort file or 0 critical NPIs.
    """
    path = STATES_DIR / f"{state.lower()}-cohort-critical.csv"
    if not path.exists():
        return {}
    with open(path, newline="", encoding="utf-8") as fh:
        return {
            row["npi"]: row
            for row in csv.DictReader(fh)
            if row.get("npi")
        }


def load_all_state_cohorts(states: Iterable[str] | None = None) -> dict[str, dict[str, dict]]:
    """Return {state_code_upper: {npi: cohort_row}} for every published cohort.

    When `states` is None, walks every <state>-cohort-critical.csv under
    STATES_DIR. When given an explicit list, restricts to those states.
    """
    if states is not None:
        codes = [s.upper() for s in states]
    else:
        codes = [
            p.stem.split("-cohort-critical")[0].upper()
            for p in STATES_DIR.glob("*-cohort-critical.csv")
        ]
    out: dict[str, dict[str, dict]] = {}
    for code in sorted(codes):
        cohort = load_state_cohort(code)
        if cohort:
            out[code] = cohort
    return out


def npi_to_state_map(cohorts: dict[str, dict[str, dict]]) -> dict[str, str]:
    """Reverse-index cohorts as {npi: state_code_upper}.

    A given NPI lives in exactly one state cohort (the cohort builder
    partitions by NPPES practice state). If two cohorts somehow contain
    the same NPI, the alphabetically-first state wins. That is conservative
    — the resulting match attribution may be slightly wrong on the edge
    case but never invents an NPI that isn't already in some state's
    published cohort.
    """
    out: dict[str, str] = {}
    for state in sorted(cohorts.keys()):
        for npi in cohorts[state].keys():
            out.setdefault(npi, state)
    return out


def cutoff_year(cohort_row: dict) -> int | None:
    """Earliest LEIE or SAM exclusion year for this cohort row (or None).

    Used by H29 / H30a / H30b / H32 to filter strictly post-exclusion
    matches: cohort exclusion-effective year must be < the claim year for
    a match to count as a § 455.436 / 42 USC § 1320a-7 violation signal.

    Does NOT include nppes_deactivation_date because deactivation can be
    triggered by retirement or death; that's a different signal class
    (H31's domain), not a § 455.436 payment-gate failure.
    """
    candidates: list[int] = []
    for k in ("leie_excldate", "sam_active_date"):
        v = (cohort_row.get(k) or "").strip()
        if v and len(v) >= 4 and v[:4].isdigit():
            candidates.append(int(v[:4]))
    return min(candidates) if candidates else None


def state_output_dir(state: str) -> pathlib.Path:
    """Ensure `/api/v1/states/<state>/` exists, return path."""
    p = STATES_DIR / state.lower()
    p.mkdir(parents=True, exist_ok=True)
    return p


def lookup_urls(npi: str) -> dict[str, str]:
    """The three primary-source verification URLs every claims-side row carries."""
    return {
        "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
        "sam_lookup_url": "https://sam.gov/search/?index=ex",
        "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{npi}",
    }
