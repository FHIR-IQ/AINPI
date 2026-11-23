"""NPPES monthly full replacement file to parquet, with a freshness control.

Replaces the `bigquery-public-data.nppes.npi_raw` snapshot (newest enumeration
2026-02-07) for cross-source work. That snapshot read 245,374 real, active
providers as absent from NPPES against the 2026-08-20 release, because it was
six months staler than the release it was checked against.

CMS publishes one full replacement file a month plus weekly increments on
https://download.cms.gov/nppes/NPI_Files.html. `pick_full_file` takes the
monthly V2 file by name (`NPPES_Data_Dissemination_<Month>_<Year>_V2.zip`),
never a `_Weekly` increment or the deactivation report, and if the page lists
two monthly files (a mid-month replacement, or last month's still up) it takes
the newest by parsed month and year, not by string order.

`load` streams the main `npidata_pfile_*.csv` from the zip (not the
`_fileheader`, othername, pl or endpoint files) into parquet with 14 columns.
CMS encodings vary between files and the wrong guess raises partway through,
so it reads utf-8-sig first and, on a decode error, restarts from the top as
latin-1 into a fresh temp file. The output is renamed into place only after a
complete pass.

`control` is the positive control: the load fails if the newest enumeration
date is more than 45 days before the file's own month, which is what a stale
or truncated file looks like.

The download is about 1 GB and is announced before it runs:

    python3 analysis/nppes_monthly.py --announce          # page only: name + size
    python3 analysis/nppes_monthly.py --download --confirm
    python3 analysis/nppes_monthly.py --load analysis/data/nppes/<zip>

Output: analysis/data/nppes/<YYYY-MM>/nppes.parquet (gitignored) and the
committed counts file frontend/public/api/v1/nppes-load.json.
"""
from __future__ import annotations

import argparse
import calendar
import csv
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin

import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nucc_taxonomy import primary_taxonomy  # noqa: E402
from xsource_norm import SF_DATALESS, phone10, zip5  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = REPO_ROOT / "analysis" / "data" / "nppes"
SUMMARY_PATH = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "nppes-load.json"
LISTING_URL = "https://download.cms.gov/nppes/NPI_Files.html"
UA = "ainpi-research/1.0 (+https://ainpi.dev)"

CONTROL_MAX_LAG_DAYS = 45
BATCH_ROWS = 200_000
csv.field_size_limit(sys.maxsize)

_MONTHS = {m: i for i, m in enumerate(calendar.month_name) if m}
_FULL_RE = re.compile(
    r"NPPES_Data_Dissemination_(" + "|".join(_MONTHS) + r")_(\d{4})_V2\.zip", re.I
)
_HREF_RE = re.compile(r"""href\s*=\s*["']([^"']+)["']""", re.I)
_MAIN_CSV_RE = re.compile(r"^npidata_pfile_[\d-]+\.csv$", re.I)

# Output column -> NPPES header. Mapped by name so a reordered file still
# loads correctly and a renamed header fails loudly instead of loading blanks.
SOURCE_COLUMNS = {
    "npi": "NPI",
    "entity_type": "Entity Type Code",
    "last_name": "Provider Last Name (Legal Name)",
    "first_name": "Provider First Name",
    "org_name": "Provider Organization Name (Legal Business Name)",
    "practice_line1": "Provider First Line Business Practice Location Address",
    "practice_city": "Provider Business Practice Location Address City Name",
    "practice_state": "Provider Business Practice Location Address State Name",
    "practice_zip5": "Provider Business Practice Location Address Postal Code",
    "practice_phone10": "Provider Business Practice Location Address Telephone Number",
    "deactivation_date": "NPI Deactivation Date",
    "enumeration_date": "Provider Enumeration Date",
    "last_update_date": "Last Update Date",
}
TAXONOMY_SLOTS = [
    (f"Healthcare Provider Taxonomy Code_{i}", f"Healthcare Provider Primary Taxonomy Switch_{i}")
    for i in range(1, 16)
]
COLUMNS = [
    "npi", "entity_type", "last_name", "first_name", "org_name", "practice_line1",
    "practice_city", "practice_state", "practice_zip5", "practice_phone10",
    "primary_taxonomy", "deactivation_date", "enumeration_date", "last_update_date",
]
DATE_COLUMNS = ("deactivation_date", "enumeration_date", "last_update_date")
SCHEMA = pa.schema(
    [pa.field(c, pa.date32() if c in DATE_COLUMNS else pa.string()) for c in COLUMNS]
)

_stat = os.stat  # indirection so tests can simulate a dataless file


# --------------------------------------------------------------------------
# Picking the file
# --------------------------------------------------------------------------

