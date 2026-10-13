"""The NDH measure series, first slice: build /api/v1/measures.json from the repo.

A measure is a named quantity with a fixed definition and one point per CMS
release (design: docs/superpowers/specs/2026-09-12-ndh-measure-series-design.md).
This first slice computes nothing. It reads values that are already committed:

  analysis/release-snapshots/<release>.json      shape captured before a reload
  analysis/release-snapshots/published/*.json    as-published finding payloads
                                                 from earlier releases, copied
                                                 verbatim from git history
  frontend/public/api/v1/role-gap-delta.json
  frontend/public/api/v1/findings/*.json         the current release

No BigQuery, no network, no git. Running it twice on the same tree gives the
same series.

Rules the generator enforces rather than trusts:

  * A point's release is read from the source file itself (`release_date`,
    `release`, or `from`/`to`), never assumed from which source was consulted.
    A source whose release is not in the series is not a point.
  * A release with no source is omitted and the reason recorded. No point is
    ever interpolated, carried forward, or taken from prose.
  * A ratio needs a positive denominator. A missing or zero denominator is an
    omission, never a zero.
  * A zero numerator needs a positive control that proves the field being
    counted was present. Without one the point is omitted: a zero in a series
    looks like a collapse, not like an error.
  * Two sources for one release are allowed only when one is declared a
    restatement; the difference is published, not resolved silently.
  * `definition_version` changes only at a declared break. The pair across a
    break is `comparable: false` unless the break says otherwise.
  * Every measure declares, before looking at the numbers, the move per
    release it would consider ordinary. A larger move with no break and no
    review is `comparable: "unreviewed"`: the point publishes, the line waits.

Deviation from the design, deliberate for this slice: the design derives
`definition_version` from a hash of each measure's SQL text. There is no SQL
here yet, so versions are declared by hand at each break, and `definition_hash`
hashes the declared definition text instead. Moving the hash onto the SQL is
the BigQuery measure pass in docs/superpowers/plans/2026-10-13-ndh-measure-series.md.

Run from the repo root:  python3 analysis/measures.py
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_PATH = pathlib.Path("frontend/public/api/v1/measures.json")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from release import KNOWN_RELEASES  # noqa: E402

# The series starts at 2026-05-08. The 2026-04-09 export is an archive
# artifact, not a published point (design: "The series starts at 2026-05-08
# and runs forward").
SERIES_START = "2026-05-08"
SERIES_START_REASON = (
    "The 2026-04-09 export is held as an archive artifact rather than a "
    "published point, per the measure-series design."
)

FINDINGS = "frontend/public/api/v1/findings"
SNAPSHOTS = "analysis/release-snapshots"
PUBLISHED = "analysis/release-snapshots/published"


class SourceUnavailable(Exception):
    """A source cannot yield a point. The message becomes the omission reason."""


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Raw:
    """What an extractor returns: one release's numbers from one file."""
    release: str
    numerator: Optional[float]
    denominator: Optional[float]
    field: str
    commit: Optional[str] = None
    zero_control: Optional[str] = None


@dataclass(frozen=True)
class Source:
    path: str
    extract: Callable[[dict], list]
    definition_version: int = 1
    # A restatement source supplies an as-published value for a release that
    # another source covers. It never becomes the point itself.
    restatement_of: Optional[str] = None
    restatement_reason: Optional[str] = None
    # Commit a vendored file was copied from (the filename carries it too).
    vendored_from: Optional[str] = None


@dataclass(frozen=True)
class Definition:
    version: int
    numerator: str
    denominator: str
    note: str = ""


@dataclass(frozen=True)
class Break:
    at: str
    from_version: int
    to_version: int
    reason: str
    comparable_across_break: bool = False


@dataclass(frozen=True)
class Review:
    """A human decision that a move beyond the declared prior is real."""
    at: str
    reason: str


