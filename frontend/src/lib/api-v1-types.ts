/**
 * Public-facing JSON contract for AINPI findings.
 *
 * These types describe the static files served at:
 *
 *   /api/v1/stats.json: site-wide counters
 *   /api/v1/findings/<slug>.json: per-finding detail
 *
 * External consumers (dashboards, academic citation, journalists) can
 * rely on this shape. Breaking changes here require a version bump in
 * the path: `/api/v2/...`.
 *
 * The schema is intentionally tolerant of `null` values so scaffolded
 * findings (pre-registered, no numbers yet) can serve the same endpoint
 * shape as published findings.
 */

export interface ApiV1Stats {
  /** NPD release the numbers were computed against (ISO 8601 date). */
  release_date: string;
  /** When this JSON was generated (ISO 8601 timestamp, UTC). */
  generated_at: string;
  /** Pinned methodology version: see docs/methodology/index.md front matter. */
  methodology_version: string;
  /** Git SHA of the repo at pipeline run time, or 'pending'. */
  commit_sha: string;
  counters: {
    /** Total FHIR resources ingested from the pinned NPD release. */
    resources_processed: number;
    /** NPIs subject to Luhn + NPPES validation. Null until pipeline runs. */
    npis_checked: number | null;
    /** NPIs that failed any validation code (INVALID_STRUCTURE or LUHN_FAIL). */
    npis_flagged: number | null;
    /** % of FHIR-REST endpoints that serve a parseable CapabilityStatement. Null until crawler runs. */
    endpoints_live_pct: number | null;
    /** Findings whose status has advanced to 'published'. */
    findings_published: number;
    /** Findings with partial results landed (one or more hypotheses published, others pending). */
    findings_in_progress: number;
    /** Findings currently in pre-registered state (no numbers yet). */
    findings_pre_registered: number;
  };
}

export interface ApiV1FindingChartBar {
  label: string;
  value: number;
}

export interface ApiV1FindingChart {
  /** Display hint. 'bar' is the only one implemented today. */
  type: 'bar' | 'histogram' | 'gauge';
  data: ApiV1FindingChartBar[];
  /** Optional hint, e.g. 'percent', 'count'. */
  unit?: string;
}

export interface ApiV1Finding {
  slug: string;
  title: string;
  hypotheses: string[];
  status: 'pre-registered' | 'in-progress' | 'published';
  release_date: string;
  generated_at: string;
  methodology_version: string;
  commit_sha: string;
  /** Short one-sentence result, ready to print in a social card. Null when pre-registered. */
  headline: string | null;
  /** The numerator behind the headline. Null when pre-registered. */
  numerator: number | null;
  /** The denominator behind the headline. Null when pre-registered. */
  denominator: number | null;
  /** Optional supporting chart payload. */
  chart: ApiV1FindingChart | null;
  /** Free-form notes: caveats, data-cleanup events, known edge cases. */
  notes: string | null;
}

/**
 * State-scoped view of the audit, for `/states/<state>` pages and the
 * State Medicaid Director ask under the 2026-04-23 CMS PR letter.
 *
 * One file per state at `/api/v1/states/<lowercase-abbrev>.json`.
 */

export interface ApiV1StateFindingRow {
  /** Maps to the slug at /findings/[slug]. */
  slug: string;
  /** H10, H13, etc. */
  hypotheses: string[];
  /** Display title. */
  title: string;
  /** Whether the finding is computable at state granularity. */
  state_computable: boolean;
  /** State numerator. Null when not yet computed or not state-computable. */
  state_numerator: number | null;
  /** State denominator. Null when not yet computed or not state-computable. */
  state_denominator: number | null;
  /** State rate as percent. Null when not yet computed. */
  state_pct: number | null;
  /** Published national rate (percent), for side-by-side context. */
  national_pct: number | null;
  /** One-sentence state-specific takeaway. Null until computed. */
  state_headline: string | null;
  /** Why a finding cannot be computed at state level (e.g. endpoint→state mapping is indirect). */
  not_computable_reason: string | null;
}

/**
 * A specific record a reader can independently verify against the
 * authoritative public source (NPPES NPI Registry). Surfacing concrete
 * NPIs that AINPI flagged is the strongest trust signal we can publish.
 */
