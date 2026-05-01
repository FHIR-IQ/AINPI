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

# Payer FHIR endpoint registry — base URLs + search strategy.
# v1 wiring: 2 publicly-queryable endpoints verified working 2026-05-01.
#   - Humana supports `?identifier=NPI` directly.
#   - Cigna does not support identifier search (returns 400); we name-search
#     `?family=&given=` and post-filter the Bundle by NPI.
# Stage B fast-follows (deferred): Anthem (HealthKeepersInc / AnthemBlueCross
# via Elevance TotalView /registered/* — auth-required), Aetna (OAuth-only),
# UnitedHealthcare (URL drift in our ProviderDirectoryAPI table).
MCOS: list[dict[str, str]] = [
    {"name": "Humana",
     "endpoint": "https://fhir.humana.com/api",
     "search": "identifier"},
    {"name": "Cigna",
     "endpoint": "https://fhir.cigna.com/ProviderDirectory/v1",
     "search": "name"},
]


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


def classify_response(status_code: int, body: str) -> Classification:
    """Map an MCO HTTP response into one of three buckets.

    - matched          : Bundle with at least one entry (total>=1 or entry list non-empty)
    - not_in_directory : Bundle with total=0 / empty entry list, OR HTTP 404
    - error            : everything else (5xx, 4xx-not-404, malformed JSON,
                         non-Bundle resourceType)

    The 404 -> not_in_directory rule covers FHIR servers that return 404 for
    empty searches; everything else 4xx is treated as `error` so we never
    silently miss a match because of an auth or schema issue.
    """
    if status_code == 404:
        return "not_in_directory"
    if status_code != 200:
        return "error"
    try:
        body_json = json.loads(body)
    except json.JSONDecodeError:
        return "error"
    if body_json.get("resourceType") != "Bundle":
        return "error"
    total = body_json.get("total")
    entries = body_json.get("entry") or []
    if total is None:
        return "matched" if entries else "not_in_directory"
    return "matched" if total >= 1 else "not_in_directory"


def _fetch(url: str) -> tuple[int, str]:
    """One HTTP GET via curl subprocess. Returns (status_code, body).

    Why curl instead of `urllib.request`? Akamai-fronted endpoints
    (e.g. Humana's FHIR API) WAF-block Python's TLS fingerprint and
    return 403 even with a valid User-Agent and identical headers.
    curl uses the system TLS stack and is fingerprinted as a real
    client. This also sidesteps Python certifi-vs-corp-proxy SSL
    intercepts on dev boxes. curl is universally available on dev
    machines and on the GitHub Actions `ubuntu-latest` runner.
    """
    try:
        result = subprocess.run(
            [
                "curl", "-sS", "-w", "\n__HTTP_CODE__%{http_code}",
                "--max-time", str(HTTP_TIMEOUT_SECONDS),
                "-H", "Accept: application/fhir+json, application/json",
                "-H", f"User-Agent: {USER_AGENT}",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=HTTP_TIMEOUT_SECONDS + 5,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return 0, ""
    if result.returncode != 0:
        return 0, ""
    out = result.stdout
    marker = "\n__HTTP_CODE__"
    idx = out.rfind(marker)
    if idx == -1:
        return 0, ""
    body = out[:idx]
    try:
        code = int(out[idx + len(marker):].strip())
    except ValueError:
        return 0, ""
    return code, body


def parse_cohort_name(name: str) -> tuple[str, str]:
    """Split the cohort export's "FAMILY, GIVEN" name into (family, given).

    Cohort rows have names like "DOE, JANE" or "SMITH, A B" (multi-token
    given). We keep the full given chunk as one search term — payer FHIR
    servers tolerate extra given names.
    """
    if not name:
        return "", ""
    parts = [p.strip() for p in name.split(",", 1)]
    family = parts[0]
    given = parts[1] if len(parts) > 1 else ""
    return family, given


def bundle_contains_npi(body: str, npi: str) -> bool:
    """Return True if the Bundle's entries include any Practitioner whose
    `identifier[]` array carries an NPI matching `npi`.

    Used by the name-search path to confirm an NPI hit among potentially
    many name-search results. Treated as `not_in_directory` if no match
    is found, regardless of how many entries the Bundle returned.
    """
    try:
        body_json = json.loads(body)
    except json.JSONDecodeError:
        return False
    if body_json.get("resourceType") != "Bundle":
        return False
    for entry in body_json.get("entry", []) or []:
        resource = entry.get("resource") or {}
        if resource.get("resourceType") != "Practitioner":
            continue
        for ident in resource.get("identifier", []) or []:
            value = (ident.get("value") or "").strip()
            system = (ident.get("system") or "").strip()
            if value == npi and (
                "us-npi" in system.lower()
                or system == ""  # some payers omit the system
            ):
                return True
    return False


def _query_by_identifier(npi: str, mco: dict[str, str]) -> Classification:
    npi_identifier = f"http://hl7.org/fhir/sid/us-npi|{npi}"
    base = mco["endpoint"].rstrip("/")
    url = f"{base}/Practitioner?identifier={urllib.parse.quote(npi_identifier, safe='')}"
    status, body = _fetch(url)
    return classify_response(status, body)


def _query_by_name(npi: str, family: str, given: str, mco: dict[str, str]) -> Classification:
    """For payers whose Practitioner search rejects identifier=. Run a name
    search and post-filter for the NPI.

    Strategy: encode `family` and `given` (skip if empty), request up to
    `_count=20` results, then check identifier arrays for the NPI. If no
    family AND no given are available, we cannot search — return `error`
    so the row is auditable rather than silently miscounted.
    """
    if not family and not given:
        return "error"
    base = mco["endpoint"].rstrip("/")
    params = []
    if family:
        params.append(f"family={urllib.parse.quote(family)}")
    if given:
        params.append(f"given={urllib.parse.quote(given)}")
    params.append("_count=20")
    url = f"{base}/Practitioner?" + "&".join(params)
    status, body = _fetch(url)
    if status == 404:
        return "not_in_directory"
    if status != 200:
        return "error"
    try:
        json.loads(body)
    except json.JSONDecodeError:
        return "error"
    return "matched" if bundle_contains_npi(body, npi) else "not_in_directory"


def query_mco(npi: str, name: str, mco: dict[str, str]) -> Classification:
    """Query one payer for one NPI. Single retry on `error` after RETRY_DELAY_SECONDS.

    Dispatches by the MCO entry's `search` field:
        - "identifier": direct `?identifier=NPI` search (Humana)
        - "name":       name-search + post-filter by NPI (Cigna)
    """
    strategy = mco.get("search", "identifier")

    def _once() -> Classification:
        if strategy == "name":
            family, given = parse_cohort_name(name)
            return _query_by_name(npi, family, given, mco)
        return _query_by_identifier(npi, mco)

    result = _once()
    if result == "error":
        time.sleep(RETRY_DELAY_SECONDS)
        result = _once()
    return result
