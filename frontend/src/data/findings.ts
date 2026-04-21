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

export type ImplicationAudience =
  | 'Payer data teams'
  | 'Provider data teams'
  | 'Regulators'
  | 'Researchers'
  | 'FHIR implementers'
  | 'Everyone using NDH';

export interface Implication {
  audience: ImplicationAudience;
  takeaway: string;
}

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
  /** Audience-specific "so what" — what to do with this number */
  implications?: Implication[];
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
    implications: [
      { audience: 'Payer data teams', takeaway: 'If you build integrations against declared NDH FHIR endpoints, expect 14.6% to fail at /metadata and 18.4% to lack a valid SMART well-known — budget for partial availability rather than treating endpoint presence as functional.' },
      { audience: 'Provider data teams', takeaway: 'An endpoint URL in NDH does not prove your endpoint works. Audit yours against ainpi-probe L0–L7: DNS, TLS cert expiry, CapabilityStatement conformance, SMART discovery, unauthenticated Practitioner search.' },
      { audience: 'Regulators', takeaway: 'Technical reachability (90.4% L7) vs SMART discovery compliance (81.6%) is a 9-point gap. If rules start citing SMART conformance, current NDH is below the implied bar.' },
      { audience: 'FHIR implementers', takeaway: 'Zero R5 endpoints, zero R2 — NDH is a pure R4 population. Don\u2019t spend cycles on R5 compatibility testing for this directory.' },
    ],
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
    implications: [
      { audience: 'Payer data teams', takeaway: 'When comparing NDH specialty to NPPES, match against all 15 NPPES taxonomy slots — NOT just slot 1. 15% of NPPES records have their TRUE primary (switch=Y) in a non-slot-1 position, and 6% of NDH Practitioners legitimately match only an NPPES secondary board (dual-specialists).' },
      { audience: 'FHIR implementers', takeaway: 'NDH uses TWO specialty code systems on two resources — NUCC on Practitioner.qualification, CMS Medicare Types on PractitionerRole.specialty. A consumer filtering on one won\u2019t interoperate with one using the other. Apply the CMS-published Medicare/NUCC crosswalk (updated quarterly) to bridge.' },
      { audience: 'Regulators', takeaway: '0.79% of NDH NPIs (86K) don\u2019t exist in NPPES at all. 3.49% (379K) are deactivated in NPPES but still live in NDH. NDH\u2019s update cadence lags NPPES by the gap window between releases.' },
      { audience: 'Researchers', takeaway: '99.98% CMS structural validity + 99.83% NUCC validity = the underlying code quality is excellent. The interesting signal is inconsistency BETWEEN code systems for the same practitioner (14% fail the crosswalk check), not invalid codes themselves.' },
    ],
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
    implications: [
      { audience: 'Regulators', takeaway: 'Compliance with the CMS-9115-F 30-day or REAL Health Providers Act / No Surprises Act 90-day update cadence CANNOT be measured from NDH bulk files. meta.lastUpdated is an export stamp, not a per-record signal. Upstream NPPES last_updated (or attestation logs) is the right denominator.' },
      { audience: 'Payer data teams', takeaway: 'Don\u2019t use NDH meta.lastUpdated as a freshness heuristic to decide which records to refresh from upstream. Every record carries the same release-day timestamp. Cross-reference NPPES last_updated for real cadence signal.' },
      { audience: 'Researchers', takeaway: 'Any analysis claiming NDH per-record freshness must caveat that meta.lastUpdated is release-time stamping. Use the NPD release date itself as a lower bound on staleness.' },
    ],
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
    implications: [
      { audience: 'Payer data teams', takeaway: '97% of NDH Endpoints have no managingOrganization back-reference. You can\u2019t reliably traverse Endpoint → Organization. Work around via NPI-based secondary joins (NPPES, CAQH).' },
      { audience: 'Provider data teams', takeaway: 'If your organization has Endpoints registered, audit whether they declare managingOrganization pointing back to you. The 97% coverage gap is in this exact pointer.' },
      { audience: 'FHIR implementers', takeaway: 'Integrity of DECLARED references is 100% — zero dangling refs across 17M edges. The defect pattern is under-population, not broken pointers. Trust your resolver, but expect 4 of the 10 NDH IG resources (HealthcareService, InsurancePlan, Network, Verification) to be absent entirely.' },
      { audience: 'Regulators', takeaway: 'The NDH bulk export omits 4 of the 10 NDH-IG resources (HealthcareService + InsurancePlan + Network + Verification). Any rule citing those resources cannot be measured from the current public-use artifact.' },
    ],
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
    implications: [
      { audience: 'Everyone using NDH', takeaway: 'COUNT(Organization) is roughly 2× the number of unique real-world organizations. De-duplicate by _npi before treating org counts as unique entities. Practitioner dedup is clean (0 excess rows).' },
      { audience: 'Payer data teams', takeaway: 'An org that appears multiple times in NDH under different resource IDs may be legitimate (one FHIR Organization per service location) or defect (true duplicate). Either way, your match-to-internal-roster logic needs a normalization pass on NPI or (name, state, city).' },
      { audience: 'Researchers', takeaway: '70% of Org NPIs map to multiple Organization resources. Any study that treats NDH Organization count as a population figure will be inflated by ~1.7× at the entity level.' },
    ],
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
    implications: [
      { audience: 'Regulators', takeaway: 'Empirical FHIR endpoint reachability (90.3% L7) clears the 85% MA network-adequacy implied ceiling on BASIC reachability, but SMART discovery (81.6%) sits below it. If policy adds SMART conformance to the adequacy frame, the floor moves.' },
      { audience: 'Payer data teams', takeaway: 'Technical reachability ≠ regulatory adequacy. The 85% ceiling concerns active-provider share, not endpoint liveness. Don\u2019t substitute one for the other; use both as independent signals.' },
      { audience: 'Researchers', takeaway: 'This gauge maps technical reachability ONTO a regulatory proxy. The mapping is defensible but imperfect. Treat the comparison as illustrative, not regulatory-equivalent.' },
    ],
  },
];

export function findBySlug(slug: string): Finding | undefined {
  return FINDINGS.find((f) => f.slug === slug);
}

export function allSlugs(): string[] {
  return FINDINGS.map((f) => f.slug);
}
