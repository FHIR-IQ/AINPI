"""Practitioner-to-organization edges and NPI categories from CMS enrollment data.

The connectivity ledger's binding constraint is the role gap: 61.9% of active
Pennsylvania practitioners carry no `PractitionerRole`, so the directory states
no organization for them, so no endpoint path exists at any confidence. H52
showed payer directories carry that edge. This shows CMS already publishes it
too, in files that need no harvest and no credentials.

Four public files, each answering a different part of the question:

    DAC National Downloadable File   NPI -> org PAC ID + group legal name,
                                     practice address, phone, primary
                                     specialty, telehealth flag, Medicare
                                     assignment. One row per clinician per
                                     practice location.
    Facility Affiliation Data        NPI -> facility CCN, by facility type
                                     (hospital, SNF, LTCH, IRF, dialysis,
                                     hospice). The hospital half of the edge.
    Revalidation Reassignment List   Individual NPI -> group PAC ID. Benefit
                                     reassignment, which is the enrollment
                                     act that creates the employment link.
    PPEF Enrollment Extract          NPI -> CMS provider type. The category.

**PAC ID is the public stand-in for the tax ID.** A claim carries both an NPI
and a TIN, and the TIN is what actually groups billing under one legal entity.
The TIN is not public. The PECOS Associate Control ID is: CMS assigns one per
legal entity, publishes it, and keeps it stable across enrollments, so it
groups the same way. NPPES does carry `parent_organization_tin` and this
project deliberately does not read or republish it.

**An empty `org_pac_id` is a finding, not a missing value.** A solo
practitioner has no group to be linked to, and counting them as an unclosed
gap would overstate the problem. They are reported as their own category.

**Coverage limit, stated because it decides what this can and cannot fix.**
These files cover clinicians enrolled in Medicare. A clinician who bills only
Medicaid or only commercial plans is absent by construction. The overlap with
the directory is measured per state rather than assumed.

Cost: zero. Four public CSV downloads, no BigQuery, no paid API.

Usage:
    python analysis/ingest_pecos_affiliations.py
    python analysis/ingest_pecos_affiliations.py --state PA --print-top 20
    python analysis/ingest_pecos_affiliations.py --state PA VA OH --refresh

Outputs:
    frontend/public/api/v1/findings/pecos-org-crosswalk-<state>.csv
    frontend/public/api/v1/findings/pecos-affiliation-coverage.json
"""
from __future__ import annotations

import argparse
import collections
import csv
import json
import pathlib
from datetime import datetime, timezone
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
CACHE = REPO_ROOT / "analysis" / "data" / "pecos"

UA = "ainpi-research/1.0 (+https://ainpi.dev)"
PROVIDER_CATALOG = ("https://data.cms.gov/provider-data/api/1/metastore"
                    "/schemas/dataset/items/{}?show-reference-ids=true")
OPEN_CATALOG = "https://data.cms.gov/data.json"

# Care Compare dataset ids. Resolved through the catalog rather than hardcoded
# because the download URLs carry a content hash that changes every refresh.
DAC_ID = "mj5m-pzi6"
FACILITY_ID = "27ea-46a8"
REASSIGNMENT_TITLE = "Revalidation Reassignment List"
PPEF_TITLE = "Medicare Fee-For-Service  Public Provider Enrollment"

METHODOLOGY_VERSION = "0.7.3-draft"

SOURCES = {
    "dac": ("dac_national.csv", "provider-data", DAC_ID),
    "facility": ("facility_affiliation.csv", "provider-data", FACILITY_ID),
    "reassignment": ("revalidation_reassignment.csv", "open", REASSIGNMENT_TITLE),
    "ppef": ("ppef_enrollment.csv", "open", PPEF_TITLE),
}

