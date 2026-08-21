"""State-scoped findings — produces /api/v1/states/<state>.json.

For state Medicaid agencies responding to the CMS State Medicaid Director
letter dated 2026-04-23 on provider revalidation strategies. Re-runs the
cleanly state-filterable subset of the AINPI hypothesis catalog with a
WHERE _state = <STATE> predicate and writes a state-scoped JSON conforming
to the ApiV1StateFindings schema (frontend/src/lib/api-v1-types.ts).

Usage:
    python analysis/state_findings.py va
    python analysis/state_findings.py pa
    python analysis/state_findings.py oh

Requires:
    - Application Default Credentials (`gcloud auth application-default login`)
      OR GCP_SERVICE_ACCOUNT_KEY env var pointing to a JSON key
    - BigQuery jobUser + dataViewer on thematic-fort-453901-t7.cms_npd
    - dataViewer on bigquery-public-data.nppes (for NPPES match)

Computed at state granularity:
    - Resource-type denominators (practitioner, organization, location)
    - H10 NPPES NPI match rate (state practitioners → NPPES npi_raw)
    - H10 NPPES deactivation rate (in NPPES but flagged deactivated)
    - H14/H15 duplicate rate for state organizations (by NPI cardinality)
    - H18 distinct meta.lastUpdated values per resource type, filtered to state
    - Sample NPIs flagged by H10 (5 records the state can hand to PI staff)

Not state-computable (left as not_computable_reason in the JSON):
    - Endpoint liveness (H1-H5): Endpoint resources lack a state field; the
      indirect join via managingOrganization covers ~3% of Endpoints.
    - Referential integrity (H6-H8): graph-level; state filtering of source
      and target sides conflates two distinct populations.
    - Network adequacy gauge (H22): same Endpoint constraint as H1-H5.

The state_pct values come from the NEW state-filtered queries here; the
national_pct values are read from the previously-published national finding
JSONs at frontend/public/api/v1/findings/*.json.

Methodology version: bumped to 0.2.0 with the introduction of state-scoped
findings. See docs/methodology/index.md for the prose.
"""
from __future__ import annotations
import json
import pathlib
import subprocess
import sys
from datetime import datetime, timezone
from google.cloud import bigquery

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
NPPES_DATASET = "bigquery-public-data.nppes"

# Set on first use by nppes_asof(). The public NPPES snapshot is static and
# currently stops well before the NDH release, which turns "absent from NPPES"
# into a statement about our reference copy rather than about the directory.
NPPES_ASOF_LABEL = "unknown"
_NPPES_ASOF: str | None = None


def nppes_asof(client: bigquery.Client) -> str:
    """Newest enumeration date in the NPPES reference copy, cached per run."""
    global _NPPES_ASOF, NPPES_ASOF_LABEL
    if _NPPES_ASOF is None:
        row = next(iter(client.query(
            f"SELECT MAX(provider_enumeration_date) AS d FROM `{NPPES_DATASET}.npi_raw`",
            job_config=bq_job_config()).result()))
        _NPPES_ASOF = str(row.d) if row.d else ""
        NPPES_ASOF_LABEL = _NPPES_ASOF or "unknown"
    return _NPPES_ASOF
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from claims_sources._cohorts import bq_job_config  # noqa: E402
from release import CURRENT_RELEASE as RELEASE_DATE  # noqa: E402
METHODOLOGY_VERSION = "0.2.0"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
NATIONAL_FINDINGS_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
STATE_OUTPUT_DIR = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "states"

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana",
    "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
    # Frontend SEED_STATES still drives which states appear in the /states
    # index navigation; this dict drives which state codes the analysis
    # script will accept. Keep state-page narrative copy + Medicaid-program
    # context only for the state slices we actively brief on.
}



def capped(params=None):
    """QueryJobConfig carrying the project byte cap, plus optional params.

    `_state` is not a cluster key on any table here, so each of these queries
    scans the referenced columns of the whole table. Fifty-one states times
    six queries is the most expensive thing this repo runs, and it ran
    uncapped until 2026-08-21.
    """
    cfg = bq_job_config()
    if params:
        cfg.query_parameters = params
    return cfg


