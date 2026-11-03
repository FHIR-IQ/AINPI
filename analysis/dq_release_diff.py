"""Markdown report comparing two NDH releases for the quality review.

Reads three published files and prints one deterministic report:
  - frontend/public/api/v1/dq-results.json (rule results, Task 6)
  - frontend/public/api/v1/fingerprints/<release>.json (structural fingerprints,
    Task 8) for both releases
  - frontend/public/api/v1/measures.json (the `ordinary_move` threshold)

Sections: fingerprint changes, rules whose status changed, values that moved
further than the measure's `ordinary_move` (5 points where no measure is paired),
`control_failed` rows, and rows where the rule disagrees with its paired measure.
It reads no parquet and prints no matched values. Nothing here blocks a release;
each line is a prompt for the owner to explain or ignore.

Run: python3 analysis/dq_release_diff.py 2026-08-20 2026-10-07
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = ROOT / "frontend" / "public" / "api" / "v1"
DEFAULT_MOVE = 0.05  # points, as a share, where no measure sets ordinary_move


def _live(dq: dict, release: str) -> dict:
    """Current (non-superseded) rows for one release, keyed by rule_id."""
    out = {}
    for r in dq.get("rows", []):
        if r.get("release_date") == release and not r.get("superseded_by"):
            out[r["rule_id"]] = r
    return out


def _threshold(measure_slug, measures: dict) -> tuple[str, float]:
    for m in (measures or {}).get("measures", []):
        if m.get("slug") == measure_slug and measure_slug:
            om = m.get("ordinary_move") or {}
            if om.get("max") is not None:
                return om.get("kind", "absolute"), float(om["max"])
    return "absolute", DEFAULT_MOVE


def _moved(prev, new, kind: str, limit: float) -> bool:
    if not isinstance(prev, (int, float)) or not isinstance(new, (int, float)):
        return False
    delta = abs(new - prev)
    if kind == "relative":
        return prev != 0 and delta / abs(prev) > limit or (prev == 0 and delta > 0)
    return delta > limit


def _section(title: str, lines: list[str]) -> list[str]:
    return [f"## {title}", ""] + (lines if lines else ["None."]) + [""]


def report(prev: str, new: str, dq: dict, fp_diff, measures: dict) -> str:
    """Pure. `fp_diff` is ndh_fingerprint.diff() output, or None when a
    fingerprint file was missing."""
    p, n = _live(dq, prev), _live(dq, new)
    out = [f"# NDH release diff: {prev} to {new}", ""]

    if fp_diff is None:
        fp_lines = ["Fingerprint diff not available: a fingerprint file for one of "
                    "the two releases is missing. Run `ndh_fingerprint.py fingerprint` first."]
    else:
        fp_lines = [f"- {d['resource']} {d['kind']}: `{d['item']}` ({d['prev']} -> {d['new']})"
                    for d in fp_diff]
    out += _section("Fingerprint changes", fp_lines)

    status = [f"- `{rid}`: {p[rid]['status']} -> {n[rid]['status']}"
              for rid in sorted(set(p) & set(n)) if p[rid]["status"] != n[rid]["status"]]
    out += _section("Status changes", status)

    moves = []
    for rid in sorted(set(p) & set(n)):
        kind, limit = _threshold(n[rid].get("measure"), measures)
        a, b = p[rid].get("value"), n[rid].get("value")
        if _moved(a, b, kind, limit):
            moves.append(f"- `{rid}`: {a:.4f} -> {b:.4f} (limit {limit:g} {kind})")
    out += _section("Value moves beyond the ordinary move", moves)

    cf = [f"- `{rid}`: control_failed at {new}" for rid, r in sorted(n.items())
          if r.get("status") == "control_failed"]
    out += _section("Control failed", cf)

    ag = [f"- `{rid}`: rule disagrees with measure `{r.get('measure')}`"
          for rid, r in sorted(n.items()) if r.get("measure_agrees") == "false"]
    out += _section("Rule disagrees with its paired measure", ag)
    return "\n".join(out).rstrip() + "\n"


def _load(path: pathlib.Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("prev")
    ap.add_argument("new")
    args = ap.parse_args(argv)

    dq = _load(API / "dq-results.json")
    if dq is None:
        print("dq_release_diff: dq-results.json is missing or unreadable", file=sys.stderr)
        return 1
    measures = _load(API / "measures.json") or {}
    fp_prev = _load(API / "fingerprints" / f"{args.prev}.json")
    fp_new = _load(API / "fingerprints" / f"{args.new}.json")
    fp_diff = None
    if fp_prev is not None and fp_new is not None:
        import ndh_fingerprint  # imports duckdb; only needed when both files exist
        fp_diff = ndh_fingerprint.diff(fp_prev, fp_new)
    sys.stdout.write(report(args.prev, args.new, dq, fp_diff, measures))
    return 0


if __name__ == "__main__":
    sys.exit(main())
