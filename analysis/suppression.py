#!/usr/bin/env python3
"""Individual NPI suppression for everything AINPI publishes under
frontend/public/api/v1.

A provider can ask for their individual page and per-NPI rows to be removed
(/privacy/remove, docs/privacy.md). This module is the one place the
analysis side learns which NPIs are suppressed and removes them from the
published files. Aggregate numbers are not touched: a suppressed record still
counts toward every total, and a payload whose rows were removed carries a
count-only `suppressed_rows` field so its row count reconciles with its totals.

Scope is individual (Type 1) NPIs. Intake admits only those, and filtering
reads only individual NPI fields (`INDIVIDUAL_NPI_KEYS`), never organization
NPI fields, and skips the organization files in `ORG_FILES` entirely.

THE LIST NEVER ENTERS GIT. It is read from, and merged across:

  * the `npi_suppressions` table in Supabase (the source of truth) through
    SUPPRESSION_READER_URL (select on npi only) or SUPPRESSION_APPLY_URL,
    with psycopg installed. Row-level security hides `held` rows from both;
  * SUPPRESSED_NPIS (comma or whitespace separated 10-digit NPIs), a second
    layer that also covers offline runs.

A malformed entry raises: a list that silently drops an entry publishes the
record it was meant to remove.

POSITIVE CONTROL. Committed payloads record `suppressed_rows`. If any is above
zero, the list must not come back empty, and a configured database must not
come back with zero rows: either means the run cannot see removals already
made, and would republish them. `load_suppressed()` raises in both cases.

Modes:

  python3 analysis/suppression.py --apply [PATH ...]
      Remove suppressed NPIs from every per-NPI CSV and JSON under PATH
      (default: frontend/public/api/v1). Only rows change; untouched files
      are not rewritten, and a CSV keeps its bytes except the removed lines.

  python3 analysis/suppression.py --check [--report-file F]
      Exit 1 if any suppressed NPI appears in a file under
      frontend/public/api/v1. Hits in docs/ and analysis/release-snapshots/
      are warnings (editorial text is handled by hand). Prints file paths and
      counts only, never an NPI; --report-file writes the same as Markdown for
      an issue. With no list configured at all (forks) it warns and passes.

  python3 analysis/suppression.py --mark-applied [--before ISO_TIME]
      Mark pending rows (requested at or before ISO_TIME) as applied, through
      SUPPRESSION_APPLY_URL. The suppression-apply workflow runs this after
      its commit is pushed.

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
import fnmatch
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
WARN_ROOTS = (
    REPO_ROOT / "docs",
    REPO_ROOT / "analysis" / "release-snapshots",
)

ENV_VAR = "SUPPRESSED_NPIS"
READER_URL_VAR = "SUPPRESSION_READER_URL"
APPLY_URL_VAR = "SUPPRESSION_APPLY_URL"
TABLE = "npi_suppressions"

NPI_RE = re.compile(r"^\d{10}$")

# Field names that hold an individual's NPI. Organization NPI fields
# (org_npi, manager_npi, organization_npi, ...) are deliberately absent.
INDIVIDUAL_NPI_KEYS = frozenset({
    "npi", "_npi", "practitioner_npi", "individual_npi", "provider_npi",
    "rndrng_npi", "prscrbr_npi",
})

# Files whose `npi` field is an organization's NPI. Never filtered.
ORG_FILES = (
    "states/*-connectivity.json",
    "states/*-system-endpoint-gap.json",
    "states/*-org-endpoint-resolution.csv",
    "findings/hospital-ownership-crosswalk.csv",
    "findings/endpoint-org-crosswalk.csv",
    "findings/vendor-endpoint-attribution.csv",
)

# A CSV whose removed rows are reconciled in a sibling finding JSON. The
# JSON's `suppressed_rows` grows by the number of rows removed from the CSV.
COUNT_SIDECARS = {
    "findings/high-risk-cohort-export.csv": "findings/high-risk-cohort.json",
}

TEXT_SUFFIXES = {".csv", ".json"}
SUPPRESSED_ROWS_RE = re.compile(r'"suppressed_rows"\s*:\s*(\d+)')


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


def _psycopg():
    try:
        import psycopg  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on the runner
        raise SuppressionError(
            "a suppression database URL is set but psycopg is not installed "
            "(pip install 'psycopg[binary]')"
        ) from exc
    return psycopg


def load_from_db(url: str) -> set[str]:
    # Only `npi` is selected: the reader role has no other column, and RLS
    # already hides rows held for review.
    psycopg = _psycopg()
    with psycopg.connect(url, connect_timeout=20) as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT npi FROM {TABLE}")
            rows = [r[0] for r in cur.fetchall()]
    return parse_npis(",".join(rows))


_committed_cache: dict[Path, int] = {}


def committed_suppressed_rows(public_root: Path | None = None) -> int:
    """Sum of `suppressed_rows` across the committed JSON payloads."""
    root = (public_root or PUBLIC_ROOT).resolve()
    if root in _committed_cache:
        return _committed_cache[root]
    total = 0
    if root.exists():
        for f in root.rglob("*.json"):
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if "suppressed_rows" in text:
                total += sum(int(m) for m in SUPPRESSED_ROWS_RE.findall(text))
    _committed_cache[root] = total
    return total


def db_url(env) -> str | None:
    return env.get(READER_URL_VAR) or env.get(APPLY_URL_VAR) or None


def load_suppressed(
    env: dict | None = None,
    public_root: Path | None = None,
    control: bool = True,
) -> set[str]:
    """Every suppressed NPI: env override merged with the table, after the
    positive control (see module docstring)."""
    env = os.environ if env is None else env
    npis = parse_npis(env.get(ENV_VAR))
    url = db_url(env)
    db_rows: set[str] | None = None
    if url:
        db_rows = load_from_db(url)
        npis |= db_rows
    if control:
        committed = committed_suppressed_rows(public_root)
        if committed > 0 and db_rows is not None and not db_rows:
            raise SuppressionError(
                f"the suppression table returned zero rows, but committed payloads "
                f"record {committed} suppressed row(s). Refusing to run: the table "
                f"is empty, unreadable under RLS, or the wrong database."
            )
        if committed > 0 and not npis:
            raise SuppressionError(
                f"no suppression list is configured ({READER_URL_VAR} or {ENV_VAR}), "
                f"but committed payloads record {committed} suppressed row(s). "
                f"Refusing to run: this would republish removed rows."
            )
    return npis


# --------------------------------------------------------------------------
# Row filtering
# --------------------------------------------------------------------------

def _is_npi_key(key: str) -> bool:
    return key.lower() in INDIVIDUAL_NPI_KEYS


def _is_org_file(rel: str) -> bool:
    return any(fnmatch.fnmatch(rel, pat) for pat in ORG_FILES)


def filter_rows(
    rows: Iterable[dict],
    npi_key: str | Sequence[str] = "npi",
    suppressed: set[str] | None = None,
) -> tuple[list[dict], int]:
    """Drop rows whose individual-NPI column(s) hold a suppressed NPI.

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
# JSON
#
# One rule, applied the same way everywhere: whatever identifies the person
# is REMOVED, never blanked or retyped.
#   * a record in a list whose individual-NPI field matches: dropped from the
#     list;
#   * a bare NPI string/number in a list: dropped from the list;
#   * an object key equal to the NPI: the key is deleted;
#   * an object held directly under a key whose individual-NPI field matches:
#     the key is deleted;
#   * a scalar individual-NPI field on an object that stays: the field is
#     deleted.
# Consumers therefore see a shorter list or an absent key, which is what
# they already see for a record that was never there.
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
                removed += 1
                continue
            if _is_suppressed_record(v, suppressed):
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
        return path.resolve().relative_to(REPO_ROOT.resolve())
    except ValueError:
        return Path(path.name)