@dataclass(frozen=True)
class Measure:
    slug: str
    question: str
    unit: str                      # "ratio" or "count"
    source: str
    hypotheses: tuple
    definitions: tuple
    sources: tuple
    ordinary_move: dict            # {"kind": "absolute"|"relative", "max": float, "why": str}
    breaks: tuple = ()
    reviews: tuple = ()
    omission_reasons: dict = field(default_factory=dict)
    notes: str = ""


# --------------------------------------------------------------------------
# Extractors. Each reads one parsed JSON document and returns Raw points.
# --------------------------------------------------------------------------

def _require(doc: dict, *keys):
    cur = doc
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            raise SourceUnavailable(f"field {'.'.join(keys)} absent")
        cur = cur[k]
    return cur


def finding_ratio(doc: dict) -> list:
    """The `numerator` / `denominator` pair a finding publishes."""
    return [Raw(
        release=_require(doc, "release_date"),
        numerator=doc.get("numerator"),
        denominator=doc.get("denominator"),
        field="numerator / denominator",
        commit=doc.get("commit_sha"),
    )]


def snapshot_fhir_rest(doc: dict) -> list:
    """FHIR REST endpoints out of all Endpoint rows, from a release snapshot."""
    kinds = _require(doc, "shape", "endpoint_connection_types")
    rows = _require(doc, "tables", "endpoint", "rows")
    total = sum(k["n"] for k in kinds)
    if total != rows:
        raise SourceUnavailable(
            f"connection types sum to {total}, endpoint table holds {rows}")
    fhir = [k["n"] for k in kinds if k["kind"] == "hl7-fhir-rest"]
    if not fhir:
        raise SourceUnavailable("no hl7-fhir-rest row in the snapshot")
    return [Raw(_require(doc, "release"), fhir[0], rows,
                "shape.endpoint_connection_types[hl7-fhir-rest].n / tables.endpoint.rows")]


def snapshot_coded_org_type(doc: dict) -> list:
    """Organizations whose type is a coding, out of all Organization rows.

    Snapshot kinds prefixed `text:` carry free text where a coding belongs;
    a null kind carries no type at all. Both count against the measure.
    """
    kinds = _require(doc, "shape", "organization_types")
    rows = _require(doc, "tables", "organization", "rows")
    total = sum(k["n"] for k in kinds)
    if total != rows:
        raise SourceUnavailable(
            f"organization types sum to {total}, organization table holds {rows}")
    coded = sum(k["n"] for k in kinds
                if k["kind"] is not None and not str(k["kind"]).startswith("text:"))
    return [Raw(_require(doc, "release"), coded, rows,
                "shape.organization_types[coded].n / tables.organization.rows")]


def role_gap_delta_pa(doc: dict) -> list:
    """Both releases of PA role coverage from role-gap-delta.json."""
    if doc.get("state") != "PA":
        raise SourceUnavailable(f"role-gap-delta state is {doc.get('state')!r}, not PA")
    out = []
    for side, rel_key in (("before", "from"), ("after", "to")):
        o = _require(doc, "overall", side)
        out.append(Raw(_require(doc, rel_key), o.get("with_role"), o.get("active"),
                       f"overall.{side}.with_role / overall.{side}.active"))
    return out


def npi_validity_summary(doc: dict) -> list:
    """H9's sidecar, which survives the H10-H13 overwrite of the shared slug."""
    return [Raw(_require(doc, "release_date"), doc.get("npis_flagged"),
                doc.get("npis_checked"), "npis_flagged / npis_checked")]


def h9_from_shared_slug(doc: dict) -> list:
    """H9 as it stood in npi-taxonomy-correctness.json before H10-H13 replaced it.

    Guarded on the headline because the same slug later carries H13 pair
    counts in the same two fields.
    """
    headline = doc.get("headline", "")
    if "Luhn" not in headline:
        raise SourceUnavailable("shared slug no longer carries H9 counts")
    return finding_ratio(doc)


