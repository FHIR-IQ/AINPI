/**
 * Catalog of states with state-scoped AINPI audit pages.
 *
 * Seeded with Virginia, Pennsylvania, and Ohio in response to the 2026-04-23
 * CMS State Medicaid Director letter requesting comprehensive provider
 * revalidation strategies. Each state's per-finding numbers are computed
 * by `analysis/state_findings.py` and stored at
 * `frontend/public/api/v1/states/<lowercase-abbrev>.json`.
 *
 * The MCO list is only used for the optional FFS↔MCO directory parity
 * angle on the state page narrative (deliverable #4 in the SMD response
 * plan). Pulled from each state's Medicaid program publications.
 */

export interface StateEntry {
  code: string;
  name: string;
  /** Medicaid program brand name. */
  medicaid_program_name: string;
  /** State Medicaid agency. */
  agency: string;
  /** Approximate Medicaid enrollment (most recent state publication). */
  enrollment_approx: string;
  /** Notable managed care plans operating in the state. */
  mcos: string[];
}

export const SEED_STATES: StateEntry[] = [
  {
    code: 'VA',
    name: 'Virginia',
    medicaid_program_name: 'Cardinal Care',
    agency: 'Department of Medical Assistance Services (DMAS)',
    enrollment_approx: '~1.8M enrollees',
    mcos: [
      'Anthem HealthKeepers Plus',
      'Sentara Community Plan',
      'Aetna Better Health of Virginia',
      'Molina Complete Care',
      'United Healthcare Community Plan',
      'Virginia Premier',
    ],
  },
  {
    code: 'PA',
    name: 'Pennsylvania',
    medicaid_program_name: 'Medical Assistance (HealthChoices)',
    agency: 'Department of Human Services (DHS)',
    enrollment_approx: '~3.5M enrollees',
    mcos: [
      'AmeriHealth Caritas Pennsylvania',
      'Geisinger Health Plan Family',
      'Highmark Wholecare',
      'Keystone First',
      'PA Health & Wellness',
      'UPMC for You',
      'United Healthcare Community Plan',
    ],
  },
  {
    code: 'OH',
    name: 'Ohio',
    medicaid_program_name: 'Ohio Medicaid (Next Generation Managed Care)',
    agency: 'Ohio Department of Medicaid (ODM)',
    enrollment_approx: '~3.0M enrollees',
    mcos: [
      'AmeriHealth Caritas Ohio',
      'Anthem Blue Cross and Blue Shield',
      'Buckeye Health Plan',
      'CareSource',
      'Humana Healthy Horizons in Ohio',
      'Molina HealthCare of Ohio',
      'United Healthcare Community Plan',
    ],
  },
];

/**
 * Every US state + DC where AINPI publishes a state-scoped JSON slice.
 * Code → display name only. SEED_STATES is the richer "we have a Medicaid
 * program brief for this state" subset; ALL_STATE_NAMES drives static
 * param generation and friendly-name lookup for the rest.
 */
export const ALL_STATE_NAMES: Record<string, string> = {
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
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export function findStateByCode(code: string): StateEntry | undefined {
  const upper = code.toUpperCase();
  const seeded = SEED_STATES.find((s) => s.code === upper);
  if (seeded) return seeded;
  const name = ALL_STATE_NAMES[upper];
  if (!name) return undefined;
  // Lightweight entry for non-seeded states. Fields we don't have rich data
  // for fall back to placeholders the state page handles gracefully.
  return {
    code: upper,
    name,
    medicaid_program_name: '',
    agency: '',
    enrollment_approx: '',
    mcos: [],
  };
}

/**
 * State codes for which a /states/<code> page should be generated.
 * Returns lowercase codes (matching the JSON file naming).
 */
export function allStateCodes(): string[] {
  return Object.keys(ALL_STATE_NAMES).map((c) => c.toLowerCase());
}

/**
 * The richer subset that gets nav-promoted as a state-Medicaid briefing.
 */
export function seededStateCodes(): string[] {
  return SEED_STATES.map((s) => s.code.toLowerCase());
}
