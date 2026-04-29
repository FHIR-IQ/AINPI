"""H23 — High-risk provider cohort (composite score for revalidation prioritization).

Aligned with 42 CFR § 455.436 (federal database checks) and § 455.450 (risk-tier
screening). Produces /api/v1/findings/high-risk-cohort.json with a transparent,
audit-friendly composite score per NPI plus a downloadable CSV at
/api/v1/findings/high-risk-cohort-export.csv.

The composite combines four NDH/NPPES signals already produced by other AINPI
analyses (no new data ingestion required for v1):

  Signal                           Weight   Reason code            Source
  -----------------------------    ------   --------------------   ---------------
  No NPPES NPI match               1.0      not_in_nppes           H10
  NPPES deactivated, NDH active    0.8      nppes_deactivated      H10 v2
  Luhn check fails                 1.0      luhn_fail              H9
  Specialty mismatch with NPPES    0.4      specialty_mismatch     H13

Bucketed:
    score >= 1.0 → 'high'   (lead with these in the state revalidation queue)
    score >= 0.5 → 'medium' (review during normal cadence)
    score <  0.5 → 'clean'  (no flag)

Roadmap signals (not yet ingested):
    OIG LEIE excluded provider          weight 1.5  reason: oig_excluded
    SAM.gov exclusion record            weight 1.5  reason: sam_excluded
    Endpoint dead (L4+)                 weight 0.3  reason: endpoint_dead
    meta.lastUpdated > 180 days drift   weight 0.2  reason: stale_metadata

Each addition will bump the methodology version and republish.

Usage:
    python analysis/high_risk_cohort.py

Output:
    frontend/public/api/v1/findings/high-risk-cohort.json
    frontend/public/api/v1/findings/high-risk-cohort-export.csv
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from datetime import datetime, timezone
from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
NPPES_DATASET = "bigquery-public-data.nppes"
RELEASE_DATE = "2026-04-09"
METHODOLOGY_VERSION = "0.2.0"
HIGH_RISK_THRESHOLD = 1.0
MEDIUM_RISK_THRESHOLD = 0.5
EXPORT_TOP_N = 10000  # Cap CSV export size; full cohort available via /api/v1/* refresh

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"


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


def luhn_check(npi: str) -> bool:
    """CMS NPI Luhn validation per CMS NPI Final Rule (Sep 2007).

    NPIs are 10-digit identifiers. The CMS Luhn variant prefixes with the
    fixed string '80840' before computing the standard mod-10 check.
    """
    if not npi or len(npi) != 10 or not npi.isdigit():
        return False
    full = "80840" + npi
    total = 0
    for i, digit in enumerate(reversed(full)):
        d = int(digit)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def run() -> None:
    client = bigquery.Client(project=PROJECT)

    # Single CTE-based query computes all four signals at once. We score
    # only practitioner NPIs because the SMD letter's high-risk focus is on
    # provider-type screening (42 CFR 455.450). Organization revalidation
    # is a separate workflow.
    sql = f"""
    WITH ndh_practitioners AS (
      SELECT
        _npi,
        _family_name,
        _given_name,
        _state
      FROM `{PROJECT}.{DATASET}.practitioner`
      WHERE _npi IS NOT NULL
    ),
    nppes_join AS (
      SELECT
        p._npi,
        p._family_name,
        p._given_name,
        p._state,
        nppes.npi IS NOT NULL                                     AS in_nppes,
        nppes.npi_deactivation_date IS NOT NULL                   AS nppes_deactivated,
        nppes.provider_last_name_legal_name                       AS nppes_last,
        nppes.provider_first_name                                 AS nppes_first,
        nppes.healthcare_provider_taxonomy_code_1                 AS nppes_taxonomy_1
      FROM ndh_practitioners p
      LEFT JOIN `{NPPES_DATASET}.npi_raw` nppes
        ON p._npi = CAST(nppes.npi AS STRING)
    )
    SELECT
      _npi,
      _family_name,
      _given_name,
      _state,
      in_nppes,
      nppes_deactivated
    FROM nppes_join
    """
    print(f"Running composite cohort query — this may take ~3-5 min on 7.4M practitioners...")
    rows = list(client.query(sql).result())
    print(f"  Loaded {len(rows):,} practitioner NPIs")

    # Score each NPI in Python (Luhn check is Python-side; remaining signals
    # come from the BQ row).
    cohort = []
    bucket_counts = {"high": 0, "medium": 0, "clean": 0}
    reason_counts = {
        "not_in_nppes": 0,
        "nppes_deactivated": 0,
        "luhn_fail": 0,
    }

    for r in rows:
        npi = r._npi
        score = 0.0
        reasons = []

        if not luhn_check(npi):
            score += 1.0
            reasons.append("luhn_fail")
            reason_counts["luhn_fail"] += 1

        if not r.in_nppes:
            score += 1.0
            reasons.append("not_in_nppes")
            reason_counts["not_in_nppes"] += 1
        elif r.nppes_deactivated:
            score += 0.8
            reasons.append("nppes_deactivated")
            reason_counts["nppes_deactivated"] += 1

        # H13 specialty mismatch is computed by the h10_h13_with_crosswalk
        # script and stored in a BQ derived table (not yet wired here). v2
        # of this script will join `cohort_specialty_mismatch` and add
        # weight 0.4 + reason `specialty_mismatch`.

        bucket = "clean"
        if score >= HIGH_RISK_THRESHOLD:
            bucket = "high"
        elif score >= MEDIUM_RISK_THRESHOLD:
            bucket = "medium"
        bucket_counts[bucket] += 1

        if bucket != "clean":
            family = (r._family_name or "").strip()
            given = (r._given_name or "").strip()
            cohort.append({
                "npi": npi,
                "name": f"{family}, {given}".strip(", "),
                "state": r._state or "",
                "score": round(score, 2),
                "reasons": reasons,
                "bucket": bucket,
            })

    cohort.sort(key=lambda c: (-c["score"], c["npi"]))
    total = len(rows)
    high_n = bucket_counts["high"]
    med_n = bucket_counts["medium"]

    print(f"\nCohort distribution:")
    print(f"  high   (score >= {HIGH_RISK_THRESHOLD}):   {high_n:>10,}  ({100*high_n/total:.4f}%)")
    print(f"  medium (score >= {MEDIUM_RISK_THRESHOLD}): {med_n:>10,}  ({100*med_n/total:.4f}%)")
    print(f"  clean:                              {bucket_counts['clean']:>10,}")
    print(f"\nReason-code prevalence:")
    for k, v in reason_counts.items():
        print(f"  {k:<22} {v:>10,}  ({100*v/total:.4f}%)")

    # Write CSV export (top N by score, deduplicated by NPI).
    csv_path = FINDINGS_DIR / "high-risk-cohort-export.csv"
    with open(csv_path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["npi", "name", "state", "score", "bucket", "reasons"])
        w.writeheader()
        for c in cohort[:EXPORT_TOP_N]:
            w.writerow({
                "npi": c["npi"],
                "name": c["name"],
                "state": c["state"],
                "score": c["score"],
                "bucket": c["bucket"],
                "reasons": "|".join(c["reasons"]),
            })
    print(f"\nWrote {csv_path} ({min(len(cohort), EXPORT_TOP_N):,} rows)")

    headline = (
        f"{high_n:,} of {total:,} ({100*high_n/total:.2f}%) NDH practitioner NPIs "
        f"score at or above the {HIGH_RISK_THRESHOLD} composite threshold, anchored in "
        f"42 CFR § 455.436 federal database checks. Reason codes: "
        f"not_in_nppes ({reason_counts['not_in_nppes']:,}), "
        f"nppes_deactivated ({reason_counts['nppes_deactivated']:,}), "
        f"luhn_fail ({reason_counts['luhn_fail']:,})."
    )

    payload = {
        "slug": "high-risk-cohort",
        "title": "High-risk provider cohort",
        "hypotheses": ["H23"],
        "status": "in-progress",  # 'published' once LEIE + SAM are ingested
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": high_n,
        "denominator": total,
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "high", "value": bucket_counts["high"]},
                {"label": "medium", "value": bucket_counts["medium"]},
                {"label": "clean", "value": bucket_counts["clean"]},
            ],
        },
        "notes": (
            f"v1 composite uses three of the four documented signals: NPPES match (1.0), "
            f"NPPES deactivation (0.8), and Luhn validity (1.0). H13 specialty mismatch "
            f"(weight 0.4) is wired into the next pass via the cohort_specialty_mismatch "
            f"derived table populated by analysis/h10_h13_with_crosswalk.py. OIG LEIE and "
            f"SAM.gov exclusion ingestion (each weight 1.5) are roadmap items; until "
            f"ingested, state Medicaid agencies must run independent monthly checks per "
            f"42 CFR § 455.436. Composite score is a data-quality flag, NOT a fraud "
            f"determination — each NPI carries reason codes for transparent triage."
        ),
    }

    out = FINDINGS_DIR / "high-risk-cohort.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {out}")


if __name__ == "__main__":
    run()