def ssn_with_control(doc: dict) -> list:
    """H27 count, with the container-field control the source asserts.

    The control (Practitioner resources still carrying `qualification`) is
    stated in the finding's notes and is not yet a structured field. The
    generator checks that the assertion is present rather than taking it on
    trust; making it a field is a follow-up in h27_pii_exposure.py.
    """
    [raw] = finding_ratio(doc)
    notes = doc.get("notes", "")
    control = None
    marker = "still carry the qualification array"
    if marker in notes:
        sentence = next((s.strip() for s in notes.split(". ") if marker in s), marker)
        control = f"asserted in source notes, not yet a structured field: {sentence}"
    return [Raw(raw.release, raw.numerator, raw.denominator, raw.field,
                raw.commit, zero_control=control)]


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------

_PP = "percentage points"

REGISTRY: tuple = (
    Measure(
        slug="role-coverage-pa",
        question="What share of active Pennsylvania practitioners carry a PractitionerRole?",
        unit="ratio",
        source="NDH bulk export joined to NPPES taxonomy (H54)",
        hypotheses=("H54",),
        definitions=(Definition(
            1,
            "active PA practitioners with at least one PractitionerRole",
            "active Practitioner resources with a PA address"),),
        sources=(Source("frontend/public/api/v1/role-gap-delta.json", role_gap_delta_pa),),
        ordinary_move={"kind": "absolute", "max": 0.05,
                       "why": "Coverage had not moved more than a few points between releases before 2026-08-20."},
        reviews=(Review("2026-08-20",
                        "PractitionerRole more than doubled in this release (3,952,445 to 10,806,327 active). "
                        "Coverage reads no specialty code, so the vocabulary change cannot touch it; "
                        "the rise is the directory adding roles, most of them to practitioners who already had one."),),
        notes="National role coverage is not yet a measure: no committed file carries its numerator for either release.",
    ),
    Measure(
        slug="fhir-rest-endpoint-share",
        question="What share of Endpoint resources are FHIR REST endpoints software can query?",
        unit="ratio",
        source="NDH bulk export",
        hypotheses=("H28",),
        definitions=(Definition(
            1,
            "Endpoint rows whose connectionType code is hl7-fhir-rest",
            "all Endpoint rows in the export"),),
        sources=(Source(f"{SNAPSHOTS}/2026-05-08.json", snapshot_fhir_rest),
                 Source(f"{SNAPSHOTS}/2026-08-20.json", snapshot_fhir_rest)),
        ordinary_move={"kind": "absolute", "max": 0.03,
                       "why": "The FHIR REST subset is a small, slow-moving share of a large Direct-address population."},
        notes="The denominator is rows, not distinct endpoints. April repeated each endpoint about four times; "
              "May and August are close to one row per address.",
    ),
    Measure(
        slug="endpoint-org-linkage",
        question="What share of FHIR REST endpoints resolve to a managing organization?",
        unit="ratio",
        source="NDH bulk export (H50)",
        hypotheses=("H50",),
        definitions=(Definition(
            1,
            "FHIR REST endpoints whose managingOrganization reference resolves to an Organization in the export",
            "Endpoint resources with connectionType hl7-fhir-rest"),),
        sources=(Source(f"{PUBLISHED}/endpoint-org-linkage@f8a18ab.json", finding_ratio, vendored_from="f8a18ab"),
                 Source(f"{FINDINGS}/endpoint-org-linkage.json", finding_ratio)),
        ordinary_move={"kind": "absolute", "max": 0.05,
                       "why": "Attribution depends on CMS populating one reference; a move over five points would be a change in how the export is built."},
    ),
    Measure(
        slug="vendor-filled-attribution",
        question="Of the FHIR REST endpoints the NDH cannot attribute, what share do public EHR vendor files name?",
        unit="ratio",
        source="NDH bulk export plus eight public vendor endpoint files fetched at run time (H51)",
        hypotheses=("H51",),
        definitions=(Definition(
            1,
            "unattributed FHIR REST endpoints whose base URL a vendor file maps to an organization",
            "FHIR REST endpoints with no resolvable managingOrganization"),),
        sources=(Source(f"{PUBLISHED}/vendor-endpoint-attribution@0f8f39d.json", finding_ratio, vendored_from="0f8f39d"),
                 Source(f"{FINDINGS}/vendor-endpoint-attribution.json", finding_ratio)),
        ordinary_move={"kind": "absolute", "max": 0.05,
                       "why": "Both inputs change: the NDH by release and the vendor files whenever vendors republish."},
        notes="This measure has two clocks. The vendor files are fetched when the script runs, not when CMS "
              "releases, so a move can come from either side.",
    ),
    Measure(
        slug="payer-directory-endpoints",
        question="What share of FHIR REST endpoints are payer provider directories?",
        unit="ratio",
        source="NDH bulk export (H49)",
        hypotheses=("H49",),
        definitions=(Definition(
            1,
            "FHIR REST endpoints identified as a payer provider directory",
            "Endpoint resources with connectionType hl7-fhir-rest"),),
        sources=(Source(f"{PUBLISHED}/ndh-payer-endpoint-coverage@c39b178.json", finding_ratio, vendored_from="c39b178"),
                 Source(f"{FINDINGS}/ndh-payer-endpoint-coverage.json", finding_ratio)),
        ordinary_move={"kind": "absolute", "max": 0.01,
                       "why": "Payer directories are a handful of endpoints in a population of about 110,000."},
        notes="Payer organizations with an endpoint is not yet a measure: the 2026-05-08 release had no payer "
              "organization type, and the 2026-08-20 count of payer organizations carrying an endpoint is stated "
              "only in prose.",
    ),
    Measure(
        slug="ssn-exposures",
        question="How many Practitioner resources expose a Social Security Number?",
        unit="count",
        source="NDH bulk export (H27)",
        hypotheses=("H27",),
        definitions=(Definition(
            1,
            "Practitioner resources whose JSON matches the dashed SSN pattern after false-positive filtering",
            "Practitioner resources scanned",
            "Undashed nine-digit values are out of scope; they collide with EINs and account identifiers."),),
        sources=(Source(f"{PUBLISHED}/pii-exposure-ndh@c34fe94.json", ssn_with_control, vendored_from="c34fe94"),
                 Source(f"{FINDINGS}/pii-exposure-ndh.json", ssn_with_control)),
        ordinary_move={"kind": "relative", "max": 0.5,
                       "why": "A count this small moves in large proportions on any change."},
        reviews=(Review("2026-08-20",
                        "Remediation, not an empty query: the source records that 7,371,126 of 7,373,232 "
                        "Practitioner resources still carry the qualification array the exposures were found in."),),
    ),
    Measure(
        slug="npi-validation-failures",
        question="What share of NPIs in the export fail structural or check-digit validation?",
        unit="ratio",
        source="NDH bulk export (H9)",
        hypotheses=("H9",),
        definitions=(Definition(
            1,
            "NPIs that are not ten digits or fail the Luhn check digit",
            "NPIs carried on Practitioner and Organization resources"),),
        sources=(Source(f"{PUBLISHED}/npi-taxonomy-correctness@3fe0500.json", h9_from_shared_slug, vendored_from="3fe0500"),
                 Source(f"{FINDINGS}/npi-validity-summary.json", npi_validity_summary)),
        ordinary_move={"kind": "absolute", "max": 0.001,
                       "why": "CMS validates NPIs at enumeration; failures are a few records in ten million."},
    ),
    Measure(
        slug="role-specialty-agreement",
        question="Do Practitioner.qualification and PractitionerRole.specialty agree?",
        unit="ratio",
        source="NDH bulk export (H13)",
        hypotheses=("H13",),
        definitions=(
            Definition(1,
                       "Practitioner-to-Role pairs whose Role specialty (CMS Medicare code) maps to the "
                       "qualification NUCC code through the CMS Medicare-to-NUCC crosswalk",
                       "Practitioner-to-Role pairs where both carry a specialty"),
            Definition(2,
                       "Practitioner-to-Role pairs where any Role specialty NUCC code equals any qualification NUCC code",
                       "Practitioner-to-Role pairs where both carry a specialty",
                       "Reads every entry of both repeating elements."),
        ),
        sources=(Source(f"{PUBLISHED}/npi-taxonomy-correctness@c34fe94.json", finding_ratio,
                        definition_version=1, vendored_from="c34fe94"),
                 Source(f"{FINDINGS}/npi-taxonomy-correctness.json", finding_ratio, definition_version=2),
                 Source(f"{PUBLISHED}/npi-taxonomy-correctness@be51fe6.json", finding_ratio,
                        definition_version=2, vendored_from="be51fe6",
                        restatement_of="2026-08-20",
                        restatement_reason="First published reading only the first entry of each repeating "
                                           "specialty element; restated on 2026-08-28 (e029518) to read every entry.")),
        ordinary_move={"kind": "absolute", "max": 0.05,
                       "why": "Agreement between two fields of the same record should be stable."},
        breaks=(Break("2026-08-20", 1, 2,
                      "PractitionerRole.specialty moved from CMS Medicare codes to NUCC taxonomy codes, so "
                      "definition 1 measured a lossy Medicare-to-NUCC crosswalk rather than disagreement. "
                      "Definition 2 compares NUCC to NUCC.",
                      comparable_across_break=False),),
    ),
    Measure(
        slug="practitioner-phone-reachability",
        question="What share of active practitioners can be associated with a phone number through FHIR?",
        unit="ratio",
        source="NDH bulk export (H43)",
        hypotheses=("H43",),
        definitions=(Definition(
            1,
            "active practitioners with a phone on Practitioner.telecom, PractitionerRole.telecom or a referenced Location.telecom",
            "active Practitioner resources"),),
        sources=(Source(f"{PUBLISHED}/practitioner-phone-reachability@c34fe94.json", finding_ratio, vendored_from="c34fe94"),
                 Source(f"{FINDINGS}/practitioner-phone-reachability.json", finding_ratio)),
        ordinary_move={"kind": "absolute", "max": 0.01,
                       "why": "Coverage sits near 100% on the Practitioner record alone."},
    ),
    Measure(
        slug="organization-coded-type",
        question="What share of Organization resources carry a coded type rather than free text or nothing?",
        unit="ratio",
        source="NDH bulk export",
        hypotheses=(),
        definitions=(Definition(
            1,
            "Organization rows whose type carries a coding (prov, team, govt, pay and any later code)",
            "all Organization rows in the export",
            "Tax-entity (ein) and network (ntwk) records carry the type as text and count against the measure."),),
        sources=(Source(f"{SNAPSHOTS}/2026-05-08.json", snapshot_coded_org_type),
                 Source(f"{SNAPSHOTS}/2026-08-20.json", snapshot_coded_org_type)),
        ordinary_move={"kind": "absolute", "max": 0.05,
                       "why": "Organization typing is a property of how CMS builds the export and was not expected to move."},
    ),
)

