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

export function findStateByCode(code: string): StateEntry | undefined {
  const upper = code.toUpperCase();
  return SEED_STATES.find((s) => s.code === upper);
}

export function allStateCodes(): string[] {
  return SEED_STATES.map((s) => s.code.toLowerCase());
}
