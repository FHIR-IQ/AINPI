"""Publish the NDH release archive to Databricks as Delta tables and share it.

WHAT THIS IS FOR

CMS serves only the latest NDH bulk export. Every prior release is gone the day
a new one lands, and this project has three of them. That archive is the single
most useful thing here that the source does not offer, it costs nothing to give
away, and it is the free tier.

The tables are shared over OPEN Delta Sharing, not Databricks-to-Databricks.
That distinction decides who can actually use it: Databricks Free Edition
cannot create or manage sharing recipients, so a free-edition user cannot
receive a Databricks-to-Databricks share at all. Open sharing needs only a
credential file and the `delta-sharing` Python package, with no Databricks
account on the consumer side. Verified end to end before this script existed.

COST

Two things cost money and neither is the storage.

  Compute. Converting parquet to Delta runs on a SQL warehouse. The serverless
  Small warehouse auto-stops after 10 minutes; this script does not create
  compute and does not change that setting.

  Egress. A recipient pulling the archive is S3 egress, roughly $0.09/GB
  against a 8.7 GB archive. There is no rate limiter in front of Delta Sharing
  the way there is in front of /api/npd/*. Partitioning by release_date is
  deliberate: a consumer who wants one release should be able to read one
  release rather than the whole thing.

Run:
    python analysis/databricks_publish.py --upload      # parquet -> volume
    python analysis/databricks_publish.py --load        # volume -> Delta
    python analysis/databricks_publish.py --share       # add tables to share
    python analysis/databricks_publish.py --status

Requires the `databricks` CLI authenticated (`databricks auth login`).
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from release import KNOWN_RELEASES  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
PARQUET_DIR = ROOT / "frontend" / "data" / "parquet-export"

CATALOG = "workspace"
SCHEMA = "ainpi"
VOLUME = "staging"
SHARE = "ainpi-ndh-archive"
WAREHOUSE_ID = "b5bb83df437b78af"

# The six NDH resource types. HealthcareService and InsurancePlan arrived in
# the 2026-08-20 release and are not exported to parquet yet.
TABLES = [
    "practitioner",
    "practitioner_role",
    "organization",
    "organization_affiliation",
    "location",
    "endpoint",
]

# Cross-release ID stability, measured across 2026-04-09 and 2026-05-08 rather
# than assumed. This is the first thing a consumer of a multi-release archive
# gets wrong, so it belongs on the tables themselves:
#
#   practitioner / organization   ids are `Type-<NPI>`, stable across releases.
#                                 Practitioner overlaps 100% Apr->May.
#   endpoint / location           ids are `Type-<random UUID>`, REGENERATED on
#                                 every export. Apr->May overlap is exactly 0.
#
# So a cross-release diff joining endpoint or location on `_id` reports 100%
# churn every time, which is an artifact of id minting and not a finding.
ID_NOTE_STABLE = (
    " Resource ids are Type-<NPI> and are stable across releases, so joining "
    "on _id across release_date is valid."
)
# Two different warnings, because the replacement key works for one of these
# resources and only partly for the other. Measured, not assumed: an earlier
# draft of this comment told consumers to join location on "name plus address"
# without anyone having run that join. It recovers 9.7% of May rows raw.
_UNSTABLE_ID = (
    " WARNING: resource ids are Type-<random UUID> and are REGENERATED on every "
    "release. Zero ids survive from one release to the next, so joining on _id "
    "across release_date yields 100% false churn."
)
ID_NOTE_ENDPOINT = _UNSTABLE_ID + (
    " Join on _address instead: it matches 100.0% of distinct addresses between "
    "2026-04-09 and 2026-05-08. Note the April file repeats each address 3.9 "
    "times on average and the May file 1.05 times, so the 73% fall in row count "
    "between them is de-duplication, not removal: 1,299,999 of 1,300,241 "
    "distinct April addresses are still present in May."
)
ID_NOTE_LOCATION = _UNSTABLE_ID + (
    " There is no reliable cross-release key for Location in these columns. "
    "_name + _city + _state + _postal_code matches only 9.7% of May rows as "
    "stored, rising to 73.5% after upper-casing and stripping non-alphanumerics, "
    "because CMS re-cased and re-punctuated these fields between releases. Treat "
    "any Location cross-release join as lossy and state the match rate."
)

TABLE_COMMENTS = {
    "practitioner": "NDH Practitioner resources. Full FHIR resource JSON plus flattened _* columns." + ID_NOTE_STABLE,
    "practitioner_role": "NDH PractitionerRole. The practitioner-to-organization link, and the field whose absence is the directory's binding constraint.",
    "organization": "NDH Organization. Contains both provider organizations and `ein` tax records; check type[0].text before counting." + ID_NOTE_STABLE,
    "location": "NDH Location. Carries the only geography in the directory, as position.latitude/longitude." + ID_NOTE_LOCATION,
    "endpoint": "NDH Endpoint. Mostly Direct Trust messaging addresses; filter connectionType.code = 'hl7-fhir-rest' for callable APIs." + ID_NOTE_ENDPOINT,
    "organization_affiliation": "NDH OrganizationAffiliation. Carries no relationship code, so an edge does not say what it means.",
}


def sh(args: list[str], check: bool = True) -> str:
    r = subprocess.run(args, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit(f"{' '.join(args[:3])}… failed:\n{r.stderr.strip()[:400]}")
    return r.stdout


# Terminal states per the SQL Statement Execution API. Anything else means the
# statement is still going and the result is not yet knowable.
TERMINAL = {"SUCCEEDED", "FAILED", "CANCELED", "CLOSED"}


def sql(statement: str, poll_seconds: int = 1800) -> dict:
    """Run a statement and block until it actually finishes.

    The API caps `wait_timeout` at 50s and then hands back a statement_id with
    state PENDING or RUNNING. Converting a 1.1 GB parquet file to Delta takes
    longer than that, so reading the first response as the outcome reports a
    healthy load as a failure. Poll instead.
    """
    payload = json.dumps(
        {"warehouse_id": WAREHOUSE_ID, "statement": statement, "wait_timeout": "50s"}
    )
    out = sh(["databricks", "api", "post", "/api/2.0/sql/statements", "--json", payload])
    r = json.loads(out)

    waited = 0
    while r.get("status", {}).get("state") not in TERMINAL:
        sid = r.get("statement_id")
        if not sid:
            return r
        if waited >= poll_seconds:
            return {"status": {"state": "TIMEOUT_LOCAL", "statement_id": sid}}
        time.sleep(5)
        waited += 5
        r = json.loads(sh(["databricks", "api", "get", f"/api/2.0/sql/statements/{sid}"]))
    return r


def volume_path(release: str, table: str) -> str:
    return f"/Volumes/{CATALOG}/{SCHEMA}/{VOLUME}/release_date={release}/{table}.parquet"


def available_releases() -> list[str]:
    if not PARQUET_DIR.exists():
        return []
    return [
        d.name for d in sorted(PARQUET_DIR.iterdir())
        if d.is_dir() and d.name in KNOWN_RELEASES
    ]


def _remote_size(path: str) -> int | None:
    """Size of a file already in the volume, or None if it is not there."""
    out = subprocess.run(
        ["databricks", "fs", "ls", path, "--output", "json"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return None
    try:
        entries = json.loads(out.stdout or "[]")
    except json.JSONDecodeError:
        return None
    for e in entries if isinstance(entries, list) else []:
        n = e.get("file_size")
        if isinstance(n, int):
            return n
    return None


def do_upload(only_release: str | None = None) -> None:
    """Upload parquet to the staging volume, skipping what is already there.

    Byte-for-byte size match is the skip test. Re-uploading a release that has
    not changed costs nothing but time, and this loop used to re-push every
    release on disk every run: adding the third release meant re-sending the
    first two, 8.7 GB of them.
    """
    for release in available_releases():
        if only_release and release != only_release:
            continue
        dest_dir = f"dbfs:/Volumes/{CATALOG}/{SCHEMA}/{VOLUME}/release_date={release}"
        sh(["databricks", "fs", "mkdir", dest_dir], check=False)
        for table in TABLES:
            src = PARQUET_DIR / release / f"{table}.parquet"
            if not src.exists():
                print(f"  {release}/{table}: no parquet, skipped")
                continue
            dest = f"{dest_dir}/{table}.parquet"
            local = src.stat().st_size
            if _remote_size(dest) == local:
                print(f"  {release}/{table}: already uploaded ({local/1e6:,.0f} MB)")
                continue
            print(f"  {release}/{table}: {local/1e6:,.0f} MB …", flush=True)
            sh(["databricks", "fs", "cp", "--overwrite", str(src), dest])
    print("upload complete")


def do_load() -> None:
    releases = available_releases()
    for table in TABLES:
        present = [r for r in releases if (PARQUET_DIR / r / f"{table}.parquet").exists()]
        if not present:
            continue
        fq = f"{CATALOG}.{SCHEMA}.{table}"

        # One table per resource type, partitioned by release, rather than a
        # table per release. A consumer comparing two releases should write a
        # WHERE clause, not a UNION across differently-named tables.
        first, rest = present[0], present[1:]
        comment = TABLE_COMMENTS.get(table, "").replace("'", "\\'")
        print(f"  {fq} <- {first}", flush=True)
        r = sql(
            f"CREATE OR REPLACE TABLE {fq} USING DELTA PARTITIONED BY (release_date) "
            f"COMMENT '{comment} Partitioned by NDH release; CMS serves only the latest.' "
            f"AS SELECT *, '{first}' AS release_date "
            f"FROM parquet.`{volume_path(first, table)}`"
        )
        state = r.get("status", {}).get("state")
        if state != "SUCCEEDED":
            print(f"    FAILED: {json.dumps(r.get('status'))[:300]}")
            continue

        for rel in rest:
            print(f"  {fq} += {rel}", flush=True)
            r = sql(
                f"INSERT INTO {fq} "
                f"SELECT *, '{rel}' AS release_date "
                f"FROM parquet.`{volume_path(rel, table)}`"
            )
            if r.get("status", {}).get("state") != "SUCCEEDED":
                print(f"    FAILED: {json.dumps(r.get('status'))[:300]}")
    print("load complete")


def do_share() -> None:
    for table in TABLES:
        fq = f"{CATALOG}.{SCHEMA}.{table}"
        # Re-apply the comment every run. CREATE TABLE set it once; editing the
        # dict above would otherwise never reach the published table, and the
        # comment is the only place a Delta Sharing consumer sees the id-
        # stability warning.
        c = TABLE_COMMENTS.get(table, "").replace("'", "\\'")
        # Check the state. An unchecked COMMENT is a silent no-op if the text
        # ever breaks the quoting (several comments contain apostrophes), and
        # the comment is the only place a Delta Sharing consumer sees the
        # id-stability warning.
        rc = sql(f"COMMENT ON TABLE {fq} IS '{c}'")
        if rc.get("status", {}).get("state") != "SUCCEEDED":
            print(f"  {fq}: COMMENT FAILED {json.dumps(rc.get('status'))[:200]}")
        payload = json.dumps({
            "updates": [{
                "action": "ADD",
                "data_object": {
                    "name": fq,
                    "data_object_type": "TABLE",
                    "comment": TABLE_COMMENTS.get(table, ""),
                },
            }]
        })
        r = subprocess.run(
            ["databricks", "shares", "update", SHARE, "--json", payload],
            capture_output=True, text=True,
        )
        ok = r.returncode == 0
        # Re-adding a table already in the share is not an error worth stopping
        # for; anything else is.
        already = "already exists" in (r.stderr or "").lower()
        print(f"  {fq}: {'added' if ok else ('already shared' if already else 'FAILED')}")
        if not ok and not already:
            print(f"    {r.stderr.strip()[:240]}")
    print("share updated")


def do_status() -> None:
    print(f"parquet releases on disk: {', '.join(available_releases()) or 'none'}")
    out = sh(["databricks", "tables", "list", CATALOG, SCHEMA], check=False)
    print("\ntables:")
    print(out.strip() or "  none")
    r = sql(
        f"SELECT release_date, COUNT(*) AS rows FROM {CATALOG}.{SCHEMA}.practitioner "
        f"GROUP BY release_date ORDER BY release_date"
    )
    if r.get("status", {}).get("state") == "SUCCEEDED":
        print("\npractitioner rows by release:")
        for row in r.get("result", {}).get("data_array", []) or []:
            print(f"  {row[0]}  {int(row[1]):,}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--upload", action="store_true")
    ap.add_argument("--release", help="limit --upload/--load to one release")
    ap.add_argument("--load", action="store_true")
    ap.add_argument("--share", action="store_true")
    ap.add_argument("--status", action="store_true")
    a = ap.parse_args()
    if not any(vars(a).values()):
        ap.print_help()
        return
    if a.upload:
        do_upload(a.release)
    if a.load:
        do_load()
    if a.share:
        do_share()
    if a.status:
        do_status()


if __name__ == "__main__":
    main()