# Candidates considered for this slice and left out, with the reason. These
# are published so a reader can see what the series does not yet cover.
EXCLUDED_CANDIDATES: tuple = (
    {"slug": "role-coverage-national",
     "reason": "No committed file carries the national count of practitioners with a role for either release; "
               "only rounded percentages appear, in prose. Needs the BigQuery measure pass."},
    {"slug": "organization-partof-resolvability",
     "reason": "2026-05-08 appears only in prose. 2026-08-20 appears in primer-scoreboard.json as a percentage "
               "plus a prose detail string, with no numerator or denominator field."},
    {"slug": "payer-organizations-with-endpoint",
     "reason": "The 2026-05-08 release had no payer organization type, so its denominator does not exist; the "
               "2026-08-20 numerator is stated only in prose."},
    {"slug": "location-phone-coverage",
     "reason": "ndh-column-coverage.json carries a rounded percentage and a row count but no numerator, and "
               "covers 2026-08-20 only. A count back-computed from a rounded percentage would be invented."},
)


# --------------------------------------------------------------------------
# Generator
# --------------------------------------------------------------------------

def series_releases(known=KNOWN_RELEASES, start=SERIES_START) -> list:
    return sorted(r for r in known if r >= start)


def definition_hash(measure: Measure, d: Definition) -> str:
    text = json.dumps({"slug": measure.slug, "question": measure.question, "unit": measure.unit,
                       "numerator": d.numerator, "denominator": d.denominator},
                      sort_keys=True)
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def _value(measure: Measure, num, den):
    return num if measure.unit == "count" else num / den


