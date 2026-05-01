# H26 — MCO networks containing federally excluded providers (VA pilot)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cross-reference the federally-excluded subset of the AINPI high-risk cohort (LEIE or SAM, score ≥ 1.5) for Virginia against live FHIR provider directories of 4 wired MCO parent payers, publishing per-MCO match counts as a citable finding.

**Architecture:** New Python script `analysis/h26_mco_exposure_va.py` mirrors the H24/H25 pattern. It reads `frontend/public/api/v1/findings/high-risk-cohort-export.csv`, filters to VA critical NPIs, hits `${endpoint}/Practitioner?identifier=...` on each MCO with a 1 req/sec/host throttle, and writes `frontend/public/api/v1/findings/mco-exposure-va.json` (public contract) + `mco-exposure-va-detail.json` (sidecar). The finding entry registers in `findings.ts`; `/states/va` gains a panel that reads the sidecar.

**Tech Stack:** Python 3.12+ (stdlib only — no new deps), Next.js 14, TypeScript, Vitest, GitHub Actions YAML.

**Spec:** `docs/superpowers/specs/2026-05-01-h26-mco-exposure-va-design.md`

---

## File structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `analysis/h26_mco_exposure_va.py` | Create | The full pipeline: cohort filter, MCO query, classification, aggregation, JSON write |
| `analysis/tests/__init__.py` | Create | Marks `analysis/tests/` as a package |
| `analysis/tests/test_h26_mco_exposure_va.py` | Create | Pure-function unit tests (bundle parser, cohort filter, headline composer) |
| `frontend/public/api/v1/findings/mco-exposure-va.json` | Create (generated) | Public contract — committed after first run |
| `frontend/public/api/v1/findings/mco-exposure-va-detail.json` | Create (generated) | Sidecar with samples — committed after first run |
| `frontend/src/data/findings.ts` | Modify | Add H26 `mco-exposure-va` entry |
| `frontend/src/lib/load-api-v1.ts` | Modify | Add `loadFindingDetail(slug)` for sidecar JSON |
| `frontend/src/app/states/[state]/page.tsx` | Modify | New MCO-exposure section (per-MCO bar + sample list) on `/states/va` |
| `frontend/tests/lib/load-api-v1.test.ts` | Modify | Snapshot test for `mco-exposure-va.json` shape |
| `.github/workflows/weekly-refresh.yml` | Modify | New step after the cohort step: `python analysis/h26_mco_exposure_va.py` |
| `CLAUDE.md` | Modify | Add `mco-exposure-va` → H26 to the hypothesis-to-slug map |
| `README.md` | Modify | `H1–H25` → `H1–H26` |
| `docs/methodology/index.md` | Modify | Update finding-count and status note |

---

## Task 1: Capture the live MCO endpoint list

**Files:**
- Create: `/tmp/mco-endpoints.json` (one-time scratch, not committed)

This task discovers the actual production MCO FHIR endpoint URLs from the running Supabase `ProviderDirectoryAPI` table so they can be hardcoded into the Python script in Task 4.

- [ ] **Step 1: Write a one-off TS script to dump the active rows**

Create `frontend/scripts/dump-provider-directory-apis.ts`:

```ts
import { prisma } from '../src/lib/prisma';

async function main() {
  const rows = await prisma.providerDirectoryAPI.findMany({
    orderBy: { organizationName: 'asc' },
  });
  console.log(JSON.stringify(rows.map(r => ({
    organizationName: r.organizationName,
    apiEndpoint: r.apiEndpoint,
    fhirVersion: r.fhirVersion,
  })), null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the dump and capture output**

Run from `frontend/`:

```bash
cp .env.local .env  # tooling needs DATABASE_URL in .env
npx tsx scripts/dump-provider-directory-apis.ts > /tmp/mco-endpoints.json
cat /tmp/mco-endpoints.json
```

Expected: a JSON array containing entries for at least Aetna, Anthem, UHC (or UnitedHealth/UnitedHealthcare), and Humana, each with `organizationName` and `apiEndpoint`.

- [ ] **Step 3: Identify the 4 MCO base URLs**

Read `/tmp/mco-endpoints.json` and write down the base URL for each of the four payers we will query. Verify each URL responds to `/metadata`:

```bash
for url in $(jq -r '.[].apiEndpoint' /tmp/mco-endpoints.json); do
  echo "=== $url ==="
  curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 "$url/metadata"
done
```

Expected: each returns `200`. If any returns non-200, mark that MCO as `degraded` for the run and proceed (the script will bucket those as `error`).

- [ ] **Step 4: Delete the dump script — it's a one-off**

```bash
rm frontend/scripts/dump-provider-directory-apis.ts
```

No commit yet; nothing of consequence has changed.

---

## Task 2: Test scaffold + cohort filter test (failing)

**Files:**
- Create: `analysis/tests/__init__.py`
- Create: `analysis/tests/test_h26_mco_exposure_va.py`

- [ ] **Step 1: Create empty package marker**

Create `analysis/tests/__init__.py`:

```python
```

(Empty file. This makes `analysis/tests/` a Python package so pytest can discover it.)

- [ ] **Step 2: Write the cohort-filter test**

Create `analysis/tests/test_h26_mco_exposure_va.py`:

```python
"""Unit tests for analysis/h26_mco_exposure_va.py.

Pure-function coverage only — HTTP and BigQuery are validated by running
the script end-to-end against live MCO endpoints.

Run:
    cd <repo-root>
    python -m pytest analysis/tests/test_h26_mco_exposure_va.py -v
"""
from __future__ import annotations
import sys
from pathlib import Path

