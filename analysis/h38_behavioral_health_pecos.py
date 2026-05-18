"""H38 — Behavioral-health PECOS taxonomy misalignment (highest-recoupment cohort).

Subset of H37 narrowed to NPPES taxonomy codes in the behavioral-health
provider taxonomy. Behavioral-health wrong-taxonomy is the highest-
recoupment-risk category under the 2026 verification rules because payer
rejection is automatic — not flag-and-investigate — and the rejection
covers the entire window the wrong code was in place.

Method:
    1. Reuse the H37 mismatch logic: PPEF PROVIDER_TYPE -> crosswalk ->
       expected NUCC set; compare to NPPES NUCC set.
    2. Filter to NPIs where NPPES has at least one behavioral-health
       taxonomy code (any of the BEHAVIORAL_HEALTH_PREFIXES below).
    3. Surface per-state.

BEHAVIORAL_HEALTH_PREFIXES is intentionally conservative — only codes
where wrong-taxonomy leads to automatic-denial / recoupment under
typical payer logic. Includes the clinical-billing roles:
    101Y* Counselor (including substance abuse / mental health)
    103T* Psychologist
    1041C* / 1041S* Clinical Social Worker
    106H* Marriage & Family Therapist
    103G* Clinical Neuropsychologist
    103K* Behavior Analyst (and assistant 106E*)

NOT included: org-level codes (251S* community/behavioral health agency,
261QM* mental-health clinic) — those have different billing semantics
and aren't typically subject to provider-level taxonomy-denial logic.

Source: depends on H37 having run (reuses the same PPEF + NPPES +
crosswalk + same Python in-memory dataset).

Writes:
    frontend/public/api/v1/findings/pecos-behavioral-health-taxonomy.json
    frontend/public/api/v1/findings/pecos-behavioral-health-taxonomy-detail.json
    frontend/public/api/v1/findings/pecos-behavioral-health-taxonomy-detail.csv
    frontend/public/api/v1/states/<state>/h38-behavioral-health-pecos-mismatch.csv
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from collections import defaultdict
from datetime import datetime, timezone

from google.cloud import bigquery

# Import the helpers we already wrote for H37 — same data flow.
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from h37_pecos_taxonomy import (  # noqa: E402
    load_crosswalk,
    load_nppes_taxonomies,
    strip_medicare_prefix,
    VALID_US_JURISDICTIONS,
    PROJECT,
    PPEF_CSV,
    FINDINGS_DIR,
    STATES_DIR,
    get_commit_sha,
)

METHODOLOGY_VERSION = "0.7.0-draft"
DATA_SOURCE_RELEASE = "PPEF 2026-04-01 + NPPES + CMS Medicare↔NUCC crosswalk (2025-10)"

# NUCC behavioral-health roots where wrong-taxonomy causes automatic
# denial (not flag-and-investigate) under typical payer logic.
BEHAVIORAL_HEALTH_PREFIXES = (
    "101Y",   # Counselor (mental health, substance use, addiction, etc.)
    "103T",   # Psychologist (all subtypes)
    "103G",   # Clinical Neuropsychologist
    "103K",   # Behavior Analyst
    "1041C",  # Clinical Social Worker
    "1041S",  # School Social Worker
    "106E",   # Assistant Behavior Analyst
    "106H",   # Marriage & Family Therapist
)


def is_behavioral_health(codes: set[str]) -> bool:
    return any(c.startswith(BEHAVIORAL_HEALTH_PREFIXES) for c in codes)


def main() -> None:
    client = bigquery.Client(project=PROJECT)

    print("Loading crosswalk + NPPES taxonomies (same data H37 uses)...")
    crosswalk = load_crosswalk(client)
    nppes = load_nppes_taxonomies(client)

    print(f"\nStreaming {PPEF_CSV.name}...")
    npi_data: dict[str, dict] = {}
    total_rows = 0
    with open(PPEF_CSV, newline="", encoding="latin-1") as fh:
        for row in csv.DictReader(fh):
            total_rows += 1
            npi = (row.get("NPI") or "").strip()
            if not npi or len(npi) != 10:
                continue
            ptype = (row.get("PROVIDER_TYPE_CD") or "").strip()
            state = (row.get("STATE_CD") or "").strip().upper()
            slot = npi_data.setdefault(npi, {
                "states": set(),
                "ptype_cds": set(),
                "ptype_descs": set(),
                "first_name": "",
                "last_name": "",
                "org_name": "",
            })
            slot["states"].add(state)
            if ptype:
                slot["ptype_cds"].add(ptype)
            ptype_desc = (row.get("PROVIDER_TYPE_DESC") or "").strip()
            if ptype_desc:
                slot["ptype_descs"].add(ptype_desc)
            slot["first_name"] = slot["first_name"] or (row.get("FIRST_NAME") or "").strip()
            slot["last_name"] = slot["last_name"] or (row.get("LAST_NAME") or "").strip()
            slot["org_name"] = slot["org_name"] or (row.get("ORG_NAME") or "").strip()

    # Filter to NPIs whose NPPES record carries any behavioral-health code.
    bh_npis = {npi for npi, codes in nppes.items() if is_behavioral_health(codes)}
    print(f"  NPPES NPIs with any behavioral-health code: {len(bh_npis):,}")

    # Apply H37 mismatch logic but only to the BH cohort
    bh_with_pecos = 0
    bh_unresolved_pecos = 0
    matches = 0
    mismatches: list[dict] = []

    for npi in bh_npis:
        slot = npi_data.get(npi)
        if not slot:
            # NPPES BH provider not in PPEF — not Medicare-enrolled, out of scope.
            continue
        resolved_nucc: set[str] = set()
        for cd in slot["ptype_cds"]:
            specialty = strip_medicare_prefix(cd)
            resolved_nucc.update(crosswalk.get(specialty, set()))
        if not resolved_nucc:
            bh_unresolved_pecos += 1
            continue
        bh_with_pecos += 1
        nppes_codes = nppes[npi]
        intersection = resolved_nucc & nppes_codes
        if intersection:
            matches += 1
        else:
            mismatches.append({
                "npi": npi,
                "name": (
                    slot["org_name"] if slot["org_name"] and not slot["last_name"]
                    else f"{slot['last_name']}, {slot['first_name']}".strip(", ")
                ),
                "states": sorted(slot["states"] & VALID_US_JURISDICTIONS),
                "pecos_types": " | ".join(sorted(slot["ptype_descs"])),
                "pecos_codes": ",".join(sorted(slot["ptype_cds"])),
                "pecos_resolved_nucc": ",".join(sorted(resolved_nucc)[:5]) + (
                    f"+{len(resolved_nucc) - 5}" if len(resolved_nucc) > 5 else ""
                ),
                "nppes_nucc": ",".join(sorted(nppes_codes)[:5]) + (
                    f"+{len(nppes_codes) - 5}" if len(nppes_codes) > 5 else ""
                ),
                "bh_codes_on_nppes": ",".join(sorted(c for c in nppes_codes if c.startswith(BEHAVIORAL_HEALTH_PREFIXES))),
            })

    print(f"\nBehavioral-health cohort analysis:")
    print(f"  NPPES BH NPIs:                           {len(bh_npis):>10,}")
    print(f"  ... of which in PPEF (Medicare-enrolled): {bh_with_pecos + bh_unresolved_pecos:>10,}")
    print(f"  ... PECOS specialty in crosswalk:        {bh_with_pecos:>10,}")
    print(f"  ... PECOS specialty NOT in crosswalk:    {bh_unresolved_pecos:>10,}")
    print(f"  ... matching:                            {matches:>10,}")
    print(f"  ... MISMATCHING (denial-risk):           {len(mismatches):>10,}")
    pct = 100 * len(mismatches) / bh_with_pecos if bh_with_pecos else 0
    print(f"  mismatch rate within BH cohort:          {pct:.2f}%")

    # Per-state output
    per_state_rows: dict[str, list[dict]] = defaultdict(list)
    for m in mismatches:
        for st in m["states"]:
            per_state_rows[st].append({
                "npi": m["npi"],
                "name": m["name"],
                "state": st,
                "pecos_provider_type": m["pecos_types"],
                "pecos_codes": m["pecos_codes"],
                "pecos_resolved_nucc": m["pecos_resolved_nucc"],
                "nppes_nucc": m["nppes_nucc"],
                "bh_codes_on_nppes": m["bh_codes_on_nppes"],
                "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{m['npi']}",
            })

    fields = [
        "npi", "name", "state", "pecos_provider_type", "pecos_codes",
        "pecos_resolved_nucc", "nppes_nucc", "bh_codes_on_nppes",
        "nppes_lookup_url",
    ]
    for state, rows in per_state_rows.items():
        state_dir = STATES_DIR / state.lower()
        state_dir.mkdir(parents=True, exist_ok=True)
        with open(state_dir / "h38-behavioral-health-pecos-mismatch.csv", "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in fields})

    # National CSV
    national_csv = FINDINGS_DIR / "pecos-behavioral-health-taxonomy-detail.csv"
    with open(national_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "npi", "name", "states", "pecos_provider_type", "pecos_codes",
            "pecos_resolved_nucc", "nppes_nucc", "bh_codes_on_nppes",
            "nppes_lookup_url",
        ])
        w.writeheader()
        for m in mismatches:
            w.writerow({
                "npi": m["npi"],
                "name": m["name"],
                "states": ",".join(m["states"]),
                "pecos_provider_type": m["pecos_types"],
                "pecos_codes": m["pecos_codes"],
                "pecos_resolved_nucc": m["pecos_resolved_nucc"],
                "nppes_nucc": m["nppes_nucc"],
                "bh_codes_on_nppes": m["bh_codes_on_nppes"],
                "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{m['npi']}",
            })

    state_counts = sorted(
        ({"state": s, "matches": len(rs)} for s, rs in per_state_rows.items()),
        key=lambda d: -d["matches"],
    )
    print("\nTop 10 states by BH mismatch count:")
    for s in state_counts[:10]:
        print(f"  {s['state']:2s}  {s['matches']:>7,}")

    headline = (
        f"{len(mismatches):,} of {bh_with_pecos:,} comparable behavioral-"
        f"health NPIs ({pct:.2f}%) show a PECOS PROVIDER_TYPE that does not "
        f"resolve to any NUCC code on the NPI's NPPES record via the CMS "
        f"Medicare↔NUCC crosswalk. Behavioral-health wrong-taxonomy is the "
        f"highest-recoupment-risk category under the 2026 verification "
        f"rules — payer rejection is automatic, not flag-and-investigate, "
        f"and recoupment covers the entire window the wrong code was in "
        f"place. This subset is the priority cohort for state PI offices "
        f"and behavioral-health group practices to triage. Per-state CSVs "
        f"at /api/v1/states/<state>/h38-behavioral-health-pecos-mismatch.csv."
    )

    payload = {
        "slug": "pecos-behavioral-health-taxonomy",
        "title": "Behavioral-health PECOS taxonomy misalignment (highest-recoupment cohort)",
        "hypotheses": ["H38"],
        "status": "published",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(mismatches),
        "denominator": bh_with_pecos,
        "denominator_note": (
            f"Denominator = {bh_with_pecos:,} NPIs that are (a) Medicare-"
            f"enrolled with a PROVIDER_TYPE_CD in the crosswalk, AND (b) "
            f"carry at least one NUCC behavioral-health code on their NPPES "
            f"record. Behavioral-health codes recognized: prefixes "
            f"{', '.join(BEHAVIORAL_HEALTH_PREFIXES)} (counselor, "
            f"psychologist, clinical neuropsychologist, behavior analyst, "
            f"clinical/school social worker, MFT). Numerator = subset where "
            f"the PECOS-resolved NUCC set has empty intersection with the "
            f"NPPES set."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "Behavioral-health mismatch", "value": len(mismatches)},
                {"label": "Behavioral-health match", "value": matches},
            ],
        },
        "per_state": state_counts[:25],
        "notes": (
            "Behavioral health gets carved out from H37 because the "
            "regulatory consequences are harder. A mental-health counselor "
            "billing E/M codes their NPPES taxonomy doesn't cover, or a "
            "marriage-and-family therapist whose PECOS record was filed "
            "as a general counselor, will trigger automatic claim rejection. "
            "Then recoupment over the multi-year window the wrong code was "
            "in place. The cohort surfaced here is the highest-priority "
            "triage list for behavioral-health group practices doing pre-"
            "emptive PECOS-cleanup audits. State PI offices should treat "
            "this subset as priority within H37 for the SMD-letter Element "
            "4 (other comprehensive measures) submission."
        ),
    }
    out = FINDINGS_DIR / "pecos-behavioral-health-taxonomy.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")

    detail = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "nppes_bh_npis": len(bh_npis),
        "bh_with_pecos_in_crosswalk": bh_with_pecos,
        "bh_with_pecos_outside_crosswalk": bh_unresolved_pecos,
        "matches": matches,
        "mismatches": len(mismatches),
        "mismatch_rate_pct": round(pct, 2),
        "top_states": state_counts[:25],
        "sample_mismatches": mismatches[:20],
        "csv_url_national": "/api/v1/findings/pecos-behavioral-health-taxonomy-detail.csv",
        "csv_url_pattern": "/api/v1/states/<state>/h38-behavioral-health-pecos-mismatch.csv",
    }
    (FINDINGS_DIR / "pecos-behavioral-health-taxonomy-detail.json").write_text(
        json.dumps(detail, indent=2) + "\n"
    )
    print(f"Wrote {FINDINGS_DIR / 'pecos-behavioral-health-taxonomy-detail.json'}")


if __name__ == "__main__":
    main()