def _validate(measure: Measure, raw: Raw) -> Optional[str]:
    """Reason this raw value cannot be a point, or None if it can."""
    num, den = raw.numerator, raw.denominator
    if not isinstance(num, (int, float)) or isinstance(num, bool):
        return f"{raw.field}: numerator missing"
    if not isinstance(den, (int, float)) or isinstance(den, bool) or den <= 0:
        return f"{raw.field}: denominator missing or not positive"
    if num < 0 or (measure.unit == "ratio" and num > den):
        return f"{raw.field}: numerator {num} outside 0..{den}"
    if num == 0 and not raw.zero_control:
        return f"{raw.field}: zero with no positive control proving the field was read"
    return None


def _comparability(measure: Measure, prev: dict, cur: dict):
    """True, False or 'unreviewed' for the pair (prev, cur); plus the reason."""
    for b in measure.breaks:
        if b.at == cur["release"]:
            return b.comparable_across_break, f"definition break: {b.reason}"
    if prev["definition_version"] != cur["definition_version"]:
        raise ValueError(f"{measure.slug}: definition_version changes at {cur['release']} with no declared break")
    om = measure.ordinary_move
    if om["kind"] == "absolute":
        move = abs(cur["value"] - prev["value"])
    else:
        base = abs(prev["value"])
        move = abs(cur["value"] - prev["value"]) / base if base else float("inf")
    if move <= om["max"]:
        return True, None
    for r in measure.reviews:
        if r.at == cur["release"]:
            return True, f"reviewed: {r.reason}"
    return "unreviewed", (f"moved {move:.4g} against a declared ordinary move of {om['max']} "
                          f"({om['kind']}); not yet reviewed")