export interface ApiV1StateSampleNPI {
  /** 10-digit NPI. */
  npi: string;
  /** Display name (last, first OR organization legal name). */
  display_name: string;
  /** Slug of the finding that flagged this NPI. */
  flagged_by: string;
  /** Plain-English flag reason ("not present in NPPES", "primary specialty disagrees with NPPES", etc.). */
  flag_reason: string;
  /** Direct verification URL on nppes.cms.hhs.gov. */
  nppes_lookup_url: string;
}

export interface ApiV1StateFindings {
  state: string; // 'VA'
  state_name: string; // 'Virginia'
  status: 'pre-registered' | 'in-progress' | 'published';
  release_date: string;
  generated_at: string;
  methodology_version: string;
  commit_sha: string;
  /** Counts of NDH resources tied to this state (by service-address state). */
  denominators: {
    practitioner: number | null;
    organization: number | null;
    location: number | null;
  };
  findings: ApiV1StateFindingRow[];
  /** Concrete records the reader can verify. Empty until computed. */
  verify_samples: ApiV1StateSampleNPI[];
  /** Free-form state-specific caveats. */
  notes: string | null;
}

// ---------------------------------------------------------------------------
// /api/v1/measures.json: the measure series (generator: analysis/measures.py)
// Design: docs/superpowers/specs/2026-09-12-ndh-measure-series-design.md
// ---------------------------------------------------------------------------

/**
 * Whether a point may be joined to the one before it.
 *   true          same definition, move within the declared prior (or reviewed)
 *   false         a definition break the measure declares as not comparable
 *   'unreviewed'  a move larger than the declared prior that nobody has reviewed
 *   null          first point in the series; there is nothing before it
 * Only `true` may be drawn as a line.
 */
export type ApiV1MeasureComparability = true | false | 'unreviewed' | null;

export interface ApiV1MeasureSource {
  /** Repo-relative file the value was read from. */
  file: string;
  /** Field path inside that file. */
  field: string;
  /** Commit the file was copied from (vendored) or the commit_sha it carries. */
  commit: string | null;
  /** True when the file is an as-published copy under analysis/release-snapshots/published/. */
  vendored: boolean;
}

export interface ApiV1MeasureRestatement {
  as_published_value: number;
  as_published_numerator: number;
  as_published_denominator: number;
  source: ApiV1MeasureSource;
  reason: string;
}

export interface ApiV1MeasurePoint {
  /** NDH release date, ISO. */
  release: string;
  /** numerator / denominator for unit 'ratio'; the numerator for unit 'count'. */
  value: number;
  numerator: number;
  /** Always positive. A release without one is omitted, never zero. */
  denominator: number;
  definition_version: number;
  source: ApiV1MeasureSource;
  comparable_to_previous: ApiV1MeasureComparability;
  comparability_reason?: string;
  /** Present on a zero numerator: the control proving the field was read. */
  zero_control?: string;
  restatements?: ApiV1MeasureRestatement[];
}

export interface ApiV1MeasureDefinition {
  version: number;
  numerator: string;
  denominator: string;
  note: string | null;
  /** Hash of the declared definition text. Moves to the SQL text in the BigQuery measure pass. */
  definition_hash: string;
}

export interface ApiV1MeasureBreak {
  at: string;
  from_version: number;
  to_version: number;
  reason: string;
  comparable_across_break: boolean;
}

export interface ApiV1Measure {
  slug: string;
  question: string;
  unit: 'ratio' | 'count';
  source: string;
  hypotheses: string[];
  time_axis: 'ndh-release';
  /** The current definition. */
  definition_version: number;
  definitions: ApiV1MeasureDefinition[];
  /** The move per release the measure declares ordinary; larger moves are 'unreviewed'. */
  ordinary_move: { kind: 'absolute' | 'relative'; max: number; why: string };
  breaks: ApiV1MeasureBreak[];
  /** Ascending by release. */
  series: ApiV1MeasurePoint[];
  /** Releases in the series window with no point, and why. */
  omitted: { release: string; reason: string }[];
  notes: string | null;
}

export interface ApiV1Measures {
  generated_at: string;
  generator: string;
  time_axis: 'ndh-release';
  releases: string[];
  series_start: string;
  series_start_reason: string;
  note: string;
  measures: ApiV1Measure[];
  excluded_candidates: { slug: string; reason: string }[];
}
