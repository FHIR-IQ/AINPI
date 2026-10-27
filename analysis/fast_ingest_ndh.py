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
import gzip
import json
import pathlib
import subprocess
import sys
import time
from typing import Callable

# Manifest-driven URL resolution per the 2026-06-05 CMS NDH Slack
# discussion (Fred Trotter): manifest.json is the stable indirection;
# downstream consumers should resolve dated filenames through it rather
# than guessing or scraping. See analysis/ndh_manifest.py for details.
from ndh_manifest import (  # type: ignore[import-not-found]
    fetch_manifest,
    resolve_file_url,
    parse_release_date,
    expected_compressed_size,
)

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
DOWNLOADS_BASE = "https://directory.cms.gov/downloads"
LOAD_DIR = pathlib.Path("/tmp/ndh-load")
# DEFAULT_DATA_DIR is no longer hardcoded — the release date is read
# from the manifest at runtime and the data dir is derived as
# `frontend/data/cms-npd-<release-date>`. Pass --data-dir to override.


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


# Multi-valued fields are pipe-joined rather than truncated to the first entry.
# The existing _location_ids column already uses "|", so this matches. Callers
# that want one value take the first split; callers that want all of them do
# not have to fall back to scanning the resource JSON, which is the whole point
# of the flattened columns.
def _telecom_pairs(telecom):
    """Return (first_phone, "system:value|system:value|...")."""
    if not isinstance(telecom, list):
        return None, None
    first_phone, pairs = None, []
    for t in telecom:
        if not isinstance(t, dict):
            continue
        system, value = t.get("system"), t.get("value")
        if not isinstance(value, str) or not value:
            continue
        if system == "phone" and first_phone is None:
            first_phone = value
        pairs.append(f"{system or 'unknown'}:{value}")
    return first_phone, ("|".join(pairs) or None)


def first_address(raw):
    """First Address as a dict, whatever shape the source actually sent.

    The NDH is a bulk export of self-attested data and does occasionally carry
    values that do not match the profile. An AttributeError in here aborts the
    entire file rather than being absorbed by --max_bad_records, so one bad
    record would kill a multi-million-row load. Degrade to {} instead.
    """
    if isinstance(raw, list):
        raw = next((a for a in raw if isinstance(a, dict)), None)
    return raw if isinstance(raw, dict) else {}


PHYSICAL_ADDRESS_TYPES = ("physical", "both")


def physical_address(raw):
    """The Address that says where the organization is, as a dict.

    `Organization.address` is 0..* and the NDH frequently lists the postal
    billing address first and the physical work address second (NPI
    1548282270: a Woonsocket, RI billing address, then the Harrisburg, PA
    practice). Reading `address[0]` put 63,194 of 2,058,500 organizations in
    the wrong state on the 2026-10-07 release (FHI-84). Choose, in order:

      1. the first entry whose `type` is `physical` or `both` (FHIR
         Address.type is postal | physical | both, and `both` is physical);
      2. else the first entry whose `use` is `work`;
      3. else the first entry that is an object (what `first_address` does).

    Same never-raise contract as `first_address`: degrade to {}.
    `analysis/backfill_flattened_columns.py` mirrors this in SQL
    (`picked_address_sql`); keep the two in step.
    """
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, list):
        return {}
    addrs = [a for a in raw if isinstance(a, dict)]
    for a in addrs:
        if a.get("type") in PHYSICAL_ADDRESS_TYPES:
            return a
    for a in addrs:
        if a.get("use") == "work":
            return a
    return addrs[0] if addrs else {}


def _address_line(address):
    """Join address.line entries. Accepts an Address or a list of them."""
    addr = first_address(address)
    lines = [l for l in (addr.get("line") or []) if isinstance(l, str) and l]
    return "|".join(lines) or None


def _position(r):
    """Location.position is the only geo in the NDH. Returns (lat, lng)."""
    pos = r.get("position")
    if not isinstance(pos, dict):
        return None, None
    lat, lng = pos.get("latitude"), pos.get("longitude")
    return (
        float(lat) if isinstance(lat, (int, float)) else None,
        float(lng) if isinstance(lng, (int, float)) else None,
    )