def build_measure(measure: Measure, root: pathlib.Path, releases: list) -> dict:
    points: dict = {}
    restatements: dict = {}
    omitted: dict = {}
    versions = {d.version for d in measure.definitions}

    for src in measure.sources:
        if src.definition_version not in versions:
            raise ValueError(f"{measure.slug}: source {src.path} names undeclared definition {src.definition_version}")
        path = root / src.path
        if not path.exists():
            omitted.setdefault("*", []).append(f"source file missing: {src.path}")
            continue
        try:
            raws = src.extract(json.loads(path.read_text()))
        except SourceUnavailable as e:
            omitted.setdefault("*", []).append(f"{src.path}: {e}")
            continue
        for raw in raws:
            if raw.release not in releases:
                continue
            reason = _validate(measure, raw)
            if reason:
                omitted.setdefault(raw.release, []).append(f"{src.path}: {reason}")
                continue
            entry = {
                "release": raw.release,
                "value": _value(measure, raw.numerator, raw.denominator),
                "numerator": raw.numerator,
                "denominator": raw.denominator,
                "definition_version": src.definition_version,
                "source": {"file": src.path, "field": raw.field,
                           "commit": src.vendored_from or raw.commit,
                           "vendored": src.vendored_from is not None},
            }
            if raw.zero_control:
                entry["zero_control"] = raw.zero_control
            if src.restatement_of:
                if raw.release != src.restatement_of:
                    raise ValueError(f"{measure.slug}: restatement source {src.path} carries {raw.release}, "
                                     f"declared for {src.restatement_of}")
                entry["reason"] = src.restatement_reason
                restatements.setdefault(raw.release, []).append(entry)
                continue
            if raw.release in points:
                raise ValueError(f"{measure.slug}: two sources for {raw.release} and neither is a restatement")
            points[raw.release] = entry

    series = []
    omissions = []
    for rel in releases:
        if rel in points:
            p = points[rel]
            for r in restatements.get(rel, []):
                if (r["numerator"], r["denominator"]) != (p["numerator"], p["denominator"]):
                    p.setdefault("restatements", []).append({
                        "as_published_value": r["value"],
                        "as_published_numerator": r["numerator"],
                        "as_published_denominator": r["denominator"],
                        "source": r["source"],
                        "reason": r["reason"],
                    })
            series.append(p)
        else:
            reasons = omitted.get(rel, []) + omitted.get("*", [])
            declared = measure.omission_reasons.get(rel)
            if declared:
                reasons = [declared] + reasons
            omissions.append({"release": rel,
                              "reason": "; ".join(reasons) or "no source in the repo carries this release"})

    for prev, cur in zip(series, series[1:]):
        comp, why = _comparability(measure, prev, cur)
        cur["comparable_to_previous"] = comp
        if why:
            cur["comparability_reason"] = why
    if series:
        series[0]["comparable_to_previous"] = None

    for b in measure.breaks:
        if b.at not in releases:
            raise ValueError(f"{measure.slug}: break at {b.at} is outside the series")

    return {
        "slug": measure.slug,
        "question": measure.question,
        "unit": measure.unit,
        "source": measure.source,
        "hypotheses": list(measure.hypotheses),
        "time_axis": "ndh-release",
        "definition_version": max(versions),
        "definitions": [{"version": d.version, "numerator": d.numerator, "denominator": d.denominator,
                         "note": d.note or None, "definition_hash": definition_hash(measure, d)}
                        for d in measure.definitions],
        "ordinary_move": dict(measure.ordinary_move),
        "breaks": [{"at": b.at, "from_version": b.from_version, "to_version": b.to_version,
                    "reason": b.reason, "comparable_across_break": b.comparable_across_break}
                   for b in measure.breaks],
        "series": series,
        "omitted": omissions,
        "notes": measure.notes or None,
    }


