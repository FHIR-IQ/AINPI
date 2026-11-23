"""Humana exhibit for the CMS-4214-P comment (plan 2026-11-03, Task 5).

Reads the per-release facts table (xsource_facts), one Humana payer sample
(payer_sample) and, optionally, the facts table of an earlier release, and
prints counts only. Per-NPI inputs stay under analysis/data/.

What it reports, per field (zip5, phone10):

  * Humana vs the NPD role Location (never the practitioner's own address),
    any-to-any on normalized values, with a 95% Wilson interval on each share.
    Taxonomy has no payer leg: the sample does not read a payer specialty.
  * The three-way pattern across Humana, NPD and NPPES for NPIs where all
    three carry a value. NPD derives from NPPES, so "NPD and NPPES agree" is
    the export copying its upstream, not a second vote.
  * Release-to-release NPD role-Location changes (earlier release -> this
    one) for practitioners in scope in both, classified by whether the values
    NPD dropped are still in the current NPPES file (see `release_change`).

NPIs whose payer search was truncated (paging cap) are excluded from the
comparison and counted, because a cut-off location set can read as a false
disagreement. NPIs whose payer roles referenced Locations the payer did not
return are counted under `locations_missing` by xsource_facts.compare.

Usage (from the repo root, venv with duckdb + pyarrow):

    python3 analysis/exhibit_humana_2026_11.py \\
        --facts analysis/data/xsource/2026-10-07/facts.parquet \\
        --sample analysis/data/payer-sample/humana/<date>-seed<seed>.parquet \\
        [--earlier-facts analysis/data/xsource/2026-08-20/facts.parquet] \\
        [--out analysis/data/xsource/exhibit-humana-2026-11.json]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pyarrow.parquet as pq  # noqa: E402

from payer_sample import to_fact_rows, locations_missing_npis  # noqa: E402
from xsource_facts import (  # noqa: E402
    EL_NPPES_LOC, ROLE_ELEMENT, compare,
)

PAYER = "humana"
LOC_FIELDS = ("zip5", "phone10")
Z95 = 1.959963984540054


def wilson(k: int, n: int, z: float = Z95) -> tuple[float, float] | None:
    """95% Wilson score interval for k successes in n trials; None when n == 0."""
    if n <= 0:
        return None
    if not 0 <= k <= n:
        raise ValueError("need 0 <= k <= n")
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, centre - half), min(1.0, centre + half))


def share(k: int, n: int) -> dict:
    ci = wilson(k, n)
    return {"k": k, "n": n, "share": (k / n) if n else None,
            "ci95": [round(ci[0], 4), round(ci[1], 4)] if ci else None}


THREE_WAY = ("all_three_match", "payer_differs_npd_nppes_match", "npd_differs",
             "nppes_differs", "two_pairs_match", "all_differ")


def three_way(payer: set, npd: set, nppes: set) -> str | None:
    """Pattern across three non-empty value sets, any-to-any per pair.
    None when any side is empty (not a three-way comparison)."""
    if not (payer and npd and nppes):
        return None
    pn, pp, nn = bool(payer & npd), bool(payer & nppes), bool(npd & nppes)
    hits = pn + pp + nn
    if hits == 3:
        return "all_three_match"
    if hits == 0:
        return "all_differ"
    if hits == 2:
        return "two_pairs_match"
    if nn:
        return "payer_differs_npd_nppes_match"
    if pp:
        return "npd_differs"
    return "nppes_differs"


RELEASE_CHANGE = ("unchanged", "dropped_still_in_nppes", "dropped_not_in_nppes",
                  "added_only")


def release_change(earlier: set, later: set, nppes: set) -> str:
    """Classify one practitioner's NPD role-Location values across releases.

    dropped_still_in_nppes: every value NPD dropped is still in the current
    NPPES file, the upstream NPD is built from, so the drop is not explained
    by the provider's own record changing: an export artifact by this test.
    It is a lower bound: NPPES carries one practice location, so a dropped
    secondary role location can never pass it."""
    if earlier == later:
        return "unchanged"
    dropped = earlier - later
    if not dropped:
        return "added_only"
    return "dropped_still_in_nppes" if dropped <= nppes else "dropped_not_in_nppes"


def _index(facts_rows, npis: set | None = None) -> dict[tuple, set]:
    out: dict[tuple, set] = {}
    for r in facts_rows:
        if npis is not None and r["npi"] not in npis:
            continue
        out.setdefault((r["npi"], r["source"], r["fhir_element"], r["field"]),
                       set()).add(r["value_norm"])
    return out


def analyse(facts_rows: list[dict], sample_rows: list[dict],
            earlier_rows: list[dict] | None = None) -> dict:
    statuses = [r["status"] for r in sample_rows]
    listed_rows = [r for r in sample_rows if r["status"] == "listed"]
    truncated = {r["npi"] for r in listed_rows if r.get("truncated")}
    results = {r["npi"]: {"status": r["status"], "zips": set(r["zips"] or ()),
                          "phones": set(r["phones"] or ()),
                          "locations_missing": bool(r.get("locations_missing"))}
               for r in listed_rows if r["npi"] not in truncated}
    compared = set(results)
    payer_rows = to_fact_rows(results, PAYER, "")
    missing = locations_missing_npis(results)
    cmp = compare(facts_rows, compared, payer_rows, locations_missing=missing)

    out: dict = {
        "sample": {
            "queried": len(statuses),
            "listed": statuses.count("listed"),
            "not_listed": statuses.count("not_listed"),
            "lookup_failed": statuses.count("lookup_failed"),
            "listed_share": share(statuses.count("listed"),
                                  len(statuses) - statuses.count("lookup_failed")),
            "excluded_truncated": len(truncated),
            "compared": len(compared),
            "locations_missing": len(missing & compared),
        },
        "fields": {},
    }

    idx = _index(facts_rows, compared)
    pay = {(r["npi"], r["field"]): set() for r in payer_rows}
    for r in payer_rows:
        pay[(r["npi"], r["field"])].add(r["value_norm"])

    for field in LOC_FIELDS:
        c = cmp[field]
        comparable = c["agree"] + c["disagree"]
        base = comparable + c["one_sided"]
        tw = dict.fromkeys(THREE_WAY, 0)
        for npi in compared - missing:
            k = three_way(pay.get((npi, field), set()),
                          idx.get((npi, "npd", ROLE_ELEMENT[field], field), set()),
                          idx.get((npi, "nppes", EL_NPPES_LOC, field), set()))
            if k:
                tw[k] += 1
        n3 = sum(tw.values())
        up = c["by_relation"]["upstream"]
        out["fields"][field] = {
            "agree": c["agree"], "disagree": c["disagree"],
            "one_sided": c["one_sided"], "neither": c["neither"],
            "locations_missing": c["locations_missing"],
            "agree_of_comparable": share(c["agree"], comparable),
            "disagree_of_comparable": share(c["disagree"], comparable),
            "one_sided_of_any_value": share(c["one_sided"], base),
            "by_npd_element": c["by_element"],
            "npd_vs_nppes_upstream": up,
            "three_way": {k: {**share(v, n3)} for k, v in tw.items()},
            "three_way_n": n3,
        }

    if earlier_rows is not None:
        out["release_change"] = release_changes(facts_rows, earlier_rows)
    return out


def release_changes(later_rows: list[dict], earlier_rows: list[dict]) -> dict:
    """NPD role-Location changes for NPIs in scope in both releases.
    NPPES values come from the later facts table (the current NPPES file)."""
    later = _index(later_rows)
    earlier = _index(earlier_rows)
    npis_later = {k[0] for k in later if k[1] == "npd"}
    npis_earlier = {k[0] for k in earlier if k[1] == "npd"}
    both = npis_later & npis_earlier
    res = {"in_scope_both": len(both), "in_scope_earlier_only": len(npis_earlier - both),
           "in_scope_later_only": len(npis_later - both)}
    for field in LOC_FIELDS:
        el = ROLE_ELEMENT[field]
        counts = dict.fromkeys(RELEASE_CHANGE, 0)
        for npi in both:
            counts[release_change(earlier.get((npi, "npd", el, field), set()),
                                  later.get((npi, "npd", el, field), set()),
                                  later.get((npi, "nppes", EL_NPPES_LOC, field), set()))] += 1
        changed = len(both) - counts["unchanged"]
        dropped = counts["dropped_still_in_nppes"] + counts["dropped_not_in_nppes"]
        res[field] = {**counts, "changed": share(changed, len(both)),
                      "dropped_still_in_nppes_of_dropped": share(counts["dropped_still_in_nppes"], dropped),
                      "dropped_still_in_nppes_of_changed": share(counts["dropped_still_in_nppes"], changed)}
    return res


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Humana vs NPD vs NPPES exhibit (counts only).")
    ap.add_argument("--facts", type=Path, required=True)
    ap.add_argument("--sample", type=Path, required=True)
    ap.add_argument("--earlier-facts", type=Path)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)
    cols = ["npi", "source", "fhir_element", "field", "value_norm"]
    facts = pq.read_table(args.facts, columns=cols).to_pylist()
    sample = pq.read_table(args.sample).to_pylist()
    earlier = (pq.read_table(args.earlier_facts, columns=cols).to_pylist()
               if args.earlier_facts else None)
    result = analyse(facts, sample, earlier)
    text = json.dumps(result, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
