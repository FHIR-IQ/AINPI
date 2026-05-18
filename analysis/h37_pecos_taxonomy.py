"""H37 — PECOS PROVIDER_TYPE vs NPPES NUCC taxonomy disagreement.

CMS designated PECOS as the authoritative source for Medicare enrollment
under the 2026 verification rules. State Medicaid systems must demonstrate
alignment. AINPI cross-references each NPI's PECOS PROVIDER_TYPE_CD
(from the Public Provider Enrollment Extract) against its NPPES NUCC
taxonomy via the CMS Medicare ↔ NUCC crosswalk (same crosswalk H10-H13
use).

Method:
    1. Stream PPEF locally. Build NPI -> set of PECOS PROVIDER_TYPE_CDs.
    2. Strip the "14-" prefix (and similar) to get bare Medicare specialty
       codes; map each through the BQ crosswalk to a set of valid NUCC codes.
    3. Query NPPES for each NPI's taxonomy codes (15 slots).
    4. For each NPI: PECOS PROVIDER_TYPE resolves to a set of expected NUCC
       codes; NPPES carries another set. Mismatch when the intersection is
       empty AND both sides are non-empty.

The crosswalk is many-to-many in both directions: a CMS code can map to
multiple NUCC codes (e.g. "11" Internal Medicine → all IM sub-specialties)
and a NUCC code can map to multiple CMS codes. So the check is:
  "does the PECOS-resolved NUCC set intersect the NPPES-registered set?"
Empty intersection = the provider is enrolled to bill services the NPPES
record does not register them for.

Source files:
    frontend/data/cms-claims/PPEF_Enrollment_Extract_2026.04.01.csv
    bigquery-public-data.nppes.npi_optimized
    cms_npd.medicare_taxonomy_crosswalk (loaded by analysis/h10_h13_with_crosswalk.py)

Writes:
    frontend/public/api/v1/findings/pecos-taxonomy-disagreement.json
    frontend/public/api/v1/findings/pecos-taxonomy-disagreement-detail.json
    frontend/public/api/v1/findings/pecos-taxonomy-disagreement-detail.csv
    frontend/public/api/v1/states/<state>/h37-pecos-taxonomy-mismatch.csv
"""
from __future__ import annotations
import csv
import json
import pathlib
import subprocess
from collections import defaultdict
from datetime import datetime, timezone

from google.cloud import bigquery

METHODOLOGY_VERSION = "0.7.0-draft"
DATA_SOURCE_RELEASE = "PPEF 2026-04-01 + NPPES + CMS Medicare↔NUCC crosswalk (2025-10)"
PROJECT = "thematic-fort-453901-t7"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
PPEF_CSV = REPO_ROOT / "frontend" / "data" / "cms-claims" / "PPEF_Enrollment_Extract_2026.04.01.csv"
FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
STATES_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states"

VALID_US_JURISDICTIONS = frozenset({
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY", "DC", "PR", "VI", "GU", "MP", "AS",
})


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


def strip_medicare_prefix(code: str) -> str:
    """PPEF PROVIDER_TYPE_CD is '<group>-<specialty>'. Crosswalk uses bare specialty."""
    code = (code or "").strip()
    if "-" in code:
        return code.split("-", 1)[1]
    return code


def load_crosswalk(client: bigquery.Client) -> dict[str, set[str]]:
    """Return {medicare_specialty_code -> set(nucc_taxonomy_code)}."""
    sql = f"""
    SELECT medicare_specialty_code, nucc_taxonomy_code
    FROM `{PROJECT}.cms_npd.medicare_taxonomy_crosswalk`
    WHERE medicare_specialty_code IS NOT NULL
      AND nucc_taxonomy_code IS NOT NULL
    """
    out: dict[str, set[str]] = defaultdict(set)
    for row in client.query(sql).result():
        out[row.medicare_specialty_code.strip()].add(row.nucc_taxonomy_code.strip())
    print(f"Crosswalk: {len(out):,} CMS specialty codes → NUCC sets")
    return dict(out)


def load_nppes_taxonomies(client: bigquery.Client) -> dict[str, set[str]]:
    """Return {npi -> set(nucc_taxonomy_code)} pulled from NPPES.

    NPPES carries up to 15 taxonomy slots per NPI. We collapse all
    non-empty slots into a set; the mismatch check is "does PECOS-resolved
    NUCC intersect the NPPES set?" — we don't care about primary vs
    secondary for the disagreement signal.
    """
    cols = ", ".join(
        f"healthcare_provider_taxonomy_code_{i}" for i in range(1, 16)
    )
    sql = f"""
    SELECT npi, {cols}
    FROM `bigquery-public-data.nppes.npi_optimized`
    WHERE npi IS NOT NULL
    """
    out: dict[str, set[str]] = {}
    n_rows = 0
    for row in client.query(sql).result():
        codes = set()
        for i in range(1, 16):
            val = getattr(row, f"healthcare_provider_taxonomy_code_{i}", None)
            if val and val.strip():
                codes.add(val.strip())
        if codes:
            out[row.npi] = codes
        n_rows += 1
    print(f"NPPES: {n_rows:,} rows scanned, {len(out):,} with ≥1 taxonomy code")
    return out


