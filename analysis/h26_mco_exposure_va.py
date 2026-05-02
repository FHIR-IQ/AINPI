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
# v1 wiring: 3 publicly-queryable endpoints verified working 2026-05-02.
#   - Humana          — `?identifier=NPI` directly
#   - Cigna           — name search + post-filter (CapabilityStatement
#                        rejects `?identifier=` with 400)
#   - UnitedHealthcare — `?identifier=NPI` against the Optum FLEX public
#                        endpoint (covers UHC commercial + UHC Community
#                        Plan / Medicaid + OptumRx in one ~1,400-plan
#                        InsurancePlan tree)
#
# Stage B fast-follows still deferred:
#   - Anthem HealthKeepers Plus: public Medicaid endpoint exists at
#     totalview.healthos.elevancehealth.com/resources/unregistered/api/v1/fhir/cms_mandate/mcd/
#     but returns HTTP 500 on every Practitioner query (Elevance server bug
#     as of 2026-05-02). CapabilityStatement reveals Anthem only supports
#     family/given/name searches (no identifier), so once 500s clear we'll
#     need a name+filter path like Cigna.
#   - Molina Complete Care: production URL not yet discovered; dev portal
#     at developer.interop.molinahealthcare.com requires registration.
#   - Aetna: OAuth-required at developerportal.aetna.com.
MCOS: list[dict[str, str]] = [
    {"name": "Humana",
     "endpoint": "https://fhir.humana.com/api",
     "search": "identifier"},
    {"name": "Cigna",
     "endpoint": "https://fhir.cigna.com/ProviderDirectory/v1",
     "search": "name"},
    {"name": "UnitedHealthcare",
     "endpoint": "https://flex.optum.com/fhirpublic/R4",
     "search": "identifier"},
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


def compose_headline(numerator: int, denominator: int, per_mco: list[dict]) -> str:
    """Stable headline: count + per-payer breakdown in registry order."""
    breakdown = ", ".join(f"{m['name']} {m['matched']}" for m in per_mco)
    return (
        f"{numerator:,} of {denominator:,} federally excluded VA-resident "
        f"providers (LEIE or SAM, score >= 1.5) appear in at least one of "
        f"{len(per_mco)} wired payer provider directories. Per-payer: {breakdown}."
    )


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

    # Per-payer counters and per-NPI matched-in lists.
    per_mco: list[dict] = [
        {"name": m["name"], "endpoint": m["endpoint"], "search": m.get("search", "identifier"),
         "queried": 0, "matched": 0, "errors": 0}
        for m in MCOS
    ]
    matched_in_per_npi: dict[str, list[str]] = {row["npi"]: [] for row in queue}

    for row in queue:
        npi = row["npi"]
        name = row.get("name", "")
        for mco_index, mco in enumerate(MCOS):
            slot = per_mco[mco_index]
            slot["queried"] += 1
            try:
                result = query_mco(npi, name, mco)
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
            f"  {npi}  {name:<28}  "
            + " ".join(
                f"{m['name'][:6]}={'M' if m['name'] in matched_in_per_npi[npi] else '.'}"
                for m in MCOS
            )
        )

    # Soft-fail on excessive payer errors.
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
        "title": "VA payer networks containing federally excluded providers (methodology demo)",
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
            f"v1 methodology demonstration. Cross-references the VA-resident "
            f"critical-bucket cohort (LEIE or SAM, score >= 1.5) against {len(MCOS)} "
            f"publicly-queryable payer FHIR endpoints. Humana accepts "
            f"`?identifier=NPI` directly; Cigna does not (its CapabilityStatement "
            f"rejects identifier search) so we name-search and post-filter the "
            f"Bundle by NPI. Each match is a data-quality and triage signal "
            f"aligned with 42 CFR § 455.436 and § 438.602 — investigation, "
            f"hearing rights, and reinstatement claims belong to the payer and "
            f"the excluding agency. Provider directory listing alone does not "
            f"establish current billing privileges or active patient assignment. "
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
            {"name": m["name"], "endpoint": m["endpoint"], "search": m["search"],
             "queried": m["queried"], "matched": m["matched"], "errors": m["errors"]}
            for m in per_mco
        ],
        "samples": samples,
        "limitations": [
            "v1 of H26 is a methodology demonstration covering 2 publicly-queryable payer FHIR endpoints (Humana, Cigna). Neither is a primary VA Medicaid carrier; the actual VA Medicaid MCO products (Anthem HealthKeepers Plus, Aetna BH of VA, UHC Community Plan, Sentara Community Plan, Molina Complete Care, Virginia Premier) all require credentialed access and are deferred to Stage B follow-on.",
            "Anthem's TotalView FHIR endpoints (HealthKeepersInc, AnthemBlueCross via /resources/registered/...) return 403 on every Practitioner query without app registration. Aetna requires OAuth from developerportal.aetna.com. UnitedHealthcare's URL captured in our `ProviderDirectoryAPI` Supabase table is stale (DNS-fails); current public URL is unconfirmed.",
            "Cigna's CapabilityStatement does not list `identifier` as a Practitioner search parameter, so we name-search (`?family=&given=`) and post-filter Bundle entries for the target NPI. False negatives are possible if the cohort name (`FAMILY, GIVEN`) does not exactly match the payer's listing.",
            "Provider directory listing alone does not establish current network participation, billing privileges, or active patient assignment.",
            "Each match is a data-quality and triage flag, not a fraud determination — investigation, hearing rights, and reinstatement claims belong to the payer and the excluding agency.",
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
