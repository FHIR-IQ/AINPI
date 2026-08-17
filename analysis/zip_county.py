"""ZIP to county assignment, population-weighted.

Practitioner records carry a postal code and no county. Locations carry
coordinates, but only 38.1% of practitioners have a role, so only that
minority reaches a Location at all. A postal code is the only geography the
whole population has, so county rollups go through it.

**Assignment is by dominant population share, not land area.** A rural ZIP can
hold most of its land in one county and all of its people, and therefore all
of its clinics, in another. Census publishes the population split, so use it.

**Split ZIPs are reported rather than hidden.** Pennsylvania: 336 of 1,798
ZCTAs cross a county line, and the dominant county holds a median 91% of the
population, so the assignment is usually not close. 80 are genuinely ambiguous
at under 75%, and callers surface that count so a reader can weigh a
county-level number rather than assume it is exact.

Fractional allocation was considered and rejected. It is more precise in
aggregate and it destroys the property that matters more here: with dominant
assignment, every practitioner sits in exactly one county and a reader can
check any single NPI by hand.

ZIP is treated as ZCTA. They are not the same thing: ZIP codes are delivery
routes and ZCTAs are areal approximations of them, so PO-box-only and
single-building ZIPs have no ZCTA. Unmatched postal codes are counted and
reported, never silently dropped into a county.

Source: Census 2010 ZCTA-to-county relationship file, which publishes the
population share per pair. The 2020 file replaces it but publishes only land
area in the same role, which is the weaker basis.

Usage:
    from analysis.zip_county import load_zip_county
    xw = load_zip_county()
    xw.county("15213")        # ('42003', 'Allegheny')
"""
from __future__ import annotations

import collections
import csv
import pathlib
import subprocess

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = REPO_ROOT / "analysis" / "data" / "geo"
UA = "ainpi-research/1.0 (+https://ainpi.dev)"
REL_URL = ("https://www2.census.gov/geo/docs/maps-data/data/rel/"
           "zcta_county_rel_10.txt")
REL_FILE = "zcta_county_rel_10.txt"

# Ambiguity threshold. Below this the dominant county holds a bare majority of
# the ZIP's population and the county assignment is a coin-toss worth
# reporting. Chosen once, named, and applied uniformly rather than tuned.
AMBIGUOUS_BELOW_PCT = 75.0


class ZipCounty:
    def __init__(self, by_zip, ambiguous, splits):
        self._by_zip = by_zip
        self.ambiguous_zips = ambiguous
        self.split_zips = splits

    def county(self, postal_code):
        """(county FIPS, share of the ZIP's population) or None."""
        if not postal_code:
            return None
        return self._by_zip.get(str(postal_code).strip()[:5])

    def fips(self, postal_code):
        hit = self.county(postal_code)
        return hit[0] if hit else None

    def __len__(self):
        return len(self._by_zip)


def _download():
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / REL_FILE
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    proc = subprocess.run(
        ["curl", "-sL", "-m", "600", "-o", str(dest),
         "-H", f"User-Agent: {UA}", REL_URL],
        capture_output=True, text=True)
    if proc.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
        raise RuntimeError(f"download failed: {REL_URL}")
    return dest


def load_zip_county(state_fips=None):
    """Build the crosswalk. `state_fips` limits it to one state, e.g. '42'."""
    path = _download()
    pairs = collections.defaultdict(list)
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            if state_fips and row["STATE"] != state_fips:
                continue
            zcta = row["ZCTA5"].strip()
            if not zcta:
                continue
            try:
                share = float(row["ZPOPPCT"])
            except (TypeError, ValueError):
                continue
            pairs[zcta].append((row["GEOID"].strip(), share))

    by_zip = {}
    ambiguous = 0
    splits = 0
    for zcta, options in pairs.items():
        if len(options) > 1:
            splits += 1
        fips, share = max(options, key=lambda t: t[1])
        if share < AMBIGUOUS_BELOW_PCT:
            ambiguous += 1
        by_zip[zcta] = (fips, round(share, 1))
    return ZipCounty(by_zip, ambiguous, splits)


STATE_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08",
    "CT": "09", "DE": "10", "DC": "11", "FL": "12", "GA": "13", "HI": "15",
    "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
    "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27",
    "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
    "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46",
    "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53",
    "WV": "54", "WI": "55", "WY": "56",
}