def pick_full_file(listing_html: str) -> str:
    """The href of the newest monthly full replacement V2 file on the page."""
    best = None
    for href in _HREF_RE.findall(listing_html):
        name = href.rsplit("/", 1)[-1]
        if "weekly" in name.lower() or "deactivat" in name.lower():
            continue
        m = _FULL_RE.fullmatch(name)
        if not m:
            continue
        key = (int(m.group(2)), _MONTHS[m.group(1).capitalize()])
        if best is None or key > best[0]:
            best = (key, href)
    if best is None:
        raise ValueError(
            "no full replacement monthly V2 file (NPPES_Data_Dissemination_<Month>_<Year>_V2.zip) "
            "on the NPPES files page; the page layout may have changed"
        )
    return best[1]


def file_month(name: str) -> str:
    """'NPPES_Data_Dissemination_November_2026_V2.zip' -> '2026-11'."""
    m = _FULL_RE.search(name)
    if not m:
        raise ValueError(f"not a monthly NPPES file name: {name}")
    return f"{int(m.group(2)):04d}-{_MONTHS[m.group(1).capitalize()]:02d}"


def resolve_url(href: str, base: str = LISTING_URL) -> str:
    return urljoin(base, href)


def listed_size_mb(listing_html: str, href: str) -> int | None:
    """The '(1,078 MB)' figure the page prints next to the link, if any."""
    i = listing_html.find(href)
    if i == -1:
        return None
    m = re.search(r"\(([\d,]+)\s*MB\)", listing_html[i:i + 400])
    return int(m.group(1).replace(",", "")) if m else None


# --------------------------------------------------------------------------
# Network (exercised only by the owner-run CLI)
# --------------------------------------------------------------------------

def fetch_listing(run=subprocess.run) -> str:
    proc = run(["curl", "-sSL", "-m", "60", "-H", f"User-Agent: {UA}", LISTING_URL],
               capture_output=True, text=True)
    if proc.returncode != 0 or "NPPES" not in (proc.stdout or ""):
        raise RuntimeError("could not read the NPPES files page")
    return proc.stdout


def download(url: str, dest_dir: Path, *, listed_mb: int | None, confirm: bool,
             run=subprocess.run) -> Path:
    """Announce the file, then fetch it with curl only if `confirm` is set."""
    name = url.rsplit("/", 1)[-1]
    size = f"{listed_mb} MB" if listed_mb else "size not listed"
    print(f"NPPES monthly file: {name} ({size}) from {url}")
    if not confirm:
        print("Not downloading. Re-run with --download --confirm once the owner has seen this.")
        raise SystemExit(2)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / name
    proc = run(["curl", "-sSL", "--fail", "-C", "-", "-H", f"User-Agent: {UA}",
                "-o", str(dest), url])
    if getattr(proc, "returncode", 1) != 0:
        raise RuntimeError(f"download of {name} failed")
    if listed_mb:
        got = dest.stat().st_size
        # The page rounds and does not say whether MB is 10^6 or 2^20 bytes;
        # the smaller reading minus 2% is the floor. Below it, truncated.
        if got < listed_mb * 1_000_000 * 0.98:
            raise RuntimeError(f"{name} is {got / 1e6:.0f} MB, page lists {listed_mb} MB: truncated")
    return dest


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

def _parse_date(v: str) -> date | None:
    v = (v or "").strip()
    if not v:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            pass
    return None


def _main_member(zf: zipfile.ZipFile) -> str:
    names = [n for n in zf.namelist() if _MAIN_CSV_RE.match(n.rsplit("/", 1)[-1])]
    if len(names) != 1:
        raise ValueError(f"expected one npidata_pfile_*.csv in the zip, found {len(names)}")
    return names[0]


def _convert(row: list[str], idx: dict[str, int], tax_idx: list[tuple[int, int]]) -> dict:
    def get(col):
        v = row[idx[col]].strip() if idx[col] < len(row) else ""
        return v or None

    codes = [row[c] if c < len(row) else "" for c, _ in tax_idx]
    switches = [row[s] if s < len(row) else "" for _, s in tax_idx]
    primary, _ = primary_taxonomy(codes, switches)
    out = {
        "npi": get("npi"),
        "entity_type": get("entity_type"),
        "last_name": get("last_name"),
        "first_name": get("first_name"),
        "org_name": get("org_name"),
        "practice_line1": get("practice_line1"),
        "practice_city": get("practice_city"),
        "practice_state": get("practice_state"),
        "practice_zip5": zip5(get("practice_zip5")),
        "practice_phone10": phone10(get("practice_phone10")),
        "primary_taxonomy": primary,
    }
    for c in DATE_COLUMNS:
        out[c] = _parse_date(get(c) or "")
    return out


