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
    id: 'aug-2026-08-21-update',
    version: '2026-08-21-update',
    title:
      '2026-08-21 update: the directory just changed more in one release than in the last four',
    description:
      'We reloaded all 45 GB of the 2026-08-20 release and re-ran every measurement. Where-they-work records went from 7.0M to 16.5M, and coverage moved only five points because most landed on clinicians who already had one. Every profession improved, most at the bottom of the table. A hierarchy field that resolved to nothing in May now resolves completely. 233 health plans and 27 insurers appeared. Endpoint attribution went backwards, 16.9% to 14.7%.',
    format: 'web',
    url: '/reports/2026-08-21-update',
    badge: 'NEW',
    length: '~5 min read',
  },
  {
    id: 'aug-2026-08-17-update',
    version: '2026-08-17-update',
    title:
      '2026-08-17 update: the directory knows doctors, and barely knows nurses, dentists and pharmacists',
    description:
      'We checked all 227,727 health workers the national directory lists as active in Pennsylvania, and asked which ones it says have a workplace. It is not evenly spread. 77.9% of nurse practitioners and physician assistants have one, and 1 of 12,995 pharmacy workers does. The split tracks who bills Medicare, not who provides care. Includes a new county map you can zoom, and an honest account of the guess we got wrong.',
    format: 'web',
    url: '/reports/2026-08-17-update',
    length: '~4 min read',
  },
  {
    id: 'aug-2026-08-16-update',
    version: '2026-08-16-update',
    title: "2026-08-16 update: most addresses in the national doctor directory don't say who they belong to",
    description:
      'We checked 114,071 web addresses in the national directory of doctors. Only 19,334 say who owns them, about one in six. Nothing is broken, the names were simply never filled in. Includes a free list of the ones that work, why sixteen software companies have never filled the name in once, why health insurers are not in the directory yet, and what we think the community should push for next.',
    format: 'web',
    url: '/reports/2026-08-16-update',
    length: '~4 min read',
  },
  {
    id: 'aug-2026-08-04-update',
    version: '2026-08-04-update',
    title: '2026-08-04 update: a third of American hospitals serve a seventh of the people',
    description:
      'New rural health section with a state-level map. 1,847 of 5,366 US hospitals (34.4%) sit in nonmetro counties holding 13.8% of residents; 1,338 are Critical Access. Plus a Pennsylvania deep dive showing rural hospitals are more findable than metro ones, and a correction to an earlier claim about Epic endpoint traversal.',
    format: 'web',
    url: '/reports/2026-08-04-update',
    length: '~4 min read',
  },
  {
    id: 'aug-2026-08-01-update',
    version: '2026-08-01-update',
    title: '2026-08-01 update: half the states have a Medicaid directory you can actually open',
    description:
      'H46 published, computed entirely from public data at zero cost: CMS lists a Medicaid provider directory for 32 of 51 states and DC, and 5 of those listed URLs do not resolve, so 27 of 51 (52.9%) have a catalogued directory the public can open. Plus a baseline of the federated payer registry: 2,557 Medicare Advantage plans enumerated, zero payer-published files, zero endpoints.',
    format: 'web',
    url: '/reports/2026-08-01-update',
    length: '~5 min read',
  },
  {
    id: 'jul-2026-07-13-update',
    version: '2026-07-13-update',
    title: '2026-07-13 update: no June release, and the missing endpoints are already public',
    description:
      'The NDH manifest still serves the May release after 66 days. The CMS directory team published a scrape of 31,255 certified-EHR FHIR endpoints (HTI-1 bundles) with NPIs and states attached; 98.7% of NDH orgs carried zero endpoints in the April release. H45 pre-registered: the per-state coverage gap, computed from public data on both sides.',
    format: 'web',
    url: '/reports/2026-07-13-update',
    length: '~5 min read',
  },
  {
    id: 'state-of-ndh-v1',
    version: 'state-of-ndh-v1.0.0',
    title: 'State of the National Provider Directory (v1.0)',
    description:
      'The full white paper: pre-registered findings against the 2026-05-08 CMS NPD release. Printable.',
    format: 'pdf',
    url: '/downloads/ainpi-state-of-ndh-v1.0.0.pdf',
    length: '~30 pages',
  },
  {
    id: 'jun-2026-06-25-update',
    version: '2026-06-25-update',
    title: '2026-06-25 update: what is actually in an NDH endpoint record? (H44)',
    description:
      'H44 (endpoint metadata coverage vs the HTE submission spec) published. Of the 9 endpoint fields the spec collects, 5 have no home in the NDH FHIR Endpoint profile (STU1); the extensions that could carry the others are 0% populated across all 114,071 FHIR-REST endpoints. Today the NDH knows an endpoint address and payload type (both 100%), and that is the whole record.',
    format: 'web',
    url: '/reports/2026-06-25-update',
    length: '~4 min read',
  },
  {
    id: 'jun-2026-06-09-update',
    version: '2026-06-09-update',
    title: '2026-06-09 update: 99.98% of practitioners carry a phone on the record (H43)',
    description:
      'H43 (practitioner phone-number reachability) published. 7,195,270 of 7,196,385 active practitioners (99.98%) in the 2026-05-08 release carry a phone directly on the Practitioner record; the role/location traversal adds nothing; 1,115 have no phone on any resource. The pre-registered prior (phone on the location, NPPES-style) was rejected by the data.',
    format: 'web',
    url: '/reports/2026-06-09-update',
    length: '~4 min read',
  },
  {
    id: 'jun-2026-06-02-update',
    version: '2026-06-02-update',
    title: '2026-06-02 update: landscape becomes the front door, REAL Health audit framework published',
    description:
      'Two coordinated releases: the homepage swaps to a Karpathy-style hierarchical treemap (548 cells, 6 audit dimensions, one per state × specialty) and a new policy brief maps every § 6220 obligation of the REAL Health Providers Act to the AINPI signal that measures it. The choropleth moves to /map.',
    format: 'web',
    url: '/reports/2026-06-02-update',
    length: '~6 min read',
  },
  {
    id: 'may-2026-05-22-update',
    version: '2026-05-22-update',
    title: '2026-05-22 update: H40 published, one confirmed case, three SAM-NPI false positives',
    description:
      'Sharpened H30a to per-(NPI, HCPCS, place-of-service) detail. Cross-audit surfaced 4 strict-post-exclusion candidates nationally; primary-source verification confirms 1 (Eduardo Miranda MD, LEIE-excluded 2015, $880K Medicare Part B in CY 2023) and reveals 3 SAM-NPI-join false positives. H42 null result honestly framed.',
    format: 'web',
    url: '/reports/2026-05-22-update',
    length: '~7 min read',
  },
  {
    id: 'may-2026-05-14-update',
    version: '2026-05-14-update',
    title: '2026-05-14 update: claims-side cross-audit shipped',
    description:
      '8 new findings (H29-H36) link AINPI\'s directory cohort to Medicaid spending, Medicare Part B / Part D, Open Payments, DMEPOS, nursing-home ownership, and NDH completeness. Strict-post-exclusion attribution and the H35 Stage B PPEF cross-walk fix shipped this week.',
    format: 'web',
    url: '/reports/2026-05-14-update',
    length: '~6 min read',
  },
  {
    id: 'may-2026-05-08-update',
    version: '2026-05-08-update',
    title: '2026-05-08 update: first comparable-release deltas',
    description:
      'CMS pushed a new NDH bulk export. Endpoint −73%, Location −61%, OrgAffiliation +147%; total 27.2M → 21.7M. SSN exposures 46 → 41 (CMS partially scrubbed). Organization NPI-duplicate excess 383K → 1.41M. Two source-side schema breaks AINPI caught.',
    format: 'web',
    url: '/reports/2026-05-08-update',
    length: '~5 min read',
  },
  {
    id: 'may-2026-update',
    version: 'may-2026-update',
    title: 'May 2 update: H26, H27, and SMD-letter readiness',
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
      'Worked example using public federal data. 42 CFR § 455.436 framework + Virginia-specific data quality (130K practitioners, 99.50% NPPES match, 4,090 deactivated-still-listed, 40.8% organization NPI duplicate rate) + the 131-NPI Virginia federally-excluded cohort + H26 4-payer cross-reference + Stage B roadmap. Measured against the 2026-05-08 release; the cohort is 106 NPIs at 2026-08-20.',
    format: 'web',
    url: '/briefings/va',
    length: '~10 min read',
  },
  {
    id: 'va-cohort-csv',
    version: 'va-cohort-critical-2026-08-20',
    title: 'Virginia federally-excluded cohort (CSV)',
    description:
      'The 106 VA-resident NPIs in the H23 critical bucket (LEIE or SAM excluded, score ≥ 1.5) with per-NPI verification URLs (LEIE / SAM / NPPES). Public file derived from public federal sources. Was 131 at the 2026-05-08 release.',
    format: 'csv',
    url: '/api/v1/states/va-cohort-critical.csv',
    badge: 'UPDATED',
    length: '106 rows',
  },
];

export function findReport(id: string): ReportOption | undefined {
  return REPORTS.find((r) => r.id === id);
}

/** Default selection if the form doesn't specify (back-compat with old POSTs). */
export const DEFAULT_REPORT_ID = 'state-of-ndh-v1';
