"""H18 — meta.lastUpdated as a freshness signal on NPD bulk files.

First pass measured 100% of resources as "within 30 days" — but the
distinct-value distribution revealed that every resource carries one of
only 1-2 timestamps per resource type, all on the release date.
meta.lastUpdated on the NPD bulk files is a bulk-export stamp, not a
per-resource freshness signal. That IS the finding.

Writes frontend/public/api/v1/findings/temporal-staleness.json.
"""
from __future__ import annotations
import json
import pathlib
from datetime import datetime, timezone
from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE_DATE = "2026-04-09"
RESOURCE_TYPES = ["practitioner", "organization", "location", "endpoint",
                  "practitioner_role", "organization_affiliation"]


def run() -> None:
    client = bigquery.Client(project=PROJECT)

    distinct_per_type: list[dict] = []
    total = 0
    total_on_release_day = 0

    for t in RESOURCE_TYPES:
        sql = f"""
        SELECT
          JSON_EXTRACT_SCALAR(resource, '$.meta.lastUpdated') AS ts,
          COUNT(*) AS n
        FROM `{PROJECT}.{DATASET}.{t}`
        GROUP BY ts
        ORDER BY n DESC
        """
        rows = list(client.query(sql).result())
        distinct_count = len(rows)
        type_total = sum(r.n for r in rows if r.ts is not None)
        on_release_day = sum(r.n for r in rows if r.ts and r.ts.startswith(RELEASE_DATE))
        top_ts = rows[0].ts if rows else None
        top_n = rows[0].n if rows else 0

        total += type_total
        total_on_release_day += on_release_day

        distinct_per_type.append({
            "resource_type": t,
            "total": type_total,
            "distinct_timestamps": distinct_count,
            "modal_timestamp": top_ts,
            "modal_share_pct": round(100 * top_n / type_total, 4) if type_total else 0,
            "on_release_day_pct": round(100 * on_release_day / type_total, 4) if type_total else 0,
        })
        print(
            f"{t:<28} total={type_total:>12,}  distinct={distinct_count:>4}  "
            f"modal={top_n:>12,} ({100*top_n/type_total:.2f}%)  top_ts={top_ts}"
        )

    print()
    release_day_pct = 100 * total_on_release_day / total if total else 0
    print(f"Aggregate: {total_on_release_day:,} / {total:,} ({release_day_pct:.2f}%) on release day")

    max_distinct = max(r["distinct_timestamps"] for r in distinct_per_type)
    headline = (
        f"{release_day_pct:.1f}% of NPD resources carry a meta.lastUpdated "
        f"value on the release day ({RELEASE_DATE}). Distinct meta.lastUpdated "
        f"values range from 1 to {max_distinct} across the {len(RESOURCE_TYPES)} "
        f"resource types — meta.lastUpdated on the NPD bulk public-use files "
        f"is a bulk-export stamp, not a per-resource freshness signal."
    )

    chart_data = [
        {"label": r["resource_type"], "value": r["distinct_timestamps"]}
        for r in distinct_per_type
    ]

    payload = {
        "slug": "temporal-staleness",
        "title": "Temporal staleness",
        "hypotheses": ["H18"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": "0.1.0-draft",
        "commit_sha": "pending",
        "headline": headline,
        "numerator": total_on_release_day,
        "denominator": total,
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": chart_data,
        },
        "notes": (
            f"Per-resource distinct meta.lastUpdated values on release day "
            f"{RELEASE_DATE}: "
            + "; ".join(
                f"{r['resource_type']} → {r['distinct_timestamps']} distinct, "
                f"{r['modal_share_pct']:.2f}% at modal"
                for r in distinct_per_type
            )
            + ". Regulatory compliance with the 30-day CMS-9115-F or 90-day "
              "REAL Health Providers Act / No Surprises Act update cadence "
              "CANNOT be measured from meta.lastUpdated on the bulk files — "
              "a per-record freshness signal from upstream NPPES "
              "(enumeration_date / last_updated) or PECOS would be required."
        ),
    }

    out = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "public" / "api" / "v1" / "findings" / "temporal-staleness.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    run()
