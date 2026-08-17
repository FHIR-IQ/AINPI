"""H54 - what the role gap is actually made of.

H52 established the role gap: 73% of active NDH practitioners carry no
`PractitionerRole`, so the directory states no organization for them and no
endpoint path exists at any confidence. Every coverage percentage this project
publishes divides by that population. Nobody had checked what is in it.

**The registered prior was that the denominator is padded with NPIs that hold
no patient record, and it is not supported.** Pennsylvania does contain 9,804
NPIs whose NPPES taxonomy is "Student in an Organized Health Care
Education/Training Program", 12,995 pharmacy providers, 1,384 aides and
technicians and 21 transport NPIs, but the categories that are not an
independently practising clinician total 5.2% of the active set. Removing them
moves the coverage number by about a point. That is not the explanation.

What the composition does show is sharper. Role coverage is not uniform across
the professions and does not vary a little; it varies by two orders of
magnitude, and it tracks Medicare billing rather than clinical practice:

    advanced practice    27,392 / 35,175    77.9%
    physicians           39,811 / 57,020    69.8%
    rehab and therapy     6,235 / 31,753    19.6%
    behavioral health     6,526 / 44,162    14.8%
    dental                  442 /  9,451     4.7%
    nursing                 242 /  9,034     2.7%
    pharmacy                  1 / 12,995     0.0%

The professions that bill Medicare carry a `PractitionerRole`. The professions
that bill Medicaid, commercial plans or cash mostly do not. That is a coherent
account of the whole gap, and it predicts the H54 companion result: adding CMS
enrollment data closed only 1.9% of the gap, because Medicare-enrolled
clinicians are already the ones with roles.

The consequence for anyone using the directory: an endpoint-coverage number is
really a statement about Medicare-billing specialties, and the NDH publishes
no field that says so. A consumer cannot tell a specialty with genuinely no
digital presence from one the directory simply does not describe.

**No category is asserted to be unable to hold a record.** That would bake an
opinion into a denominator. Categories are NUCC groupings, which are a lookup;
what each category actually reaches is measured, not assumed.

Three sources, one capped BigQuery scan each:
    NDH practitioner + practitioner_role   who is active, and who has a role
    NPPES npi_raw                          the taxonomy, for every NPI
    NUCC taxonomy release                  code -> grouping (analysis/nucc_taxonomy.py)

Plus, when it has been generated, the CMS enrollment crosswalk from
`analysis/ingest_pecos_affiliations.py`, so the "organization from any source"
line accounts for the Medicare-enrollment path too.

Cost: two capped BigQuery queries. The NPPES scan is not state-filtered on
purpose. BigQuery bills for the columns read, not the rows returned, so a
`WHERE state = 'PA'` costs exactly the same as no filter and loses every
practitioner whose NPPES practice address is recorded out of state (6,383 in
Pennsylvania alone).

Usage:
    python analysis/h54_role_gap_composition.py pa
    python analysis/h54_role_gap_composition.py pa va oh

Outputs:
    frontend/public/api/v1/findings/role-gap-composition.json
    frontend/public/api/v1/findings/role-gap-composition-<state>.csv
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from analysis.claims_sources._cohorts import bq_job_config  # noqa: E402
from analysis.nucc_taxonomy import (  # noqa: E402
    categorize,
    load_taxonomy,
    primary_taxonomy,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE = "2026-05-08"
METHODOLOGY = "0.7.2-draft"

_TAX_COLS = ", ".join(f"n.healthcare_provider_taxonomy_code_{i}"
                      for i in range(1, 16))
_SW_COLS = ", ".join(f"n.healthcare_provider_primary_taxonomy_switch_{i}"
                     for i in range(1, 16))

# One query per state, joined server-side. The first version pulled all 9M
# NPPES rows to the client and joined locally: same bytes billed, but row
# iteration over the REST API made it minutes-long for a result of 227,727
# rows. The join belongs where the data is.
#
# NPPES is not state-filtered inside the join on purpose. BigQuery bills for
# the columns read rather than the rows returned, so a state predicate saves
# nothing and would drop every practitioner whose NPPES practice address is
# recorded out of state (6,383 in Pennsylvania alone).
PRACTITIONER_SQL = f"""
WITH prac AS (
  SELECT _id AS pid, _npi AS npi
  FROM `{PROJECT}.{DATASET}.practitioner`
  WHERE _active AND _state = @state AND _npi IS NOT NULL
),
roles AS (
  SELECT DISTINCT _practitioner_id AS pref
  FROM `{PROJECT}.{DATASET}.practitioner_role`
  WHERE _active
),
base AS (
  SELECT p.npi, MAX(IF(r.pref IS NULL, 0, 1)) AS has_role
  FROM prac p
  LEFT JOIN roles r ON r.pref = CONCAT('Practitioner/', p.pid)
  GROUP BY p.npi
)
SELECT
  b.npi,
  b.has_role,
  n.npi IS NOT NULL              AS in_nppes,
  n.entity_type_code             AS entity_type_code,
  n.npi_deactivation_date        AS npi_deactivation_date,
  {_TAX_COLS},
  {_SW_COLS}
