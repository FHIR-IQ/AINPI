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


def _table_columns(fq: str) -> list[str] | None:
    r = sql(f"SELECT * FROM {fq} LIMIT 0")
    if r.get("status", {}).get("state") != "SUCCEEDED":
        return None
    schema = r.get("manifest", {}).get("schema", {}).get("columns") or []
    return [c["name"] for c in schema]


def _parquet_columns(path: pathlib.Path) -> list[str]:
    import pyarrow.parquet as pq  # local: only the load path needs pyarrow
    return list(pq.ParquetFile(path).schema_arrow.names)


def load_one_release(release: str) -> bool:
    """Add or replace a single release without disturbing the others.

    DELETE the matching partition then INSERT, which is idempotent: re-running
    cannot double-count, and the other releases stay readable throughout.

    The schema is checked BEFORE the DELETE. That ordering is load-bearing.
    An earlier version deleted first and then discovered the INSERT could not
    run, which is harmless the first time (nothing to delete) and destroys the
    partition on any re-run. The parquet schema does drift between releases:
    the flattened columns _address_line, _phone, _telecom and the location
    coordinates were added to the extractors after the April and May exports
    were written, so those files carry fewer columns than the tables now have.

    Returns True only if every table with parquet on disk loaded.
    """
    ok = True
    for table in TABLES:
        src = PARQUET_DIR / release / f"{table}.parquet"
        if not src.exists():
            print(f"  {release}/{table}: no parquet, skipped")
            continue
        fq = f"{CATALOG}.{SCHEMA}.{table}"

        target = _table_columns(fq)
        if target is None:
            print(f"  {fq}: could not read target schema, skipped")
            ok = False
            continue
        source = _parquet_columns(src) + ["release_date"]
        if source != target:
            missing = [c for c in target if c not in source]
            extra = [c for c in source if c not in target]
            print(f"  {fq}: SCHEMA MISMATCH, nothing deleted or written")
            if extra:
                print(f"      parquet has, table lacks: {extra}")
            if missing:
                print(f"      table has, parquet lacks: {missing}")
            ok = False
            continue

        r = sql(f"DELETE FROM {fq} WHERE release_date = '{release}'")
        if r.get("status", {}).get("state") != "SUCCEEDED":
            print(f"  {fq}: DELETE failed {json.dumps(r.get('status'))[:200]}")
            ok = False
            continue
        print(f"  {fq} += {release}", flush=True)
        r = sql(
            f"INSERT INTO {fq} SELECT *, '{release}' AS release_date "
            f"FROM parquet.`{volume_path(release, table)}`"
        )
        if r.get("status", {}).get("state") != "SUCCEEDED":
            print(f"    FAILED {json.dumps(r.get('status'))[:300]}")
            ok = False
    print(f"{release}: {'loaded' if ok else 'INCOMPLETE'}")
    return ok


def do_load(only: list[str] | None = None) -> None:
    """Rebuild the tables from parquet.

    `only` restricts and orders the releases. Without it every release found on
    disk is included, which is wrong once a release has been retired from the
    archive but its derived parquet is still sitting in the export directory.
    """
    releases = [r for r in available_releases() if not only or r in only]
    if only:
        releases = [r for r in only if r in releases]
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
    shared_now = shared_object_names()
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
        # The share object carries its OWN copy of the comment, snapshotted when
        # the table was added, and COMMENT ON TABLE does not propagate to it.
        # A recipient reads the share's copy, so an ADD-only loop leaves every
        # consumer reading whatever the text said the day the table was first
        # shared. That is how a correction to the Location join guidance sat in
        # this file for a week while the published share still told consumers to
        # join on name plus address.
        #
        # UPDATE refreshes it, but it re-validates the whole object, so
        # history_data_sharing_status has to be restated or the call fails with
        # DS_UNSUPPORTED_DELTA_TABLE_FEATURES on deletion vectors.
        action = "UPDATE" if fq in shared_now else "ADD"
        data_object = {
            "name": fq,
            "data_object_type": "TABLE",
            "comment": TABLE_COMMENTS.get(table, ""),
        }
        if action == "UPDATE":
            data_object["shared_as"] = f"{SCHEMA}.{table}"
            data_object["history_data_sharing_status"] = "ENABLED"
        payload = json.dumps({"updates": [{"action": action, "data_object": data_object}]})
        r = subprocess.run(
            ["databricks", "shares", "update", SHARE, "--json", payload],
            capture_output=True, text=True,
        )
        ok = r.returncode == 0
        print(f"  {fq}: {action.lower()}d" if ok else f"  {fq}: {action} FAILED")
        if not ok:
            print(f"    {r.stderr.strip()[:240]}")
    verify_share_comments()
    print("share updated")


def shared_object_names() -> set[str]:
    r = subprocess.run(["databricks", "shares", "get", SHARE, "--include-shared-data",
                        "-o", "json"], capture_output=True, text=True)
    if r.returncode != 0:
        return set()
    try:
        return {o["name"] for o in json.loads(r.stdout or "{}").get("objects", [])}
    except (json.JSONDecodeError, KeyError):
        return set()


def verify_share_comments() -> bool:
    """Read the share back and confirm each object carries the current comment.

    Writing the comment and checking the table is not enough: the share keeps a
    separate copy and that is the one a recipient sees.
    """
    r = subprocess.run(["databricks", "shares", "get", SHARE, "--include-shared-data",
                        "-o", "json"], capture_output=True, text=True)
    if r.returncode != 0:
        print("  VERIFY FAILED: cannot read the share back")
        return False
    live = {o["name"]: o.get("comment", "")
            for o in json.loads(r.stdout or "{}").get("objects", [])}
    ok = True
    for table in TABLES:
        fq = f"{CATALOG}.{SCHEMA}.{table}"
        want = TABLE_COMMENTS.get(table, "")
        if live.get(fq) != want:
            print(f"  STALE share comment on {fq}: recipients are reading old text")
            ok = False
    if ok:
        print("  share comments match TABLE_COMMENTS on all "
              f"{len(TABLES)} objects")
    return ok


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
    ap.add_argument("--release", help="limit --upload/--load to one release, or a comma-separated list for --load")
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
        wanted = [x.strip() for x in a.release.split(",")] if a.release else None
        if wanted and len(wanted) > 1:
            do_load(wanted)
        elif a.release:
            # Exit non-zero on a partial load. The previous version printed
            # FAILED for four of six tables and still exited 0, which is
            # indistinguishable from success to anything reading the code.
            if not load_one_release(a.release):
                sys.exit(1)
        else:
            do_load()
    if a.share:
        do_share()
    if a.status:
        do_status()


if __name__ == "__main__":
    main()
