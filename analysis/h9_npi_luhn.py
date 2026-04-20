"""H9 — NPI Luhn + structural validity across all NPD Practitioner + Organization resources.

Query every NPI (system = us-npi) from BigQuery, validate with the same
Luhn implementation used by pipeline/2_npi_luhn.py, emit the finding JSON.

Expected outcomes:
    NPI_OK                 — passes structure + Luhn (predicted >99.9%)
    NPI_INVALID_STRUCTURE  — not 10 digits or leading digit not 1/2
    NPI_LUHN_FAIL          — structurally valid but checksum wrong
    NPI_MISSING            — resource has no us-npi identifier

Per methodology: the failing cohort is the story, not the pass rate.
"""
from __future__ import annotations
import json
import pathlib
import re
from collections import Counter
from datetime import datetime, timezone
from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE_DATE = "2026-04-09"

NPI_PREFIX = "80840"
NPI_RE = re.compile(r"^[12]\d{9}$")


def luhn_check(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = ord(ch) - ord("0")
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def validate(npi: str | None) -> str:
    if not npi:
        return "NPI_MISSING"
    if not NPI_RE.match(npi):
        return "NPI_INVALID_STRUCTURE"
    if not luhn_check(NPI_PREFIX + npi):
        return "NPI_LUHN_FAIL"
    return "NPI_OK"


def run() -> None:
    client = bigquery.Client(project=PROJECT)

    counter: Counter[str] = Counter()
    by_resource: dict[str, Counter[str]] = {}

    for tbl in ["practitioner", "organization"]:
        sql = f"""
        SELECT
          _id AS resource_id,
          _npi AS npi
        FROM `{PROJECT}.{DATASET}.{tbl}`
        """
        print(f"Querying {tbl} ...")
        result = client.query(sql).result()
        t_counter: Counter[str] = Counter()
        for row in result:
            code = validate(row.npi)
            t_counter[code] += 1
            counter[code] += 1
        by_resource[tbl] = t_counter
        total = sum(t_counter.values())
        print(f"  {tbl}: {total:,}")
        for code, n in t_counter.most_common():
            pct = 100 * n / total if total else 0
            print(f"    {code:<26} {n:>12,}  ({pct:5.2f}%)")

    total_all = sum(counter.values())
    ok = counter["NPI_OK"]
    struct = counter["NPI_INVALID_STRUCTURE"]
    luhn_fail = counter["NPI_LUHN_FAIL"]
    missing = counter["NPI_MISSING"]
    flagged = struct + luhn_fail
    checked = total_all - missing

    print()
    print(f"TOTAL resources          {total_all:>12,}")
    print(f"  with an NPI            {checked:>12,}")
    print(f"  missing an NPI         {missing:>12,}")
    print(f"  OK (struct + Luhn)     {ok:>12,}  ({100*ok/checked:5.4f}%)")
    print(f"  INVALID_STRUCTURE      {struct:>12,}")
    print(f"  LUHN_FAIL              {luhn_fail:>12,}")
    print(f"  flagged total          {flagged:>12,}  ({100*flagged/checked:5.4f}%)")

    headline = (
        f"{100*ok/checked:.4f}% of {checked/1_000_000:.1f}M NDH NPIs pass "
        f"structural + Luhn validation ({flagged:,} failing records: "
        f"{struct:,} structural, {luhn_fail:,} Luhn checksum). "
        f"{missing:,} Practitioner/Organization resources carry no us-npi identifier."
    )

    chart_data = [
        {"label": "OK", "value": ok},
        {"label": "INVALID_STRUCTURE", "value": struct},
        {"label": "LUHN_FAIL", "value": luhn_fail},
        {"label": "MISSING", "value": missing},
    ]

    payload = {
        "slug": "npi-taxonomy-correctness",
        "title": "NPI and taxonomy correctness",
        "hypotheses": ["H9", "H10", "H11", "H12", "H13"],
        "status": "in-progress",  # H9 complete; H10-H13 require NPPES + NUCC joins
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": "0.1.0-draft",
        "commit_sha": "pending",
        "headline": headline,
        "numerator": flagged,
        "denominator": checked,
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": chart_data,
        },
        "notes": (
            f"H9 only — Practitioner: {by_resource['practitioner'].get('NPI_OK', 0):,} OK / "
            f"{by_resource['practitioner'].get('NPI_INVALID_STRUCTURE', 0):,} invalid structure / "
            f"{by_resource['practitioner'].get('NPI_LUHN_FAIL', 0):,} Luhn fail / "
            f"{by_resource['practitioner'].get('NPI_MISSING', 0):,} missing. "
            f"Organization: {by_resource['organization'].get('NPI_OK', 0):,} OK / "
            f"{by_resource['organization'].get('NPI_INVALID_STRUCTURE', 0):,} invalid / "
            f"{by_resource['organization'].get('NPI_LUHN_FAIL', 0):,} Luhn fail / "
            f"{by_resource['organization'].get('NPI_MISSING', 0):,} missing. "
            f"H10 (NPPES existence), H11 (name agreement), H12 (NUCC taxonomy), H13 (specialty agreement) "
            f"pending the NPPES monthly file + NUCC code set joins."
        ),
    }

    out = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "public" / "api" / "v1" / "findings" / "npi-taxonomy-correctness.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    run()