def _stream(zip_path: Path, member: str, encoding: str, tmp_out: Path) -> tuple[int, date | None]:
    rows = 0
    max_enum = None
    writer = pq.ParquetWriter(tmp_out, SCHEMA, compression="zstd")
    try:
        with zipfile.ZipFile(zip_path) as zf, zf.open(member) as raw:
            text = io.TextIOWrapper(raw, encoding=encoding, newline="")
            reader = csv.reader(text)
            header = [h.strip() for h in next(reader)]
            pos = {h: i for i, h in enumerate(header)}
            missing = [h for h in SOURCE_COLUMNS.values() if h not in pos]
            missing += [h for pair in TAXONOMY_SLOTS for h in pair if h not in pos]
            if missing:
                raise ValueError(f"missing NPPES column(s) in {member}: {missing[:3]}")
            idx = {c: pos[h] for c, h in SOURCE_COLUMNS.items()}
            tax_idx = [(pos[c], pos[s]) for c, s in TAXONOMY_SLOTS]
            batch: list[dict] = []
            for row in reader:
                if not row:
                    continue
                rec = _convert(row, idx, tax_idx)
                batch.append(rec)
                e = rec["enumeration_date"]
                if e and (max_enum is None or e > max_enum):
                    max_enum = e
                if len(batch) >= BATCH_ROWS:
                    writer.write_table(pa.Table.from_pylist(batch, schema=SCHEMA))
                    rows += len(batch)
                    batch = []
            if batch:
                writer.write_table(pa.Table.from_pylist(batch, schema=SCHEMA))
                rows += len(batch)
    finally:
        writer.close()
    return rows, max_enum


def load(zip_path: Path, out_dir: Path) -> dict:
    """Stream the main NPPES CSV into out_dir/nppes.parquet. Returns the summary."""
    zip_path = Path(zip_path)
    st = _stat(zip_path)
    if getattr(st, "st_flags", 0) & SF_DATALESS:
        raise RuntimeError(
            f"{zip_path} is an iCloud placeholder (dataless). Open its folder in Finder "
            f"and choose Download Now, then re-run."
        )
    with zipfile.ZipFile(zip_path) as zf:
        member = _main_member(zf)

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    final = out_dir / "nppes.parquet"
    tmp = out_dir / "nppes.parquet.partial"
    used = None
    try:
        for encoding in ("utf-8-sig", "latin-1"):
            try:
                rows, max_enum = _stream(zip_path, member, encoding, tmp)
                used = encoding
                break
            except UnicodeDecodeError:
                tmp.unlink(missing_ok=True)
                continue
        if used is None:  # pragma: no cover - latin-1 decodes every byte
            raise RuntimeError(f"could not decode {member}")
        tmp.replace(final)
    finally:
        tmp.unlink(missing_ok=True)

    return {
        "file": zip_path.name,
        "csv_member": member,
        "size": st.st_size,
        "rows": rows,
        "max_enumeration_date": max_enum.isoformat() if max_enum else None,
        "encoding": used,
        "loaded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def control(summary: dict, file_month: str) -> bool:
    """Positive control: rows exist and the newest enumeration is recent.

    Fails when MAX(enumeration_date) is more than 45 days before the first
    day of the file's month. An empty or stale file must not stand in for
    "these providers are not in NPPES".
    """
    if not summary.get("rows"):
        return False
    raw = summary.get("max_enumeration_date")
    if not raw:
        return False
    newest = date.fromisoformat(str(raw))
    y, m = (int(x) for x in file_month.split("-"))
    return newest >= date(y, m, 1) - timedelta(days=CONTROL_MAX_LAG_DAYS)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--announce", action="store_true", help="print the current file name and size")
    g.add_argument("--download", action="store_true", help="download the current monthly file")
    g.add_argument("--load", type=Path, metavar="ZIP", help="load a downloaded monthly zip")
    ap.add_argument("--confirm", action="store_true", help="required with --download")
    args = ap.parse_args(argv)

    if args.announce or args.download:
        html = fetch_listing()
        href = pick_full_file(html)
        url = resolve_url(href)
        mb = listed_size_mb(html, href)
        if args.announce:
            print(f"NPPES monthly file: {url.rsplit('/', 1)[-1]} ({mb} MB) from {url}")
            return 0
        dest = download(url, DATA_ROOT, listed_mb=mb, confirm=args.confirm)
        print(f"saved {dest}")
        return 0

    month = file_month(args.load.name)
    summary = load(args.load, DATA_ROOT / month)
    ok = control(summary, month)
    print(json.dumps(summary, indent=2))
    if not ok:
        print(f"CONTROL FAILED: newest enumeration {summary['max_enumeration_date']} is more than "
              f"{CONTROL_MAX_LAG_DAYS} days before {month}; not writing {SUMMARY_PATH.name}")
        return 1
    published = {k: summary[k] for k in ("file", "size", "rows", "max_enumeration_date", "loaded_at")}
    published["file_month"] = month
    SUMMARY_PATH.write_text(json.dumps(published, indent=2) + "\n")
    print(f"wrote {SUMMARY_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
