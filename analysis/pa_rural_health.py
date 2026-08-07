"""Pennsylvania rural hospital connectivity dashboard (H47).

Assembles one row per Pennsylvania hospital, joining five public sources:

  1. CMS Hospital General Information: the hospital spine (CCN, name, city,
     county, type, ownership). Critical Access Hospital is a federal rural
     designation and arrives here as `Hospital Type`.
  2. USDA ERS Rural-Urban Continuum Codes 2023: county metro/nonmetro status.
     RUCC 1-3 is metro, 4-9 is nonmetro. This is the standard county-level
     rural classification.
  3. USDA ERS county data: median household income.
  4. Census Population Estimates: median age and the share of population 65+.
  5. The CMS directory team's cache of certified-EHR FHIR endpoints, derived
     from ONC Lantern (ftrotter-gov/npd_slurp_cehrt_clientfhir_cache). The
     vendor that publishes an organization's service-base-URL bundle is the
     EHR that organization runs, so this single join answers both "does this
     hospital publish a FHIR endpoint" and "which EHR does it use".

What this deliberately does NOT do: assign per-hospital Health Information
Organization membership or TEFCA participation. Pennsylvania has five
certified HIOs connected to the P3N hub, but the participant lists are not
published in machine-readable form, and the QHIN participant rosters are
partial. Inventing that column would be worse than leaving it out, so the
payload carries the structural facts and names the gap.

Cost: zero. No BigQuery, no paid API. Every input is a public file.

Usage:
    python analysis/pa_rural_health.py --cehrt-cache /path/to/clone
    python analysis/pa_rural_health.py --refresh          # re-download inputs

Output:
    frontend/public/api/v1/states/pa-rural-health.json
    frontend/public/api/v1/states/pa-rural-health.csv
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import pathlib
import re
import ssl
import urllib.request

try:
    import certifi

    _CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:  # pragma: no cover
    _CTX = ssl.create_default_context()

UA = "AINPI-DirectoryQualityBot/1.0 (+https://ainpi.dev/methodology)"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states"
CACHE_DIR = REPO_ROOT / "analysis" / ".cache"

# Pinned source URLs. CMS rotates the resource hash on each refresh; resolve it
# from the metastore rather than hardcoding a URL that silently 404s.
CMS_METASTORE = "https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/xubh-q36u"
ERS_RUCC = "https://ers.usda.gov/sites/default/files/_laserfiche/DataFiles/53251/Ruralurbancontinuumcodes2023.csv"
ERS_INCOME = "https://ers.usda.gov/sites/default/files/_laserfiche/DataFiles/48747/Unemployment2023.csv"
CENSUS_PEP = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2023/counties/asrh/cc-est2023-agesex-42.csv"

INCOME_ATTR = "Median_Household_Income_2022"
PEP_YEAR = "5"  # vintage 2023 estimate

# Health systems are derived from the facility name. PA systems brand their
# hospitals inconsistently, so this resolves a little over half of them and the
# rest are reported as undetermined rather than guessed. A hospital is not
# assigned a system unless its own name carries the brand.
SYSTEM_RULES: list[tuple[str, str]] = [
    ("UPMC", "UPMC"),
    ("GEISINGER", "Geisinger"),
    ("WELLSPAN", "WellSpan Health"),
    ("LEHIGH VALLEY", "Lehigh Valley Health Network"),
    ("PENN HIGHLANDS", "Penn Highlands Healthcare"),
    ("PENN STATE HEALTH", "Penn State Health"),
    ("ST LUKE", "St. Luke's University Health Network"),
    ("ST. LUKE", "St. Luke's University Health Network"),
    ("SAINT LUKE", "St. Luke's University Health Network"),
    ("TOWER HEALTH", "Tower Health"),
    ("JEFFERSON", "Jefferson Health"),
    ("TEMPLE", "Temple Health"),
    ("ALLEGHENY", "Allegheny Health Network"),
    ("WVU", "WVU Medicine"),
    ("COMMONWEALTH HEALTH", "Commonwealth Health"),
    ("CONEMAUGH", "Conemaugh Health System"),
    ("HERITAGE VALLEY", "Heritage Valley Health System"),
    ("MAIN LINE", "Main Line Health"),
    ("EXCELA", "Excela Health"),
    ("CROZER", "Crozer Health"),
    ("GUTHRIE", "Guthrie"),
    ("EVANGELICAL", "Evangelical Community Hospital"),
    ("VA MEDICAL CENTER", "Veterans Health Administration"),
    ("VETERANS AFFAIRS", "Veterans Health Administration"),
]

# Tokens carrying no distinguishing signal when matching a hospital name to a
# vendor-published organization name.
STOPWORDS = {
    "THE", "INC", "LLC", "LP", "PC", "CORPORATION", "CORP", "CO", "COMPANY",
    "HOSPITAL", "HOSPITALS", "MEDICAL", "CENTER", "CENTRE", "HEALTH",
    "HEALTHCARE", "SYSTEM", "REGIONAL", "COMMUNITY", "MEMORIAL", "GENERAL",
    "UNIVERSITY", "UNIV", "OF", "AND", "AT", "FOR",
}


def fetch(url: str, name: str, refresh: bool = False, encoding: str = "utf-8") -> str:
    """Download to analysis/.cache and reuse unless --refresh."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / name
    if path.exists() and not refresh:
        return path.read_text(encoding="utf-8")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180, context=_CTX) as resp:
        raw = resp.read()
    text = raw.decode(encoding, errors="replace")
    path.write_text(text, encoding="utf-8")
    return text


