"""Credential-to-taxonomy disagreement, from a CMS-side report.

WHAT THIS IS, AND WHAT IT IS NOT

This is **exploratory**, not a finding. It was not pre-registered: the CMS NDH
team published the aggregate and this analysis followed. Every published AINPI
finding registers its hypothesis before the numbers exist, and calling a
post-hoc analysis a finding would spend the credibility that discipline buys.
It lives under /api/v1/exploratory/ for that reason.

WHAT IT DOES

The source is a CMS aggregate of NPPES credential text against chosen taxonomy
code, one row per (credential, taxonomy) with a provider count. This script
separates rows that are genuinely a provider choosing the wrong code from rows
that are artifacts of how the question was asked. Three artifact classes, all
verified against the NUCC file rather than asserted:

1. NUCC files three specialties under "Allopathic & Osteopathic Physicians"
   whose certifying boards credential non-physicians: Oral & Maxillofacial
   Surgery (ABOMS certifies dentists), Medical Genetics (ABMGG certifies PhD
   laboratory geneticists) and Radiological Physics (ABR certifies PhD medical
   physicists). Any filter defined on the grouping sweeps these up.

2. Three credential abbreviations are expanded wrongly in the source. The
   evidence is concentration: a wrong expansion has no reason to cluster on one
   specialty. AA and CAA sit on anesthesiology, CSFA on surgery.

3. Everything else, which is the real signal.

Run:
    python3 analysis/explore_credential_taxonomy.py --input <csv> [--out <json>]
"""
from __future__ import annotations

import argparse
import collections
import csv
import importlib.util
import io
import json
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
OUT = REPO / "frontend/public/api/v1/exploratory/credential-taxonomy-mismatch.json"

# NUCC groups these under Allopathic & Osteopathic Physicians, but the boards
# that certify them credential non-physicians. Asserted here, checked below.
NON_MD_PHYSICIAN_CODES = {
    "204E00000X": ("Oral & Maxillofacial Surgery", "ABOMS certifies dentists (DDS/DMD)"),
    "207SG0203X": ("Clinical Molecular Genetics", "ABMGG certifies PhD laboratory geneticists"),
    "207SC0300X": ("Clinical Cytogenetics", "ABMGG certifies PhD laboratory geneticists"),
    "207SG0202X": ("Clinical Biochemical Genetics", "ABMGG certifies PhD laboratory geneticists"),
    "207SG0205X": ("PhD Medical Genetics", "ABMGG certifies PhD laboratory geneticists"),
    "207SG0207X": ("Medical Biochemical Genetics", "ABMGG certifies PhD laboratory geneticists"),
    "2085R0205X": ("Radiological Physics", "ABR certifies PhD medical physicists"),
}
DENTAL_CREDENTIALS = {"DDS", "DMD", "MSD", "BDS", "MS", "PHD", "MPH", "MBA", "MD"}
LAB_CREDENTIALS = {"PHD", "MS", "MBA"}

# Expansion in the source file -> what the abbreviation actually is. Each is
# corroborated by the concentration check, not by assertion alone.
MISDECODED = {
    "AA": ("Associate of Arts", "Anesthesiologist Assistant", "ANESTHESIOLOG"),
    "CAA": ("Certified Audiologist Assistant", "Certified Anesthesiologist Assistant", "ANESTHESIOLOG"),
    "CSFA": ("Certified School Food Administrator", "Certified Surgical First Assistant", "SURG"),
}


def read_rows(path: pathlib.Path) -> list[dict]:
    """Read the source CSV.

    The file carries TWO UTF-8 BOMs. `utf-8-sig` strips one, so a naive read
    leaves a BOM glued to the first column name and silently loses that column.
    """
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig").lstrip("﻿")
    return list(csv.DictReader(io.StringIO(text)))