def main() -> None:
    client = bigquery.Client(project=PROJECT)

    print("Loading crosswalk + NPPES taxonomies from BQ...")
    crosswalk = load_crosswalk(client)
    nppes = load_nppes_taxonomies(client)

    print(f"\nStreaming {PPEF_CSV.name}...")
    # NPI -> {state, name, set of provider_type_cds, set of resolved NUCCs from crosswalk}
    npi_data: dict[str, dict] = {}
    total_rows = 0
    with open(PPEF_CSV, newline="", encoding="latin-1") as fh:
        for row in csv.DictReader(fh):
            total_rows += 1
            npi = (row.get("NPI") or "").strip()
            if not npi or len(npi) != 10:
                continue
            ptype = (row.get("PROVIDER_TYPE_CD") or "").strip()
            specialty = strip_medicare_prefix(ptype)
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
    print(f"  total PPEF rows: {total_rows:,}")
    print(f"  distinct NPIs:   {len(npi_data):,}")

    # Classify each NPI
    pecos_with_nppes = 0
    no_pecos_specialty_in_crosswalk = 0
    npi_no_nppes_record = 0
    nppes_no_taxonomy = 0
    matches = 0
    mismatches: list[dict] = []

    for npi, slot in npi_data.items():
        # PECOS resolved NUCC set: union over all the NPI's PROVIDER_TYPE_CDs
        resolved_nucc: set[str] = set()
        unresolvable_codes: list[str] = []
        for cd in slot["ptype_cds"]:
            specialty = strip_medicare_prefix(cd)
            if specialty in crosswalk:
                resolved_nucc.update(crosswalk[specialty])
            else:
                unresolvable_codes.append(cd)
        if not resolved_nucc:
            # PECOS specialty doesn't map through the crosswalk at all.
            # Common for non-clinical PROVIDER_TYPEs (e.g., Part B SUPPLIER -
            # CLINIC/GROUP PRACTICE which is org-level, not NUCC-mapped).
            no_pecos_specialty_in_crosswalk += 1
            continue

        nppes_codes = nppes.get(npi)
        if nppes_codes is None:
            npi_no_nppes_record += 1
            continue
        if not nppes_codes:
            nppes_no_taxonomy += 1
            continue
        pecos_with_nppes += 1

        intersection = resolved_nucc & nppes_codes
        if intersection:
            matches += 1
        else:
            # Real mismatch: PECOS enrolled NUCC set != NPPES registered set.
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
            })

    print(f"\nClassification of {len(npi_data):,} PPEF NPIs:")
    print(f"  PECOS specialty not in crosswalk:    {no_pecos_specialty_in_crosswalk:>10,}  (org-level / non-NUCC types)")
    print(f"  NPI not in NPPES:                    {npi_no_nppes_record:>10,}")
    print(f"  NPPES has no taxonomy codes:         {nppes_no_taxonomy:>10,}")
    print(f"  Comparable (PECOS-resolved × NPPES): {pecos_with_nppes:>10,}")
    print(f"    of which match (intersect non-empty): {matches:>10,}")
    print(f"    of which MISMATCH:                    {len(mismatches):>10,}")
    pct = 100 * len(mismatches) / pecos_with_nppes if pecos_with_nppes else 0
    print(f"    mismatch rate:                        {pct:.2f}%")

    # Per-state output. A mismatched NPI appears in every state it's enrolled in.
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
                "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{m['npi']}",
            })

    fields = [
        "npi", "name", "state", "pecos_provider_type", "pecos_codes",
        "pecos_resolved_nucc", "nppes_nucc", "nppes_lookup_url",
    ]
    for state, rows in per_state_rows.items():
        state_dir = STATES_DIR / state.lower()
        state_dir.mkdir(parents=True, exist_ok=True)
        with open(state_dir / "h37-pecos-taxonomy-mismatch.csv", "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in fields})

    # National CSV
    national_csv = FINDINGS_DIR / "pecos-taxonomy-disagreement-detail.csv"
    with open(national_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "npi", "name", "states", "pecos_provider_type", "pecos_codes",
            "pecos_resolved_nucc", "nppes_nucc", "nppes_lookup_url",
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
                "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{m['npi']}",
            })

    state_counts = sorted(
        ({"state": s, "matches": len(rs)} for s, rs in per_state_rows.items()),
        key=lambda d: -d["matches"],
    )
    print("\nTop 10 states by mismatch count:")
    for s in state_counts[:10]:
        print(f"  {s['state']:2s}  {s['matches']:>7,}")

    headline = (
        f"{len(mismatches):,} of {pecos_with_nppes:,} comparable PPEF-NPPES "
        f"pairs ({pct:.2f}%) show a PECOS PROVIDER_TYPE that doesn't resolve "
        f"to any NUCC code on the NPI's NPPES record, via the CMS Medicare-"
        f"NUCC crosswalk. Under CMS's 2026 verification rules (PECOS "
        f"designated as authoritative for Medicare enrollment), this is the "
        f"regulatorily significant signal: the provider is Medicare-enrolled "
        f"to bill services their NPPES record does not register them for. "
        f"Per-state CSVs at /api/v1/states/<state>/h37-pecos-taxonomy-"
        f"mismatch.csv. The mismatch CSV lists PECOS code(s), resolved-NUCC "
        f"set, and NPPES-registered NUCC set for every flagged NPI — provider "
        f"verification + CMS-855 refile is the fix."
    )

    payload = {
        "slug": "pecos-taxonomy-disagreement",
        "title": "PECOS PROVIDER_TYPE vs NPPES NUCC taxonomy disagreement",
        "hypotheses": ["H37"],
        "status": "published",
        "release_date": DATA_SOURCE_RELEASE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": len(mismatches),
        "denominator": pecos_with_nppes,
        "denominator_note": (
            f"Denominator = {pecos_with_nppes:,} NPIs that are (a) in PPEF "
            f"with at least one PROVIDER_TYPE_CD that maps through the CMS "
            f"Medicare↔NUCC crosswalk, AND (b) have at least one NUCC "
            f"taxonomy code on their NPPES record. Numerator = NPIs where "
            f"the PECOS-resolved NUCC set has empty intersection with the "
            f"NPPES-registered NUCC set. Filter exclusions: "
            f"{no_pecos_specialty_in_crosswalk:,} PPEF NPIs have only "
            f"org-level / non-NUCC PROVIDER_TYPE codes (e.g., Part B SUPPLIER "
            f"- CLINIC/GROUP PRACTICE); {npi_no_nppes_record:,} have no "
            f"NPPES record; {nppes_no_taxonomy:,} have NPPES but no taxonomy "
            f"codes — none of these can be compared and are excluded from "
            f"both numerator and denominator."
        ),
        "data_source_release": DATA_SOURCE_RELEASE,
        "data_source_url": "https://data.cms.gov/provider-characteristics/medicare-provider-supplier-enrollment/medicare-fee-for-service-public-provider-enrollment",
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "PECOS-NPPES mismatch", "value": len(mismatches)},
                {"label": "PECOS-NPPES match", "value": matches},
            ],
        },
        "per_state": state_counts[:25],
        "notes": (
            "The crosswalk is many-to-many: a CMS specialty code can map to "
            "multiple NUCC codes (e.g., Internal Medicine spans all IM sub-"
            "specialties), and a NUCC code can map to multiple CMS codes. "
            "The mismatch test is 'does the PECOS-resolved NUCC set intersect "
            "the NPPES set?' — empty intersection is the signal. This is "
            "intentionally permissive: a NPI enrolled for Internal Medicine "
            "in PECOS but registered as Family Practice in NPPES will register "
            "as a match if the crosswalks share any sub-specialty. The "
            "mismatch headline is the conservative count. Per-row detail "
            "(pecos_resolved_nucc + nppes_nucc columns) shows exactly which "
            "code sets are in disagreement for each flagged NPI; CMS-855B/I "
            "refile is the fix. Under the 2026 verification rules, every "
            "mismatch is a denial-risk flag — behavioral-health especially "
            "(see H38 for the subset)."
        ),
    }
    out = FINDINGS_DIR / "pecos-taxonomy-disagreement.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")

    detail = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total_ppef_rows": total_rows,
        "distinct_npis_in_ppef": len(npi_data),
        "no_pecos_specialty_in_crosswalk": no_pecos_specialty_in_crosswalk,
        "npi_not_in_nppes": npi_no_nppes_record,
        "nppes_no_taxonomy": nppes_no_taxonomy,
        "comparable_pairs": pecos_with_nppes,
        "matches": matches,
        "mismatches": len(mismatches),
        "mismatch_rate_pct": round(pct, 2),
        "top_states": state_counts[:25],
        "sample_mismatches": mismatches[:20],
        "csv_url_national": "/api/v1/findings/pecos-taxonomy-disagreement-detail.csv",
        "csv_url_pattern": "/api/v1/states/<state>/h37-pecos-taxonomy-mismatch.csv",
    }
    (FINDINGS_DIR / "pecos-taxonomy-disagreement-detail.json").write_text(
        json.dumps(detail, indent=2) + "\n"
    )
    print(f"Wrote {FINDINGS_DIR / 'pecos-taxonomy-disagreement-detail.json'}")


if __name__ == "__main__":
    main()