def resolve_cms_csv_url() -> str:
    req = urllib.request.Request(CMS_METASTORE, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120, context=_CTX) as resp:
        meta = json.load(resp)
    for d in meta.get("distribution", []):
        if d.get("downloadURL", "").endswith(".csv"):
            return d["downloadURL"]
    raise SystemExit("could not resolve the CMS hospital CSV URL from the metastore")


def norm_county(s: str) -> str:
    """Collapse county names to a comparison key.

    CMS and USDA disagree on spacing and punctuation for the same county:
    CMS writes "MC KEAN" and "MCKEAN", USDA writes "McKean". Comparing raw
    uppercase strings silently drops the hospital from every county rollup,
    which is how UPMC Kane once made McKean look like a county with no
    hospital while also appearing in the hospital table.
    """
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def norm_name(s: str) -> str:
    s = (s or "").upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tokens(s: str) -> set[str]:
    return {t for t in norm_name(s).split() if t not in STOPWORDS and len(t) > 2}


def match_key(name: str, city: str) -> tuple[str, str]:
    core = " ".join(t for t in norm_name(name).split() if t not in STOPWORDS)
    return (core, (city or "").upper().strip())


def load_counties(refresh: bool) -> dict[str, dict]:
    """FIPS -> county record with rural class, income, age."""
    counties: dict[str, dict] = {}

    rucc = csv.DictReader(io.StringIO(fetch(ERS_RUCC, "rucc2023.csv", refresh, "latin-1")))
    for r in rucc:
        if r["State"] != "PA":
            continue
        fips = r["FIPS"].zfill(5)
        c = counties.setdefault(fips, {"fips": fips, "name": r["County_Name"].replace(" County", "")})
        if r["Attribute"] == "RUCC_2023":
            c["rucc"] = int(float(r["Value"]))
        elif r["Attribute"] == "Population_2020":
            c["population_2020"] = int(float(r["Value"]))
        elif r["Attribute"] == "Description":
            c["rucc_description"] = r["Value"]

    inc = csv.DictReader(io.StringIO(fetch(ERS_INCOME, "ers_income.csv", refresh, "latin-1")))
    for r in inc:
        if r["State"] != "PA" or r["Attribute"] != INCOME_ATTR:
            continue
        fips = r["FIPS_Code"].zfill(5)
        if fips in counties and r["Value"]:
            counties[fips]["median_household_income"] = int(float(r["Value"].replace(",", "")))

    pep = csv.DictReader(io.StringIO(fetch(CENSUS_PEP, "pep_pa_agesex.csv", refresh, "latin-1")))
    for r in pep:
        if r.get("YEAR") != PEP_YEAR:
            continue
        fips = (r["STATE"].zfill(2) + r["COUNTY"].zfill(3))
        if fips not in counties:
            continue
        pop = int(r["POPESTIMATE"])
        c65 = int(r["AGE65PLUS_TOT"])
        counties[fips].update(
            population=pop,
            median_age=float(r["MEDIAN_AGE_TOT"]),
            pct_65_plus=round(100 * c65 / pop, 1) if pop else None,
        )

    for c in counties.values():
        c["rural"] = c.get("rucc", 0) >= 4
    return counties


