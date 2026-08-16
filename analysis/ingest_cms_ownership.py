"""Build an NPI-to-corporate-owner crosswalk from CMS enrollment ownership data.

The connectivity ledger showed the directory records leaves, not trees: the
organizations that hold practitioners are legal entities, and the systems that
own them are mostly absent. Two attempts to recover the tree from directory
data failed, and both failures are documented rather than buried:

- `OrganizationAffiliation` carries no `code` and is dominated by retail
  pharmacy corporate structure, so connected components merge unrelated
  organizations (see analysis/org_systems.py).
- NPPES `parent_organization_lbn` is real but sparse, and it has three failure
  modes measured here: it exists only for subparts; it goes stale (UPMC Altoona
  still names "ALTOONA REGIONAL HEALTH SYSTEM", a pre-acquisition identity);
  and it sometimes records a program rather than an owner (49 UPMC Community
  Medicine NPIs name "MEDVANTX, INC." as parent).

CMS's own enrollment ownership files do not have those problems. They state
ownership, they name holding companies and chain home offices explicitly, and
they join to an NPI deterministically:

    Hospital All Owners      ENROLLMENT ID -> owner name, type, percentage
    Hospital Enrollments     ENROLLMENT ID -> NPI, CCN

Measured on the 2026-07-17 release: all 9,162 hospital enrollments carry an NPI
and all appear in the owners file, so the join loses nothing. 327 Pennsylvania
hospital enrollments have owner rows, and the top owners are UPMC (49),
WellSpan Health (34), Highmark Health (29, the payer that owns Allegheny Health
Network), Jefferson Health, Allegheny Health Network, Encompass, Select
Medical, Penn Highlands and UHS of Delaware.

**Scope limit, stated because it decides what this can and cannot fix.** These
files cover facilities enrolled in Medicare as hospitals. They do not cover
physician groups, so "UNIVERSITY OF PITTSBURGH PHYSICIANS" and its 6,562
practitioners are still not linked to UPMC by this source. It closes the
hospital half of the gap and none of the group-practice half.

Encoding: the CMS files are latin-1, not UTF-8. Reading them as UTF-8 raises
partway through and looks like a truncated download.

Cost: zero. Two public CSV downloads, no BigQuery, no paid API.

Usage:
    python analysis/ingest_cms_ownership.py
    python analysis/ingest_cms_ownership.py --state PA --print-top 20

Outputs:
    frontend/public/api/v1/findings/hospital-ownership-crosswalk.csv
"""
from __future__ import annotations

import argparse
import collections
import csv
import io
import json
import pathlib
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
CACHE = REPO_ROOT / "analysis" / "data" / "cms-ownership"

CATALOG = "https://data.cms.gov/data.json"
OWNERS_TITLE = "Hospital All Owners"
ENROLL_TITLE = "Hospital Enrollments"

# Owner flags CMS sets explicitly. These are the corporate-structure signals
# that make the file worth using: a holding company or a chain home office is
# the tree node the provider directory is missing.
FLAGS = [
    ("HOLDING COMPANY - OWNER", "holding_company"),
    ("CHAIN HOME OFFICE - OWNER", "chain_home_office"),
    ("FOR PROFIT - OWNER", "for_profit"),
    ("NON PROFIT - OWNER", "non_profit"),
    ("PRIVATE EQUITY COMPANY - OWNER", "private_equity"),
    ("REIT - OWNER", "reit"),
    ("INVESTMENT FIRM - OWNER", "investment_firm"),
    ("MANAGEMENT SERVICES COMPANY - OWNER", "management_services"),
]