def extract_practitioner(r):
    names = r.get("name") or []
    if isinstance(names, list):
        names = [n for n in names if isinstance(n, dict)]
    else:
        names = []
    addresses = r.get("address")
    addr = first_address(addresses)
    phone, telecom = _telecom_pairs(r.get("telecom"))
    return {
        "_id": r.get("id"),
        "_npi": extract_npi(r.get("identifier")),
        "_family_name": (names[0].get("family") if names else None) or None,
        "_given_name": (names[0].get("given", [None])[0] if names and names[0].get("given") else None),
        "_state": addr.get("state") or None,
        "_city": addr.get("city") or None,
        "_postal_code": addr.get("postalCode") or None,
        "_address_line": _address_line(addresses),
        "_phone": phone,
        "_telecom": telecom,
        "_gender": r.get("gender") or None,
        "_active": r.get("active") is True,
    }


def _specialty_pairs(specialties):
    """Return (first_code, first_display, "code|code|...").

    `PractitionerRole.specialty` is 0..*, and reading only the first entry
    loses real data: 421,613 role records in the 2026-08-20 release carry two
    or more, up to 17. Measuring context variation through the first-entry
    column undercounted it by 40.6%, so both forms are published. The
    first-entry columns stay because external consumers and the schema docs
    already reference them.
    """
    if not isinstance(specialties, list):
        return None, None, None
    def coding_of(sp):
        if not isinstance(sp, dict):
            return {}
        coding = sp.get("coding")
        if not isinstance(coding, list) or not coding:
            return {}
        return coding[0] if isinstance(coding[0], dict) else {}

    codes = []
    for sp in specialties:
        code = coding_of(sp).get("code")
        if isinstance(code, str) and code:
            codes.append(code)

    # Codes only, deliberately. A parallel displays column would need padding
    # to stay positionally aligned when one entry has no display, and an
    # unpadded one silently pairs a code with another specialty's name. The
    # display for a code is a NUCC lookup; see analysis/nucc_taxonomy.py.

    # The singular columns stay strictly first-entry, which is what they have
    # always held. Widening them to "first entry that has a code" would be
    # more useful and would also rewrite existing values during the backfill,
    # so the new behaviour lives only in the new columns.
    head = coding_of(specialties[0]) if specialties else {}
    first_code = head.get("code")
    first_display = head.get("display")
    return (
        first_code if isinstance(first_code, str) and first_code else None,
        first_display if isinstance(first_display, str) and first_display else None,
        "|".join(codes) or None,
    )


def extract_practitioner_role(r):
    locations = r.get("location") or []
    code, display, codes = _specialty_pairs(r.get("specialty"))
    location_ids = "|".join(
        l.get("reference", "") for l in locations if isinstance(l, dict) and l.get("reference")
    ) or None
    phone, telecom = _telecom_pairs(r.get("telecom"))
    return {
        "_id": r.get("id"),
        "_practitioner_id": ref_id(r.get("practitioner")),
        "_org_id": ref_id(r.get("organization")),
        "_specialty_code": code,
        "_specialty_display": display,
        "_specialty_codes": codes,
        "_location_ids": location_ids,
        "_phone": phone,
        "_telecom": telecom,
        "_active": r.get("active") is True,
    }


def extract_organization(r):
    # Physical address, not address[0]: see physical_address (FHI-84).
    addr = physical_address(r.get("address"))
    types = r.get("type") or []
    types = [t for t in types if isinstance(t, dict)] if isinstance(types, list) else []
    type_coding = (types[0].get("coding", [{}])[0] if types else {}) or {}
    org_phone, org_telecom = _telecom_pairs(r.get("telecom"))
    return {
        "_id": r.get("id"),
        "_npi": extract_npi(r.get("identifier")),
        "_name": r.get("name") or None,
        "_state": addr.get("state") or None,
        "_city": addr.get("city") or None,
        "_address_line": _address_line(addr),
        "_phone": org_phone,
        "_telecom": org_telecom,
        "_org_type": type_coding.get("code") or None,
        "_active": r.get("active") is True,
    }


