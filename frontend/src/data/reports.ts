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
      'The full white paper — pre-registered findings against the 2026-05-08 CMS NPD release. Printable.',
    format: 'pdf',
    url: '/downloads/ainpi-state-of-ndh-v1.0.0.pdf',
    length: '~30 pages',
  },
  {
    id: 'jun-2026-06-09-update',
    version: '2026-06-09-update',
    title: '2026-06-09 update — 99.98% of practitioners carry a phone on the record (H43)',
    description:
      'H43 — practitioner phone-number reachability — published. We pre-registered expecting NDH to keep phone on the location (the NPPES pattern); the 2026-05-08 data overturned it. 7,195,270 of 7,196,385 active practitioners (99.98%) carry a phone directly on the Practitioner record, the role/location traversal adds nothing, and only 1,115 have no phone on any resource. Pre-registration working as intended.',
    format: 'web',
    url: '/reports/2026-06-09-update',
    badge: 'NEW',
    length: '~4 min read',
  },
  {
    id: 'jun-2026-06-02-update',
    version: '2026-06-02-update',
    title: '2026-06-02 update — landscape becomes the front door, REAL Health audit framework published',
    description:
      'Two coordinated releases: the homepage swaps to a Karpathy-style hierarchical treemap (548 cells, 6 audit dimensions, one per state × specialty) and a new policy brief maps every § 6220 obligation of the REAL Health Providers Act to the AINPI signal that measures it. The choropleth moves to /map.',
    format: 'web',
    url: '/reports/2026-06-02-update',
    length: '~6 min read',
  },
  {
    id: 'may-2026-05-22-update',
    version: '2026-05-22-update',
    title: '2026-05-22 update — H40 published, one confirmed case, three SAM-NPI false positives',
    description:
      'Sharpened H30a to per-(NPI, HCPCS, place-of-service) detail. Cross-audit surfaced 4 strict-post-exclusion candidates nationally; primary-source verification confirms 1 (Eduardo Miranda MD, LEIE-excluded 2015, $880K Medicare Part B in CY 2023) and reveals 3 SAM-NPI-join false positives. H42 null result honestly framed.',
    format: 'web',
    url: '/reports/2026-05-22-update',
    length: '~7 min read',
  },
  {
    id: 'may-2026-05-14-update',
    version: '2026-05-14-update',
    title: '2026-05-14 update — claims-side cross-audit shipped',
    description:
      '8 new findings (H29-H36) link AINPI\'s directory cohort to Medicaid spending, Medicare Part B / Part D, Open Payments, DMEPOS, nursing-home ownership, and NDH completeness. Strict-post-exclusion attribution and the H35 Stage B PPEF cross-walk fix shipped this week.',
    format: 'web',
    url: '/reports/2026-05-14-update',
    length: '~6 min read',
  },
  {
    id: 'may-2026-05-08-update',
    version: '2026-05-08-update',
    title: '2026-05-08 update — first comparable-release deltas',
    description:
      'CMS pushed a new NDH bulk export. Endpoint −73%, Location −61%, OrgAffiliation +147%; total 27.2M → 21.7M. SSN exposures 46 → 41 (CMS partially scrubbed). Organization NPI-duplicate excess 383K → 1.41M. Two source-side schema breaks AINPI caught.',
    format: 'web',
    url: '/reports/2026-05-08-update',
    length: '~5 min read',
  },
  {
    id: 'may-2026-update',
    version: 'may-2026-update',
    title: 'May 2 update — H26, H27, and SMD-letter readiness',
    description:
      'Independent verification of the 2026-04-30 Washington Post SSN-exposure finding (63 confirmed in the April release), the VA payer-directory cross-reference, and the v0.4.0 high-risk cohort closing 3 of 4 § 455.436 federal database checks.',
    format: 'web',
    url: '/reports/2026-05-update',
    length: '~5 min read',
  },
  {
    id: 'va-briefing',
    version: 'va-briefing-2026-05-08',
    title: 'Virginia case study (worked example)',
    description:
      'Worked example using public federal data. 42 CFR § 455.436 framework + Virginia-specific data quality (130K practitioners, 99.50% NPPES match, 4,090 deactivated-still-listed, 40.8% organization NPI duplicate rate) + the 131-NPI Virginia federally-excluded cohort + H26 4-payer cross-reference + Stage B roadmap.',
    format: 'web',
    url: '/briefings/va',
    length: '~10 min read',
  },
  {
    id: 'va-cohort-csv',
    version: 'va-cohort-critical-2026-05-08',
    title: 'Virginia federally-excluded cohort (CSV)',
    description:
      'The 131 VA-resident NPIs in the H23 critical bucket (LEIE or SAM excluded, score ≥ 1.5) with per-NPI verification URLs (LEIE / SAM / NPPES). Public file derived from public federal sources.',
    format: 'csv',
    url: '/api/v1/states/va-cohort-critical.csv',
    badge: 'UPDATED',
    length: '131 rows',
  },
];

export function findReport(id: string): ReportOption | undefined {
  return REPORTS.find((r) => r.id === id);
}

/** Default selection if the form doesn't specify (back-compat with old POSTs). */
export const DEFAULT_REPORT_ID = 'state-of-ndh-v1';
