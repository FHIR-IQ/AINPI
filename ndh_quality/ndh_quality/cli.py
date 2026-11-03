"""ndh-quality command line. CC0 1.0."""
from __future__ import annotations

import argparse
import json
import sys

from ndh_quality.registry import run_release


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="ndh-quality")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run every rule over a release directory")
    r.add_argument("--release-dir", required=True)
    r.add_argument("--previous-dir", default=None)
    r.add_argument("--json", action="store_true", help="print rows as a JSON list")
    args = p.parse_args(argv)

    rows = run_release(args.release_dir, args.previous_dir)
    if args.json:
        print(json.dumps(rows, indent=2, default=str))
    else:
        for row in rows:
            v = "n/a" if row["value"] is None else f"{row['value']:.6f}"
            print(f"{row['status']:<15} {row['severity']:<9} {row['rule_id']:<26} "
                  f"value={v} {row['detail'] or ''}")
    return 1 if any(x["severity"] == "pipeline" and x["status"] != "pass" for x in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
