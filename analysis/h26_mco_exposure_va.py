"""H26 — MCO networks containing federally excluded providers (VA pilot).

Cross-references the AINPI high-risk cohort's federally-excluded subset
(LEIE or SAM, score >= 1.5) for Virginia against live FHIR provider
directories of 4 publicly-queryable payer endpoints (Anthem HealthKeepers
Plus, Anthem Blue Cross, Humana, Cigna). Publishes per-payer match counts.

Anchored in 42 CFR § 455.436 (federal database checks) and § 438.602
(Medicaid managed care directory oversight).

Run order:
    1. analysis/high_risk_cohort.py    (regenerates cohort + export.csv)
    2. analysis/h26_mco_exposure_va.py (this script)

Writes:
    frontend/public/api/v1/findings/mco-exposure-va.json
    frontend/public/api/v1/findings/mco-exposure-va-detail.json
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Iterable, Literal

RELEASE_DATE = "2026-04-09"
METHODOLOGY_VERSION = "0.5.0"
USER_AGENT = (
    "AINPI-DirectoryQualityBot/1.0 "
    "(+https://ainpi.dev/methodology; gene@fhiriq.com)"
)
HTTP_TIMEOUT_SECONDS = 10
THROTTLE_SECONDS_PER_HOST = 1.0
RETRY_DELAY_SECONDS = 2.0

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
COHORT_CSV = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings" / "high-risk-cohort-export.csv"
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"

Classification = Literal["matched", "not_in_directory", "error"]


def filter_cohort(rows: Iterable[dict], state: str) -> list[dict]:
    """Keep only rows that are critical-bucket federally-excluded and in `state`.

    Federal exclusion = oig_excluded OR sam_excluded in the pipe-delimited
    `reasons` field. Other criticals (none today, but conceivable) are
    dropped because the H26 thesis is specifically about federal-database
    exclusions appearing in payer networks.
    """
    kept = []
    for r in rows:
        if r.get("state", "").upper() != state.upper():
            continue
        if r.get("bucket") != "critical":
            continue
        reasons = set((r.get("reasons") or "").split("|"))
        if not (reasons & {"oig_excluded", "sam_excluded"}):
            continue
        kept.append(r)
    return kept


def get_commit_sha() -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            capture_output=True, text=True, cwd=REPO_ROOT, timeout=5,
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except (FileNotFoundError, subprocess.SubprocessError):
        pass
    return "pending"