# Add analysis/ to sys.path so we can import the module under test without
# packaging the analysis dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import h26_mco_exposure_va as h26  # noqa: E402


def test_filter_cohort_keeps_only_va_critical_excluded():
    rows = [
        # state=VA, critical, oig_excluded → KEEP
        {"npi": "1111111111", "name": "DOE, JANE", "state": "VA",
         "score": "1.5", "bucket": "critical", "reasons": "oig_excluded"},
        # state=VA, critical, sam_excluded → KEEP
        {"npi": "2222222222", "name": "ROE, JOHN", "state": "VA",
         "score": "1.5", "bucket": "critical", "reasons": "sam_excluded"},
        # state=VA, critical, oig+sam → KEEP
        {"npi": "3333333333", "name": "SMITH, A", "state": "VA",
         "score": "3.0", "bucket": "critical", "reasons": "oig_excluded|sam_excluded"},
        # state=VA, high (not critical) → DROP
        {"npi": "4444444444", "name": "JONES, B", "state": "VA",
         "score": "1.0", "bucket": "high", "reasons": "luhn_fail"},
        # state=NY, critical, oig_excluded → DROP (wrong state)
        {"npi": "5555555555", "name": "LEE, C", "state": "NY",
         "score": "1.5", "bucket": "critical", "reasons": "oig_excluded"},
        # state=VA, critical, but only luhn_fail → DROP (not federally excluded)
        {"npi": "6666666666", "name": "POE, D", "state": "VA",
         "score": "1.5", "bucket": "critical", "reasons": "luhn_fail"},
    ]
    kept = h26.filter_cohort(rows, state="VA")
    assert [r["npi"] for r in kept] == ["1111111111", "2222222222", "3333333333"]
```

- [ ] **Step 3: Run the test — it must fail because the module doesn't exist**

```bash
python -m pytest analysis/tests/test_h26_mco_exposure_va.py -v
```

Expected: `ModuleNotFoundError: No module named 'h26_mco_exposure_va'`.

No commit — implementation comes next.

---

## Task 3: Implement the script skeleton + cohort filter

**Files:**
- Create: `analysis/h26_mco_exposure_va.py`

- [ ] **Step 1: Write the module header + cohort filter**

Create `analysis/h26_mco_exposure_va.py`:

```python
"""H26 — MCO networks containing federally excluded providers (VA pilot).

Cross-references the AINPI high-risk cohort's federally-excluded subset
(LEIE or SAM, score ≥ 1.5) for Virginia against live FHIR provider
directories of 4 wired MCO parent payers (Aetna, Anthem, UHC, Humana).
Publishes per-MCO match counts.

Anchored in 42 CFR § 455.436 (federal database checks) and § 438.602
(Medicaid managed care directory oversight).

Run order:
    1. analysis/high_risk_cohort.py   (regenerates cohort + export.csv)
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
    exclusions appearing in MCO networks.
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
```

- [ ] **Step 2: Re-run the test — cohort filter test must pass**

```bash
python -m pytest analysis/tests/test_h26_mco_exposure_va.py -v
```

Expected: `1 passed`.

- [ ] **Step 3: Commit**

```bash
git add analysis/tests/__init__.py analysis/tests/test_h26_mco_exposure_va.py analysis/h26_mco_exposure_va.py
git commit -m "H26 scaffold: cohort filter + test

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Bundle classifier — test + implement

**Files:**
- Modify: `analysis/tests/test_h26_mco_exposure_va.py`
- Modify: `analysis/h26_mco_exposure_va.py`

- [ ] **Step 1: Write the classifier tests**

Append to `analysis/tests/test_h26_mco_exposure_va.py`:

```python
def test_classify_response_matched_with_total_one():
    body = '{"resourceType":"Bundle","type":"searchset","total":1,"entry":[{}]}'
    assert h26.classify_response(200, body) == "matched"


def test_classify_response_matched_with_entries_no_total():
    body = '{"resourceType":"Bundle","type":"searchset","entry":[{"resource":{}}]}'
    assert h26.classify_response(200, body) == "matched"


def test_classify_response_not_in_directory_zero_total():
    body = '{"resourceType":"Bundle","type":"searchset","total":0}'
    assert h26.classify_response(200, body) == "not_in_directory"


def test_classify_response_not_in_directory_empty_entry():
    body = '{"resourceType":"Bundle","type":"searchset","entry":[]}'
    assert h26.classify_response(200, body) == "not_in_directory"


def test_classify_response_error_on_5xx():
    assert h26.classify_response(503, "service unavailable") == "error"


def test_classify_response_error_on_4xx_non_404():
    # 400 / 401 / 403 are auth/parse errors — never silently say "not in directory"
    assert h26.classify_response(401, "") == "error"


def test_classify_response_404_treated_as_not_in_directory():
    # Some FHIR servers return 404 for empty searches instead of empty Bundle
    assert h26.classify_response(404, "") == "not_in_directory"


def test_classify_response_error_on_malformed_json():
    assert h26.classify_response(200, "not json") == "error"


def test_classify_response_error_on_non_bundle_resource():
    body = '{"resourceType":"OperationOutcome","issue":[{"severity":"error"}]}'
    assert h26.classify_response(200, body) == "error"
```

- [ ] **Step 2: Run — these must fail**

```bash
python -m pytest analysis/tests/test_h26_mco_exposure_va.py -v
```

Expected: 8 failures with `AttributeError: module ... has no attribute 'classify_response'`.

- [ ] **Step 3: Implement `classify_response`**

Append to `analysis/h26_mco_exposure_va.py`:

```python
def classify_response(status_code: int, body: str) -> Classification:
    """Map an MCO HTTP response into one of three buckets.

    - matched          : Bundle with at least one entry (total>=1 or entry list non-empty)
    - not_in_directory : Bundle with total=0 / empty entry list, OR HTTP 404
    - error            : everything else (5xx, 4xx-not-404, malformed JSON,
                         non-Bundle resourceType)

    The 404 → not_in_directory rule covers FHIR servers that return 404 for
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
```

- [ ] **Step 4: Run — all classifier tests must pass**

```bash
python -m pytest analysis/tests/test_h26_mco_exposure_va.py -v
```

Expected: `9 passed` (1 from Task 3 + 8 here).

- [ ] **Step 5: Commit**

```bash
git add analysis/tests/test_h26_mco_exposure_va.py analysis/h26_mco_exposure_va.py
git commit -m "H26: bundle response classifier with full status-code coverage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: MCO endpoint registry + HTTP query