def build(registry=REGISTRY, root: pathlib.Path = REPO_ROOT, releases: Optional[list] = None,
          excluded=EXCLUDED_CANDIDATES, generated_at: Optional[str] = None) -> dict:
    releases = releases or series_releases()
    slugs = [m.slug for m in registry]
    if len(slugs) != len(set(slugs)):
        raise ValueError("duplicate measure slug")
    return {
        "generated_at": generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generator": "analysis/measures.py",
        "time_axis": "ndh-release",
        "releases": releases,
        "series_start": SERIES_START,
        "series_start_reason": SERIES_START_REASON,
        "note": ("As-published values from committed files, not recomputed. A point's comparable_to_previous "
                 "is true, false (a definition break) or \"unreviewed\" (a move larger than the measure's "
                 "declared ordinary move, not yet reviewed). Only a true pair may be drawn as a line. "
                 "The ordinary-move priors in this first slice were declared with both points already "
                 "known, so they are not pre-registered; priors for measures added later are declared "
                 "before their first point."),
        "measures": [build_measure(m, root, releases) for m in registry],
        "excluded_candidates": list(excluded),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(OUT_PATH))
    ap.add_argument("--check", action="store_true", help="build and report; do not write")
    args = ap.parse_args(argv)
    doc = build()
    for m in doc["measures"]:
        pts = ", ".join(f"{p['release']}={p['value']:.6g}" for p in m["series"])
        print(f"  {m['slug']:34s} {len(m['series'])} point(s)  {pts}")
        for o in m["omitted"]:
            print(f"    omitted {o['release']}: {o['reason']}")
    if args.check:
        return 0
    out = REPO_ROOT / args.out
    # Keep the file byte-stable when nothing but the timestamp would change,
    # so an unattended run does not produce a commit that says nothing.
    if out.exists():
        try:
            prior = json.loads(out.read_text())
        except json.JSONDecodeError:
            prior = None
        if prior and {**prior, "generated_at": None} == {**doc, "generated_at": None}:
            print(f"unchanged {out.relative_to(REPO_ROOT)}")
            return 0
    out.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"wrote {out.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
