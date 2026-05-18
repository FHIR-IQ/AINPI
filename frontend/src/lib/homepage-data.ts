/**
 * Server-side aggregator for the homepage map.
 *
 * Reads the per-state cohort + claims-audit CSVs at build time and emits a
 * single typed structure with one entry per US jurisdiction. The MapHomepage
 * client component binds the choropleth to this structure. No HTTP fetch on
 * the client.
 *
 * Each state entry carries enough data to populate the side panel inline —
 * the five claims-side summary rows (Medicaid, Part B+D with opioid count,
 * NPPES-deactivated, Open Payments, directory hygiene) plus the first
 * cohort NPI for the "Verify a sample NPI" CTA.
 */
import { loadStateCohort, loadStateClaimsAudit, loadStats } from './load-api-v1';

export type MapMetricSlug =
  | 'cohortSize'
  | 'strictPostExclusion'
  | 'deactivatedStillBilling'
  | 'industryPaymentsPostExclusion'
  | 'compositeRiskScore';

export interface MapMetric {
  slug: MapMetricSlug;
  label: string;
  /** One-sentence description for the metric switcher tooltip. */
  description: string;
  /** Unit hint for the legend ('count' | 'usd' | 'score'). */
  unit: 'count' | 'usd' | 'score';
}

export interface StateAuditSummary {
  medicaid: {
    strictMatches: number;
    fullWindowMatches: number;
    strictPaid: number;
    fullWindowPaid: number;
  };
  partbPartd: {
    partbMatches: number;
    partdMatches: number;
    opioidPrescribers: number;
  };
  deactivatedBilling: {
    matches: number;
    multiSource: number;
  };
  industryPayments: {
    strictMatches: number;
    fullWindowMatches: number;
    strictPaid: number;
  };
  /** First cohort NPI for the "Verify a sample NPI" CTA. Empty if cohort is empty. */
  sampleNpi: string;
}

export interface StateMapEntry {
  code: string;
  name: string;
  metrics: Record<MapMetricSlug, number>;
  audit: StateAuditSummary;
}

export interface HomepageMapData {
  generatedAt: string;
  /** The pinned NDH release date (e.g. "2026-05-08"). From stats.json. */
  releaseDate: string;
  methodologyVersion: string;
  states: StateMapEntry[];
  availableMetrics: MapMetric[];
}

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const AVAILABLE_METRICS: MapMetric[] = [
  {
    slug: 'cohortSize',
    label: 'Critical cohort size',
    description: 'Federally-excluded NPIs (LEIE or SAM active, score ≥ 1.5) in this state.',
    unit: 'count',
  },
  {
    slug: 'strictPostExclusion',
    label: 'Strict post-exclusion violations',
    description: 'Cohort NPIs paid by Medicaid, Part B, or Part D after their exclusion took effect.',
    unit: 'count',
  },
  {
    slug: 'deactivatedStillBilling',
    label: 'Deactivated still billing',
    description: 'NPPES-deactivated NPIs in this state still showing billing activity.',
    unit: 'count',
  },
  {
    slug: 'industryPaymentsPostExclusion',
    label: 'Industry payments post-exclusion',
    description: 'Excluded NPIs in this state receiving pharma/device payments after exclusion (PY 2024).',
    unit: 'count',
  },
  {
    slug: 'compositeRiskScore',
    label: 'Composite risk score (0-100)',
    description: 'Min-max normalized blend of cohort size + strict-post + deactivated-billing + industry payments.',
    unit: 'score',
  },
];

interface StateRawData {
  code: string;
  cohortSize: number;
  strictPostExclusion: number;
  deactivatedStillBilling: number;
  industryPaymentsPostExclusion: number;
  audit: StateAuditSummary;
}

function loadStateRawData(state: string): StateRawData {
  const cohort = loadStateCohort(state);
  const audit = loadStateClaimsAudit(state);
  return {
    code: state,
    cohortSize: cohort.length,
    strictPostExclusion:
      audit.medicaid.strict_post_exclusion_matches +
      audit.partb.strict_post_exclusion_matches +
      audit.partd.strict_post_exclusion_matches,
    deactivatedStillBilling: audit.deactivated_billing.matches,
    industryPaymentsPostExclusion: audit.industry_payments.strict_post_exclusion_matches,
    audit: {
      medicaid: {
        strictMatches: audit.medicaid.strict_post_exclusion_matches,
        fullWindowMatches: audit.medicaid.full_window_matches,
        strictPaid: audit.medicaid.strict_post_paid,
        fullWindowPaid: audit.medicaid.full_window_paid,
      },
      partbPartd: {
        partbMatches: audit.partb.full_window_matches,
        partdMatches: audit.partd.full_window_matches,
        opioidPrescribers: audit.partd.opioid_prescribers,
      },
      deactivatedBilling: {
        matches: audit.deactivated_billing.matches,
        multiSource: audit.deactivated_billing.multi_source_matches,
      },
      industryPayments: {
        strictMatches: audit.industry_payments.strict_post_exclusion_matches,
        fullWindowMatches: audit.industry_payments.full_window_matches,
        strictPaid: audit.industry_payments.strict_post_paid,
      },
      sampleNpi: cohort[0]?.npi ?? '',
    },
  };
}

function normalize(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

export function loadHomepageMapData(): HomepageMapData {
  const codes = Object.keys(STATE_NAMES);
  const raw = codes.map(loadStateRawData);

  const maxCohort = Math.max(...raw.map((r) => r.cohortSize), 1);
  const maxStrict = Math.max(...raw.map((r) => r.strictPostExclusion), 1);
  const maxDeact = Math.max(...raw.map((r) => r.deactivatedStillBilling), 1);
  const maxIndustry = Math.max(...raw.map((r) => r.industryPaymentsPostExclusion), 1);

  const states: StateMapEntry[] = raw.map((r) => {
    const cohortScore = normalize(r.cohortSize, maxCohort);
    const strictScore = normalize(r.strictPostExclusion, maxStrict);
    const deactScore = normalize(r.deactivatedStillBilling, maxDeact);
    const industryScore = normalize(r.industryPaymentsPostExclusion, maxIndustry);
    const composite = Math.round((cohortScore + strictScore + deactScore + industryScore) / 4);
    return {
      code: r.code,
      name: STATE_NAMES[r.code],
      metrics: {
        cohortSize: r.cohortSize,
        strictPostExclusion: r.strictPostExclusion,
        deactivatedStillBilling: r.deactivatedStillBilling,
        industryPaymentsPostExclusion: r.industryPaymentsPostExclusion,
        compositeRiskScore: composite,
      },
      audit: r.audit,
    };
  });

  const stats = loadStats();

  return {
    generatedAt: new Date().toISOString(),
    releaseDate: stats?.release_date ?? '',
    methodologyVersion: stats?.methodology_version ?? '',
    states,
    availableMetrics: AVAILABLE_METRICS,
  };
}