**Files:**
- Modify: `analysis/h26_mco_exposure_va.py`

- [ ] **Step 1: Add the MCO registry constant**

Substitute the **actual URLs from /tmp/mco-endpoints.json (Task 1)** for the placeholders below. Append to `analysis/h26_mco_exposure_va.py` immediately after the constants block:

```python
# MCO FHIR endpoint registry — base URLs only.
# Sourced from the live `ProviderDirectoryAPI` rows used by
# `frontend/src/app/api/provider-search/route.ts`. Hardcoded here to keep
# the analysis pipeline self-contained (no Supabase dependency).
# Update these when the canonical Supabase rows change.
MCOS: list[dict[str, str]] = [
    {"name": "Aetna",  "endpoint": "<AETNA_FHIR_BASE_URL_FROM_TASK_1>"},
    {"name": "Anthem", "endpoint": "<ANTHEM_FHIR_BASE_URL_FROM_TASK_1>"},
    {"name": "UHC",    "endpoint": "<UHC_FHIR_BASE_URL_FROM_TASK_1>"},
    {"name": "Humana", "endpoint": "<HUMANA_FHIR_BASE_URL_FROM_TASK_1>"},
]
```

- [ ] **Step 2: Implement `query_mco`**

Append to `analysis/h26_mco_exposure_va.py`:

```python
def _fetch(url: str) -> tuple[int, str]:
    """One HTTP GET. Returns (status_code, body) — never raises for HTTP errors."""
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/fhir+json, application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        return e.code, body
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        return 0, ""  # network-level failure


def query_mco(npi: str, mco: dict[str, str]) -> Classification:
    """Query one MCO for one NPI. Single retry on `error` after RETRY_DELAY_SECONDS."""
    npi_identifier = f"http://hl7.org/fhir/sid/us-npi|{npi}"
    base = mco["endpoint"].rstrip("/")
    url = f"{base}/Practitioner?identifier={urllib.parse.quote(npi_identifier, safe='')}"

    status, body = _fetch(url)
    result = classify_response(status, body)
    if result == "error":
        time.sleep(RETRY_DELAY_SECONDS)
        status, body = _fetch(url)
        result = classify_response(status, body)
    return result
```

- [ ] **Step 3: Smoke-test against one real MCO with a known dummy NPI**

Run a quick interactive check. Pick any real NPI (e.g. one of the LEIE-matched ones from `frontend/public/api/v1/findings/oig-leie-exclusions-detail.json`). Run from `<repo-root>`:

```bash
python -c "
import sys; sys.path.insert(0, 'analysis')
import h26_mco_exposure_va as h26
mco = h26.MCOS[0]
print('Endpoint:', mco['endpoint'])
print('Result for known NPI 1234567890:', h26.query_mco('1234567890', mco))
"
```

