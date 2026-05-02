/**
 * Catalog of downloadable reports surfaced via /download.
 *
 * Each entry maps to a redirect target (PDF asset OR live web page) and
 * a stable version string that gets persisted to ReportDownload.reportVersion
 * so we can later answer "which report did this email request?".
 *
 * To add a new report:
 *   1. Add a const entry below with a unique id + version.
 *   2. If `format: 'pdf'`, drop the static asset under
 *      frontend/public/downloads/ at the URL declared here.
 *   3. The /download form picks it up automatically.
 */

export interface ReportOption {
  /** URL slug + form-radio value. Stable across versions. */
  id: string;
  /** Persisted to ReportDownload.reportVersion; rotates per release. */
  version: string;
  /** Display title in the picker. */
  title: string;
  /** One-sentence summary under the title. */
  description: string;
  /** What's at `url`: a static PDF, a live web page, or a CSV. */
  format: 'pdf' | 'web' | 'csv';
  /** Redirect target after the email gate. Relative to the site origin. */
  url: string;
  /** Optional badge shown next to the title. */
  badge?: 'NEW' | 'UPDATED';
  /** Approximate length, shown as flavor next to the format. */
  length?: string;
}

export const REPORTS: ReportOption[] = [
  {
    id: 'state-of-ndh-v1',
    version: 'state-of-ndh-v1.0.0',
    title: 'State of the National Provider Directory (v1.0)',
    description:
      'The full white paper — pre-registered findings against the 2026-04-09 CMS NPD release. Printable.',
    format: 'pdf',
    url: '/downloads/ainpi-state-of-ndh-v1.0.0.pdf',
    length: '~30 pages',
  },
  {
    id: 'may-2026-update',
    version: 'may-2026-update',
    title: 'May 2026 update — H26, H27, and SMD-letter readiness',
    description:
      'Independent verification of the 2026-04-30 Washington Post SSN-exposure finding (63 confirmed), the VA payer-directory cross-reference (4 of 125 in Cigna), and the v0.4.0 high-risk cohort closing 3 of 4 § 455.436 federal database checks.',
    format: 'web',
    url: '/reports/2026-05-update',
    badge: 'NEW',
    length: '~5 min read',
  },
  {
    id: 'va-briefing',
    version: 'va-briefing-2026-05-04',
    title: 'Virginia State Medicaid briefing (2026-05-04)',
    description:
      'Citation-grade briefing prepared for Virginia DMAS. 42 CFR § 455.436 framework + state-specific data quality (141K practitioners, 99.39% NPPES match, 4,657 deactivated-still-listed, 42.5% organization NPI duplicate rate) + the 125-NPI federally-excluded cohort + H26 4-payer cross-reference + Stage B roadmap.',
    format: 'web',
    url: '/briefings/va',
    badge: 'NEW',
    length: '~10 min read',
  },
  {
    id: 'va-cohort-csv',
    version: 'va-cohort-critical-2026-05-02',
    title: 'Virginia federally-excluded cohort (CSV)',
    description:
      'The 125 VA-resident NPIs in the H23 critical bucket (LEIE or SAM excluded, score ≥ 1.5) with per-NPI verification URLs (LEIE / SAM / NPPES). DMAS-shareable; MMIS-ready.',
    format: 'csv',
    url: '/api/v1/states/va-cohort-critical.csv',
    badge: 'NEW',
    length: '125 rows',
  },
];

export function findReport(id: string): ReportOption | undefined {
  return REPORTS.find((r) => r.id === id);
}

/** Default selection if the form doesn't specify (back-compat with old POSTs). */
export const DEFAULT_REPORT_ID = 'state-of-ndh-v1';