def get_commit_sha() -> str:
    """Best-effort short SHA for provenance. Falls back to 'pending'."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (FileNotFoundError, subprocess.SubprocessError):
        pass
    return "pending"


def load_national_pct(slug: str) -> float | None:
    """Pull the headline percentage from a published national finding JSON.

    Headline strings are free-form across findings, so we infer the headline
    rate from numerator/denominator. Returns None if the finding is not yet
    published or the ratio is undefined.
    """
    p = NATIONAL_FINDINGS_DIR / f"{slug}.json"
    if not p.exists():
        return None
    data = json.loads(p.read_text())
    if data.get("status") != "published":
        return None
    num = data.get("numerator")
    den = data.get("denominator")
    if num is None or den is None or den == 0:
        return None
    return round(100.0 * num / den, 4)


def query_denominators(client: bigquery.Client, state: str) -> dict:
    """Count practitioner / organization / location resources tied to STATE."""
    out = {}
    for resource_type in ("practitioner", "organization", "location"):
        sql = f"""
        SELECT COUNT(*) AS n
        FROM `{PROJECT}.{DATASET}.{resource_type}`
        WHERE _state = @state
        """
        job = client.query(
            sql,
            job_config=capped([bigquery.ScalarQueryParameter("state", "STRING", state)]
            ),
        )
        row = next(iter(job.result()))
        out[resource_type] = int(row.n)
    return out


def query_h10_match(client: bigquery.Client, state: str) -> dict:
    """H10 — NPPES NPI match rate for practitioners with this state's address.

    Matches NDH practitioner._npi to bigquery-public-data.nppes.npi_raw.npi.
    Reports both the in-NPPES count and the deactivated-in-NPPES count.
    """
    sql = f"""
    WITH state_pract AS (
      SELECT _npi
      FROM `{PROJECT}.{DATASET}.practitioner`
      WHERE _state = @state AND _npi IS NOT NULL
    )
    SELECT
      COUNT(*) AS total,
      COUNTIF(nppes.npi IS NOT NULL) AS in_nppes,
      COUNTIF(nppes.npi_deactivation_date IS NOT NULL) AS deactivated_in_nppes
    FROM state_pract sp
    LEFT JOIN `{NPPES_DATASET}.npi_raw` nppes
      ON sp._npi = CAST(nppes.npi AS STRING)
    """
    job = client.query(
        sql,
        job_config=capped([bigquery.ScalarQueryParameter("state", "STRING", state)]
        ),
    )
    row = next(iter(job.result()))
    total = int(row.total)
    in_nppes = int(row.in_nppes)
    deactivated = int(row.deactivated_in_nppes)
    return {
        "total": total,
        "in_nppes": in_nppes,
        "deactivated_in_nppes": deactivated,
        "match_pct": round(100.0 * in_nppes / total, 4) if total else None,
    }


def query_h14_org_dups(client: bigquery.Client, state: str) -> dict:
    """H14/H15 — Organization duplicate rate by NPI for this state.

    NPD has roughly 2x as many Organization resources as unique NPIs at the
    national level. This re-measures that ratio for the state-scoped slice.
    """
    sql = f"""
    SELECT
      COUNT(*) AS total_resources,
      COUNT(DISTINCT _npi) AS unique_npis,
      COUNTIF(_npi IS NULL) AS no_npi
    FROM `{PROJECT}.{DATASET}.organization`
    WHERE _state = @state
    """
    job = client.query(
        sql,
        job_config=capped([bigquery.ScalarQueryParameter("state", "STRING", state)]
        ),
    )
    row = next(iter(job.result()))
    total = int(row.total_resources)
    unique = int(row.unique_npis)
    no_npi = int(row.no_npi)
    excess = total - unique - no_npi
    excess_pct = round(100.0 * excess / total, 4) if total else None
    return {
        "total_resources": total,
        "unique_npis": unique,
        "no_npi": no_npi,
        "excess_resources": excess,
        "excess_pct": excess_pct,
    }


def query_h18_state(client: bigquery.Client, state: str) -> dict:
    """H18 — distinct meta.lastUpdated values per resource for state slice."""
    out = {"per_resource": {}, "total": 0, "on_release_day": 0}
    for resource_type in ("practitioner", "organization", "location"):
        sql = f"""
        SELECT
          JSON_EXTRACT_SCALAR(resource, '$.meta.lastUpdated') AS ts,
          COUNT(*) AS n
        FROM `{PROJECT}.{DATASET}.{resource_type}`
        WHERE _state = @state
        GROUP BY ts
        ORDER BY n DESC
        """
        rows = list(
            client.query(
                sql,
                job_config=capped(
                    [bigquery.ScalarQueryParameter("state", "STRING", state)]
                ),
            ).result()
        )
        type_total = sum(r.n for r in rows if r.ts is not None)
        on_release_day = sum(r.n for r in rows if r.ts and r.ts.startswith(RELEASE_DATE))
        distinct = len(rows)
        out["per_resource"][resource_type] = {
            "total": type_total,
            "distinct_timestamps": distinct,
            "on_release_day": on_release_day,
        }
        out["total"] += type_total
        out["on_release_day"] += on_release_day
    return out


def query_verify_samples(client: bigquery.Client, state: str, limit: int = 5,
                         nppes_stale: bool = False) -> list[dict]:
    """A few concrete NPIs a state analyst can check for themselves.

    These were drawn from practitioners "not present in NPPES" until
    2026-08-21. That is only a defect if the NPPES reference copy is at least
    as current as the release, and it is not: the public snapshot stops at
    2026-02-07 against a 2026-08-20 release. Every NPI sampled from that set
    resolved to a real, active provider enumerated in between.

    The deactivated-in-NPPES set fails the same way in the other direction.
    Three sampled from it were all active in the live registry, having been
    reactivated after the snapshot was taken. So while the reference copy is
    behind, no NPPES-derived signal can carry a verification sample at all.

    The sample therefore comes from the OIG LEIE exclusion file, which this
    project ingests fresh and which is the check 42 CFR 455.436 actually
    requires. An excluded provider still listed as active is a disagreement
    between two current federal sources, and it is the row a state program
    integrity analyst wants anyway.

    A verification sample whose every row checks out fine is worse than no
    sample: it spends an analyst's afternoon and teaches them the list is
    noise.
    """
    sql = f"""
    SELECT
      sp._npi,
      sp._family_name,
      sp._given_name,
      l.EXCLDATE AS excl_date,
      l.EXCLTYPE AS excl_type
    FROM `{PROJECT}.{DATASET}.practitioner` sp
    JOIN (
      -- One row per excluded NPI. A provider carrying two exclusion records
      -- is still one person for an analyst to check; the earliest exclusion
      -- is the one worth showing.
      SELECT NPI, MIN(EXCLDATE) AS EXCLDATE, ANY_VALUE(EXCLTYPE) AS EXCLTYPE
      FROM `{PROJECT}.{DATASET}.oig_leie`
      WHERE NPI IS NOT NULL AND NPI != ''
        AND (REINDATE IS NULL OR REINDATE = '' OR REINDATE = '00000000')
      GROUP BY NPI
    ) l ON l.NPI = sp._npi
    WHERE sp._state = @state
      AND sp._npi IS NOT NULL
    ORDER BY l.EXCLDATE
    LIMIT @lim
    """
    job = client.query(
        sql,
        job_config=capped([
            bigquery.ScalarQueryParameter("state", "STRING", state),
            bigquery.ScalarQueryParameter("lim", "INT64", limit),
        ]),
    )
    out = []
    for r in job.result():
        family = (r._family_name or "").strip()
        given = (r._given_name or "").strip()
        display = f"{family}, {given}".strip(", ")
        raw = (r.excl_date or "").strip()
        pretty = f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}" if len(raw) == 8 else raw
        out.append(
            {
                "npi": r._npi,
                "display_name": display or "(name not in NDH record)",
                "flagged_by": "oig-leie-exclusions",
                "flag_reason": (
                    f"Listed as an active practitioner in the NDH while excluded "
                    f"from federal health care programs by OIG"
                    + (f" since {pretty}" if pretty else "")
                    + f" (exclusion type {r.excl_type})" if r.excl_type else ""
                ),
                "nppes_lookup_url": f"https://npiregistry.cms.hhs.gov/provider-view/{r._npi}",
                "leie_lookup_url": "https://exclusions.oig.hhs.gov/",
            }
        )
    return out


def run_for_state(state_code: str) -> None:
    state = state_code.upper()
    state_name = STATE_NAMES.get(state)
    if not state_name:
        raise SystemExit(
            f"State {state} not registered. Add an entry to STATE_NAMES in this script "
            f"AND to SEED_STATES in frontend/src/data/states.ts before running."
        )

    print(f"\n=== {state_name} ({state}) ===")
    client = bigquery.Client(project=PROJECT)

    print("Querying denominators...")
    denominators = query_denominators(client, state)
    print(f"  practitioner={denominators['practitioner']:,}  "
          f"organization={denominators['organization']:,}  "
          f"location={denominators['location']:,}")

    print("Querying H10 NPPES match...")
    h10 = query_h10_match(client, state)
    print(f"  total={h10['total']:,}  in_nppes={h10['in_nppes']:,} "
          f"({h10['match_pct']}%)  deactivated={h10['deactivated_in_nppes']:,}")

    print("Querying H14/H15 organization duplicates...")
    h14 = query_h14_org_dups(client, state)
    print(f"  resources={h14['total_resources']:,}  unique_npis={h14['unique_npis']:,}  "
          f"excess={h14['excess_resources']:,} ({h14['excess_pct']}%)")

    print("Querying H18 temporal staleness (state slice)...")
    h18 = query_h18_state(client, state)
    print(f"  on_release_day={h18['on_release_day']:,} / {h18['total']:,}")

    print("Pulling verify samples (LEIE-excluded, still listed active)...")
    asof = nppes_asof(client)
    stale = bool(asof) and asof < RELEASE_DATE
    samples = query_verify_samples(client, state, limit=5, nppes_stale=stale)
    print(f"  {len(samples)} samples")

    # Read national context from already-published findings.
    national_npi = load_national_pct("npi-taxonomy-correctness")
    national_dup = load_national_pct("duplicate-detection")
    national_temp = load_national_pct("temporal-staleness")

    # Build state findings rows.
    findings = [
        {
            "slug": "npi-taxonomy-correctness",
            "hypotheses": ["H9", "H10", "H11", "H12", "H13"],
            "title": "NPI and taxonomy correctness",
            "state_computable": True,
            "state_numerator": h10["in_nppes"],
            "state_denominator": h10["total"],
            "state_pct": h10["match_pct"],
            "national_pct": national_npi,
            "state_headline": (
                f"{h10['in_nppes']:,} of {h10['total']:,} {state} practitioner NPIs "
                f"({h10['match_pct']}%) match NPPES; {h10['deactivated_in_nppes']:,} "
                f"are flagged deactivated in NPPES while still active in the federal NDH."
            ),
            "not_computable_reason": None,
        },
        {
            "slug": "duplicate-detection",
            "hypotheses": ["H14", "H15"],
            "title": "Duplicate detection",
            "state_computable": True,
            "state_numerator": h14["excess_resources"],
            "state_denominator": h14["total_resources"],
            "state_pct": h14["excess_pct"],
            "national_pct": national_dup,
            "state_headline": (
                f"{state} has {h14['total_resources']:,} Organization resources "
                f"covering {h14['unique_npis']:,} unique NPIs — "
                f"{h14['excess_resources']:,} excess resources ({h14['excess_pct']}%) "
                f"appear duplicated."
            ),
            "not_computable_reason": None,
        },
        {
            "slug": "temporal-staleness",
            "hypotheses": ["H18"],
            "title": "Temporal staleness",
            "state_computable": True,
            "state_numerator": h18["on_release_day"],
            "state_denominator": h18["total"],
            "state_pct": (
                round(100.0 * h18["on_release_day"] / h18["total"], 4)
                if h18["total"] else None
            ),
            "national_pct": national_temp,
            "state_headline": (
                f"{h18['on_release_day']:,} of {h18['total']:,} {state}-resident "
                f"resources carry a meta.lastUpdated on the {RELEASE_DATE} release "
                f"day. As at the national level, meta.lastUpdated is a release-time "
                f"stamp; state-scoping does not change this finding."
            ),
            "not_computable_reason": None,
        },
        {
            "slug": "endpoint-liveness",
            "hypotheses": ["H1", "H2", "H3", "H4", "H5"],
            "title": "Endpoint liveness",
            "state_computable": False,
            "state_numerator": None,
            "state_denominator": None,
            "state_pct": None,
            "national_pct": load_national_pct("endpoint-liveness"),
            "state_headline": None,
            "not_computable_reason": (
                "FHIR Endpoints in NDH do not carry a state field. State scoping "
                "requires joining Endpoint.managingOrganization to Organization._state. "
                "Approximately 97% of NDH Endpoints have no populated managingOrganization "
                "back-reference (see /findings/referential-integrity), so a state-scoped "
                "endpoint-liveness number would only cover the 3% with a resolvable "
                "back-reference. The national rate is the defensible reference."
            ),
        },
        {
            "slug": "referential-integrity",
            "hypotheses": ["H6", "H7", "H8"],
            "title": "Referential integrity",
            "state_computable": False,
            "state_numerator": None,
            "state_denominator": None,
            "state_pct": None,
            "national_pct": load_national_pct("referential-integrity"),
            "state_headline": None,
            "not_computable_reason": (
                "Cross-resource references in NDH are graph-level. State filtering on "
                "the source side (PractitionerRole.practitioner) is straightforward, but "
                "the target side (Organization, Location) may be in a different state, "
                "so a per-state integrity rate conflates two distinct populations. "
                "The national rate is the defensible reference."
            ),
        },
        {
            "slug": "network-adequacy-gauge",
            "hypotheses": ["H22"],
            "title": "Network adequacy gauge",
            "state_computable": False,
            "state_numerator": None,
            "state_denominator": None,
            "state_pct": None,
            "national_pct": load_national_pct("network-adequacy-gauge"),
            "state_headline": None,
            "not_computable_reason": (
                "Same constraint as endpoint-liveness: FHIR Endpoints lack a state field, "
                "and the indirect join via managingOrganization covers only ~3% of "
                "Endpoints. The 85% Medicare Advantage network-adequacy implied ceiling "
                "is itself a national reference, so a state-scoped recomputation here "
                "would not be meaningful for state Medicaid PR strategy."
            ),
        },
    ]

    payload = {
        "state": state,
        "state_name": state_name,
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "denominators": denominators,
        "findings": findings,
        "verify_samples": samples,
        "notes": (
            f"State-scoped re-run of cleanly state-filterable AINPI findings against the "
            f"{RELEASE_DATE} NPD release. NPI/taxonomy correctness here measures only H10 "
            f"(NPPES match); the full H11/H13 specialty-agreement re-run requires the "
            f"CMS Medicare/NUCC crosswalk and is scheduled for a methodology v0.3 update. "
            f"Verify samples are five {state}-resident NPIs not present in NPPES — the "
            f"actionable cohort the state PI team can revalidate first."
        ),
    }

    STATE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out = STATE_OUTPUT_DIR / f"{state.lower()}.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(
            "Usage: python analysis/state_findings.py <state>\n"
            "  e.g. python analysis/state_findings.py va\n"
            f"  Registered states: {', '.join(sorted(STATE_NAMES.keys()))}"
        )
    for state_arg in sys.argv[1:]:
        run_for_state(state_arg)
