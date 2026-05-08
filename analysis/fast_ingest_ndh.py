"""Fast NDH bulk-export ingest via BigQuery load jobs.

Replaces the streaming-insert approach in
frontend/scripts/ingest-cms-npd.ts (which moves at ~1.3K rows/s and
takes 3-4 hours total) with bq load jobs (~5-10x faster, ~30 min total).

Pipeline per resource:
  zstdcat <file>.ndjson.zst
    -> Python transformation: each FHIR JSON line becomes
       {"resource": <original>, "_id": "...", "_npi": "...", ...}
       so it matches the existing BQ table schema (resource:JSON +
       extracted flat _* columns)
    -> writes /tmp/ndh-load/<table>.ndjson
    -> bq load --replace --source_format=NEWLINE_DELIMITED_JSON

Usage:
    python analysis/fast_ingest_ndh.py [--data-dir DIR] [--resource NAME]

Required:
    BigQuery jobUser + dataEditor on cms_npd dataset.
    Local file at <data-dir>/<resource>.ndjson.zst (downloads from
    directory.cms.gov if missing).
"""
from __future__ import annotations
import argparse
import json
import pathlib
import subprocess
import sys
import time
from typing import Callable

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
DOWNLOADS_BASE = "https://directory.cms.gov/downloads"
DEFAULT_DATA_DIR = pathlib.Path("frontend/data/cms-npd-2026-05-08")
LOAD_DIR = pathlib.Path("/tmp/ndh-load")


def extract_npi(identifiers):
    if not identifiers:
        return None
    for ident in identifiers:
        if not isinstance(ident, dict):
            continue
        val = ident.get("value")
        if not isinstance(val, str):
            continue
        sys_ = (ident.get("system") or "").lower()
        if "us-npi" in sys_ or "namingsystem/npi" in sys_:
            return val
        type_coding = (ident.get("type") or {}).get("coding") or []
        for c in type_coding:
            if isinstance(c, dict) and (c.get("code") or "").upper() == "NPI":
                return val
    return None


def ref_id(ref):
    if not isinstance(ref, dict):
        return None
    s = ref.get("reference")
    return s if isinstance(s, str) else None


def extract_practitioner(r):
    names = r.get("name") or []
    addresses = r.get("address") or []
    return {
        "_id": r.get("id"),
        "_npi": extract_npi(r.get("identifier")),
        "_family_name": (names[0].get("family") if names else None) or None,
        "_given_name": (names[0].get("given", [None])[0] if names and names[0].get("given") else None),
        "_state": (addresses[0].get("state") if addresses else None) or None,
        "_city": (addresses[0].get("city") if addresses else None) or None,
        "_postal_code": (addresses[0].get("postalCode") if addresses else None) or None,
        "_gender": r.get("gender") or None,
        "_active": r.get("active") is True,
    }


def extract_practitioner_role(r):
    specialties = r.get("specialty") or []
    locations = r.get("location") or []
    coding = (specialties[0].get("coding", [{}])[0] if specialties else {}) or {}
    location_ids = "|".join(
        l.get("reference", "") for l in locations if isinstance(l, dict) and l.get("reference")
    ) or None
    return {
        "_id": r.get("id"),
        "_practitioner_id": ref_id(r.get("practitioner")),
        "_org_id": ref_id(r.get("organization")),
        "_specialty_code": coding.get("code") or None,
        "_specialty_display": coding.get("display") or None,
        "_location_ids": location_ids,
        "_active": r.get("active") is True,
    }


def extract_organization(r):
    addresses = r.get("address") or []
    types = r.get("type") or []
    type_coding = (types[0].get("coding", [{}])[0] if types else {}) or {}
    return {
        "_id": r.get("id"),
        "_npi": extract_npi(r.get("identifier")),
        "_name": r.get("name") or None,
        "_state": (addresses[0].get("state") if addresses else None) or None,
        "_city": (addresses[0].get("city") if addresses else None) or None,
        "_org_type": type_coding.get("code") or None,
        "_active": r.get("active") is True,
    }


def extract_location(r):
    address = r.get("address") or {}
    return {
        "_id": r.get("id"),
        "_name": r.get("name") or None,
        "_state": address.get("state") or None,
        "_city": address.get("city") or None,
        "_postal_code": address.get("postalCode") or None,
        "_status": r.get("status") or None,
        "_managing_org_id": ref_id(r.get("managingOrganization")),
    }


def extract_endpoint(r):
    ct = r.get("connectionType") or {}
    return {
        "_id": r.get("id"),
        "_connection_type": ct.get("code") or None,
        "_status": r.get("status") or None,
        "_address": r.get("address") or None,
        "_name": r.get("name") or None,
        "_managing_org_id": ref_id(r.get("managingOrganization")),
    }


