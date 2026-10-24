#!/usr/bin/env python3
"""Individual NPI suppression for everything AINPI publishes under
frontend/public/api/v1.

A provider can ask for their individual page and per-NPI rows to be removed
(/privacy/remove, docs/privacy.md). This module is the one place the
analysis side learns which NPIs are suppressed and removes them from the
published files. Applying a request does not change any published aggregate:
a suppressed record still counts toward every total, and a payload whose rows
were removed carries a count-only `suppressed_rows` field so its row count
reconciles with its totals. If a later regeneration reads a filtered file (for
example a vendor file with a row removed), a few derived counts can shift by a
handful of practitioners.

Scope is individual (Type 1) NPIs: intake declines an NPI only when NPPES
positively says it is an organization's (NPI-2), and accepts the rest. A
suppressed NPI is therefore an individual's identifier (or one NPPES could
not classify) wherever it appears, so it is removed
from every NPI-valued column or key (any name containing "npi"), in
organization files too: a vendor that lists a clinician's own NPI as an
`org_npi` has published that person, and the row (with its `org_name`, which
may be their name) goes. Matching is on the exact value, never a substring.

THE LIST NEVER ENTERS GIT. It is read from, and merged across:

  * the `npi_suppressions` table in Supabase (the source of truth) through
    SUPPRESSION_READER_URL (select on npi only) or SUPPRESSION_APPLY_URL,
    with psycopg installed. Row-level security shows both roles only rows in
    force (accepted, and not queued for a later day);
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
      Exit 1 if a file under frontend/public/api/v1 still holds a suppressed
      NPI as the exact value of an NPI-valued CSV column or JSON key (the same
      test --apply uses). A digit-bounded occurrence anywhere else in those
      files, and any in docs/ or analysis/release-snapshots/, is a warning: a
      PAC ID, phone number or longer number containing the digits never trips
      it. Prints paths and counts only, never an NPI; --report-file writes the
      same as Markdown for an issue. With no list configured (forks) it warns
      and passes.

  python3 analysis/suppression.py --check-counts
      Optional, manual, informational. Lists payloads whose `suppressed_rows`
      is below the value committed at HEAD. A lower value after regeneration
      is normal (a suppressed NPI can leave the top-10,000 cohort through LEIE
      reinstatement, SAM churn or a tie at the boundary), so no workflow runs
      it; --check is what proves a removed row did not come back.

  python3 analysis/suppression.py --mark-applied [--before ISO_TIME]
      Mark pending rows (requested at or before ISO_TIME) as applied, through
      SUPPRESSION_APPLY_URL. The suppression-apply workflow runs this after
      its commit is pushed.

  python3 analysis/suppression.py --report
      Count-only summary: how many NPIs are suppressed. Nothing else.

Every removal also keeps the unfiltered file under analysis/data/unsuppressed/
(gitignored), keyed by a hash of the filtered public file. Scripts that read a
published file as an input to another computation call `input_path()` and get
the unfiltered copy while it still matches, so their derived counts do not
shift; a script that reads a filtered file without it can differ by a handful.
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

# A CSV whose removed rows are reconciled in a payload JSON: that JSON's
# `suppressed_rows` grows by the number of rows removed from the CSV. Patterns
# are tried in order; `{x}` is the CSV stem, `{st}` the state directory.
# Without an explicit entry, `findings/X.csv` reconciles in `findings/X.json`,
# then in `findings/X-without-detail.json`.
COUNT_SIDECARS = (
    ("findings/high-risk-cohort-export.csv", "findings/high-risk-cohort.json"),
    ("findings/endpoint-org-crosswalk.csv", "findings/endpoint-org-linkage.json"),
    ("findings/pecos-org-crosswalk-*.csv", "findings/pecos-affiliation-coverage.json"),
    ("findings/role-gap-composition-*.csv", "findings/role-gap-composition.json"),
    ("states/*-cohort-critical.csv", "states/{prefix}.json"),
    ("states/*/*.csv", "states/{st}.json"),
    ("states/pa-enrollment-endpoint.csv", "states/pa-connectivity.json"),
    ("states/pa-org-endpoint-resolution.csv", "states/pa-connectivity.json"),
)

TEXT_SUFFIXES = {".csv", ".json"}
SUPPRESSED_ROWS_RE = re.compile(r'"suppressed_rows"\s*:\s*(\d+)')

FAIL_CLOSED_ACTION = (
    "Set SUPPRESSED_NPIS in Vercel production and preview, or run "
    "frontend/prisma/sql/npi_suppressions.sql and record the rows with scripts/suppress-npi.ts."
)


class SuppressionError(ValueError):
    pass


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

def npi_check_digit_ok(npi: str) -> bool:
    """CMS NPI check digit: Luhn over "80840" + the ten digits."""
    total = 0
    for i, ch in enumerate(reversed("80840" + npi)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def parse_npis(raw: str | None) -> set[str]:
    """Parse a comma/whitespace separated list. Blanks are ignored; anything
    that is not a ten-digit NPI with a valid check digit raises (a mistyped
    entry would otherwise suppress nothing, silently)."""
    if not raw:
        return set()
    out: set[str] = set()
    for i, tok in enumerate(re.split(r"[\s,;]+", raw.strip())):
        if not tok:
            continue
        if not NPI_RE.match(tok) or not npi_check_digit_ok(tok):
            # Position only: the token itself may be a mistyped NPI.
            raise SuppressionError(
                f"suppression list entry #{i + 1} is not a valid 10-digit NPI "
                f"(check digit). Paste the value rather than retyping it."
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
    # already hides declined rows and rows queued for a later day.
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
                f"record {committed} suppressed row(s). Refusing to run. {FAIL_CLOSED_ACTION}"
            )
        if committed > 0 and not npis:
            raise SuppressionError(
                f"no suppression list is configured ({READER_URL_VAR} or {ENV_VAR}), "
                f"but committed payloads record {committed} suppressed row(s), and "
                f"running would republish them. {FAIL_CLOSED_ACTION}"
            )
    return npis


# --------------------------------------------------------------------------
# Row filtering
# --------------------------------------------------------------------------

def _is_npi_key(key: str) -> bool:
    """Any NPI-valued column or key: npi, _npi, org_npi, manager_npi, ...
    Count columns such as npis_on_url also match the name, but their values
    are small integers and can never equal a 10-digit NPI exactly."""
    return "npi" in key.lower()


def _digit_bounded_count(text: str, suppressed: set[str]) -> int:
    """Occurrences not embedded in a longer run of digits."""
    return sum(
        len(re.findall(rf"(?<!\d){re.escape(n)}(?!\d)", text)) for n in suppressed
    )


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
#   * a record in a list whose NPI-valued field matches: dropped from the
#     list;
#   * a bare NPI string/number in a list: dropped from the list;
#   * an object key equal to the NPI: the key is deleted;
#   * an object held directly under a key whose NPI-valued field matches:
#     the key is deleted;
#   * a scalar NPI-valued field on an object that stays: the field is
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
    if update_sidecar and path.suffix == ".csv" and rel:
        sidecar = sidecar_for(rel)
        if sidecar is not None:
            _bump_sidecar(sidecar, removed)
        else:
            print(f"  note: no payload JSON reconciles {rel}; {removed} row(s) removed")
    return removed


def sidecar_for(rel: str, public_root: Path | None = None) -> Path | None:
    """The payload JSON whose `suppressed_rows` reconciles a published CSV."""
    root = public_root or PUBLIC_ROOT
    stem = Path(rel).stem
    parts = rel.split("/")
    for pattern, target in COUNT_SIDECARS:
        if fnmatch.fnmatch(rel, pattern) and rel.count("/") == pattern.count("/"):
            cand = root / target.format(
                prefix=stem.split("-cohort-critical")[0],
                st=parts[1] if len(parts) > 2 else "",
            )
            if cand.exists():
                return cand
    if rel.startswith("findings/"):
        for name in (f"{stem}.json", f"{stem.removesuffix('-detail')}.json"):
            cand = root / "findings" / name
            # The -detail.json twin is itself per-NPI; prefer the headline.
            if cand.exists() and not (name.endswith("-detail.json") and stem.endswith("-detail")):
                return cand
    return None


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


def check(
    paths: Sequence[Path], suppressed: set[str]
) -> tuple[dict[str, int], dict[str, int]]:
    """(failures, warnings) per file, as counts.

    A failure is a CSV row or JSON record still holding a suppressed NPI as
    the exact value of an NPI-valued column or key: exactly what --apply
    removes. A warning is any other digit-bounded occurrence (free text, a
    URL, a file type --apply does not handle). A longer number that merely
    contains the digits is neither.
    """
    fails: dict[str, int] = {}
    warns: dict[str, int] = {}
    if not suppressed:
        return fails, warns
    for f in _walk(paths):
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if not _contains_any(text, suppressed):
            continue
        bounded = _digit_bounded_count(text, suppressed)
        if bounded == 0:
            continue
        keyed = 0
        if f.suffix == ".csv":
            keyed = scrub_csv_text(text, suppressed)[1]
        elif f.suffix == ".json":
            try:
                keyed = _scrub_json(json.loads(text), suppressed)[1]
            except ValueError:
                keyed = 0
        rel = str(_rel(f))
        if keyed:
            fails[rel] = keyed
        else:
            warns[rel] = bounded
    return fails, warns


def committed_counts_at_head(public_root: Path | None = None) -> dict[str, int]:
    """`suppressed_rows` per payload as committed at HEAD (git grep)."""
    import subprocess

    root = public_root or PUBLIC_ROOT
    rel_root = _rel(root).as_posix()
    out = subprocess.run(
        ["git", "grep", "-n", "-E", r'"suppressed_rows"[[:space:]]*:[[:space:]]*[0-9]+', "HEAD", "--", rel_root],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    counts: dict[str, int] = {}
    for line in out.stdout.splitlines():
        # HEAD:<path>:<line>:<text>
        try:
            _, path, _, rest = line.split(":", 3)
        except ValueError:
            continue
        m = SUPPRESSED_ROWS_RE.search(rest)
        if m:
            counts[path] = counts.get(path, 0) + int(m.group(1))
    return counts


def check_counts(public_root: Path | None = None) -> list[str]:
    """Payloads whose suppressed_rows fell below the committed value."""
    problems = []
    for path, committed in sorted(committed_counts_at_head(public_root).items()):
        f = REPO_ROOT / path
        if not f.exists():
            problems.append(f"{path}: committed suppressed_rows={committed}, file is gone")
            continue
        now = sum(int(m) for m in SUPPRESSED_ROWS_RE.findall(f.read_text(encoding="utf-8")))
        if now < committed:
            problems.append(f"{path}: suppressed_rows {now} < committed {committed}")
    return problems


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
        lines.append("Published files that still hold a removed NPI in an NPI field (the guard failed):")
        lines += [f"- `{f}`: {n} occurrence(s)" for f, n in sorted(public.items())]
    if other:
        lines.append("Files where a removed NPI appears outside an NPI field, or in docs/snapshots (handle by hand):")
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
    mode.add_argument("--check-counts", action="store_true")
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

    if args.check_counts:
        problems = check_counts()
        for p in problems:
            print(f"  {p}")
        if problems:
            print("Informational: a lower suppressed_rows is normal when a removed record "
                  "left that file. --check is what proves no removed row came back.")
        else:
            print("No payload's suppressed_rows fell below its committed value.")
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
    public, other = check(public_paths, suppressed)
    if not args.paths:
        f2, w2 = check([p for p in WARN_ROOTS if p.exists()], suppressed)
        for k, v in {**f2, **w2}.items():
            other[k] = other.get(k, 0) + v
    _write_report(args.report_file, public, other)
    for f, n in sorted(other.items()):
        print(f"::warning file={f}::a removed NPI appears outside an NPI field ({n} occurrence(s)); look by hand")
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
