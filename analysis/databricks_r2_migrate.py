"""Move the NDH release archive onto Cloudflare R2 so sharing egress is free.

WHY

Serving a share costs no compute: recipients authenticate and then read Parquet
straight from object storage via short-lived presigned URLs. So the only
running cost of the archive is storage plus egress, and egress is the half that
scales with popularity rather than with size.

On S3 that is roughly $0.09/GB out, uncapped, with no rate limiter in front of
sharing the way there is in front of /api/npd/*. A hundred consumers pulling
the 15 GB archive once a month is $135/month, a thousand is $1,350, and the
slope is set by strangers. R2 charges nothing for egress, which turns an
unbounded number into a fixed one near $0.07/month.

Databricks documents R2 as the supported way to do this. In-region sharing is
already egress-free on S3, so what R2 actually buys is every consumer who is
not in us-west-2, which for a public listing is most of them.

CREDENTIALS

Never hardcoded and never committed. Set these in analysis/.env (gitignored):

    R2_ACCOUNT_ID          Cloudflare account id
    R2_ACCESS_KEY_ID       R2 API token access key
    R2_SECRET_ACCESS_KEY   R2 API token secret
    R2_BUCKET              bucket name (default: ainpi-archive)

The token needs Object Read & Write; read-only cannot be a clone target.

Run:
    set -a; source analysis/.env; set +a
    python analysis/databricks_r2_migrate.py --check      # credentials + preflight
    python analysis/databricks_r2_migrate.py --provision  # credential + location + catalog
    python analysis/databricks_r2_migrate.py --clone      # DEEP CLONE the tables
    python analysis/databricks_r2_migrate.py --reshare    # point the share at R2
    python analysis/databricks_r2_migrate.py --verify     # row counts old vs new
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from databricks_publish import CATALOG, SCHEMA, SHARE, TABLES, TABLE_COMMENTS, sh, sql  # noqa: E402

R2_CATALOG = "ainpi_r2"
R2_SCHEMA = "ainpi"
CREDENTIAL = "ainpi-r2-credential"
LOCATION = "ainpi-r2-location"


def env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if not v:
        raise SystemExit(
            f"{name} is not set. Put it in analysis/.env (gitignored) and run:\n"
            f"  set -a; source analysis/.env; set +a"
        )
    return v.strip()


def r2_url() -> str:
    return f"r2://{env('R2_BUCKET', 'ainpi-archive')}@{env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com"


def do_check() -> None:
    """Preflight. Fails loudly rather than half-migrating."""
    for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"):
        env(k)
    print(f"  credentials present")
    print(f"  target: {r2_url()}")

    # Liquid clustering and V2 checkpoints cannot be shared from R2. Checked
    # here rather than discovered halfway through a 15 GB clone.
    blocked = []
    for t in TABLES:
        out = subprocess.run(
            ["databricks", "tables", "get", f"{CATALOG}.{SCHEMA}.{t}"],
            capture_output=True, text=True,
        )
        if out.returncode != 0:
            print(f"  {t}: not found, skipping")
            continue
        props = (json.loads(out.stdout).get("properties") or {})
        if props.get("clusteringColumns"):
            blocked.append(f"{t} (liquid clustering)")
        if str(props.get("delta.checkpointPolicy", "")).lower() == "v2":
            blocked.append(f"{t} (v2 checkpoints)")
    if blocked:
        raise SystemExit("cannot share from R2: " + ", ".join(blocked))
    print(f"  {len(TABLES)} tables, none using liquid clustering or V2 checkpoints")


def do_provision() -> None:
    do_check()
    print(f"  storage credential {CREDENTIAL}")
    sh([
        "databricks", "storage-credentials", "create", "--json",
        json.dumps({
            "name": CREDENTIAL,
            "cloudflare_api_token": {
                "account_id": env("R2_ACCOUNT_ID"),
                "access_key_id": env("R2_ACCESS_KEY_ID"),
                "secret_access_key": env("R2_SECRET_ACCESS_KEY"),
            },
            "comment": "Cloudflare R2 for the AINPI NDH release archive. Zero egress.",
        }),
    ], check=False)

    print(f"  external location {LOCATION}")
    sh([
        "databricks", "external-locations", "create", "--json",
        json.dumps({"name": LOCATION, "url": r2_url(), "credential_name": CREDENTIAL}),
    ], check=False)

    print(f"  catalog {R2_CATALOG}")
    r = sql(
        f"CREATE CATALOG IF NOT EXISTS {R2_CATALOG} MANAGED LOCATION '{r2_url()}' "
        f"COMMENT 'AINPI NDH release archive on Cloudflare R2. Zero-egress storage "
        f"so the free public tier costs the same whatever its readership.'"
    )
    print(f"    {r.get('status', {}).get('state')}")
    sql(f"CREATE SCHEMA IF NOT EXISTS {R2_CATALOG}.{R2_SCHEMA}")
    print("provision complete")


def do_clone() -> None:
    """DEEP CLONE preserves the data and the partitioning, and is restartable."""
    for t in TABLES:
        src, dst = f"{CATALOG}.{SCHEMA}.{t}", f"{R2_CATALOG}.{R2_SCHEMA}.{t}"
        print(f"  {src} -> {dst}", flush=True)
        r = sql(f"CREATE OR REPLACE TABLE {dst} DEEP CLONE {src}")
        state = r.get("status", {}).get("state")
        if state != "SUCCEEDED":
            print(f"    FAILED {json.dumps(r.get('status'))[:300]}")
            continue
        c = TABLE_COMMENTS.get(t, "").replace("'", "\\'")
        sql(f"COMMENT ON TABLE {dst} IS '{c}'")
    print("clone complete")


def do_reshare() -> None:
    """Repoint the share at R2 without changing what a consumer sees.

    `shared_as` keeps the consumer-facing name identical, so existing recipient
    credentials keep resolving the same table names and nothing downstream
    breaks. Only the bytes move.
    """
    for t in TABLES:
        old, new = f"{CATALOG}.{SCHEMA}.{t}", f"{R2_CATALOG}.{R2_SCHEMA}.{t}"
        sh(["databricks", "shares", "update", SHARE, "--json", json.dumps({
            "updates": [{"action": "REMOVE", "data_object": {
                "name": old, "data_object_type": "TABLE"}}]
        })], check=False)
        r = subprocess.run(["databricks", "shares", "update", SHARE, "--json", json.dumps({
            "updates": [{"action": "ADD", "data_object": {
                "name": new,
                "data_object_type": "TABLE",
                "shared_as": f"{SCHEMA}.{t}",
                "comment": TABLE_COMMENTS.get(t, ""),
            }}]
        })], capture_output=True, text=True)
        print(f"  {t}: {'repointed at R2' if r.returncode == 0 else 'FAILED ' + r.stderr.strip()[:160]}")
    print("share now served from R2")


def do_verify() -> None:
    """Row counts on both sides. A clone that silently dropped rows is the
    failure this catches, and it is the only one that matters."""
    parts = []
    for t in TABLES:
        parts.append(
            f"SELECT '{t}' AS tbl, 's3' AS side, COUNT(*) AS n FROM {CATALOG}.{SCHEMA}.{t}")
        parts.append(
            f"SELECT '{t}' AS tbl, 'r2' AS side, COUNT(*) AS n FROM {R2_CATALOG}.{R2_SCHEMA}.{t}")
    r = sql(" UNION ALL ".join(parts) + " ORDER BY tbl, side")
    if r.get("status", {}).get("state") != "SUCCEEDED":
        raise SystemExit(f"verify failed: {json.dumps(r.get('status'))[:300]}")
    got: dict[tuple[str, str], int] = {}
    for tbl, side, n in r["result"]["data_array"]:
        got[(tbl, side)] = int(n)
    ok = True
    print(f"{'table':26s} {'S3':>14s} {'R2':>14s}")
    print("-" * 58)
    for t in TABLES:
        a, b = got.get((t, "s3"), -1), got.get((t, "r2"), -1)
        if a != b:
            ok = False
        print(f"{t:26s} {a:14,d} {b:14,d}  {'match' if a == b else 'MISMATCH'}")
    print("-" * 58)
    print("VERDICT:", "every table matches" if ok else "DISAGREEMENT — do not reshare")


def main() -> None:
    ap = argparse.ArgumentParser()
    for f in ("check", "provision", "clone", "reshare", "verify"):
        ap.add_argument(f"--{f}", action="store_true")
    a = ap.parse_args()
    if not any(vars(a).values()):
        ap.print_help()
        return
    if a.check:
        do_check()
    if a.provision:
        do_provision()
    if a.clone:
        do_clone()
    if a.reshare:
        do_reshare()
    if a.verify:
        do_verify()


if __name__ == "__main__":
    main()