def extract_organization_affiliation(r):
    return {
        "_id": r.get("id"),
        "_org_id": ref_id(r.get("organization")),
        "_participating_org_id": ref_id(r.get("participatingOrganization")),
        "_active": r.get("active") is True,
    }


RESOURCES = [
    ("Practitioner", "practitioner", extract_practitioner),
    ("PractitionerRole", "practitioner_role", extract_practitioner_role),
    ("Organization", "organization", extract_organization),
    ("Location", "location", extract_location),
    ("Endpoint", "endpoint", extract_endpoint),
    ("OrganizationAffiliation", "organization_affiliation", extract_organization_affiliation),
]


def download_if_missing(file_name: str, data_dir: pathlib.Path) -> pathlib.Path:
    data_dir.mkdir(parents=True, exist_ok=True)
    path = data_dir / file_name
    if path.exists() and path.stat().st_size > 0:
        print(f"  {file_name}: cached ({path.stat().st_size:,} bytes)")
        return path
    url = f"{DOWNLOADS_BASE}/{file_name}"
    print(f"  Downloading {url}...")
    subprocess.run(
        ["curl", "-sSL", "-o", str(path), url],
        check=True,
    )
    print(f"  Downloaded ({path.stat().st_size:,} bytes)")
    return path


def transform_to_loadable(
    zst_path: pathlib.Path,
    out_path: pathlib.Path,
    extractor: Callable[[dict], dict],
    name: str,
) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        ["zstdcat", str(zst_path)],
        stdout=subprocess.PIPE,
    )
    count = 0
    errors = 0
    t0 = time.time()
    with open(out_path, "w", encoding="utf-8") as out:
        for line_bytes in proc.stdout:  # type: ignore[union-attr]
            try:
                line = line_bytes.decode("utf-8")
                if not line.strip():
                    continue
                resource = json.loads(line)
                row = {"resource": resource}
                row.update(extractor(resource))
                out.write(json.dumps(row, separators=(",", ":")) + "\n")
                count += 1
            except (json.JSONDecodeError, UnicodeDecodeError):
                errors += 1
            if count % 500_000 == 0 and count > 0:
                elapsed = time.time() - t0
                rate = count / elapsed if elapsed else 0
                print(f"    {name}: transformed {count:,} rows ({rate:,.0f}/s)")
    proc.wait()
    elapsed = time.time() - t0
    rate = count / elapsed if elapsed else 0
    print(f"    {name}: transform done — {count:,} rows in {elapsed:.1f}s ({rate:,.0f}/s, {errors} errors)")
    return count


def bq_load(table: str, ndjson_path: pathlib.Path) -> None:
    cmd = [
        "bq", "load",
        "--source_format=NEWLINE_DELIMITED_JSON",
        "--replace",
        "--ignore_unknown_values",
        "--max_bad_records=100",
        f"{PROJECT}:{DATASET}.{table}",
        str(ndjson_path),
    ]
    print(f"    bq load: {' '.join(cmd)}")
    t0 = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.stdout:
        print(f"    bq stdout: {result.stdout}")
    if result.stderr:
        print(f"    bq stderr: {result.stderr}")
    if result.returncode != 0:
        raise RuntimeError(f"bq load failed for {table} (exit {result.returncode})")
    print(f"    bq load done in {time.time() - t0:.1f}s")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-dir",
        type=pathlib.Path,
        default=DEFAULT_DATA_DIR,
        help=f"directory holding *.ndjson.zst files (default: {DEFAULT_DATA_DIR})",
    )
    parser.add_argument(
        "--resource",
        help="run only this resource (e.g. Practitioner). Default: all 6.",
    )
    parser.add_argument(
        "--keep-load-files",
        action="store_true",
        help="don't delete /tmp/ndh-load/*.ndjson after bq load (debug)",
    )
    args = parser.parse_args()

    targets = [r for r in RESOURCES if not args.resource or r[0].lower() == args.resource.lower()]
    if not targets:
        print(f"unknown resource: {args.resource}", file=sys.stderr)
        sys.exit(2)

    LOAD_DIR.mkdir(parents=True, exist_ok=True)

    overall_t0 = time.time()
    for name, table, extractor in targets:
        print(f"\n=== {name} -> {table} ===")
        zst_file = name + ".ndjson.zst"
        zst_path = download_if_missing(zst_file, args.data_dir)
        load_path = LOAD_DIR / f"{table}.ndjson"
        try:
            transform_to_loadable(zst_path, load_path, extractor, name)
            bq_load(table, load_path)
        finally:
            if not args.keep_load_files and load_path.exists():
                load_path.unlink()

    print(f"\nAll done in {time.time() - overall_t0:.1f}s")


if __name__ == "__main__":
    main()
