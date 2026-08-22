"""Pre-aggregate the directory by geography for the value explorer.

Emits a small national index plus one file per state, so /explorer can drill
state -> county -> ZIP -> profession without a query at request time. The /npi
cost contract applies here verbatim: a crawlable drill-down backed by live
BigQuery is an unbounded bill, so everything is computed once and served static.

WHAT THIS COUNTS, AND WHAT IT REFUSES TO COUNT

  Practitioners   by state, ZIP and NUCC category, with role coverage. The
                  flattened _state / _city / _postal_code columns are used
                  rather than the resource JSON: 23x cheaper, and the primary
                  address is the right one for "who practises here".

  Organizations   split by record type, never summed. Half the Organization
                  file is `ein` tax records that carry an NPI and an address,
                  so a naive count reports roughly double the organizations
                  that exist. Provider orgs and ein records are separate
                  columns and the UI must keep them separate.

  Payers          measured and reported as absent. All 27 payer organizations
                  carry no state, city or ZIP, so a payer-by-geography layer
                  is empty by construction. The payload says so explicitly
                  rather than rendering a blank map, the same way the language
                  layer does in landscape.py.

  Locations       with coordinates, which is the only geo the NDH publishes
                  (98.28% of location records). This is what the geo search
                  will be built on.

ZIP TO COUNTY

Derived locally from the Census ZCTA relationship file via zip_county.py, not
from the directory, which has no county field. ZCTAs cross county lines; the
dominant county holds a median 91% of the population and is what gets used.
ZIPs below that threshold are counted as ambiguous and reported.

Run:    python analysis/explorer_geo.py            # all states
        python analysis/explorer_geo.py --state pa # one, for iteration
Writes: frontend/public/api/v1/explorer/index.json
        frontend/public/api/v1/explorer/<state>.json

Cost: three capped scans, about 10 GB total (~$0.06).
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys
from datetime import datetime, timezone

from google.cloud import bigquery

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from claims_sources._cohorts import bq_job_config, is_valid_us_state  # noqa: E402
from nucc_taxonomy import categorize, load_taxonomy  # noqa: E402
from release import CURRENT_RELEASE as RELEASE  # noqa: E402
from zip_county import STATE_FIPS, load_zip_county  # noqa: E402

COUNTY_GAZETTEER = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/"
    "2023_Gaz_counties_national.zip"
)


def county_names() -> dict[str, str]:
    """FIPS -> county name, from the Census Gazetteer.

    One small national file. The alternative was the USDA ERS loader in
    pa_rural_health.py, which pulls three files and is built for one state at
    a time. Names are cosmetic here: the map joins on FIPS, which is why a
    failed fetch degrades to an empty map rather than aborting the run.
    """
    import io
    import subprocess
    import zipfile

    try:
        # curl, not urllib. Python's TLS stack has failed against federal and
        # vendor hosts in H26, H46, H51 and the payer harvester, and the
        # failure mode here is the quiet one: names come back empty and the
        # map renders FIPS codes as labels.
        r = subprocess.run(
            ["curl", "-sSL", "--fail", "--max-time", "60", COUNTY_GAZETTEER],
            capture_output=True,
        )
        if r.returncode != 0:
            raise RuntimeError(f"curl exit {r.returncode}: {r.stderr.decode()[:120]}")
        blob = r.stdout
        zf = zipfile.ZipFile(io.BytesIO(blob))
        name = next(n for n in zf.namelist() if n.lower().endswith(".txt"))
        out: dict[str, str] = {}
        for line in io.TextIOWrapper(zf.open(name), encoding="latin-1"):
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 4 or parts[1].strip() == "GEOID":
                continue
            out[parts[1].strip()] = parts[3].strip()
        return out
    except Exception as e:  # noqa: BLE001
        print(f"  county names unavailable ({type(e).__name__}); FIPS only")
        return {}

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
METHODOLOGY_VERSION = "0.7.3-draft"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public" / "api" / "v1" / "explorer"

# The provider-taxonomy system URL moved in the 2026-08-20 release and a
# parser matching only the old literal returns zero without erroring. Same
# three-way match as h10_h13_with_crosswalk.py.
TAXONOMY_SYSTEMS = (
    "http://nucc.org/provider-taxonomy",
    "http://hl7.org/fhir/us/ndh/ValueSet/HealthcareIndividualTaxonomyVS",
)


def tax_sys(col: str) -> str:
    return f"{col} IN (" + ", ".join(f"'{u}'" for u in TAXONOMY_SYSTEMS) + ")"


def q(client: bigquery.Client, sql: str) -> list[dict]:
    job = client.query(sql, job_config=bq_job_config())
    rows = [dict(r) for r in job.result()]
    print(f"    {job.total_bytes_billed / 1e9:.2f} GB, {len(rows):,} rows")
    return rows


PRACTITIONER_SQL = f"""
WITH prac AS (
  SELECT
    p._id, p._npi, p._state AS state, p._city AS city,
    -- Five digits. The directory carries ZIP+4 in places and the two must not
    -- become separate rows for the same postal area.
    SUBSTR(REGEXP_REPLACE(IFNULL(p._postal_code, ''), r'[^0-9]', ''), 1, 5) AS zip5,
    (SELECT JSON_EXTRACT_SCALAR(qq, '$.code.coding[0].code')
     FROM UNNEST(IFNULL(JSON_EXTRACT_ARRAY(p.resource, '$.qualification'), [])) qq
     WHERE {tax_sys("JSON_EXTRACT_SCALAR(qq, '$.code.coding[0].system')")}
     LIMIT 1) AS taxonomy
  FROM `{PROJECT}.{DATASET}.practitioner` p
  WHERE p._state IS NOT NULL
),
roles AS (
  -- `_active` is load-bearing and its absence is not visible in the output.
  -- Counting every role regardless of status put PA role coverage at 62.8%
  -- against the 43.7% that H54, /states/pa and the connectivity ledger all
  -- publish. Three surfaces would have disagreed with a fourth.
  SELECT DISTINCT _practitioner_id AS pref
  FROM `{PROJECT}.{DATASET}.practitioner_role`
  WHERE _practitioner_id IS NOT NULL AND _active
)
SELECT
  prac.state, prac.zip5, prac.taxonomy,
  COUNT(*) AS practitioners,
  COUNTIF(r.pref IS NOT NULL) AS with_role
