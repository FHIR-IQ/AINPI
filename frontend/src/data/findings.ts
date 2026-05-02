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
    slug: 'oig-leie-exclusions',
    hypotheses: ['H24'],
    title: 'OIG LEIE excluded providers in NDH',
    summary:
      'Active OIG List of Excluded Individuals/Entities (LEIE) NPIs that also appear in the federal NDH bulk export. Direct measurement of 42 CFR § 455.436 federal database alignment between the federal directory and the federal exclusion list.',
    nullHypothesis:
      'Zero NPIs on the active OIG LEIE also appear in the federal NDH bulk export. Federal directory and federal exclusion list are in agreement.',
    denominator:
      'Active LEIE rows with a populated NPI (NPI != "0000000000" and REINDATE = "00000000"). Approximately 8,977 of the 83,001 LEIE rows on 2026-04-29; the remaining 89% are predominantly pre-NPI-era exclusions and are out of scope for AINPI\'s NPI-keyed match.',
    dataSource:
      'OIG LEIE downloadable CSV (`UPDATED.csv` from oig.hhs.gov/exclusions/downloadables) joined to NDH `practitioner._npi` and `organization._npi`. Refreshed weekly via the GitHub Actions cron.',
    status: 'pre-registered',
    ogTagline: 'Are LEIE-excluded providers still in the federal NDH?',
    implications: [
      {
        audience: 'Regulators',
        takeaway:
          '42 CFR § 455.436 requires monthly LEIE checks. If matches exist between active LEIE and NDH, that is direct evidence of federal-level data lag between OIG enforcement and CMS directory publication. The NDH update cadence may need a tighter coupling to LEIE supplements.',
      },
      {
        audience: 'Provider data teams',
        takeaway:
          'If your practitioner or organization NPI appears here, that is a serious flag. The LEIE search portal at exclusions.oig.hhs.gov is the authoritative source — verify there first, then contact OIG\'s Exclusion Review Section if you believe the match is in error.',
      },
      {
        audience: 'Payer data teams',
        takeaway:
          'Each match is a high-priority revalidation case for the state\'s PI team. AINPI surfaces the cohort; investigation, hearing rights, and any reinstatement claim belong to the state agency and OIG, not to AINPI.',
      },
      {
        audience: 'Researchers',
        takeaway:
          'The 89% of LEIE rows without a populated NPI are a structural limit on NPI-only matching. State MMIS systems use (lastname, firstname, DOB) demographic match for the remainder. AINPI does not implement demographic match because the data-quality risk on a national directory is too high.',
      },
    ],
  },
  {
    slug: 'sam-exclusions',
    hypotheses: ['H25'],
    title: 'SAM.gov excluded providers in NDH',
    summary:
      'Active SAM.gov exclusion records (HHS LEIE + OPM FEHBP debarment + DOJ + others, aggregated) whose NPI also appears in the federal NDH bulk export. Closes the third of four federal database checks named in 42 CFR § 455.436.',
    nullHypothesis:
      'Zero NPIs on SAM.gov\'s active exclusion list also appear in the federal NDH bulk export. Federal directory and federal exclusion list are in agreement.',
    denominator:
      'Active SAM rows (record_status = "Active") with a populated, real-format NPI. Approximately 7,063 of the 167,262 SAM rows in the V2_26120 extract; the remaining 96% are non-healthcare exclusions (OFAC sanctions, EPA contractor debarments, etc.) and are out of scope for AINPI\'s NPI-keyed match.',
    dataSource:
      'SAM.gov Public Extract V2 (sam.gov/data-services/Exclusions/Public V2) loaded via `analysis/ingest_sam_exclusions.py`, joined to NDH `practitioner._npi`. The HHS slice overlaps substantially with H24 LEIE; the OPM slice (FEHBP debarment under 5 USC 8902a) is net-new federal-screening signal not visible from LEIE alone.',
    status: 'pre-registered',
    ogTagline: 'Are SAM-excluded providers still in the federal NDH?',
    implications: [
      {
        audience: 'Regulators',
        takeaway:
          '42 CFR § 455.436 names SAM as one of four federal databases for monthly Medicaid screening. Matches between active SAM exclusions and NDH directly measure federal-level alignment; persistent matches indicate cadence drift between excluding-agency action and NDH publication.',
      },
      {
        audience: 'Payer data teams',
        takeaway:
          'The OPM-debarred slice is the operationally interesting one — those providers are barred from FEHBP but may still be in commercial network listings if your data feed treats SAM as out-of-scope. Treat OPM exclusion as an independent signal from LEIE, not a duplicate.',
      },
      {
        audience: 'Provider data teams',
        takeaway:
          'If your NPI is matched here, sam.gov/search/?index=ex is the authoritative lookup. SAM exclusions can come from agencies other than HHS — read the excluding_agency and exclusion_type fields before assuming an OIG-LEIE issue.',
      },
      {
        audience: 'Researchers',
        takeaway:
          'NPI population in SAM is the structural ceiling — only ~4% of SAM rows carry a real NPI, because SAM is a multi-domain feed (sanctions, contractor debarment, foreign-asset blocks). Healthcare-relevant matches are concentrated in the HHS and OPM agency slices.',
      },
    ],
  },
  {
    slug: 'mco-exposure-va',
    hypotheses: ['H26'],
    title: 'VA payer networks containing federally excluded providers (methodology demo)',
    summary:
      'Cross-references the AINPI federally-excluded cohort (LEIE or SAM, score >= 1.5) for Virginia against live FHIR provider directories of 3 publicly-queryable payer endpoints (Humana, Cigna, UnitedHealthcare via the Optum FLEX consolidated endpoint that covers UHC commercial + UHC Community Plan + OptumRx). v1 is a methodology demonstration; the full VA Medicaid MCO version requires credentialed access to Anthem HealthKeepers Plus, Aetna BH of VA, Molina, Sentara, and Virginia Premier and is tracked as Stage B fast-follow. Anchored in 42 CFR § 455.436 (federal database checks) and § 438.602 (Medicaid managed care directory oversight).',
    nullHypothesis:
      'Zero federally-excluded VA-resident NPIs appear in any of the queried payer provider directories. Federal exclusion status and payer directory publication are in agreement.',
    denominator:
      'VA-resident NPIs in the AINPI high-risk cohort\'s critical bucket (composite score >= 1.5) flagged for OIG LEIE or SAM.gov active exclusion. Source: `high-risk-cohort-export.csv`, filtered to `state=VA AND bucket=critical AND (oig_excluded OR sam_excluded)`.',
    dataSource:
      'Live FHIR `Practitioner` queries against 3 publicly-queryable Da Vinci PDex Plan-Net endpoints. Humana and UHC accept `?identifier=NPI` directly; Cigna does not (its CapabilityStatement returns `Search param not valid for resource: Practitioner by identifier` on 400) so we name-search via `?family=&given=` and post-filter the Bundle for the target NPI in `identifier[]`. UHC is reached via Optum FLEX (`https://flex.optum.com/fhirpublic/R4`) which serves UHC commercial + UHC Community Plan (Medicaid) + OptumRx in one tree of ~1,400 InsurancePlans. Anthem HealthKeepers Plus has a public endpoint at `cms_mandate/mcd/` but returns 500s, Aetna requires OAuth, Molina prod URL not yet discovered.',
    status: 'published',
    ogTagline: 'Are federally excluded providers in VA payer networks?',
    implications: [
      {
        audience: 'Regulators',
        takeaway:
          '42 CFR § 438.602 requires MCO directory oversight. v1 finds matches in Cigna\'s public directory — a payer that aggregates commercial + Medicaid managed care lines in one FHIR endpoint. Each match is a § 455.436-relevant flag for state PI staff to investigate. The substantive VA-Medicaid version requires Stage B (Anthem HealthKeepers Plus, Aetna BH of VA, UHC Community Plan) which is not yet wired.',
      },
      {
        audience: 'Payer data teams',
        takeaway:
          'Cigna is the v1 hit surface — if your organization carries any of the listed NPIs in your published provider directory, run an internal sweep against your provider data management workflow. Directory listing is operationally separate from active billing privileges, but the directory is the public-facing artifact regulators read first.',
      },
      {
        audience: 'Provider data teams',
        takeaway:
          'If your NPI is matched here AND you believe the federal exclusion is in error, the LEIE search portal at exclusions.oig.hhs.gov and SAM.gov are the authoritative sources; pursue reinstatement with the excluding agency before contesting the directory listing.',
      },
      {
        audience: 'Researchers',
        takeaway:
          'v1 reaches Humana (identifier search) and Cigna (name+filter). Neither is a primary VA Medicaid carrier; the actual VA Medicaid MCO products (Anthem HealthKeepers Plus, Aetna BH of VA, UHC Community Plan, Sentara, Molina, Virginia Premier) all require credentialed access. The Cigna name-search has a known false-negative class: cohort names are stored as "FAMILY, GIVEN" and may not exactly match payer-published names (typographic variants, hyphenated names, suffixes).',
      },
    ],
  },
  {
    slug: 'high-risk-cohort',
    hypotheses: ['H23'],
    title: 'High-risk provider cohort',
    summary:
      'A composite, transparent, audit-friendly score combining six independent NDH/NPPES quality signals into a per-NPI revalidation prioritization list. Aligned with 42 CFR § 455.436 federal database checks and § 455.450 risk-tier screening.',
    nullHypothesis:
      'Less than 1% of NDH practitioner NPIs accumulate a composite high-risk score above the 1.0 threshold, indicating that the federal directory population is broadly clean and revalidation can proceed on the standard 5-year cadence under 42 CFR § 455.414.',
    denominator:
      'All `Practitioner` resources in the NDH bulk export with a populated NPI.',
    dataSource:
      'NDH bulk export joined to NPPES `npi_raw` for match and deactivation status; the AINPI H9 Luhn check; the AINPI H13 NPPES↔NDH specialty agreement check; and the `ainpi-probe` endpoint liveness L4+ score for any endpoints declared by the practitioner’s organization. Roadmap: OIG LEIE and SAM.gov exclusion lists per 42 CFR § 455.436.',
    status: 'pre-registered',
    ogTagline: 'A transparent, citable revalidation prioritization list for state PI teams.',
    implications: [
      {
        audience: 'Regulators',
        takeaway:
          '42 CFR § 455.436 requires monthly NPPES + LEIE + SAM checks on all enrolled providers. AINPI today covers the NPPES leg with audit-trail-ready output (commit SHA, methodology version, generated_at). LEIE and SAM ingestion are roadmap items — the high-risk cohort will become a 4-database composite once ingested.',
      },
      {
        audience: 'Payer data teams',
        takeaway:
          'Composite scores are NOT fraud determinations. Each NPI in the cohort carries reason codes (e.g. `not_in_nppes`, `nppes_deactivated`, `luhn_fail`, `specialty_mismatch`). Use the reason codes to triage; do not treat the score as a substitute for investigation.',
      },
      {
        audience: 'Researchers',
        takeaway:
          'The composite weights (1.0 / 0.8 / 1.0 / 0.4 / 0.3 / 0.2) are pre-registered and visible in the analysis script. Sensitivity analyses welcome — file an issue with a reproducible alternative weighting and we will publish the comparison.',
      },
      {
        audience: 'Everyone using NDH',
        takeaway:
          'The cohort is exported as CSV/JSON keyed by NPI with reason codes. State Medicaid PI teams can join this directly to their internal roster and produce an actionable revalidation queue inside one workday.',
      },
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