def load_nucc() -> dict:
    spec = importlib.util.spec_from_file_location("nucc", REPO / "analysis/nucc_taxonomy.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.load_taxonomy()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args()

    rows = read_rows(pathlib.Path(a.input))
    count = lambda r: int(r["providerCount"])  # noqa: E731
    total = sum(map(count, rows))

    # Verify the grouping claim rather than asserting it. If NUCC ever moves one
    # of these out of the physician grouping, the carve-out stops being needed
    # and this should say so instead of silently carving anyway.
    nucc = load_nucc()
    grouping_checked = {}
    for code, (label, why) in NON_MD_PHYSICIAN_CODES.items():
        row = nucc.get(code)
        grouping_checked[code] = {
            "classification": label,
            "why_not_an_error": why,
            "nucc_grouping": (row or {}).get("grouping"),
            "in_physician_grouping": bool(row and "Physicians" in (row.get("grouping") or "")),
        }

    dental = sum(count(r) for r in rows
                 if r["chosenTaxonomyCode"] == "204E00000X"
                 and r["facetCredentialCode"] in DENTAL_CREDENTIALS)
    lab_codes = set(NON_MD_PHYSICIAN_CODES) - {"204E00000X"}
    lab = sum(count(r) for r in rows
              if r["chosenTaxonomyCode"] in lab_codes
              and r["facetCredentialCode"] in LAB_CREDENTIALS)

    misdecoded = []
    misdecoded_total = 0
    for code, (says, actually, marker) in MISDECODED.items():
        sub = [r for r in rows if r["facetCredentialCode"] == code]
        if not sub:
            continue
        n = sum(map(count, sub))
        on_marker = sum(count(r) for r in sub if marker in r["chosenTaxonomyDescription"])
        misdecoded_total += n
        misdecoded.append({
            "code": code,
            "source_expansion": says,
            "actual_expansion": actually,
            "providers": n,
            "concentration": round(on_marker / n, 4),
            "concentrated_on": marker,
        })

    by_cred = collections.Counter()
    by_tax = collections.Counter()
    for r in rows:
        by_cred[r["facetCredentialCode"]] += count(r)
        by_tax[r["chosenTaxonomyDescription"]] += count(r)

    explained = dental + lab + misdecoded_total
    payload = {
        "status": "exploratory",
        "not_preregistered": (
            "The CMS NDH team published the aggregate and this analysis followed. "
            "AINPI findings register a hypothesis before the numbers exist; this "
            "did not, so it is published as exploratory rather than as a finding."
        ),
        "source": {
            "file": "NonPhysicianUsingPhysicianTaxonomy.csv",
            "provenance": "CMS National Directory of Healthcare team",
            "reference_data": "NUCC taxonomy 26.1",
        },
        "totals": {
            "rows": len(rows),
            "providers": total,
            "distinct_credentials": len(by_cred),
            "distinct_taxonomies": len(by_tax),
        },
        "artifacts": {
            "non_md_physician_grouping": {
                "providers": dental + lab,
                "dental_omfs": dental,
                "phd_laboratory_and_physics": lab,
                "codes": grouping_checked,
            },
            "misdecoded_credentials": {
                "providers": misdecoded_total,
                "detail": misdecoded,
                "method": (
                    "A wrong expansion has no reason to cluster on one specialty. "
                    "Concentration is the evidence, not the expansion itself."
                ),
            },
            "explained_total": explained,
            "explained_share": round(explained / total, 4),
        },
        "remainder": {
            "providers": total - explained,
            "share": round(1 - explained / total, 4),
        },
        "top_credentials": [{"code": k, "providers": v} for k, v in by_cred.most_common(20)],
        "top_chosen_taxonomies": [{"description": k, "providers": v} for k, v in by_tax.most_common(20)],
    }

    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {out.relative_to(REPO)}")
    print(f"  {total:,} providers, {explained:,} explained ({explained/total:.1%}), "
          f"{total-explained:,} remainder")
    for c in grouping_checked.values():
        if not c["in_physician_grouping"]:
            print(f"  NOTE: {c['classification']} is no longer in the physician grouping; "
                  "the carve-out may be unnecessary")


if __name__ == "__main__":
    main()
