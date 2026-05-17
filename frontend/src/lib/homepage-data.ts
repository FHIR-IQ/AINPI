/**
 * Server-side aggregator for the homepage map.
 *
 * Reads the per-state cohort + claims-audit CSVs at build time and emits a
 * single typed structure with one entry per US jurisdiction. The MapHomepage
 * client component binds the choropleth to this structure. No HTTP fetch on
 * the client.
 */
import { loadStateCohort, loadStateClaimsAudit } from './load-api-v1';

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

export interface StateMapEntry {
  code: string;
  name: string;
  metrics: Record<MapMetricSlug, number>;
}

export interface HomepageMapData {
  generatedAt: string;
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

function rawMetrics(state: string): {
  cohortSize: number;
  strictPostExclusion: number;
  deactivatedStillBilling: number;
  industryPaymentsPostExclusion: number;
} {
  const cohort = loadStateCohort(state);
  const audit = loadStateClaimsAudit(state);
  return {
    cohortSize: cohort.length,
    strictPostExclusion:
      audit.medicaid.strict_post_exclusion_matches +
      audit.partb.strict_post_exclusion_matches +
      audit.partd.strict_post_exclusion_matches,
    deactivatedStillBilling: audit.deactivated_billing.matches,
    industryPaymentsPostExclusion: audit.industry_payments.strict_post_exclusion_matches,
  };
}

function normalize(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

export function loadHomepageMapData(): HomepageMapData {
  const codes = Object.keys(STATE_NAMES);
  const raw = codes.map((code) => ({ code, ...rawMetrics(code) }));

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
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    states,
    availableMetrics: AVAILABLE_METRICS,
  };
}