Expected: prints `matched`, `not_in_directory`, or `error` (any of the three is valid — we're checking the call wires up). If `error` for all 4 MCOs in a row, double-check the URL substitution from Task 5 Step 1.

- [ ] **Step 4: Commit**

```bash
git add analysis/h26_mco_exposure_va.py
git commit -m "H26: MCO endpoint registry + query_mco with retry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Headline composer — test + implement

**Files:**
- Modify: `analysis/tests/test_h26_mco_exposure_va.py`
- Modify: `analysis/h26_mco_exposure_va.py`

- [ ] **Step 1: Write the headline tests**

Append to `analysis/tests/test_h26_mco_exposure_va.py`:

```python
def test_compose_headline_zero_matches():
    per_mco = [
        {"name": "Aetna",  "matched": 0, "queried": 312, "errors": 0},
        {"name": "Anthem", "matched": 0, "queried": 312, "errors": 0},
        {"name": "UHC",    "matched": 0, "queried": 312, "errors": 0},
        {"name": "Humana", "matched": 0, "queried": 312, "errors": 0},
    ]
    line = h26.compose_headline(numerator=0, denominator=312, per_mco=per_mco)
    assert "0 of 312" in line
    assert "Aetna 0" in line
    assert "Anthem 0" in line
    assert "UHC 0" in line
    assert "Humana 0" in line


def test_compose_headline_with_matches():
    per_mco = [
        {"name": "Aetna",  "matched": 4, "queried": 312, "errors": 0},
        {"name": "Anthem", "matched": 7, "queried": 312, "errors": 0},
        {"name": "UHC",    "matched": 2, "queried": 312, "errors": 1},
        {"name": "Humana", "matched": 1, "queried": 312, "errors": 0},
    ]
    line = h26.compose_headline(numerator=11, denominator=312, per_mco=per_mco)
    assert "11 of 312" in line
    assert "Aetna 4, Anthem 7, UHC 2, Humana 1" in line


def test_compose_headline_stable_with_single_mco():
    per_mco = [{"name": "Aetna", "matched": 3, "queried": 100, "errors": 0}]
    line = h26.compose_headline(numerator=3, denominator=100, per_mco=per_mco)
    assert "3 of 100" in line
    assert "Aetna 3" in line
```

- [ ] **Step 2: Run — must fail with AttributeError**

```bash
python -m pytest analysis/tests/test_h26_mco_exposure_va.py -v
```

Expected: 3 failures.

- [ ] **Step 3: Implement `compose_headline`**

Append to `analysis/h26_mco_exposure_va.py`:

```python
def compose_headline(numerator: int, denominator: int, per_mco: list[dict]) -> str:
    """Stable headline: count + per-MCO breakdown in registry order."""
    breakdown = ", ".join(f"{m['name']} {m['matched']}" for m in per_mco)
    return (
        f"{numerator:,} of {denominator:,} federally excluded VA-resident "
        f"providers (LEIE or SAM, score ≥ 1.5) appear in at least one of "
        f"{len(per_mco)} wired MCO provider directories. Per-MCO: {breakdown}."
    )
```

- [ ] **Step 4: Run — all tests must pass**

```bash
python -m pytest analysis/tests/test_h26_mco_exposure_va.py -v
```

Expected: `12 passed`.

- [ ] **Step 5: Commit**

```bash
git add analysis/tests/test_h26_mco_exposure_va.py analysis/h26_mco_exposure_va.py
git commit -m "H26: stable headline composer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire `run()` end-to-end

**Files:**
- Modify: `analysis/h26_mco_exposure_va.py`

- [ ] **Step 1: Implement `run()` and `__main__`**

Append to `analysis/h26_mco_exposure_va.py`:

```python
def _read_cohort_csv(path: pathlib.Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def run(state: str = "VA") -> None:
    started = datetime.now(timezone.utc)
    cohort_rows = _read_cohort_csv(COHORT_CSV)
    queue = filter_cohort(cohort_rows, state=state)
    print(f"Cohort source: {COHORT_CSV}")
    print(f"NPIs to query: {len(queue):,} ({state} critical, federally excluded)")
    if not queue:
        raise SystemExit(
            f"No NPIs to query — {state} critical bucket is empty for "
            "oig_excluded/sam_excluded reasons. Did the cohort run? "
            "Check frontend/public/api/v1/findings/high-risk-cohort.json."
        )

    # Per-MCO counters and per-NPI matched-in lists.
    per_mco: list[dict] = [
        {"name": m["name"], "endpoint": m["endpoint"],
         "queried": 0, "matched": 0, "errors": 0}
        for m in MCOS
    ]
    matched_in_per_npi: dict[str, list[str]] = {row["npi"]: [] for row in queue}

    for row in queue:
        npi = row["npi"]
        for mco_index, mco in enumerate(MCOS):
            slot = per_mco[mco_index]
            slot["queried"] += 1
            try:
                result = query_mco(npi, mco)
            except Exception as e:  # belt + suspenders — never crash the whole run
                print(f"  ! {mco['name']} {npi}: unexpected exception {e}")
                slot["errors"] += 1
                continue
            if result == "matched":
                slot["matched"] += 1
                matched_in_per_npi[npi].append(mco["name"])
            elif result == "error":
                slot["errors"] += 1
            time.sleep(THROTTLE_SECONDS_PER_HOST)
        print(
            f"  {npi}  → "
            + " ".join(f"{m['name']}={'M' if m['name'] in matched_in_per_npi[npi] else '.'}"
                       for m in MCOS)
        )

    # Soft-fail on excessive MCO errors.
    warnings: list[str] = []
    for slot in per_mco:
        if slot["queried"] and slot["errors"] / slot["queried"] > 0.10:
            warnings.append(
                f"{slot['name']} error rate "
                f"{slot['errors']}/{slot['queried']} > 10% — match counts may understate."
            )

    numerator = sum(1 for npis in matched_in_per_npi.values() if npis)
    denominator = len(queue)

    public_payload = {
        "slug": "mco-exposure-va",
        "title": "VA Medicaid MCO networks containing federally excluded providers",
        "hypotheses": ["H26"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": compose_headline(numerator, denominator, per_mco),
        "numerator": numerator,
        "denominator": denominator,
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [{"label": m["name"], "value": m["matched"]} for m in per_mco],
        },
        "notes": (
            f"Cross-references the VA-resident critical-bucket cohort "
            f"(LEIE or SAM, score ≥ 1.5) against live FHIR provider directories "
            f"of {len(MCOS)} wired MCO parent payers via "
            f"`{{base}}/Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|<npi>`. "
            f"Each match is a data-quality and triage signal aligned with "
            f"42 CFR § 455.436 and § 438.602 — investigation, hearing rights, "
            f"and reinstatement claims belong to the MCO and the excluding "
            f"agency. Provider directory listing alone does not establish "
            f"current billing privileges or active patient assignment. "
            + (" ; ".join(warnings) if warnings else "")
        ),
    }

    samples = []
    for npi, matched_in in sorted(
        matched_in_per_npi.items(),
        key=lambda kv: (-len(kv[1]), kv[0]),
    ):
        if not matched_in:
            continue
        original = next(r for r in queue if r["npi"] == npi)
        reasons = (original.get("reasons") or "").split("|")
        samples.append({
            "npi": npi,
            "name": original.get("name") or "(name not in cohort export)",
            "reason_codes": [r for r in reasons if r],
            "matched_in": matched_in,
            "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
            "sam_lookup_url": "https://sam.gov/search/?index=ex",
            "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{npi}",
        })
        if len(samples) >= 10:
            break

    detail_payload = {
        "queried_at": started.isoformat(timespec="seconds"),
        "cohort_source": f"high-risk-cohort-export.csv@{get_commit_sha()}",
        "mcos": [
            {"name": m["name"], "endpoint": m["endpoint"],
             "queried": m["queried"], "matched": m["matched"], "errors": m["errors"]}
            for m in per_mco
        ],
        "samples": samples,
        "limitations": [
            "VA Medicaid landscape includes 6 MCO products; this finding queries 4 parent payers (Aetna, Anthem, UHC, Humana). Sentara Community Plan and Virginia Premier are not yet wired.",
            "Parent-payer FHIR endpoints may aggregate commercial + Medicaid managed care directories. The match is 'appears in payer's published provider directory'; the Medicaid line specifically may differ.",
            "Provider directory listing alone does not establish current network participation, billing privileges, or active patient assignment.",
            "Each match is a data-quality and triage flag, not a fraud determination — investigation, hearing rights, and reinstatement claims belong to the MCO and the excluding agency.",
        ],
    }

    out_public = FINDINGS_DIR / "mco-exposure-va.json"
    out_detail = FINDINGS_DIR / "mco-exposure-va-detail.json"
    out_public.write_text(json.dumps(public_payload, indent=2) + "\n")
    out_detail.write_text(json.dumps(detail_payload, indent=2) + "\n")
    print(f"\nWrote {out_public}")
    print(f"Wrote {out_detail}")
    print(
        f"\nDone in {(datetime.now(timezone.utc) - started).total_seconds():.1f}s. "
        f"Numerator: {numerator}, Denominator: {denominator}."
    )


if __name__ == "__main__":
    run()
```

- [ ] **Step 2: Confirm pytest still passes (we didn't break unit tests)**

```bash
python -m pytest analysis/tests/test_h26_mco_exposure_va.py -v
```

Expected: `12 passed`.

- [ ] **Step 3: Commit**

```bash
git add analysis/h26_mco_exposure_va.py
git commit -m "H26: end-to-end run() with JSON contract + sidecar emit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: First production run — generate JSON outputs

**Files:**
- Create (generated): `frontend/public/api/v1/findings/mco-exposure-va.json`
- Create (generated): `frontend/public/api/v1/findings/mco-exposure-va-detail.json`

- [ ] **Step 1: Confirm cohort export exists and has VA critical rows**

```bash
test -f frontend/public/api/v1/findings/high-risk-cohort-export.csv && \
  head -1 frontend/public/api/v1/findings/high-risk-cohort-export.csv && \
  awk -F, 'NR>1 && $3=="VA" && $5=="critical"' \
    frontend/public/api/v1/findings/high-risk-cohort-export.csv | wc -l
```

Expected: prints the CSV header, then a count > 0. If 0, run `python analysis/high_risk_cohort.py` first to refresh the export.

- [ ] **Step 2: Run h26 end-to-end**

```bash
python analysis/h26_mco_exposure_va.py
```

Expected: prints "NPIs to query: <N>", then per-NPI status lines with M/. matrix, then "Wrote ..." for both files. Wall time ~5 min for ~300 NPIs.

- [ ] **Step 3: Inspect the generated JSONs**

```bash
python -c "
import json
p = json.load(open('frontend/public/api/v1/findings/mco-exposure-va.json'))
print('Slug      :', p['slug'])
print('Numerator :', p['numerator'])
print('Denomin.  :', p['denominator'])
print('Headline  :', p['headline'])
print()
import json
d = json.load(open('frontend/public/api/v1/findings/mco-exposure-va-detail.json'))
print('MCOs queried:')
for m in d['mcos']:
    print(f'  {m[\"name\"]:<8} queried={m[\"queried\"]:<5} matched={m[\"matched\"]:<3} errors={m[\"errors\"]}')
print(f'Samples (top {len(d[\"samples\"])}):')
for s in d['samples'][:3]:
    print(f'  {s[\"npi\"]} {s[\"name\"]} matched_in={s[\"matched_in\"]}')
"
```

Expected: clean output, numerator <= denominator, all MCOs have queried > 0.

- [ ] **Step 4: Commit the generated JSONs**

```bash
git add frontend/public/api/v1/findings/mco-exposure-va.json \
        frontend/public/api/v1/findings/mco-exposure-va-detail.json
git commit -m "H26: first published numbers (mco-exposure-va.json)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Register H26 in `findings.ts`

**Files:**
- Modify: `frontend/src/data/findings.ts`

- [ ] **Step 1: Insert H26 entry between `oig-leie-exclusions` and `sam-exclusions` (or after `sam-exclusions` — keep slugs grouped by federal-database axis)**

Open `frontend/src/data/findings.ts`. Locate the `sam-exclusions` entry (slug `'sam-exclusions'`). Insert this entry immediately AFTER its closing `},`:

```ts
  {
    slug: 'mco-exposure-va',
    hypotheses: ['H26'],
    title: 'VA Medicaid MCO networks containing federally excluded providers',
    summary:
      'Cross-references the AINPI federally-excluded cohort (LEIE or SAM, score ≥ 1.5) for Virginia against live FHIR provider directories of 4 wired MCO parent payers (Aetna, Anthem, UHC, Humana). Anchored in 42 CFR § 455.436 (federal database checks) and § 438.602 (Medicaid managed care directory oversight).',
    nullHypothesis:
      'Zero federally-excluded VA-resident NPIs appear in any of the queried MCO provider directories. Federal exclusion status and MCO directory publication are in agreement.',
    denominator:
      'VA-resident NPIs in the AINPI high-risk cohort\'s critical bucket (composite score ≥ 1.5) flagged for OIG LEIE or SAM.gov active exclusion. Source: `high-risk-cohort-export.csv`, filtered to `state=VA AND bucket=critical AND (oig_excluded OR sam_excluded)`.',
    dataSource:
      'Live FHIR `Practitioner?identifier=` queries against the four wired MCO parent payers used by `/api/provider-search`. Sentara Community Plan and Virginia Premier are not yet wired and are documented as a v1 gap.',
    status: 'published',
    ogTagline: 'Are federally excluded providers in VA Medicaid MCO networks?',
    implications: [
      {
        audience: 'Regulators',
        takeaway:
          '42 CFR § 438.602 requires MCO directory oversight. Persistent matches between active federal exclusions and MCO-published directories indicate either MCO directory drift or carryover from commercial network listings; either way it is a § 455.436-relevant flag for state PI staff.',
      },
      {
        audience: 'Payer data teams',
        takeaway:
          'If your payer organization appears in this finding, run an internal sweep of the matched NPIs against your provider data management workflow. Directory listing is operationally separate from active billing privileges, but the directory is the public-facing artifact regulators read first.',
      },
      {
        audience: 'Provider data teams',
        takeaway:
          'If your NPI is matched here AND you believe the federal exclusion is in error, the LEIE search portal at exclusions.oig.hhs.gov and SAM.gov are the authoritative sources; pursue reinstatement with the excluding agency before contesting the directory listing.',
      },
      {
        audience: 'Researchers',
        takeaway:
          'The 4-MCO denominator covers ~80% of VA Medicaid managed care lives but not all. Sentara and Virginia Premier are not yet queried. Parent-payer endpoints may aggregate commercial + Medicaid lines; product-level disambiguation requires future work to wire the Medicaid-specific FHIR endpoint per CMS-9115-F.',
      },
    ],
  },
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit src/data/findings.ts 2>&1 | head -20
```

Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/data/findings.ts
git commit -m "H26: register mco-exposure-va finding in findings.ts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Sidecar loader + state-page MCO-exposure section

**Files:**
- Modify: `frontend/src/lib/load-api-v1.ts`
- Modify: `frontend/src/app/states/[state]/page.tsx`

- [ ] **Step 1: Add `loadFindingDetail` to load-api-v1.ts**

Open `frontend/src/lib/load-api-v1.ts`. Append after `loadFinding`:

```ts
/**
 * Load a finding's sidecar JSON (e.g. `<slug>-detail.json`). Sidecars
 * carry samples, breakdowns, and limitations that are too large for the
 * stable `<slug>.json` public contract. Untyped because each finding has
 * its own sidecar shape.
 */
export function loadFindingDetail(slug: string): unknown | null {
  try {
    const raw = fs.readFileSync(
      path.join(PUBLIC_API_ROOT, 'findings', `${slug}-detail.json`),
      'utf8',
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Define sidecar shape and renderer in the state page**

Open `frontend/src/app/states/[state]/page.tsx`. Find where the imports end and add:

```ts
import { loadStateFindings, loadFinding, loadFindingDetail } from '@/lib/load-api-v1';
```

(Replace the existing `import { loadStateFindings } from '@/lib/load-api-v1';` line.)

- [ ] **Step 3: Add the section component**

Inside `page.tsx`, before `export default function StatePage`, add:

```tsx
interface McoExposureDetail {
  queried_at: string;
  cohort_source: string;
  mcos: { name: string; endpoint: string; queried: number; matched: number; errors: number }[];
  samples: {
    npi: string;
    name: string;
    reason_codes: string[];
    matched_in: string[];
    leie_lookup_url: string;
    sam_lookup_url: string;
    nppes_lookup_url: string;
  }[];
  limitations: string[];
}

function McoExposurePanel() {
  const finding = loadFinding('mco-exposure-va');
  const detail = loadFindingDetail('mco-exposure-va') as McoExposureDetail | null;
  if (!finding || !detail) return null;

  const maxMatched = Math.max(1, ...detail.mcos.map((m) => m.matched));

  return (
    <section className="mt-8 bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">
        MCO directory exposure to federally excluded providers
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        H26. {finding.headline}{' '}
        <a href="/findings/mco-exposure-va" className="underline">
          See the full finding →
        </a>
      </p>

      <div className="space-y-2 mb-6">
        {detail.mcos.map((m) => (
          <div key={m.name} className="flex items-center gap-3">
            <span className="w-20 text-sm font-medium text-gray-700">{m.name}</span>
            <div className="flex-1 bg-gray-100 rounded h-5 relative overflow-hidden">
              <div
                className="bg-red-600 h-full"
                style={{ width: `${(m.matched / maxMatched) * 100}%` }}
              />
            </div>
            <span className="w-32 text-sm text-gray-700 tabular-nums">
              {m.matched} matched / {m.queried} queried
              {m.errors > 0 && (
                <span className="text-amber-700"> · {m.errors} err</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {detail.samples.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-gray-700">
            Verify a sample yourself ({detail.samples.length} NPIs)
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {detail.samples.map((s) => (
              <li key={s.npi}>
                <a
                  href={s.nppes_lookup_url}
                  target="_blank"
                  rel="noopener"
                  className="underline"
                >
                  {s.npi}
                </a>{' '}
                — {s.name} — matched: {s.matched_in.join(', ')}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ul className="mt-4 text-xs text-gray-500 list-disc list-inside space-y-1">
        {detail.limitations.map((lim, i) => (
          <li key={i}>{lim}</li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Render the panel only on `/states/va`**

Find the body of `StatePage` after `const data = loadStateFindings(entry.code);`. Locate the JSX `return` block of the page. Inside the JSX where state-level content is rendered, add the conditional render before the closing `</main>` (or equivalent layout container). Concretely, find a line like `<Footer />` or the end of the main content `<div>` and insert directly above it:

```tsx
            {entry.code === 'VA' && <McoExposurePanel />}
```

If the page uses a different layout structure, place this inside the same container that wraps the existing findings table on `/states/va` — the section should appear in-flow with the rest of the state's content.

- [ ] **Step 5: Type-check + lint**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -10
cd frontend && npm run lint -- src/app/states src/lib/load-api-v1.ts 2>&1 | tail -10
```

Expected: no new errors. Pre-existing warnings about unrelated files are OK.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/load-api-v1.ts frontend/src/app/states/[state]/page.tsx
git commit -m "H26: surface mco-exposure-va on /states/va

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Vitest snapshot for the new finding shape

**Files:**
- Modify: `frontend/tests/lib/load-api-v1.test.ts`

- [ ] **Step 1: Read the existing test file's first 20 lines so the new test mirrors its style**

```bash
head -30 frontend/tests/lib/load-api-v1.test.ts
```

- [ ] **Step 2: Append the new test**

Append at the end of `frontend/tests/lib/load-api-v1.test.ts`, inside the existing `describe(...)` block (or in its own `describe` if the file uses top-level `describe`s):

```ts
describe('mco-exposure-va finding', () => {
  it('loadFinding returns the typed shape', () => {
    const finding = loadFinding('mco-exposure-va');
    expect(finding).not.toBeNull();
    expect(finding?.slug).toBe('mco-exposure-va');
    expect(finding?.hypotheses).toEqual(['H26']);
    expect(typeof finding?.numerator).toBe('number');
    expect(typeof finding?.denominator).toBe('number');
    expect(finding?.chart?.data?.length).toBeGreaterThan(0);
  });

  it('loadFindingDetail returns mcos + samples + limitations', () => {
    const detail = loadFindingDetail('mco-exposure-va') as {
      mcos: { name: string; matched: number; queried: number; errors: number }[];
      samples: unknown[];
      limitations: string[];
    } | null;
    expect(detail).not.toBeNull();
    expect(detail?.mcos.length).toBeGreaterThanOrEqual(4);
    expect(detail?.limitations.length).toBeGreaterThanOrEqual(3);
    for (const m of detail?.mcos ?? []) {
      expect(typeof m.name).toBe('string');
      expect(m.queried).toBeGreaterThanOrEqual(0);
      expect(m.matched).toBeGreaterThanOrEqual(0);
      expect(m.matched).toBeLessThanOrEqual(m.queried);
    }
  });
});
```

If the existing file imports `loadFinding` only, also add `loadFindingDetail` to the import line at the top.

- [ ] **Step 3: Run vitest**

```bash
cd frontend && npm run test -- load-api-v1 2>&1 | tail -10
```

Expected: tests pass; total test count goes up by 2.

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/lib/load-api-v1.test.ts
git commit -m "H26: vitest coverage for mco-exposure-va loaders

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Wire H26 into weekly-refresh workflow

**Files:**
- Modify: `.github/workflows/weekly-refresh.yml`

- [ ] **Step 1: Add the H26 step after the cohort step**

Open `.github/workflows/weekly-refresh.yml`. Find the existing step:

```yaml
      - name: Re-run high-risk cohort (H23, composite score)
        ...
        run: python analysis/high_risk_cohort.py
```

Immediately after that step's `run:` line (and before the `Stamp stats.json` step), insert:

```yaml
      - name: Re-run H26 MCO exposure (VA pilot)
        # Cross-references the federally-excluded VA cohort against live
        # FHIR provider directories. Reads the cohort CSV produced by the
        # previous step and queries Aetna/Anthem/UHC/Humana endpoints.
        # ~5 min wall-time at 1 req/sec/host. No new secrets — MCO FHIR
        # APIs are public per CMS-9115-F.
        run: python analysis/h26_mco_exposure_va.py
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/weekly-refresh.yml
git commit -m "H26: wire mco-exposure-va into weekly-refresh

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Documentation updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/methodology/index.md`

- [ ] **Step 1: Update CLAUDE.md hypothesis-to-slug map**

Open `CLAUDE.md`. Find the hypothesis-to-slug bullet list and append after the `sam-exclusions` line:

```markdown
- `mco-exposure-va` → H26 (BQ-free; live FHIR: `analysis/h26_mco_exposure_va.py`) — joins the VA federally-excluded cohort to live MCO provider directories (Aetna, Anthem, UHC, Humana). VA pilot; multi-state generalization is roadmap.
```

Also update the `## Pre-registration workflow (H1–H25)` heading to `H1–H26`, and the descriptive sentence (`Current range: **H1–H25**...`) to `Current range: **H1–H26**, with H26 (VA MCO exposure) added on top of H23–H25 in the SMD-revalidation push.`

- [ ] **Step 2: Update README.md hypothesis range**

Open `README.md`. Find the `/findings` row in the page table:

```markdown
| [`/findings`](https://ainpi.vercel.app/findings) | Pre-registered findings (H1–H25). Each states null hypothesis + denominator *before* numbers drop |
```

Change `H1–H25` to `H1–H26`.

- [ ] **Step 3: Update methodology status**

Open `docs/methodology/index.md`. Find the status line:

```markdown
> **Status: `0.4.0-draft`.** All eight pre-registered findings (H1–H25 bundled into 8 slugs) ...
```

Change to:

```markdown
> **Status: `0.5.0-draft`.** All nine pre-registered findings (H1–H26 bundled into 9 slugs) have landed real numbers against the 2026-04-09 NPD release. H26 (VA MCO exposure) cross-references the AINPI federally-excluded cohort against live FHIR provider directories of 4 wired MCO parent payers, anchored in 42 CFR § 438.602 (Medicaid managed care directory oversight).
```

(Preserve the rest of the existing paragraph after the H25/SSA-DMF sentence.)

- [ ] **Step 4: Final lint + tests**

```bash
cd frontend && npm run lint 2>&1 | tail -5
cd frontend && npm run test 2>&1 | tail -8
```

Expected: lint clean (only pre-existing warnings); all tests pass.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/methodology/index.md
git commit -m "H26: documentation — bump hypothesis range to H1–H26 and methodology to 0.5.0-draft

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review checklist (executor runs before opening PR)

- [ ] `python -m pytest analysis/tests/test_h26_mco_exposure_va.py -v` → 12 passed
- [ ] `cd frontend && npm run lint` → no new errors
- [ ] `cd frontend && npm run test` → all pass (count up by ≥2)
- [ ] `cd frontend && npm run build` → succeeds, `/findings/mco-exposure-va` and `/states/va` both static-generate
- [ ] `frontend/public/api/v1/findings/mco-exposure-va.json` and `mco-exposure-va-detail.json` are committed and contain real numbers (numerator ≤ denominator, all MCOs have queried > 0)
- [ ] `cohort_source` field stamps the short SHA of the cohort export's last update
- [ ] `git log --oneline origin/main..HEAD` shows ≥10 atomic commits, one per task

## Out-of-scope reminders (do NOT add to this PR)

- T-MSIS Medicaid claims signal — separate Stage 2 spec
- Sentara / Virginia Premier wiring — needs Sentara API to land
- PA / OH / multi-state generalization — fast-follow after VA proves the pattern
- PractitionerRole / Location filtering for Medicaid-line-specific filtering
