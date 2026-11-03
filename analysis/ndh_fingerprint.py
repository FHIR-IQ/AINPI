"""Full-scan structural fingerprint of one CMS NDH release, and a diff of two.

A 10,000-record sample misses structure that lives in a small share of records
(payer-typed organizations were 997 of 2,058,500 at 2026-10-07). This script
scans every record of every resource in a release's parquet export and records,
per resource: the record count, every JSON key path (array indices collapsed to
`[]`) with the number of records carrying it, every `system` URL, the
Endpoint.connectionType and Organization.type codes, and the id-format mix.
Only counts, key paths, system URLs and codes are written; no other string value
from a record is ever emitted. `diff` lists what appeared, vanished, or moved by
more than a stated share, and each line is a candidate source-changes entry. A
diff blocks nothing.

Each record is expanded with DuckDB `json_tree` inside one streaming query, so
no row is pulled into Python. The SQL avoids `->` lambdas and `cast`, so it runs
on DuckDB 1.x (CI, Python 3.12) and 2.x.

Run: python3 analysis/ndh_fingerprint.py fingerprint --release 2026-10-07 [--out DIR]
     python3 analysis/ndh_fingerprint.py diff --prev 2026-08-20 --new 2026-10-07
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

import duckdb

ROOT = pathlib.Path(__file__).resolve().parent.parent
PARQUET_DIR = ROOT / "frontend" / "data" / "parquet-export"
OUT_DIR = ROOT / "frontend" / "public" / "api" / "v1" / "fingerprints"
RESOURCES = ("practitioner", "practitioner_role", "organization",
             "organization_affiliation", "location", "endpoint")
# resource -> (label, collapsed key path holding the code)
CODE_PATHS = {
    "endpoint": ("connectionType", "connectionType.code"),
    "organization": ("org_type", "type[].coding[].code"),
}
DATALESS = 0x40000000  # SF_DATALESS: an iCloud placeholder; reading it hangs


def _stat_flags(path) -> int:
    return getattr(os.stat(path), "st_flags", 0)


def _assert_materialized(path: pathlib.Path) -> None:
    if _stat_flags(path) & DATALESS:
        raise RuntimeError(f"{path} is an iCloud placeholder (dataless); download it before reading")


def _q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


CHUNK_ROWS = 250_000  # bounds memory: the json_tree expansion of a whole file does not fit


def _scan_chunk(con, p: str, resource: str, lo: int, hi: int):
    code_path = CODE_PATHS.get(resource, (None, None))[1]
    code_expr = _q(code_path) if code_path else "NULL"
    # One streaming pass: per record, distinct tagged strings (p: key path,
    # s: system URL, c: code), unnested and grouped. A record counts once per item.
    sql = f"""
    WITH expanded AS (
      SELECT l.items
      FROM (SELECT resource FROM read_parquet({p}, file_row_number = true)
            WHERE file_row_number >= {lo} AND file_row_number < {hi}) t,
      LATERAL (
        SELECT list_concat(
                 list_concat(
                   coalesce(list_transform(list_distinct(list(cp)), lambda x: 'p:' || x), []),
                   coalesce(list_transform(list_distinct(list(atom) FILTER (
                     WHERE key = 'system' AND type = 'VARCHAR')), lambda x: 's:' || x), [])),
                 coalesce(list_transform(list_distinct(list(atom) FILTER (
                     WHERE cp = {code_expr} AND type = 'VARCHAR')), lambda x: 'c:' || x), [])
               ) AS items
        FROM (
          SELECT key, json_extract_string(atom, '$') AS atom, type,
                 regexp_replace(substr(fullkey, 3), '\\[[0-9]+\\]', '[]', 'g') AS cp
          FROM json_tree(t.resource)
          WHERE fullkey <> '$'
        )
      ) l
    )
    SELECT substr(item, 1, 1) AS kind, substr(item, 3) AS v, count(*) AS n
    FROM (SELECT unnest(items) AS item FROM expanded)
    GROUP BY 1, 2
    """
    return con.execute(sql).fetchall()


def _scan_resource(con, path: pathlib.Path, resource: str) -> dict:
    p = _q(str(path))
    label = CODE_PATHS.get(resource, (None, None))[0]
    total_rows = con.execute(f"SELECT count(*) FROM read_parquet({p})").fetchone()[0]
    key_paths: dict = {}
    systems: dict = {}
    codes: dict = {}
    for lo in range(0, total_rows, CHUNK_ROWS):
        for kind, v, n in _scan_chunk(con, p, resource, lo, lo + CHUNK_ROWS):
            target = {"p": key_paths, "s": systems, "c": codes}[kind]
            target[v] = target.get(v, 0) + n
    out = {"records": 0, "key_paths": dict(sorted(key_paths.items())),
           "systems": dict(sorted(systems.items())), "codes": {}, "id_patterns": {}}
    if label:
        out["codes"][label] = dict(sorted(codes.items()))
    ids = con.execute(f"""
      SELECT count(*),
        count(*) FILTER (WHERE regexp_matches(rid, '^[A-Za-z]+-[0-9]{{10}}$')),
        count(*) FILTER (WHERE regexp_matches(rid,
          '-[0-9a-fA-F]{{8}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{12}}$'))
      FROM (SELECT json_extract_string(resource, '$.id') AS rid FROM read_parquet({p}))
    """).fetchone()
    total, npi, uuid = ids
    out["records"] = total
    out["id_patterns"] = {"npi": npi, "uuid": uuid, "other": total - npi - uuid}
    return out


def fingerprint(release_dir: pathlib.Path) -> dict:
    release_dir = pathlib.Path(release_dir)
    con = duckdb.connect()
    con.execute("SET preserve_insertion_order = false")
    result = {}
    for resource in RESOURCES:
        path = release_dir / f"{resource}.parquet"
        if not path.exists():
            continue
        _assert_materialized(path)
        result[resource] = _scan_resource(con, path, resource)
    return result


def _items(res: dict) -> dict:
    """item name -> count, over key paths, systems and codes of one resource."""
    items = {f"key_path {k}": v for k, v in res.get("key_paths", {}).items()}
    items.update({f"system {k}": v for k, v in res.get("systems", {}).items()})
    for label, d in res.get("codes", {}).items():
        items.update({f"code {label}={k}": v for k, v in d.items()})
    return items


def diff(prev: dict, new: dict, moved_share: float = 0.2) -> list[dict]:
    """Changes between two fingerprints. `moved` compares the share of records
    carrying an item, so a release that is simply smaller does not read as churn;
    it fires when that share changes by more than `moved_share` of its old value."""
    out = []
    for resource in sorted(set(prev) | set(new)):
        p, n = prev.get(resource, {}), new.get(resource, {})
        pi, ni = _items(p), _items(n)
        prec, nrec = p.get("records") or 0, n.get("records") or 0
        for item in sorted(set(pi) | set(ni)):
            a, b = pi.get(item, 0), ni.get(item, 0)
            if a and not b:
                kind = "vanished"
            elif b and not a:
                kind = "appeared"
            elif a and b and prec and nrec:
                ps, ns = a / prec, b / nrec
                if abs(ns - ps) / ps <= moved_share:
                    continue
                kind = "moved"
            else:
                continue
            out.append({"resource": resource, "kind": kind, "item": item, "prev": a, "new": b})
    return out


def to_markdown(changes: list[dict], prev_name: str, new_name: str) -> str:
    lines = [f"# NDH fingerprint diff: {prev_name} to {new_name}", ""]
    if not changes:
        return "\n".join(lines + ["No structural changes above the threshold.", ""])
    lines += ["| Resource | Change | Item | Previous | New |", "|---|---|---|---|---|"]
    for c in changes:
        lines.append(f"| {c['resource']} | {c['kind']} | `{c['item']}` | {c['prev']:,} | {c['new']:,} |")
    return "\n".join(lines + [""])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fingerprint")
    f.add_argument("--release", required=True)
    f.add_argument("--parquet-dir", type=pathlib.Path, default=PARQUET_DIR)
    f.add_argument("--out", type=pathlib.Path, default=OUT_DIR)
    d = sub.add_parser("diff")
    d.add_argument("--prev", required=True)
    d.add_argument("--new", required=True)
    d.add_argument("--dir", type=pathlib.Path, default=OUT_DIR)
    d.add_argument("--moved-share", type=float, default=0.2)
    a = ap.parse_args(argv)
    if a.cmd == "fingerprint":
        fp = fingerprint(a.parquet_dir / a.release)
        a.out.mkdir(parents=True, exist_ok=True)
        dest = a.out / f"{a.release}.json"
        dest.write_text(json.dumps({"release": a.release, "resources": fp}, indent=1, sort_keys=True) + "\n")
        print(f"wrote {dest}", file=sys.stderr)
        return 0
    load = lambda r: json.loads((a.dir / f"{r}.json").read_text())["resources"]  # noqa: E731
    sys.stdout.write(to_markdown(diff(load(a.prev), load(a.new), a.moved_share), a.prev, a.new))
    return 0


if __name__ == "__main__":
    sys.exit(main())