FROM base b
LEFT JOIN `bigquery-public-data.nppes.npi_raw` n ON n.npi = b.npi
"""


def run_query(client, sql, state=None):
    from google.cloud import bigquery
    config = bq_job_config()
    if state:
        config.query_parameters = [
            bigquery.ScalarQueryParameter("state", "STRING", state.upper())
        ]
    job = client.query(sql, job_config=config)
    rows = list(job.result())
    return rows, job.total_bytes_processed


def load_pecos(state):
    """NPIs with a CMS-enrollment organization, if the crosswalk exists."""
    path = OUT_DIR / f"pecos-org-crosswalk-{state.lower()}.csv"
    if not path.exists():
        return set(), False
    with path.open() as fh:
        return {r["npi"] for r in csv.DictReader(fh)}, True


def pct(n, d):
    return round(100.0 * n / d, 1) if d else 0.0


def _commit_sha():
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT,
                              capture_output=True, text=True,
                              check=True).stdout.strip()
    except Exception:
        return "pending"


def build_state(state, prac_rows, taxonomy, pecos_npis, pecos_present):
    ndh = {r["npi"]: bool(r["has_role"]) for r in prac_rows}
    total = len(ndh)
    with_role = sum(ndh.values())
    with_pecos_only = {n for n, has in ndh.items() if not has and n in pecos_npis}
    affiliated = with_role + len(with_pecos_only)

    per_npi = {}
    for r in prac_rows:
        if not r["in_nppes"]:
            per_npi[r["npi"]] = ("not-in-nppes", None, False, None)
            continue
        codes = [r[f"healthcare_provider_taxonomy_code_{i}"] for i in range(1, 16)]
        switches = [r[f"healthcare_provider_primary_taxonomy_switch_{i}"]
                    for i in range(1, 16)]
        code, is_primary = primary_taxonomy(codes, switches)
        per_npi[r["npi"]] = (categorize(code, taxonomy), code, is_primary,
                             bool(r["npi_deactivation_date"]))

    rows = []
    by_cat = collections.defaultdict(
        lambda: {"total": 0, "with_role": 0, "pecos_only": 0, "none": 0,
                 "deactivated": 0})
    for npi, has_role in ndh.items():
        cat, code, is_primary, deact = per_npi[npi]
        bucket = by_cat[cat]
        bucket["total"] += 1
        if has_role:
            bucket["with_role"] += 1
        elif npi in with_pecos_only:
            bucket["pecos_only"] += 1
        else:
            bucket["none"] += 1
        if deact:
            bucket["deactivated"] += 1
        # `grouping` and `classification` are deliberately not written: they
        # are a lookup from `taxonomy_code` against a public code set, and
        # repeating them per row costs 13 MB of the 24 MB file for one state.
        # The category is kept because it is this project's own mapping and a
        # reader cannot derive it from anywhere else.
        rows.append({
            "npi": npi,
            "category": cat,
            "taxonomy_code": code or "",
            "primary_switch": "Y" if is_primary else "",
            "nppes_deactivated": "Y" if deact else "",
            "ndh_role": "Y" if has_role else "",
            "cms_enrollment_org": "Y" if npi in pecos_npis else "",
        })

    ordered = sorted(by_cat.items(), key=lambda kv: -kv[1]["total"])
    unaffiliated = total - affiliated
    deactivated = sum(b["deactivated"] for b in by_cat.values())

    # Role coverage per profession, which is the actual finding. Restricted to
    # categories large enough for a rate to mean anything: a 2-of-3 category
    # would otherwise top the ranking at 67%.
    MIN_FOR_RATE = 1000
    rates = sorted(
        ((c, b["with_role"], b["total"], pct(b["with_role"], b["total"]))
         for c, b in by_cat.items()
         if b["total"] >= MIN_FOR_RATE and c not in ("not-in-nppes",
                                                     "no-taxonomy",
                                                     "unknown-code")),
        key=lambda t: -t[3])

    # Categories whose NPIs are, by NUCC definition, not an independently
    # practising clinician holding a patient record. Named explicitly and kept
    # short so a reader can disagree with the list rather than with a formula.
    NON_CLINICAL = ("student", "support", "transport", "supplier", "agency",
                    "facility", "payer", "group")
    non_clinical = sum(b["total"] for c, b in by_cat.items() if c in NON_CLINICAL)
    non_clinical_unaff = sum(
        b["none"] for c, b in by_cat.items() if c in NON_CLINICAL)

    return {
        "state": state.upper(),
        "active_practitioners": total,
        "with_ndh_role": with_role,
        "with_ndh_role_pct": pct(with_role, total),
        "with_cms_enrollment_org_only": len(with_pecos_only),
        "affiliated_any_source": affiliated,
        "affiliated_any_source_pct": pct(affiliated, total),
        "no_organization_any_source": unaffiliated,
        "cms_enrollment_crosswalk_present": pecos_present,
        "nppes_matched": sum(1 for v in per_npi.values() if v[0] != "not-in-nppes"),
        "nppes_deactivated_but_ndh_active": deactivated,
        "non_clinical_categories": list(NON_CLINICAL),
        "non_clinical_npis": non_clinical,
        "non_clinical_npis_pct": pct(non_clinical, total),
        "non_clinical_unaffiliated": non_clinical_unaff,
        "unaffiliated_excluding_non_clinical": unaffiliated - non_clinical_unaff,
        "clinical_denominator": total - non_clinical,
        "affiliated_pct_of_clinical_denominator":
            pct(affiliated - sum(b["with_role"] + b["pecos_only"]
                                 for c, b in by_cat.items() if c in NON_CLINICAL),
                total - non_clinical),
        "role_coverage_min_category_size": MIN_FOR_RATE,
        "role_coverage_by_category": [
            {"category": c, "with_role": n, "total": d, "pct": p}
            for c, n, d, p in rates],
        "role_coverage_spread": {
            "highest": {"category": rates[0][0], "pct": rates[0][3]} if rates else None,
            "lowest": {"category": rates[-1][0], "pct": rates[-1][3]} if rates else None,
        },
        "by_category": [
            {"category": c, **b,
             "unaffiliated_pct_of_category": pct(b["none"], b["total"])}
            for c, b in ordered
        ],
    }, rows


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("states", nargs="*", default=["pa"])
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    args = ap.parse_args()

    from google.cloud import bigquery
    client = bigquery.Client(project=PROJECT)

    print("Loading NUCC taxonomy")
    taxonomy = load_taxonomy()
    print(f"  {len(taxonomy):,} codes, release "
          f"{next(iter(taxonomy.values()))['version']}")

    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    results = []

    for state in args.states:
        print(f"\nScanning NDH and NPPES for {state.upper()}")
        prac_rows, prac_bytes = run_query(client, PRACTITIONER_SQL, state)
        print(f"  {len(prac_rows):,} active practitioners, "
              f"{prac_bytes / 1e9:.2f} GB scanned")
        pecos_npis, pecos_present = load_pecos(state)
        if not pecos_present:
            print("  no CMS enrollment crosswalk; run "
                  "analysis/ingest_pecos_affiliations.py to add that path")

        summary, rows = build_state(state, prac_rows, taxonomy,
                                    pecos_npis, pecos_present)
        results.append(summary)

        csv_path = out_dir / f"role-gap-composition-{state.lower()}.csv"
        with csv_path.open("w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(sorted(rows, key=lambda r: r["npi"]))
        print(f"  wrote {csv_path}")

        print(f"  {summary['active_practitioners']:,} active | "
              f"role {summary['with_ndh_role_pct']}% | "
              f"+CMS enrollment {summary['affiliated_any_source_pct']}% | "
              f"no organization {summary['no_organization_any_source']:,}")
        print(f"  {'category':<20}{'total':>10}{'role':>10}"
              f"{'cms only':>10}{'none':>10}")
        for c in summary["by_category"]:
            print(f"  {c['category']:<20}{c['total']:>10,}{c['with_role']:>10,}"
                  f"{c['pecos_only']:>10,}{c['none']:>10,}")

    lead = results[0]
    rates = lead["role_coverage_by_category"]
    top, bottom = rates[0], rates[-1]
    headline = (
        f"NDH role coverage tracks Medicare billing, not clinical practice: "
        f"{top['pct']}% of {lead['state']} {top['category'].replace('-', ' ')} "
        f"providers carry a PractitionerRole against {bottom['pct']}% of "
        f"{bottom['category'].replace('-', ' ')} providers "
        f"({bottom['with_role']:,} of {bottom['total']:,})."
    )
    payload = {
        "slug": "role-gap-composition",
        "title": "What the role gap is made of",
        "hypotheses": ["H54"],
        "status": "published",
        "release_date": RELEASE,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "methodology_version": METHODOLOGY,
        "commit_sha": _commit_sha(),
        "headline": headline,
        "numerator": bottom["with_role"],
        "denominator": bottom["total"],
        "chart": {
            "type": "bar",
            "unit": "percent",
            "data": [{"label": c["category"].replace("-", " "), "value": c["pct"]}
                     for c in rates],
        },
        "notes": (
            "The registered prior was that the role gap is mostly NPIs that "
            "hold no patient record. It is not supported: categories that are "
            "not an independently practising clinician total "
            f"{lead['non_clinical_npis']:,} of "
            f"{lead['active_practitioners']:,} "
            f"({lead['non_clinical_npis_pct']}%), so removing them moves "
            "coverage by about a point. The measured signal is the spread "
            "between professions instead. Categories are NUCC groupings mapped "
            "one-to-one, which is a lookup rather than a judgement about any "
            "provider; no category is asserted to be incapable of holding a "
            "record. Rates are shown only for categories of at least "
            f"{lead['role_coverage_min_category_size']:,} NPIs, because a "
            "three-member category would otherwise top the ranking. NPPES is "
            "joined unfiltered because BigQuery bills for columns read rather "
            "than rows returned, so a state predicate costs the same and drops "
            "practitioners whose NPPES practice address is out of state. "
            "Per-NPI detail ships as role-gap-composition-<state>.csv."
        ),
        "states": {r["state"]: r for r in results},
    }
    out_path = out_dir / "role-gap-composition.json"
    out_path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out_path}")
    print(f"\n{headline}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