FROM prac
LEFT JOIN roles r ON r.pref = CONCAT('Practitioner/', prac._id)
GROUP BY state, zip5, taxonomy
"""

# `organization` has no _postal_code column, so the ZIP comes out of the
# resource JSON. Checked before writing this: the column genuinely is not there.
ORG_SQL = f"""
SELECT
  _state AS state,
  SUBSTR(REGEXP_REPLACE(
    IFNULL(JSON_VALUE(resource, '$.address[0].postalCode'), ''), r'[^0-9]', ''), 1, 5) AS zip5,
  COALESCE(NULLIF(JSON_VALUE(resource, '$.type[0].text'), ''),
           JSON_VALUE(resource, '$.type[0].coding[0].code'), '(untyped)') AS org_type,
  COUNT(*) AS organizations,
  COUNTIF(_npi IS NOT NULL) AS with_npi
FROM `{PROJECT}.{DATASET}.organization`
WHERE _state IS NOT NULL
GROUP BY state, zip5, org_type
"""

# Coordinates are the only geography the NDH publishes and are what the geo
# search will use. A ZIP's centroid here is the mean of its location points,
# which is good enough to seed a map and is not a substitute for a geocoder.
LOCATION_SQL = f"""
SELECT
  _state AS state,
  SUBSTR(REGEXP_REPLACE(IFNULL(_postal_code, ''), r'[^0-9]', ''), 1, 5) AS zip5,
  COUNT(*) AS locations,
  COUNTIF(_position_lat IS NOT NULL) AS with_coords,
  ROUND(AVG(_position_lat), 5) AS lat,
  ROUND(AVG(_position_lng), 5) AS lng
FROM `{PROJECT}.{DATASET}.location`
WHERE _state IS NOT NULL
GROUP BY state, zip5
"""

PAYER_SQL = f"""
SELECT
  COUNT(*) AS payer_orgs,
  COUNTIF(_state IS NOT NULL) AS with_state
