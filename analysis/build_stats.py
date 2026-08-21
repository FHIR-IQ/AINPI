"""Regenerate frontend/public/api/v1/stats.json from the current state of the repo.

stats.json is the site's top-line public contract. It feeds `/report`, the
homepage counters and the discovery manifest that AI agents read. Nothing
generated it: the weekly workflow only stamped `commit_sha`, so every other
field held whatever was hand-typed when the file was created.

By 2026-08-21 it was claiming release 2026-05-08, 21,693,735 resources and 12
published findings, against a warehouse holding 2026-08-20, 32.5M resources
and 24 published findings. Each number was wrong in a different direction and
none of them could be caught by a test, because there was nothing to compare
against.

Every field here is derived:

  release_date          analysis/release.py
  resources_processed   __TABLES__ row counts, which are exact and free
  npis_checked          H9's sidecar summary, which survives the H10-H13
                        overwrite of the shared finding slug
  npis_flagged          H9's structural + checksum failures
  endpoints_live_pct    the endpoint-liveness finding, which is measured by
                        the crawler against a different and older release, so
                        it is carried with its own as-of date rather than
                        being silently attributed to this one
  findings_*            counted from frontend/src/data/findings.ts
  methodology_version   the status line in docs/methodology/index.md

Run: python analysis/build_stats.py
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys
from datetime import datetime, timezone

from google.cloud import bigquery

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from claims_sources._cohorts import bq_job_config  # noqa: E402
from release import CURRENT_RELEASE as RELEASE_DATE  # noqa: E402

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
ROOT = pathlib.Path(__file__).resolve().parent.parent
API = ROOT / "frontend" / "public" / "api" / "v1"

RESOURCE_TABLES = (
    "practitioner", "organization", "location",
    "endpoint", "practitioner_role", "organization_affiliation",
)


def commit_sha() -> str:
    try:
        r = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                           capture_output=True, text=True, check=True, cwd=ROOT)
        return r.stdout.strip()
    except Exception:
        return "pending"


def resources_processed(client: bigquery.Client) -> int:
    """Exact row counts from __TABLES__. Metadata only, so this scans nothing."""
    rows = client.query(
        f"SELECT table_id, row_count FROM `{PROJECT}.{DATASET}.__TABLES__`",
        job_config=bq_job_config(),
    ).result()
    counts = {r.table_id: int(r.row_count) for r in rows}
    missing = [t for t in RESOURCE_TABLES if t not in counts]
    if missing:
        raise SystemExit(f"tables absent from {DATASET}: {missing}")
    for t in RESOURCE_TABLES:
        print(f"  {t:<26} {counts[t]:>12,}")
    return sum(counts[t] for t in RESOURCE_TABLES)


def read_finding(slug: str) -> dict | None:
    p = API / "findings" / f"{slug}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return None


def finding_status_counts() -> dict[str, int]:
    src = (ROOT / "frontend" / "src" / "data" / "findings.ts").read_text()
    found = re.findall(r"status:\s*'([a-z-]+)'", src)
    return {
        "published": found.count("published"),
        "in_progress": found.count("in-progress"),
        "pre_registered": found.count("pre-registered"),
    }


def methodology_version() -> str:
    txt = (ROOT / "docs" / "methodology" / "index.md").read_text()
    m = re.search(r"Status:\s*`([^`]+)`", txt)
    return m.group(1) if m else "unknown"


def main() -> None:
    client = bigquery.Client(project=PROJECT)

    print("Row counts (from __TABLES__, no scan):")
    total = resources_processed(client)
    print(f"  {'TOTAL':<26} {total:>12,}")

    # NPI validation counts come from H9's sidecar, not from the finding's
    # numerator/denominator. h10_h13_with_crosswalk.py writes the same slug
    # after h9 does and replaces that pair with H13's Practitioner-to-Role
    # agreement counts, so reading them here reported 5,275,554 flagged NPIs
    # out of 5,275,635 checked. Both numbers were real; neither was about NPIs.
    npi = read_finding("npi-validity-summary") or {}
    if not npi:
        raise SystemExit(
            "findings/npi-validity-summary.json is missing. Run "
            "analysis/h9_npi_luhn.py before building stats."
        )
    if npi.get("release_date") != RELEASE_DATE:
        raise SystemExit(
            f"npi-validity-summary.json is at {npi.get('release_date')} but the "
            f"pinned release is {RELEASE_DATE}. Re-run the finding scripts before "
            f"building stats, or stats.json will summarize the wrong release."
        )
    checked = npi.get("npis_checked")
    flagged = npi.get("npis_flagged")

    # Endpoint liveness comes from the crawler, not from BigQuery, and it has
    # not been re-run against this release. Carry the number with the release
    # it was actually measured on instead of implying it is current.
    live = read_finding("endpoint-liveness") or {}
    live_asof = live.get("release_date")
    live_num, live_den = live.get("numerator"), live.get("denominator")
    live_pct = (
        round(100.0 * live_num / live_den, 2)
        if isinstance(live_num, int) and isinstance(live_den, int) and live_den
        else None
    )

    counts = finding_status_counts()
    stats = {
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": methodology_version(),
        "commit_sha": commit_sha(),
        "counters": {
            "resources_processed": total,
            "npis_checked": checked,
            "npis_flagged": flagged,
            "endpoints_live_pct": live_pct,
            "findings_published": counts["published"],
            "findings_in_progress": counts["in_progress"],
            "findings_pre_registered": counts["pre_registered"],
        },
    }
    # Not part of ApiV1Stats' required shape, and additive rather than
    # breaking: consumers that ignore it are unaffected, and the one number
    # here measured against a different release now says so on the record.
    if live_asof and live_asof != RELEASE_DATE:
        stats["counters_as_of"] = {"endpoints_live_pct": live_asof}

    out = API / "stats.json"
    out.write_text(json.dumps(stats, indent=2) + "\n")
    print(f"\nWrote {out}")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