def _public_rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(PUBLIC_ROOT.resolve()).as_posix()
    except ValueError:
        return ""


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
    rel = _public_rel(path)
    if rel and _is_org_file(rel):
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
    if update_sidecar and rel in COUNT_SIDECARS:
        _bump_sidecar(PUBLIC_ROOT / COUNT_SIDECARS[rel], removed)
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
    """Files that still contain a suppressed NPI anywhere, with counts."""
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
    """Mark pending rows applied. `before` (UTC ISO time) limits it to rows
    requested before the apply run started, so a request that arrives while
    the workflow is running is not marked applied without being applied."""
    psycopg = _psycopg()
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


def _write_report(path: str | None, public: dict[str, int], other: dict[str, int]) -> None:
    if not path:
        return
    lines = []
    if public:
        lines.append("Published files that still contain a removed NPI (the guard failed):")
        lines += [f"- `{f}`: {n} occurrence(s)" for f, n in sorted(public.items())]
    if other:
        lines.append("Editorial or snapshot files that contain a removed NPI (handle by hand):")
        lines += [f"- `{f}`: {n} occurrence(s)" for f, n in sorted(other.items())]
    lines.append("")
    lines.append("Fix with `python3 analysis/suppression.py --apply` for published files; "
                 "edit the others by hand. This report never names the NPI.")
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--mark-applied", action="store_true")
    mode.add_argument("--report", action="store_true")
    ap.add_argument("--before", help="with --mark-applied: only rows requested at or before this UTC ISO time")
    ap.add_argument("--report-file", help="with --check: write a Markdown summary (paths and counts only)")
    ap.add_argument("paths", nargs="*", type=Path)
    args = ap.parse_args(argv)

    if args.mark_applied:
        url = os.environ.get(APPLY_URL_VAR)
        if not url:
            print(f"{APPLY_URL_VAR} not set; nothing to mark.")
            return 0
        print(f"Marked {mark_applied(url, args.before)} pending suppression(s) applied.")
        return 0

    if args.check and not db_url(os.environ) and not os.environ.get(ENV_VAR):
        # Forks and unconfigured local clones. Generators and --apply still
        # enforce the positive control; the weekly refresh requires a list.
        print("::warning::No suppression list configured; the guard checked nothing.")
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
        return 0

    public_paths = args.paths or [PUBLIC_ROOT]
    public = check(public_paths, suppressed)
    other = {} if args.paths else check([p for p in WARN_ROOTS if p.exists()], suppressed)
    _write_report(args.report_file, public, other)
    for f, n in sorted(other.items()):
        print(f"::warning file={f}::contains a removed NPI ({n} occurrence(s)); edit by hand")
    if public:
        print(f"FAIL: a suppressed NPI appears in {len(public)} published file(s):")
        for f, n in sorted(public.items()):
            print(f"  {f}: {n} occurrence(s)")
        print("Run: python3 analysis/suppression.py --apply")
        return 1
    print(f"OK: none of the {len(suppressed)} suppressed NPI(s) appear in published files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