def extract_location(r):
    # Location.address is 0..1 in FHIR, but defend against a list anyway: an
    # exception here aborts the whole file rather than being absorbed by
    # --max_bad_records, so one malformed record would kill a 1.3M-row load.
    address = r.get("address") or {}
    if isinstance(address, list):
        address = (address[0] if address else {}) or {}
    if not isinstance(address, dict):
        address = {}
    phone, telecom = _telecom_pairs(r.get("telecom"))
    lat, lng = _position(r)
    return {
        "_id": r.get("id"),
        "_name": r.get("name") or None,
        "_state": address.get("state") or None,
        "_city": address.get("city") or None,
        "_postal_code": address.get("postalCode") or None,
        "_address_line": _address_line(address),
        "_phone": phone,
        "_telecom": telecom,
        "_position_lat": lat,
        "_position_lng": lng,
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


def download_if_missing(
    url: str,
    basename: str,
    data_dir: pathlib.Path,
    expected_bytes: int | None = None,
) -> pathlib.Path:
    """Download an NDH resource by manifest-resolved URL, with caching + size check.

    `url` and `basename` come from analysis/ndh_manifest.resolve_file_url —
    no string-concatenation against a hardcoded base. `expected_bytes` is
    the manifest's declared compressed_bytes; when set, we verify the
    downloaded file matches (catches half-published files + truncated
    downloads).
    """
    data_dir.mkdir(parents=True, exist_ok=True)
    path = data_dir / basename
    if path.exists() and path.stat().st_size > 0:
        if expected_bytes is not None and path.stat().st_size != expected_bytes:
            print(
                f"  {basename}: cached but size mismatch "
                f"({path.stat().st_size:,} vs manifest {expected_bytes:,}); re-downloading"
            )
            path.unlink()
        else:
            print(f"  {basename}: cached ({path.stat().st_size:,} bytes)")
            return path
    print(f"  Downloading {url}...")
    subprocess.run(
        ["curl", "-sSL", "-o", str(path), url],
        check=True,
    )
    actual = path.stat().st_size
    if expected_bytes is not None and actual != expected_bytes:
        raise RuntimeError(
            f"{basename}: downloaded {actual:,} bytes but manifest declared "
            f"{expected_bytes:,} — file may be partial or manifest stale"
        )
    print(f"  Downloaded ({actual:,} bytes)")
    return path


# Rows per gzip chunk. BigQuery rejects gzip NDJSON files over 4 GB; at
# compresslevel 3 a practitioner row is ~525 bytes compressed, so 2M rows is
# ~1 GB, leaving wide headroom for the larger PractitionerRole records.
CHUNK_ROWS = 2_000_000


def transform_to_loadable(
    zst_path: pathlib.Path,
    out_dir: pathlib.Path,
    table: str,
    extractor: Callable[[dict], dict],
    name: str,
    chunk_rows: int = CHUNK_ROWS,
) -> list[pathlib.Path]:
    """Stream the .zst through the extractor into gzip NDJSON chunks.

    Gzip because a 2026-10-13 upload of the 18 GB uncompressed practitioner
    file died at 88% on a flaky connection; chunks because one gzip file is
    capped at 4 GB by BigQuery.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        ["zstdcat", str(zst_path)],
        stdout=subprocess.PIPE,
    )
    chunks: list[pathlib.Path] = []
    out = None
    count = 0
    errors = 0
    t0 = time.time()

    def open_chunk():
        path = out_dir / f"{table}.part{len(chunks):03d}.ndjson.gz"
        chunks.append(path)
        return gzip.open(path, "wt", encoding="utf-8", compresslevel=3)

    try:
        for line_bytes in proc.stdout:  # type: ignore[union-attr]
            try:
                line = line_bytes.decode("utf-8")
                if not line.strip():
                    continue
                resource = json.loads(line)
                row = {"resource": resource}
                row.update(extractor(resource))
                if out is None or count % chunk_rows == 0:
                    if out is not None:
                        out.close()
                    out = open_chunk()
                out.write(json.dumps(row, separators=(",", ":")) + "\n")
                count += 1
            except (json.JSONDecodeError, UnicodeDecodeError):
                errors += 1
            if count % 500_000 == 0 and count > 0:
                elapsed = time.time() - t0
                rate = count / elapsed if elapsed else 0
                print(f"    {name}: transformed {count:,} rows ({rate:,.0f}/s)")
    finally:
        if out is not None:
            out.close()
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"zstdcat failed for {zst_path} (exit {proc.returncode})")
    if count == 0:
        raise RuntimeError(f"{name}: zero rows transformed from {zst_path}; refusing to load an empty table")
    elapsed = time.time() - t0
    rate = count / elapsed if elapsed else 0
    print(f"    {name}: transform done — {count:,} rows in {len(chunks)} chunk(s), {elapsed:.1f}s ({rate:,.0f}/s, {errors} errors)")
    return chunks


def _run(cmd: list[str], what: str, attempts: int = 3) -> None:
    """Run a bq command, retrying. Load and copy jobs are atomic, so a retry
    after a failure never doubles data."""
    for attempt in range(1, attempts + 1):
        t0 = time.time()
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            print(f"    {what}: ok in {time.time() - t0:.1f}s (attempt {attempt})")
            return
        print(f"    {what}: attempt {attempt}/{attempts} failed (exit {result.returncode})")
        if result.stderr:
            print(f"    stderr: {result.stderr[-2000:]}")
        if attempt < attempts:
            time.sleep(30 * attempt)
    raise RuntimeError(f"{what} failed after {attempts} attempts")


def bq_load(table: str, chunks: list[pathlib.Path]) -> None:
    """Load chunks into a staging copy of the table, then swap it in.

    The staging table is created LIKE the live one so it keeps the live
    table's clustering (every table here is clustered on purpose; see
    CLAUDE.md). The live table changes only in the final copy job, so a
    failure partway through the chunks leaves the previous release intact.
    """
    live = f"{PROJECT}:{DATASET}.{table}"
    staging_id = f"{table}__staging"
    staging = f"{PROJECT}:{DATASET}.{staging_id}"
    _run(
        ["bq", "query", "--nouse_legacy_sql",
         f"CREATE OR REPLACE TABLE `{PROJECT}.{DATASET}.{staging_id}` LIKE `{PROJECT}.{DATASET}.{table}`"],
        f"create {staging_id}",
    )
    for i, chunk in enumerate(chunks):
        _run(
            ["bq", "load", "--source_format=NEWLINE_DELIMITED_JSON", "--noreplace",
             "--ignore_unknown_values", "--max_bad_records=100", staging, str(chunk)],
            f"load {chunk.name} ({i + 1}/{len(chunks)})",
        )
    _run(["bq", "cp", "-f", staging, live], f"swap {staging_id} -> {table}")
    _run(["bq", "rm", "-f", "-t", staging], f"drop {staging_id}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-dir",
        type=pathlib.Path,
        default=None,
        help=(
            "directory holding *.ndjson.zst files. Default: "
            "frontend/data/cms-npd-<release-date> derived from manifest.json"
        ),
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
    parser.add_argument(
        "--print-manifest-only",
        action="store_true",
        help=(
            "Resolve URLs from manifest.json and print them; do not download, "
            "transform, or bq load. Useful for verifying manifest changes."
        ),
    )
    args = parser.parse_args()

    print("Fetching NDH manifest...")
    manifest = fetch_manifest()
    files = manifest.get("files", {})
    print(f"  manifest carries {len(files)} files")

    targets = [r for r in RESOURCES if not args.resource or r[0].lower() == args.resource.lower()]
    if not targets:
        print(f"unknown resource: {args.resource}", file=sys.stderr)
        sys.exit(2)

    # Derive release date + data dir from the manifest unless explicitly overridden.
    _, first_basename = resolve_file_url(manifest, targets[0][0])
    # Manifest first: since 2026-08-20 the filenames carry no date at all, so
    # asking the filename yields "unknown" and the release lands in
    # frontend/data/cms-npd-unknown. The manifest's top-level `generated_at`
    # is one authoritative date for the whole release; the filename is the
    # fallback for the older dated-filename format.
    release_date = (
        parse_release_date(manifest) or parse_release_date(first_basename) or "unknown"
    )
    data_dir = args.data_dir or pathlib.Path(f"frontend/data/cms-npd-{release_date}")
    print(f"  release: {release_date}")
    print(f"  data dir: {data_dir}")

    if args.print_manifest_only:
        print()
        for name, table, _ in targets:
            url, basename = resolve_file_url(manifest, name)
            sz = expected_compressed_size(manifest, name)
            sz_str = f"{sz / 1e6:8.1f} MB" if sz else "       ? MB"
            print(f"  {name:25s} -> {table:30s}  {sz_str}  {url}")
        return

    LOAD_DIR.mkdir(parents=True, exist_ok=True)

    overall_t0 = time.time()
    for name, table, extractor in targets:
        print(f"\n=== {name} -> {table} ===")
        url, basename = resolve_file_url(manifest, name)
        exp_bytes = expected_compressed_size(manifest, name)
        zst_path = download_if_missing(url, basename, data_dir, expected_bytes=exp_bytes)
        chunks: list[pathlib.Path] = []
        try:
            chunks = transform_to_loadable(zst_path, LOAD_DIR, table, extractor, name)
            bq_load(table, chunks)
        finally:
            if not args.keep_load_files:
                for c in LOAD_DIR.glob(f"{table}.part*.ndjson.gz"):
                    c.unlink()

    print(f"\nAll done in {time.time() - overall_t0:.1f}s")


if __name__ == "__main__":
    main()
