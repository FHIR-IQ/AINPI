#!/usr/bin/env python3
"""Individual NPI suppression for everything AINPI publishes under
frontend/public/api/v1.

A provider can ask for their individual page and per-NPI rows to be removed
(/privacy/remove, docs/privacy.md). This module is the one place the
analysis side learns which NPIs are suppressed and removes them from the
published files. Aggregate numbers are not touched: a suppressed record still
counts toward every total, and a payload whose rows were removed carries a
count-only `suppressed_rows` field so its row count reconciles with its totals.

THE LIST NEVER ENTERS GIT. It is read from:

  * the `npi_suppressions` table in Supabase (the source of truth), when
    SUPPRESSION_DATABASE_URL is set and psycopg is installed;
  * the SUPPRESSED_NPIS env var (comma or whitespace separated 10-digit NPIs),
    an optional local override for offline runs.

Both are merged. A malformed entry raises: a list that silently drops an
entry publishes the record it was meant to remove.

Modes:

  python3 analysis/suppression.py --apply [PATH ...]
      Remove suppressed NPIs from every per-NPI CSV and JSON under PATH
      (default: frontend/public/api/v1). Only rows change; untouched files
      are not rewritten, and a CSV keeps its bytes except the removed lines.

  python3 analysis/suppression.py --check [PATH ...]
      Exit 1 if any suppressed NPI appears anywhere under PATH (default: the
      public tree, docs/ and analysis/release-snapshots/). Prints file paths
      and counts only, never an NPI. Passes when no list is configured.

  python3 analysis/suppression.py --mark-applied [--before ISO_TIME]
      Mark pending rows (requested at or before ISO_TIME) as applied. The
      suppression-apply workflow runs this after its commit is pushed.

  python3 analysis/suppression.py --report
      Count-only summary: how many NPIs are suppressed. Nothing else.

Every removal also keeps the unfiltered file under analysis/data/unsuppressed/
(gitignored), keyed by a hash of the filtered public file. Scripts that read a
published file as an input to another computation call `input_path()` and get
the unfiltered copy while it still matches, so derived aggregates do not move.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
from pathlib import Path
from typing import Iterable, Sequence

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_ROOT = REPO_ROOT / "frontend" / "public" / "api" / "v1"
MIRROR_ROOT = REPO_ROOT / "analysis" / "data" / "unsuppressed"
CHECK_ROOTS = (
    PUBLIC_ROOT,
    REPO_ROOT / "docs",
    REPO_ROOT / "analysis" / "release-snapshots",
)

ENV_VAR = "SUPPRESSED_NPIS"
DB_ENV_VAR = "SUPPRESSION_DATABASE_URL"
TABLE = "npi_suppressions"

NPI_RE = re.compile(r"^\d{10}$")

# A CSV whose removed rows are reconciled in a sibling finding JSON. The
# JSON's `suppressed_rows` grows by the number of rows removed from the CSV.
COUNT_SIDECARS = {
    "findings/high-risk-cohort-export.csv": "findings/high-risk-cohort.json",
}

TEXT_SUFFIXES = {".csv", ".json"}


class SuppressionError(ValueError):
    pass


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

def parse_npis(raw: str | None) -> set[str]:
    """Parse a comma/whitespace separated list. Blanks are ignored; anything
    that is not exactly ten digits raises."""
    if not raw:
        return set()
    out: set[str] = set()
    for i, tok in enumerate(re.split(r"[\s,;]+", raw.strip())):
        if not tok:
            continue
        if not NPI_RE.match(tok):
            # Position only: the token itself may be a mistyped NPI.
            raise SuppressionError(
                f"{ENV_VAR} entry #{i + 1} is not a 10-digit NPI"
            )
        out.add(tok)
    return out


def load_from_db(url: str) -> set[str]:
    try:
        import psycopg  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on the runner
        raise SuppressionError(
            f"{DB_ENV_VAR} is set but psycopg is not installed "
            "(pip install 'psycopg[binary]')"
        ) from exc
    with psycopg.connect(url, connect_timeout=20) as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT npi FROM {TABLE}")
            rows = [r[0] for r in cur.fetchall()]
    return parse_npis(",".join(rows))


def load_suppressed(env: dict | None = None) -> set[str]:
    """Every suppressed NPI: env override merged with the table."""
    env = os.environ if env is None else env
    npis = parse_npis(env.get(ENV_VAR))
    url = env.get(DB_ENV_VAR)
    if url:
        npis |= load_from_db(url)
    return npis


# --------------------------------------------------------------------------
# Row filtering
# --------------------------------------------------------------------------

def _is_npi_key(key: str) -> bool:
    return "npi" in key.lower()


def filter_rows(
    rows: Iterable[dict],
    npi_key: str | Sequence[str] = "npi",
    suppressed: set[str] | None = None,
) -> tuple[list[dict], int]:
    """Drop rows whose NPI column(s) hold a suppressed NPI.

    Returns (kept_rows, removed_count). Works for CSV DictWriter rows and for
    lists of JSON records alike.
    """
    suppressed = load_suppressed() if suppressed is None else suppressed
    keys = [npi_key] if isinstance(npi_key, str) else list(npi_key)
    rows = list(rows)
    if not suppressed:
        return rows, 0
    kept = [
        r for r in rows
        if not any(str(r.get(k) or "").strip() in suppressed for k in keys)
    ]
    return kept, len(rows) - len(kept)


def _contains_any(text: str, suppressed: set[str]) -> bool:
    return any(n in text for n in suppressed)


# --------------------------------------------------------------------------
# CSV: byte-preserving line removal
# --------------------------------------------------------------------------

def _logical_records(text: str) -> list[str]:
    """Split CSV text into raw records, keeping line endings, joining
    physical lines while a quoted field is still open."""
    records: list[str] = []
    buf = ""
    for line in text.splitlines(keepends=True):
        buf += line
        if buf.count('"') % 2 == 0:
            records.append(buf)
            buf = ""
    if buf:
        records.append(buf)
    return records


def scrub_csv_text(text: str, suppressed: set[str]) -> tuple[str, int]:
    if not suppressed or not _contains_any(text, suppressed):
        return text, 0
    records = _logical_records(text)
    if not records:
        return text, 0
    header = next(csv.reader(io.StringIO(records[0])))
    cols = [i for i, h in enumerate(header) if _is_npi_key(h)]
    if not cols:
        return text, 0
    kept = [records[0]]
    removed = 0
    for rec in records[1:]:
        if _contains_any(rec, suppressed):
            fields = next(csv.reader(io.StringIO(rec)), [])
            if any(i < len(fields) and fields[i].strip() in suppressed for i in cols):
                removed += 1
                continue
        kept.append(rec)
    return "".join(kept), removed


# --------------------------------------------------------------------------
# JSON: drop records, keys and list entries carrying a suppressed NPI
# --------------------------------------------------------------------------

def _is_suppressed_record(item, suppressed: set[str]) -> bool:
    return isinstance(item, dict) and any(
        _is_npi_key(k) and isinstance(v, (str, int)) and str(v).strip() in suppressed
        for k, v in item.items()
    )


def _scrub_json(node, suppressed: set[str]) -> tuple[object, int]:
    removed = 0
    if isinstance(node, list):
        out = []
        for item in node:
            if isinstance(item, (str, int)) and str(item) in suppressed:
                removed += 1
                continue
            if _is_suppressed_record(item, suppressed):
                removed += 1
                continue
            new, n = _scrub_json(item, suppressed)
            removed += n
            out.append(new)
        return out, removed
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k in suppressed:
                removed += 1
                continue
            if _is_npi_key(k) and isinstance(v, (str, int)) and str(v).strip() in suppressed:
                # A scalar NPI field on an object that is not itself a list
                # entry: blank the value. Its parent, if a record, was
                # already dropped by the check below one level up.
                out[k] = None
                removed += 1
                continue
            if _is_suppressed_record(v, suppressed):
                # One record held directly under a key (a featured provider,
                # say): null the whole record, name included.
                out[k] = None
                removed += 1
                continue
            new, n = _scrub_json(v, suppressed)
            removed += n
            out[k] = new
        return out, removed
    return node, 0


def _json_style(text: str) -> dict:
    """Recover the json.dumps arguments a file was written with."""
    lines = text.split("\n", 2)
    if len(lines) < 2 or not lines[1].strip():
        return {"separators": (",", ":")}
    indent = len(lines[1]) - len(lines[1].lstrip(" "))
    return {"indent": indent or None}


def scrub_json_text(text: str, suppressed: set[str]) -> tuple[str, int]:
    if not suppressed or not _contains_any(text, suppressed):
        return text, 0
    data = json.loads(text)
    new, removed = _scrub_json(data, suppressed)
    if removed == 0:
        return text, 0
    if isinstance(new, dict):
        new["suppressed_rows"] = int(new.get("suppressed_rows") or 0) + removed
    out = json.dumps(new, **_json_style(text))
    if text.endswith("\n"):
        out += "\n"
    return out, removed


# --------------------------------------------------------------------------
# Files
# --------------------------------------------------------------------------

def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _rel(path: Path) -> Path:
    try:
        return path.resolve().relative_to(REPO_ROOT)
    except ValueError:
        return Path(path.name)


def _mirror_paths(path: Path) -> tuple[Path, Path]:
    m = MIRROR_ROOT / _rel(path)
    return m, m.with_name(m.name + ".public-sha256")


def input_path(public_path: Path | str) -> Path:
    """Path a downstream computation should read for a published file.

    The unfiltered copy when one exists and still corresponds to the current
    published file, else the published file itself.
    """
    public_path = Path(public_path)
    mirror, stamp = _mirror_paths(public_path)
    if mirror.exists() and stamp.exists() and public_path.exists():
        current = _sha256(public_path.read_text(encoding="utf-8"))
        if stamp.read_text().strip() == current:
            return mirror
    return public_path


def _bump_sidecar(sidecar: Path, removed: int) -> None:
    if not sidecar.exists() or removed == 0:
        return
    text = sidecar.read_text(encoding="utf-8")
    data = json.loads(text)
    data["suppressed_rows"] = int(data.get("suppressed_rows") or 0) + removed
    out = json.dumps(data, **_json_style(text))
    sidecar.write_text(out + ("\n" if text.endswith("\n") else ""), encoding="utf-8")


def scrub_file(
    path: Path | str,
    suppressed: set[str] | None = None,
    update_sidecar: bool = True,
) -> int:
    """Remove suppressed rows from one CSV/JSON file in place. Returns the
    number removed. Keeps the unfiltered copy for `input_path()`."""
    path = Path(path)
    suppressed = load_suppressed() if suppressed is None else suppressed
    if not suppressed or path.suffix not in TEXT_SUFFIXES:
        return 0
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".csv":
        new, removed = scrub_csv_text(text, suppressed)
    else:
        new, removed = scrub_json_text(text, suppressed)
    if removed == 0:
        return 0
    mirror, stamp = _mirror_paths(path)
    mirror.parent.mkdir(parents=True, exist_ok=True)
    mirror.write_text(text, encoding="utf-8")
    path.write_text(new, encoding="utf-8")
    stamp.write_text(_sha256(new) + "\n")
    if update_sidecar:
        try:
            key = path.resolve().relative_to(PUBLIC_ROOT.resolve()).as_posix()
        except ValueError:
            key = ""
        if key in COUNT_SIDECARS:
            _bump_sidecar(PUBLIC_ROOT / COUNT_SIDECARS[key], removed)
    return removed


def _walk(paths: Sequence[Path]) -> Iterable[Path]:
    for p in paths:
        if p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file():
                    yield f
        elif p.is_file():
            yield p


def apply(paths: Sequence[Path], suppressed: set[str]) -> dict[str, int]:
    removed: dict[str, int] = {}
    for f in _walk(paths):
        n = scrub_file(f, suppressed)
        if n:
            removed[str(_rel(f))] = n
    return removed


def check(paths: Sequence[Path], suppressed: set[str]) -> dict[str, int]:
    """Files that still contain a suppressed NPI, with occurrence counts."""
    hits: dict[str, int] = {}
    if not suppressed:
        return hits
    for f in _walk(paths):
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        n = sum(text.count(npi) for npi in suppressed)
        if n:
            hits[str(_rel(f))] = n
    return hits


def mark_applied(url: str, before: str | None = None) -> int:
    """Mark pending rows applied. `before` (ISO timestamp) limits it to rows
    requested before the apply run started, so a request that arrives while
    the workflow is running is not marked applied without being applied."""
    import psycopg  # type: ignore

    sql = (f"UPDATE {TABLE} SET status = 'applied', applied_at = (now() at time zone 'utc') "
           "WHERE status = 'pending'")
    params: tuple = ()
    if before:
        sql += " AND requested_at <= %s::timestamp"
        params = (before,)
    with psycopg.connect(url, connect_timeout=20) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            n = cur.rowcount
        conn.commit()
    return n


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--mark-applied", action="store_true")
    mode.add_argument("--report", action="store_true")
    ap.add_argument("--before", help="with --mark-applied: only rows requested at or before this ISO time")
    ap.add_argument("paths", nargs="*", type=Path)
    args = ap.parse_args(argv)

    if args.mark_applied:
        url = os.environ.get(DB_ENV_VAR)
        if not url:
            print(f"{DB_ENV_VAR} not set; nothing to mark.")
            return 0
        print(f"Marked {mark_applied(url, args.before)} pending suppression(s) applied.")
        return 0

    suppressed = load_suppressed()
    if args.report:
        print(f"Suppressed NPIs configured: {len(suppressed)}")
        return 0
    if not suppressed:
        print("No suppression list configured; nothing to do.")
        return 0

    if args.apply:
        paths = args.paths or [PUBLIC_ROOT]
        removed = apply(paths, suppressed)
        total = sum(removed.values())
        print(f"Suppression: {len(suppressed)} NPI(s) configured; "
              f"removed {total} row(s) from {len(removed)} file(s).")
        for f, n in sorted(removed.items()):
            print(f"  {f}: {n}")
        left = check(paths, suppressed)
        if left:
            print("Still present after apply (needs a manual look):")
            for f, n in sorted(left.items()):
                print(f"  {f}: {n} occurrence(s)")
            return 1
        return 0

    paths = args.paths or [p for p in CHECK_ROOTS if p.exists()]
    hits = check(paths, suppressed)
    if hits:
        print(f"FAIL: a suppressed NPI appears in {len(hits)} file(s):")
        for f, n in sorted(hits.items()):
            print(f"  {f}: {n} occurrence(s)")
        print("Run: python3 analysis/suppression.py --apply")
        return 1
    print(f"OK: none of the {len(suppressed)} suppressed NPI(s) appear in the checked paths.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