def load_hospitals(refresh: bool) -> list[dict]:
    url = resolve_cms_csv_url()
    text = fetch(url, "hospitals_all.csv", refresh, "utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    return [r for r in rows if r.get("State") == "PA"]


def index_cehrt(cache_root: pathlib.Path) -> tuple[dict, dict]:
    """Index PA organizations published by certified EHR vendors.

    Returns the exact index, the per-city index, and per-vendor counts of how
    many published organizations actually cross-link to an Endpoint resource.
    """
    exact: dict[tuple[str, str], dict] = {}
    by_city: dict[str, list[dict]] = {}
    linkage: dict[str, dict] = {}
    # Vendors publish organizations in one of two shapes and both are valid
    # FHIR. Flat: one Organization per site, each carrying Organization.endpoint.
    # Hierarchical: a brand-level Organization carries the endpoint and each
    # facility points at it through partOf. Epic uses the second shape, where
    # all 1,187 brand records carry an endpoint and the 83,678 facilities under
    # them do not. Checking only the matched record therefore reports "no
    # endpoint" for an Epic hospital whose endpoint is live, so resolve the
    # partOf chain before deciding.
    org_by_id: dict[str, dict] = {}
    pending: list[dict] = []
    org_dirs = list(cache_root.rglob("organization/*.json"))
    if not org_dirs:
        raise SystemExit(f"no organization/*.json under {cache_root}")

    for f in org_dirs:
        try:
            payload = json.loads(f.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        res = payload.get("resource", payload)
        addr = next(
            (a for a in (res.get("address") or []) if (a.get("state") or "").upper() == "PA"),
            None,
        )
        if not addr:
            continue
        # .../fhir_json_cache/<vendor>_<hash>/organization/<file>.json
        parts = f.parts
        try:
            vendor_dir = parts[parts.index("fhir_json_cache") + 1]
        except ValueError:
            continue
        vendor = vendor_dir.rsplit("_", 1)[0]
        # A Synthea identifier marks a vendor bundle populated with synthetic
        # test records rather than real customers. Flag rather than drop, so the
        # data-quality problem stays visible instead of silently shrinking the
        # denominator.
        synthetic = any(
            "synthea" in (i.get("system") or "").lower() for i in (res.get("identifier") or [])
        )
        npi = next(
            (
                i.get("value")
                for i in (res.get("identifier") or [])
                if "us-npi" in (i.get("system") or "").lower()
                and re.fullmatch(r"\d{10}", i.get("value") or "")
            ),
            None,
        )
        rec = {
            "res_id": res.get("id"),
            "part_of": (res.get("partOf") or {}).get("reference"),
            "org_name": res.get("name"),
            "vendor": vendor,
            "has_endpoint": bool(res.get("endpoint")),
            "npi": npi,
            "synthetic": synthetic,
            "city": (addr.get("city") or "").upper().strip(),
            "tokens": tokens(res.get("name")),
        }
        exact.setdefault(match_key(res.get("name"), addr.get("city")), rec)
        by_city.setdefault(rec["city"], []).append(rec)
        if rec["res_id"]:
            org_by_id[rec["res_id"]] = rec
        pending.append(rec)
        v = linkage.setdefault(vendor, {"orgs": 0, "endpoint_linked": 0})
        v["orgs"] += 1
        v["endpoint_linked"] += bool(res.get("endpoint"))

    # Second pass: an organization resolves to an endpoint if it carries one, or
    # if any ancestor in its partOf chain does.
    def resolves(rec: dict, depth: int = 0) -> bool:
        if rec.get("has_endpoint"):
            return True
        ref = rec.get("part_of") or ""
        if not ref or depth > 8:
            return False
        parent = org_by_id.get(ref.split("/")[-1].replace("urn:uuid:", ""))
        return resolves(parent, depth + 1) if parent else False

    for rec in pending:
        rec["endpoint_resolvable"] = resolves(rec)
    return exact, by_city, linkage


def vendor_label(slug: str) -> str:
    known = {
        "epic_systems_corporation": "Epic",
        "oracle_health": "Oracle Health (Cerner)",
        "medical_information_technology_inc_meditech": "MEDITECH",
        "athenahealth_inc": "athenahealth",
        "altera_digital_health_inc": "Altera (Allscripts)",
        "trubridge_inc": "TruBridge",
        "nextgen_healthcare": "NextGen",
        "eclinicalworks_llc": "eClinicalWorks",
        "pointclickcare_technologies_inc": "PointClickCare",
        "advancedmd": "AdvancedMD",
        "darena_solutions_llc_dba_darena_health": "Darena Health",
    }
    if slug in known:
        return known[slug]
    return slug.replace("_", " ").title()


def derive_system(name: str) -> str | None:
    upper = (name or "").upper()
    for pattern, label in SYSTEM_RULES:
        if pattern in upper:
            return label
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cehrt-cache", required=True, help="path to a clone of npd_slurp_cehrt_clientfhir_cache")
    ap.add_argument("--refresh", action="store_true", help="re-download source files")
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    args = ap.parse_args()

    counties = load_counties(args.refresh)
    hospitals_raw = load_hospitals(args.refresh)
    exact, by_city, linkage = index_cehrt(pathlib.Path(args.cehrt_cache))
    print(f"counties: {len(counties)} | hospitals: {len(hospitals_raw)} | PA vendor orgs: {sum(len(v) for v in by_city.values())}")

    by_county_name = {norm_county(c["name"]): c for c in counties.values()}

    hospitals = []
    stats = {"exact": 0, "token": 0, "none": 0}
    for h in hospitals_raw:
        cname = norm_county(h.get("County/Parish"))
        county = by_county_name.get(cname)
        city = (h.get("City/Town") or "").strip()

        rec = exact.get(match_key(h["Facility Name"], city))
        method = "name_city_exact" if rec else None

        if not rec:
            # Fall back to token overlap inside the same city. Requires a strong
            # majority of the hospital's distinguishing tokens, so "Wayne
            # Memorial" does not capture "Wayne Surgery".
            want = tokens(h["Facility Name"])
            best, best_score = None, 0.0
            for cand in by_city.get(city.upper(), []):
                if not want or not cand["tokens"]:
                    continue
                overlap = len(want & cand["tokens"]) / len(want)
                if overlap > best_score:
                    best, best_score = cand, overlap
            if best and best_score >= 0.75:
                rec, method = best, "name_city_token"

        stats["exact" if method == "name_city_exact" else "token" if method else "none"] += 1

        htype = h.get("Hospital Type") or ""
        hospitals.append(
            {
                "ccn": h.get("Facility ID"),
                "name": h.get("Facility Name"),
                "city": city,
                "county": h.get("County/Parish"),
                "county_fips": county["fips"] if county else None,
                "zip": h.get("ZIP Code"),
                "hospital_type": htype,
                "critical_access": htype == "Critical Access Hospitals",
                "ownership": h.get("Hospital Ownership"),
                "emergency_services": h.get("Emergency Services") == "Yes",
                "health_system": derive_system(h.get("Facility Name")),
                "county_rural": bool(county and county.get("rural")),
                "county_rucc": county.get("rucc") if county else None,
                # Two separate signals, because they answer different questions.
                # in_cehrt_bundle: the hospital appears in a certified-EHR
                # vendor's published service-base-URL bundle, so it is reachable
                # through that vendor's FHIR endpoint and we know its EHR.
                # org_endpoint_linked: the Organization resource actually points
                # at an Endpoint resource. Epic, which hosts most PA hospitals,
                # publishes organizations without that cross-reference, so an
                # automated org-to-endpoint traversal fails even though the
                # endpoint exists. Conflating the two would understate coverage.
                "in_cehrt_bundle": bool(rec),
                # Endpoint reachable for this hospital, following partOf when the
                # vendor publishes a brand-level hierarchy.
                "endpoint_resolvable": bool(rec and rec.get("endpoint_resolvable")),
                # Raw fact: the matched record itself carries Organization.endpoint.
                "org_endpoint_linked": bool(rec and rec["has_endpoint"]),
                "ehr_vendor": vendor_label(rec["vendor"]) if rec else None,
                "vendor_record_synthetic": bool(rec and rec["synthetic"]),
                "match_method": method,
            }
        )

    unresolved = [h for h in hospitals if not h["county_fips"]]
    if unresolved:
        print(f"WARNING: {len(unresolved)} hospitals did not resolve to a county:")
        for h in unresolved:
            print(f"   {h['name']} ({h['county']})")

    rural_h = [h for h in hospitals if h["county_rural"]]
    cah = [h for h in hospitals if h["critical_access"]]
    in_bundle = [h for h in hospitals if h["in_cehrt_bundle"]]
    linked = [h for h in hospitals if h["org_endpoint_linked"]]
    resolvable = [h for h in hospitals if h["endpoint_resolvable"]]
    rural_in_bundle = [h for h in rural_h if h["in_cehrt_bundle"]]
    cah_in_bundle = [h for h in cah if h["in_cehrt_bundle"]]

    vendors: dict[str, int] = {}
    for h in hospitals:
        if h["ehr_vendor"]:
            vendors[h["ehr_vendor"]] = vendors.get(h["ehr_vendor"], 0) + 1

    generated = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    payload = {
        "state": "PA",
        "state_name": "Pennsylvania",
        "slug": "pa-rural-health",
        "hypotheses": ["H47"],
        "generated_at": generated,
        "methodology_version": "0.7.2-draft",
        "summary": {
            "hospitals": len(hospitals),
            "counties": len(counties),
            "rural_counties": sum(1 for c in counties.values() if c["rural"]),
            "hospitals_in_rural_counties": len(rural_h),
            "critical_access_hospitals": len(cah),
            "in_cehrt_bundle": len(in_bundle),
            "org_endpoint_linked": len(linked),
            "endpoint_resolvable": len(resolvable),
            "rural_in_cehrt_bundle": len(rural_in_bundle),
            "cah_in_cehrt_bundle": len(cah_in_bundle),
            "match_exact": stats["exact"],
            "match_token": stats["token"],
            "match_none": stats["none"],
            "ehr_vendors": dict(sorted(vendors.items(), key=lambda kv: -kv[1])),
            # Per-vendor: how many PA organizations the vendor publishes, and how
            # many of those cross-link to an Endpoint. Epic is the outlier and
            # the page cites these numbers directly.
            "vendor_endpoint_linkage": {
                vendor_label(k): {"pa_orgs": v["orgs"], "endpoint_linked": v["endpoint_linked"]}
                for k, v in sorted(linkage.items(), key=lambda kv: -kv[1]["orgs"])[:8]
            },
        },
        "counties": sorted(counties.values(), key=lambda c: c["name"]),
        "hospitals": sorted(hospitals, key=lambda h: (h["county"] or "", h["name"] or "")),
        # Deliberately carries no QHIN headcount. Designation is rolling, so any
        # hardcoded number goes stale silently between runs, and the point here
        # is roster availability rather than how many QHINs exist.
        "connectivity_note": (
            "Pennsylvania has five certified Health Information Organizations connected to the "
            "P3N hub, and QHIN designation under TEFCA continues on a rolling basis. Neither the "
            "HIO participant lists nor the QHIN participant rosters are published in "
            "machine-readable form, and the PA eHealth Partnership states that the P3N and its "
            "HIOs are not sub-participants in any QHIN. This dashboard therefore reports FHIR "
            "endpoint publication and EHR vendor, which are measurable, and does not assign HIO "
            "or TEFCA participation per hospital."
        ),
        "sources": {
            "hospitals": "CMS Hospital General Information (data.cms.gov, provider-data catalog)",
            "rural_classification": "USDA ERS Rural-Urban Continuum Codes 2023 (RUCC 4-9 = nonmetro)",
            "income": f"USDA ERS county data, {INCOME_ATTR}",
            "age": "Census Population Estimates, vintage 2023 (median age, share 65+)",
            "endpoints_and_ehr": (
                "ftrotter-gov/npd_slurp_cehrt_clientfhir_cache, the CMS directory team's cache of "
                "certified-EHR service-base-URL bundles derived from ONC Lantern"
            ),
            "hio_context": "https://www.pa.gov/agencies/dhs/resources/for-providers/ehealth-providers/choose-your-hio",
        },
        "limits": [
            "Hospital-to-vendor matching is by normalized name and city, because most vendor "
            "bundles omit the NPI. Every row carries its match_method so a reader can weigh it.",
            "A hospital with no match is reported as no published endpoint found, which is not the "
            "same as having no endpoint. It may publish under a parent system's name.",
            "Health system is derived from the facility name only. PA systems brand inconsistently, "
            "so hospitals whose names omit the brand are left undetermined rather than guessed.",
            "County rural status is a county-level classification. A metro-county hospital can still "
            "serve a rural population, and the Critical Access flag is the facility-level federal "
            "rural designation.",
        ],
    }

    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "pa-rural-health.json").write_text(json.dumps(payload, indent=2) + "\n")

    with (out_dir / "pa-rural-health.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(hospitals[0].keys()))
        w.writeheader()
        w.writerows(hospitals)

    s = payload["summary"]
    print(
        f"\nPA hospitals {s['hospitals']} | rural-county {s['hospitals_in_rural_counties']} "
        f"| CAH {s['critical_access_hospitals']}"
    )
    print(
        f"in a certified-EHR bundle: {s['in_cehrt_bundle']} "
        f"(rural {s['rural_in_cehrt_bundle']}, CAH {s['cah_in_cehrt_bundle']}); "
        f"endpoint resolvable (incl. partOf): {s['endpoint_resolvable']}; "
        f"direct Organization.endpoint: {s['org_endpoint_linked']}"
    )
    print(f"match: exact {s['match_exact']}, token {s['match_token']}, none {s['match_none']}")
    print("vendors:", s["ehr_vendors"])
    print(f"\nwrote {out_dir/'pa-rural-health.json'}")


if __name__ == "__main__":
    main()