def _curl(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["curl", "-sL", "-m", "300", "-o", str(dest),
         "-H", "User-Agent: ainpi-research/1.0 (+https://ainpi.dev)", url],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
        raise RuntimeError(f"download failed: {url}")
    return dest


def resolve_csv_url(title):
    """Newest CSV distribution for a dataset title in the CMS catalog."""
    out = subprocess.run(
        ["curl", "-s", "-m", "120",
         "-H", "User-Agent: ainpi-research/1.0 (+https://ainpi.dev)", CATALOG],
        capture_output=True, text=True,
    ).stdout
    catalog = json.loads(out)
    for ds in catalog.get("dataset", []):
        if ds.get("title") == title:
            for dist in ds.get("distribution", []):
                if dist.get("format") == "CSV" and dist.get("downloadURL"):
                    return dist["downloadURL"], ds.get("modified")
    raise RuntimeError(f"no CSV distribution for {title!r}")


def read_cms_csv(path):
    """CMS enrollment files are latin-1. UTF-8 raises mid-file."""
    with open(path, encoding="latin-1", newline="") as fh:
        yield from csv.DictReader(fh)


def build(owners_path, enroll_path):
    npi_by_enrollment = {}
    ccn_by_enrollment = {}
    state_by_enrollment = {}
    for row in read_cms_csv(enroll_path):
        eid = (row.get("ENROLLMENT ID") or "").strip()
        npi = (row.get("NPI") or "").strip()
        if not eid or not npi:
            continue
        npi_by_enrollment.setdefault(eid, npi)
        ccn_by_enrollment.setdefault(eid, (row.get("CCN") or "").strip())
        state_by_enrollment.setdefault(eid, (row.get("ENROLLMENT STATE") or "").strip())

    rows = []
    unjoined = 0
    for row in read_cms_csv(owners_path):
        eid = (row.get("ENROLLMENT ID") or "").strip()
        npi = npi_by_enrollment.get(eid)
        if not npi:
            unjoined += 1
            continue
        owner_org = (row.get("ORGANIZATION NAME - OWNER") or "").strip()
        if not owner_org:
            continue  # individual owners are out of scope for a corporate tree
        rec = {
            "npi": npi,
            "ccn": ccn_by_enrollment.get(eid, ""),
            "state": state_by_enrollment.get(eid, ""),
            "organization": (row.get("ORGANIZATION NAME") or "").strip(),
            "owner": owner_org,
            "owner_role": (row.get("ROLE TEXT - OWNER") or "").strip(),
            "owner_state": (row.get("STATE - OWNER") or "").strip(),
            "percentage": (row.get("PERCENTAGE OWNERSHIP") or "").strip(),
            "association_date": (row.get("ASSOCIATION DATE - OWNER") or "").strip(),
        }
        for column, name in FLAGS:
            rec[name] = "yes" if (row.get(column) or "").strip().upper() == "Y" else "no"
        rows.append(rec)
    return rows, {"owner_rows_without_npi": unjoined,
                  "enrollments_with_npi": len(npi_by_enrollment)}


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--state", default=None, help="report a single state")
    ap.add_argument("--print-top", type=int, default=12)
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    ap.add_argument("--refresh", action="store_true",
                    help="re-download even if the cache is present")
    args = ap.parse_args()

    CACHE.mkdir(parents=True, exist_ok=True)
    owners_path = CACHE / "hospital_all_owners.csv"
    enroll_path = CACHE / "hospital_enrollments.csv"

    for title, dest in ((OWNERS_TITLE, owners_path), (ENROLL_TITLE, enroll_path)):
        if args.refresh or not dest.exists():
            url, modified = resolve_csv_url(title)
            print(f"Downloading {title} (modified {modified})")
            _curl(url, dest)
        else:
            print(f"Using cached {dest.name}")

    rows, stats = build(owners_path, enroll_path)
    print(f"{len(rows):,} owner rows joined to an NPI "
          f"({stats['owner_rows_without_npi']:,} owner rows had no NPI match)")

    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "hospital-ownership-crosswalk.csv"
    fields = list(rows[0].keys()) if rows else []
    with out_path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {out_path}")

    scope = [r for r in rows if not args.state or r["state"] == args.state.upper()]
    label = args.state.upper() if args.state else "national"
    owners = collections.Counter(r["owner"] for r in scope)
    print(f"\n{label}: {len(scope):,} rows, "
          f"{len({r['npi'] for r in scope}):,} distinct hospital NPIs, "
          f"{len(owners):,} distinct owners")
    print(f"  holding companies: "
          f"{sum(1 for r in scope if r['holding_company'] == 'yes'):,}, "
          f"chain home offices: "
          f"{sum(1 for r in scope if r['chain_home_office'] == 'yes'):,}, "
          f"private equity: "
          f"{sum(1 for r in scope if r['private_equity'] == 'yes'):,}")
    for name, count in owners.most_common(args.print_top):
        print(f"   {name[:52]:54s} {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
