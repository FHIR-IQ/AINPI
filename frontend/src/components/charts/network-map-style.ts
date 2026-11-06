import { JURISDICTIONS, type StateCategory } from '@/lib/networks';

export interface CellStyle {
  fill: string;
  patternId: string | null;
  label: string;
}

export interface PatternDef {
  id: string;
  size: number;
  background: string;
  /** Mark colour. */
  mark: string;
  kind: 'lines' | 'dots' | 'cross';
  /** Spacing between marks; larger is sparser. */
  gap: number;
}

// FIPS code -> state abbreviation (copied from USChoroplethMap.tsx).
export const FIPS_TO_STATE: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
};

export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida',
  GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin',
  WY: 'Wyoming',
};

// Site tokens. Fills differ in luminance (greyscale-safe) and use a blue
// and a warm ochre, never a red-green pair.
const PAPER_TINT = '#efeae1'; // none: warm paper tint
const HIE_FILL = '#9ec0e0'; // light primary
const MULTI_FILL = '#c9893f'; // warm ochre
const BOTH_FILL = '#08519c'; // primary.600
const INK = '#171310';
const INK_ON_DARK = '#faf8f5';

export const PATTERNS: PatternDef[] = [
  { id: 'nm-hie', size: 6, background: HIE_FILL, mark: INK, kind: 'lines', gap: 6 },
  { id: 'nm-multi', size: 6, background: MULTI_FILL, mark: INK, kind: 'dots', gap: 6 },
  { id: 'nm-both', size: 6, background: BOTH_FILL, mark: INK_ON_DARK, kind: 'cross', gap: 6 },
  { id: 'nm-hie-u', size: 12, background: HIE_FILL, mark: INK, kind: 'lines', gap: 12 },
  { id: 'nm-multi-u', size: 12, background: MULTI_FILL, mark: INK, kind: 'dots', gap: 12 },
  { id: 'nm-both-u', size: 12, background: BOTH_FILL, mark: INK_ON_DARK, kind: 'cross', gap: 12 },
  { id: 'nm-out', size: 5, background: '#faf8f5', mark: '#8a8279', kind: 'lines', gap: 5 },
];

const OUT: CellStyle = { fill: '#faf8f5', patternId: 'nm-out', label: 'Not covered' };

const BASE: Record<StateCategory, { fill: string; id: string | null; label: string }> = {
  none: { fill: PAPER_TINT, id: null, label: 'No state-specific route' },
  state_hie: { fill: HIE_FILL, id: 'nm-hie', label: 'State health information exchange' },
  multi_state: { fill: MULTI_FILL, id: 'nm-multi', label: 'Multi-state network' },
  both: { fill: BOTH_FILL, id: 'nm-both', label: 'State exchange and multi-state network' },
};

export function cellStyle(
  code: string,
  cell: { category: StateCategory; verified: boolean } | undefined,
): CellStyle {
  if (!cell || !JURISDICTIONS.includes(code)) return OUT;
  const b = BASE[cell.category];
  if (!b) return OUT;
  const patternId = b.id && !cell.verified ? `${b.id}-u` : b.id;
  return { fill: b.fill, patternId, label: cell.verified ? b.label : `${b.label} (use-case detail pending)` };
}

export const LEGEND: { key: string; label: string; style: CellStyle }[] = [
  { key: 'none', label: 'No state-specific route', style: cellStyle('PA', { category: 'none', verified: true }) },
  { key: 'state_hie', label: 'State health information exchange', style: cellStyle('PA', { category: 'state_hie', verified: true }) },
  { key: 'multi_state', label: 'Multi-state network', style: cellStyle('PA', { category: 'multi_state', verified: true }) },
  { key: 'both', label: 'State exchange and multi-state network', style: cellStyle('PA', { category: 'both', verified: true }) },
  {
    key: 'unverified',
    label: 'Network operates here; use-case detail pending',
    style: cellStyle('PA', { category: 'state_hie', verified: false }),
  },
  { key: 'out', label: 'Not covered', style: OUT },
  {
    key: 'national',
    label: 'National routes (QHINs, vendor networks, payer APIs, Direct) apply in every state',
    style: { fill: 'none', patternId: null, label: 'National routes' },
  },
];