FROM `{PROJECT}.{DATASET}.organization`
WHERE JSON_VALUE(resource, '$.type[0].coding[0].code') = 'pay'
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", help="limit output to one state code, for iteration")
    args = ap.parse_args()

    client = bigquery.Client(project=PROJECT)
    taxonomy = load_taxonomy()
    zc = load_zip_county()
    names = county_names()
    print(f"  taxonomy {len(taxonomy):,} codes, zip-county {len(zc):,} ZIPs, "
          f"county names {len(names):,}")

    print("  practitioners by state/zip/taxonomy ...")
    prac_rows = q(client, PRACTITIONER_SQL)
    print("  organizations by state/zip/type ...")
    org_rows = q(client, ORG_SQL)
    print("  locations by state/zip ...")
    loc_rows = q(client, LOCATION_SQL)
    print("  payer geography control ...")
    payer = q(client, PAYER_SQL)[0]

    # ---- fold into (state -> zip -> ...) ---------------------------------
    states: dict[str, dict] = collections.defaultdict(
        lambda: {"zips": collections.defaultdict(lambda: {
            "practitioners": 0, "with_role": 0, "by_category": collections.Counter(),
            "role_by_category": collections.Counter(),
            "orgs_provider": 0, "orgs_ein": 0, "orgs_other": 0,
            "locations": 0, "with_coords": 0, "lat": None, "lng": None,
        })}
    )
    ambiguous_zips = 0

    for r in prac_rows:
        st, zip5 = r["state"], (r["zip5"] or "")
        cat = categorize(r["taxonomy"], taxonomy)
        z = states[st]["zips"][zip5]
        z["practitioners"] += r["practitioners"]
        z["with_role"] += r["with_role"]
        z["by_category"][cat] += r["practitioners"]
        z["role_by_category"][cat] += r["with_role"]

    for r in org_rows:
        st, zip5 = r["state"], (r["zip5"] or "")
        z = states[st]["zips"][zip5]
        t = (r["org_type"] or "").lower()
        if t == "ein":
            z["orgs_ein"] += r["organizations"]
        elif t in ("healthcare provider", "prov"):
            z["orgs_provider"] += r["organizations"]
        else:
            z["orgs_other"] += r["organizations"]

    for r in loc_rows:
        st, zip5 = r["state"], (r["zip5"] or "")
        z = states[st]["zips"][zip5]
        z["locations"] += r["locations"]
        z["with_coords"] += r["with_coords"]
        if r["lat"] is not None:
            z["lat"], z["lng"] = r["lat"], r["lng"]

    OUT.mkdir(parents=True, exist_ok=True)
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    index_states = []

    # The `_state` column is free text and holds city names ("ST LOUIS",
    # "TULSA"), spelled-out states ("CALIFORNIA", "NEW JERSEY") and single
    # letters ("W"). A first run emitted 92 "states". These are dropped from
    # the geography, because a file named `tulsa.json` is nonsense, but they
    # are counted and published: someone typing a city into the state field is
    # a data-quality signal, and silently discarding it would hide the very
    # thing this project exists to measure.
    invalid_states = {
        st: sum(z["practitioners"] for z in states[st]["zips"].values())
        for st in states
        if not is_valid_us_state(st)
    }
    for st in list(invalid_states):
        del states[st]

    for st in sorted(states):
        if args.state and st.lower() != args.state.lower():
            continue
        counties: dict[str, dict] = collections.defaultdict(
            lambda: {"zips": [], "practitioners": 0, "with_role": 0,
                     "orgs_provider": 0, "orgs_ein": 0,
                     "by_category": collections.Counter()}
        )
        st_total = {"practitioners": 0, "with_role": 0, "orgs_provider": 0,
                    "orgs_ein": 0, "orgs_other": 0, "locations": 0,
                    "with_coords": 0}
        st_cat: collections.Counter = collections.Counter()
        st_cat_role: collections.Counter = collections.Counter()

        zips_out = []
        st_fips = STATE_FIPS.get(st)
        cross_state = 0
        for zip5, z in sorted(states[st]["zips"].items()):
            fips = zc.fips(zip5) if zip5 else None
            if zip5 and fips is None:
                ambiguous_zips += 1
            # A ZIP whose county sits in a different state means the record's
            # ZIP and state disagree. Real, and small: measured across CA, TX
            # and PA it is 0.00% of practitioners, entirely organization and
            # location rows. Left in the county rollup it invents counties,
            # which is how California ended up with 65 of them.
            if fips and st_fips and not fips.startswith(st_fips):
                cross_state += 1
                fips = None
            key = fips or "unknown"
            entry = {
                "zip": zip5 or "(no zip)",
                "county_fips": fips,
                "county": names.get(fips or "") or None,
                "practitioners": z["practitioners"],
                "with_role": z["with_role"],
                "orgs_provider": z["orgs_provider"],
                "orgs_ein": z["orgs_ein"],
                "locations": z["locations"],
                "lat": z["lat"],
                "lng": z["lng"],
                "by_category": dict(z["by_category"].most_common()),
            }
            zips_out.append(entry)
            c = counties[key]
            c["zips"].append(zip5 or "(no zip)")
            for k in ("practitioners", "with_role", "orgs_provider", "orgs_ein"):
                c[k] += z[k]
            c["by_category"].update(z["by_category"])
            for k in st_total:
                st_total[k] += z[k]
            st_cat.update(z["by_category"])
            st_cat_role.update(z["role_by_category"])

        payload = {
            "state": st,
            "release_date": RELEASE,
            "generated_at": generated,
            "methodology_version": METHODOLOGY_VERSION,
            "totals": st_total,
            "zips_with_out_of_state_county": cross_state,
            "by_category": [
                {"category": cat, "practitioners": n,
                 "with_role": st_cat_role.get(cat, 0),
                 "role_pct": round(100 * st_cat_role.get(cat, 0) / n, 1) if n else None}
                for cat, n in st_cat.most_common()
            ],
            "counties": [
                {"county_fips": None if fips_key == "unknown" else fips_key,
                 "county": names.get(fips_key) or ("(county unknown)"
                                                   if fips_key == "unknown" else fips_key),
                 "zip_count": len(c["zips"]),
                 "practitioners": c["practitioners"],
                 "with_role": c["with_role"],
                 "role_pct": round(100 * c["with_role"] / c["practitioners"], 1)
                             if c["practitioners"] else None,
                 "orgs_provider": c["orgs_provider"],
                 "orgs_ein": c["orgs_ein"],
                 "by_category": dict(c["by_category"].most_common(8))}
                for fips_key, c in sorted(counties.items(),
                                          key=lambda kv: -kv[1]["practitioners"])
            ],
            "zips": zips_out,
            "notes": NOTES,
        }
        (OUT / f"{st.lower()}.json").write_text(json.dumps(payload, indent=1) + "\n")
        index_states.append({
            "state": st,
            "practitioners": st_total["practitioners"],
            "with_role": st_total["with_role"],
            "role_pct": round(100 * st_total["with_role"] / st_total["practitioners"], 1)
                        if st_total["practitioners"] else None,
            "orgs_provider": st_total["orgs_provider"],
            "orgs_ein": st_total["orgs_ein"],
            "counties": len(counties),
            "zips": len(zips_out),
            "url": f"/api/v1/explorer/{st.lower()}.json",
        })

    index = {
        "release_date": RELEASE,
        "generated_at": generated,
        "methodology_version": METHODOLOGY_VERSION,
        "states": sorted(index_states, key=lambda s: -s["practitioners"]),
        "invalid_state_values": {
            "distinct_values": len(invalid_states),
            "practitioners_affected": sum(invalid_states.values()),
            "examples": sorted(invalid_states)[:20],
            "note": (
                "The NDH `state` field is free text. These values are not US "
                "jurisdictions and are excluded from the geography below. Most "
                "are city names entered in the state field."
            ),
        },
        "payer_geography": {
            "payer_organizations": payer["payer_orgs"],
            "with_any_state": payer["with_state"],
            "note": (
                "Payer organizations carry no address. All "
                f"{payer['payer_orgs']} of them are absent from every "
                "geography in this dataset, so a payer-by-place view is empty "
                "by construction rather than by omission."
            ),
        },
        "notes": NOTES,
    }
    (OUT / "index.json").write_text(json.dumps(index, indent=1) + "\n")

    total_p = sum(s["practitioners"] for s in index_states)
    print(f"\n  wrote {len(index_states)} state files + index to {OUT}")
    print(f"  {total_p:,} practitioners placed; {ambiguous_zips:,} ZIPs had no dominant county")
    print(f"  payer organizations: {payer['payer_orgs']}, with a state: {payer['with_state']}")
    print(f"  {len(invalid_states)} non-jurisdiction values in the state field, excluded")


NOTES = (
    "Counts come from the NDH bulk export at the release named above. "
    "Organizations are split by record type and never summed: roughly half the "
    "Organization file is `ein` tax records that carry an NPI and an address, "
    "so adding them to provider organizations roughly doubles the count. "
    "Practitioner geography uses the primary address; 14.85% of practitioners "
    "list addresses in more than one state and are counted only in the first. "
    "Counties are derived from the Census ZCTA-to-county relationship file, "
    "taking the county holding the largest share of a ZIP's population; ZIPs "
    "with no dominant county are grouped as unknown. Payer organizations carry "
    "no address at all and cannot appear in any geography. "
    "Profession categories here come from the directory's own "
    "Practitioner.qualification taxonomy, not from NPPES. H54 categorises the "
    "same practitioners against their NPPES taxonomy and lands 1 to 2 points "
    "different per profession as a result: PA physicians read 73.0% here and "
    "74.3% there. Neither is wrong. This view describes what the directory "
    "says about itself, which is the right frame for a directory explorer; "
    "H54 asks how the directory compares to the federal registry."
)

if __name__ == "__main__":
    main()