# CMS provider-type prefixes, grouped into what a reader actually wants to
# know: is this a person who sees patients, a facility, a supplier, or a ride?
#
# The question this answers is the one asked of every "N providers" headline:
# how many of those NPIs belong to someone who could hold a clinical record.
# Transport, DME and billing-only enrollments hold no record and reach no
# endpoint, and counting them in the denominator makes the endpoint gap look
# worse than it is.
CATEGORY_RULES = [
    ("transport", ("AMBULANCE",)),
    ("supplier", ("DME", "DURABLE MEDICAL", "PROSTHETIC", "ORTHOTIC",
                  "PHARMACY", "SUPPLIER OF")),
    ("facility", ("PART A PROVIDER", "HOSPITAL", "SKILLED NURSING",
                  "HOME HEALTH", "HOSPICE", "RURAL HEALTH",
                  "FEDERALLY QUALIFIED", "AMBULATORY SURGICAL",
                  "END STAGE RENAL", "CRITICAL ACCESS",
                  "COMPREHENSIVE OUTPATIENT", "PORTABLE X-RAY",
                  "COMMUNITY MENTAL HEALTH", "HISTOCOMPATIBILITY",
                  "MAMMOGRAPHY", "RADIATION THERAPY", "CLINIC/GROUP")),
    ("practitioner", ("PRACTITIONER", "PHYSICIAN", "NURSE", "PHYSICAL THERAP",
                      "OCCUPATIONAL THERAP", "SPEECH", "PSYCHOLOG",
                      "SOCIAL WORK", "DENTIST", "OPTOMETR", "PODIATR",
                      "CHIROPRACT", "ANESTH", "MIDWIFE", "DIETIT")),
    ("diagnostic", ("INDEPENDENT DIAGNOSTIC", "MASS IMMUNIZ",
                    "INDEPENDENT CLINICAL LAB", "IDTF")),
]


