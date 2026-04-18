/**
 * Public-facing JSON contract for AINPI findings.
 *
 * These types describe the static files served at:
 *
 *   /api/v1/stats.json              — site-wide counters
 *   /api/v1/findings/<slug>.json    — per-finding detail
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
  /** Pinned methodology version — see docs/methodology/index.md front matter. */
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
    /** % of FHIR-REST endpoints that pass L3 or better. Null until crawler runs. */
    endpoints_live_pct: number | null;
    /** Findings whose status has advanced to 'published'. */
    findings_published: number;
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
  /** Free-form notes — caveats, data-cleanup events, known edge cases. */
  notes: string | null;
}
