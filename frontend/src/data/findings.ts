/**
 * Pre-registered finding catalog.
 *
 * Each entry corresponds to one or more hypotheses (H1..H22) from the
 * methodology's check catalog. Entries here are the **pre-registration
 * record** — slug, hypothesis, null hypothesis, denominator, data source —
 * so they can be public *before* any results drop.
 *
 * Results (numbers, charts) come from a separate data file hydrated from
 * the pipeline output, not from this module.
 */

export type FindingStatus = 'pre-registered' | 'in-progress' | 'published';

export interface Finding {
  slug: string;
  hypotheses: string[];
  title: string;
  summary: string;
  nullHypothesis: string;
  denominator: string;
  dataSource: string;
  status: FindingStatus;
  ogTagline?: string;
}

export const FINDINGS: Finding[] = [
  {
    slug: 'endpoint-liveness',
    hypotheses: ['H1', 'H2', 'H3', 'H4', 'H5'],
    title: 'Endpoint liveness',
    summary:
      'What share of FHIR-REST endpoints in the NPD are actually reachable, parseable, and SMART-capable? Scored L0 through L7 per the ainpi-probe crawler.',
    nullHypothesis:
      'FHIR-REST endpoints are reachable and conformant at or above the implied 85% network-adequacy ceiling.',
    denominator:
      'All `Endpoint` resources with `connectionType` in the FHIR-REST family.',
    dataSource:
      'CMS NPD bulk export + live HTTP probes run by the `ainpi-probe` crawler against declared `Endpoint.address` URLs.',
    status: 'pre-registered',
    ogTagline: 'How many NDH endpoints are actually alive?',
  },
  {
    slug: 'npi-taxonomy-correctness',
    hypotheses: ['H9', 'H10', 'H11', 'H12', 'H13'],
    title: 'NPI and taxonomy correctness',
    summary:
      'Do NDH NPIs pass the Luhn check, exist in NPPES, and agree with NPPES on name and primary specialty? NUCC taxonomy validity + currency.',
    nullHypothesis:
      'NPI structural validity is ≥99.9% and NDH-to-NPPES agreement on name and primary specialty is within documented drift thresholds.',
    denominator:
      'All `Practitioner` and `Organization` resources with an NPI identifier.',
    dataSource:
      'CMS NPD bulk export joined against the NPPES monthly full dissemination file (V.2) and the current NUCC quarterly code set.',
    status: 'pre-registered',
    ogTagline: 'Do NDH NPIs match NPPES?',
  },
  {
    slug: 'temporal-staleness',
    hypotheses: ['H18'],
    title: 'Temporal staleness',
    summary:
      'How current is the NDH? Distribution of `meta.lastUpdated` vs 30-day (CMS-9115-F) and 90-day (REAL Health Providers Act / No Surprises Act) thresholds.',
    nullHypothesis:
      'A majority of resources carry a `meta.lastUpdated` within the 90-day statutory threshold.',
    denominator:
      'All resources across all six NDH resource types that carry a populated `meta.lastUpdated`.',
    dataSource: 'CMS NPD bulk export (pinned release).',
    status: 'pre-registered',
    ogTagline: 'How fresh is the National Provider Directory?',
  },
  {
    slug: 'referential-integrity',
    hypotheses: ['H6', 'H7', 'H8'],
    title: 'Referential integrity',
    summary:
      'Dangling `Practitioner` / `Organization` references in `PractitionerRole`, unresolvable `managingOrganization` in Location, and Organization-to-HealthcareService coverage.',
    nullHypothesis:
      'Cross-resource references resolve at ≥99% inside the bulk export.',
    denominator:
      'All reference fields across `PractitionerRole.practitioner`, `PractitionerRole.organization`, `Location.managingOrganization`, and `HealthcareService.providedBy`.',
    dataSource:
      'Edge tuples extracted from the NPD bulk export in a single streaming pass, queried in DuckDB.',
    status: 'pre-registered',
    ogTagline: 'Do the graph edges actually resolve?',
  },
  {
    slug: 'duplicate-detection',
    hypotheses: ['H14', 'H15'],
    title: 'Duplicate detection',
    summary:
      'Same-NPI-multiple-resource-IDs for Practitioner, and normalized-name-plus-address collapse for Organization.',
    nullHypothesis:
      'Duplicate rate is below 1% for both Practitioner (by NPI) and Organization (by normalized name + address).',
    denominator:
      'All `Practitioner` and `Organization` resources.',
    dataSource: 'CMS NPD bulk export.',
    status: 'pre-registered',
    ogTagline: 'How many providers appear twice?',
  },
  {
    slug: 'network-adequacy-gauge',
    hypotheses: ['H22'],
    title: 'Network adequacy gauge',
    summary:
      'Empirical endpoint-liveness rate compared against the 85% network-adequacy implied ceiling in Medicare Advantage regulation.',
    nullHypothesis:
      'Measured endpoint liveness matches or exceeds the 85% regulatory ceiling.',
    denominator:
      'All FHIR-REST endpoints declared in the NPD bulk export at the pinned release.',
    dataSource:
      '`ainpi-probe` crawler results joined to the `Endpoint` resource table.',
    status: 'pre-registered',
    ogTagline: 'Empirical liveness vs the 85% regulatory line.',
  },
];

export function findBySlug(slug: string): Finding | undefined {
  return FINDINGS.find((f) => f.slug === slug);
}

export function allSlugs(): string[] {
  return FINDINGS.map((f) => f.slug);
}