def _curl(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["curl", "-sL", "-m", "1200", "-o", str(dest), "-H", f"User-Agent: {UA}", url],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
        raise RuntimeError(f"download failed: {url}")
    return dest


def _get(url):
    return subprocess.run(
        ["curl", "-s", "-m", "180", "-H", f"User-Agent: {UA}", url],
        capture_output=True, text=True).stdout


def resolve_url(kind, key):
    """Current download URL for a dataset. The hash in the path rotates."""
    if kind == "provider-data":
        meta = json.loads(_get(PROVIDER_CATALOG.format(key)))
        for dist in meta.get("distribution", []):
            data = dist.get("data", dist)
            if (data.get("mediaType") or "").endswith("csv") and data.get("downloadURL"):
                return data["downloadURL"], meta.get("modified")
        raise RuntimeError(f"no CSV distribution for {key!r}")
    catalog = json.loads(_get(OPEN_CATALOG))
    for ds in catalog.get("dataset", []):
        if ds.get("title") == key:
            for dist in ds.get("distribution", []):
                if dist.get("format") == "CSV" and dist.get("downloadURL"):
                    return dist["downloadURL"], ds.get("modified")
    raise RuntimeError(f"no CSV distribution for {key!r}")


def read_csv(path):
    """CMS ships some of these latin-1 and some utf-8, with no way to tell
    from the response. Reading the wrong one raises partway through a 400 MB
    file, which looks exactly like a truncated download."""
    try:
        with open(path, encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                yield row
        return
    except UnicodeDecodeError:
        pass
    with open(path, encoding="latin-1", newline="") as fh:
        yield from csv.DictReader(fh)


def categorize(provider_type):
    upper = (provider_type or "").upper()
    if not upper:
        return "unknown"
    for label, prefixes in CATEGORY_RULES:
        if any(p in upper for p in prefixes):
            return label
    return "other"


def load_categories(path):
    """NPI -> (category, provider type, PAC ID). One NPI can hold several
    enrollments; the practitioner category wins so a clinician who also
    enrolled a facility is still counted as a clinician."""
    out = {}
    for row in read_csv(path):
        npi = (row.get("NPI") or "").strip()
        if not npi:
            continue
        desc = (row.get("PROVIDER_TYPE_DESC") or "").strip()
        cat = categorize(desc)
        prior = out.get(npi)
        if prior and prior[0] == "practitioner" and cat != "practitioner":
            continue
        out[npi] = (cat, desc, (row.get("PECOS_ASCT_CNTL_ID") or "").strip(),
                    (row.get("STATE_CD") or "").strip())
    return out


def load_dac(path, states):
    """NPI -> group affiliations from the Care Compare national file.

    One row per clinician per practice location, so a clinician in three
    offices of one group appears three times. Collapsed to distinct
    (NPI, org PAC ID) pairs, keeping the largest reported group size.
    """
    edges = {}
    solo = set()
    seen_npi = set()
    accepts = {}
    telehealth = set()
    for row in read_csv(path):
        npi = (row.get("NPI") or "").strip()
        state = (row.get("State") or "").strip().upper()
        if not npi or (states and state not in states):
            continue
        seen_npi.add(npi)
        if (row.get("ind_assgn") or "").strip().upper() == "Y":
            accepts[npi] = "Y"
        elif npi not in accepts:
            accepts[npi] = (row.get("ind_assgn") or "").strip().upper() or "?"
        if (row.get("Telehlth") or "").strip().upper() == "Y":
            telehealth.add(npi)
        pac = (row.get("org_pac_id") or "").strip()
        name = (row.get("Facility Name") or "").strip()
        if not pac and not name:
            solo.add(npi)
            continue
        key = (npi, pac or name)
        try:
            members = int((row.get("num_org_mem") or "0").strip() or 0)
        except ValueError:
            members = 0
        prior = edges.get(key)
        if prior and prior["members"] >= members:
            continue
        edges[key] = {
            "npi": npi, "org_pac_id": pac, "org_name": name, "state": state,
            "members": members, "specialty": (row.get("pri_spec") or "").strip(),
            "city": (row.get("City/Town") or "").strip(),
            "zip": (row.get("ZIP Code") or "").strip()[:5],
            "phone": (row.get("Telephone Number") or "").strip(),
            "source": "dac-group",
        }
    # A clinician with a group row in one office and a blank in another is
    # affiliated, not solo. Resolve in favour of the evidence that exists.
    solo -= {npi for npi, _ in edges}
    return edges, solo, seen_npi, accepts, telehealth


def load_reassignment(path, states):
    """Individual NPI -> group PAC ID from benefit reassignment.

    Reassignment is the enrollment act that says "this group bills for this
    clinician's services", which is the employment edge the directory omits.
    It reaches clinicians the Care Compare file misses, and it carries the
    group PAC ID even where the group legal name field is blank.
    """
    edges = {}
    blank_names = 0
    for row in read_csv(path):
        if (row.get("Record Type") or "").strip().lower() != "reassignment":
            continue
        npi = (row.get("Individual NPI") or "").strip()
        state = (row.get("Individual State Code") or "").strip().upper()
        if not npi or (states and state not in states):
            continue
        pac = (row.get("Group PAC ID") or "").strip()
        name = (row.get("Group Legal Business Name") or "").strip()
        if not pac:
            continue
        if not name:
            blank_names += 1
        edges[(npi, pac)] = {
            "npi": npi, "org_pac_id": pac, "org_name": name, "state": state,
            "members": 0,
            "specialty": (row.get("Individual Specialty Description") or "").strip(),
            "city": "", "zip": "", "phone": "",
            "source": "reassignment",
        }
    return edges, blank_names


def load_facility(path, npi_filter):
    """NPI -> facility CCN. Restricted to NPIs already in scope, because this
    file is national and carries no state column of its own."""
    out = collections.defaultdict(set)
    types = collections.Counter()
    for row in read_csv(path):
        npi = (row.get("NPI") or "").strip()
        if not npi or npi not in npi_filter:
            continue
        ccn = (row.get("Facility Affiliations Certification Number") or "").strip()
        ftype = (row.get("facility_type") or "").strip()
        if not ccn:
            continue
        out[npi].add((ftype, ccn))
        types[ftype] += 1
    return out, types


def pct(n, d):
    return round(100.0 * n / d, 1) if d else 0.0


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--state", nargs="*", default=["PA"],
                    help="state codes to publish a crosswalk for (default PA)")
    ap.add_argument("--print-top", type=int, default=15)
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    states = {s.upper() for s in args.state} if args.state else set()
    CACHE.mkdir(parents=True, exist_ok=True)

    paths, modified = {}, {}
    for name, (filename, kind, key) in SOURCES.items():
        dest = CACHE / filename
        if args.refresh or not dest.exists() or dest.stat().st_size == 0:
            url, mod = resolve_url(kind, key)
            print(f"Downloading {name} (modified {mod})")
            _curl(url, dest)
            modified[name] = mod
        else:
            print(f"Using cached {dest.name}")
            try:
                _, modified[name] = resolve_url(kind, key)
            except Exception:
                modified[name] = None
        paths[name] = dest

    print("\nReading CMS provider types")
    categories = load_categories(paths["ppef"])
    print(f"  {len(categories):,} enrolled NPIs")

    print("Reading Care Compare group affiliations")
    dac_edges, solo, dac_npis, accepts, telehealth = load_dac(paths["dac"], states)
    print(f"  {len(dac_npis):,} clinicians in scope, "
          f"{len(dac_edges):,} distinct clinician-to-group edges, "
          f"{len(solo):,} with no group")

    print("Reading benefit reassignments")
    re_edges, blank_names = load_reassignment(paths["reassignment"], states)
    print(f"  {len(re_edges):,} reassignment edges "
          f"({blank_names:,} carry no group legal name)")

    # Care Compare wins on conflict: it carries the group's legal name and the
    # practice address, and reassignment often carries only the PAC ID.
    edges = dict(re_edges)
    edges.update(dac_edges)
    npis = {npi for npi, _ in edges} | solo

    print("Reading facility affiliations")
    facilities, facility_types = load_facility(paths["facility"], npis | dac_npis)
    print(f"  {sum(len(v) for v in facilities.values()):,} facility links for "
          f"{len(facilities):,} clinicians")

    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # `generated: None` was the only provenance this payload carried, so a
    # consumer could not tell what it described or when it was measured, and
    # the contract validator could not check it at all.
    summary = {
        "slug": "pecos-affiliation-coverage",
        "title": "CMS enrollment as a practitioner-to-organization source",
        "hypotheses": [],
        "status": "published",
        # Not an NDH release: these are CMS enrollment files with their own
        # refresh cadence, recorded per source under `sources` below.
        "release_date": "CMS enrollment files (see sources)",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "sources": {k: {"file": SOURCES[k][0], "modified": modified.get(k)}
                    for k in SOURCES},
        "states": {},
    }

    for code in sorted(states) or ["ALL"]:
        scope = [e for e in edges.values() if not states or e["state"] == code]
        scope_npis = {e["npi"] for e in scope}
        # `solo` is already scoped by the practice state on the Care Compare
        # row. Re-filtering it by the PECOS enrollment state drops 1,888 PA
        # clinicians whose enrollment is recorded in another state, which is a
        # billing address, not where they see patients.
        scope_solo = solo - scope_npis
        rows = sorted(scope, key=lambda e: (e["npi"], e["org_pac_id"]))
        for r in rows:
            cat, desc, _, _ = categories.get(r["npi"], ("unknown", "", "", ""))
            r["category"] = cat
            r["cms_provider_type"] = desc
            r["accepts_assignment"] = accepts.get(r["npi"], "")
            r["telehealth"] = "Y" if r["npi"] in telehealth else ""
            r["facility_ccns"] = "|".join(
                sorted(f"{t}:{c}" for t, c in facilities.get(r["npi"], ())))

        out_path = out_dir / f"pecos-org-crosswalk-{code.lower()}.csv"
        fields = ["npi", "org_pac_id", "org_name", "state", "city", "zip",
                  "phone", "members", "specialty", "category",
                  "cms_provider_type", "accepts_assignment", "telehealth",
                  "facility_ccns", "source"]
        with out_path.open("w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
        print(f"\nWrote {out_path}")

        by_source = collections.Counter(r["source"] for r in rows)
        by_cat = collections.Counter(r["category"] for r in rows)
        orgs = collections.Counter()
        org_names = {}
        for r in rows:
            key = r["org_pac_id"] or r["org_name"]
            orgs[key] += 1
            if r["org_name"]:
                org_names.setdefault(key, r["org_name"])

        print(f"{code}: {len(scope_npis):,} clinicians with a group, "
              f"{len(scope_solo):,} enrolled with no group, "
              f"{len(orgs):,} distinct organizations")
        print(f"  edges by source: {dict(by_source)}")
        print(f"  by category: {dict(by_cat.most_common())}")
        print(f"  top organizations by clinician count:")
        for key, count in orgs.most_common(args.print_top):
            print(f"   {org_names.get(key, key)[:52]:54s} {count:,}")

        summary["states"][code] = {
            "clinicians_with_group": len(scope_npis),
            "enrolled_without_group": len(scope_solo),
            "distinct_organizations": len(orgs),
            "edges": len(rows),
            "edges_by_source": dict(by_source),
            "by_category": dict(by_cat),
            "clinicians_with_facility_link": sum(
                1 for n in scope_npis if n in facilities),
            "accepts_assignment": sum(
                1 for n in scope_npis if accepts.get(n) == "Y"),
            "telehealth": sum(1 for n in scope_npis if n in telehealth),
            "top_organizations": [
                {"org": org_names.get(k, k), "pac_id": k, "clinicians": c}
                for k, c in orgs.most_common(25)],
            "crosswalk_csv": f"/api/v1/findings/pecos-org-crosswalk-{code.lower()}.csv",
        }

    summary["facility_types"] = dict(facility_types.most_common())
    summary_path = out_dir / "pecos-affiliation-coverage.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n")
    print(f"\nWrote {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
