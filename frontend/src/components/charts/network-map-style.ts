import type { StateCategory } from '@/lib/networks';

interface CellStyle {
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
}

// Site tokens. Fills differ in luminance (greyscale-safe) and use a blue
// and a warm ochre, never a red-green pair.
const PAPER = '#faf8f5';
const PAPER_TINT = '#efeae1'; // none: warm paper tint
const HIE_FILL = '#9ec0e0'; // light primary
const MULTI_FILL = '#c9893f'; // warm ochre
const BOTH_FILL = '#08519c'; // primary.600
const INK = '#171310';
const GREY_MARK = '#8a8279';

export const PATTERNS: PatternDef[] = [
  { id: 'nm-hie', size: 6, background: HIE_FILL, mark: INK, kind: 'lines' },
  { id: 'nm-multi', size: 6, background: MULTI_FILL, mark: INK, kind: 'dots' },
  { id: 'nm-both', size: 6, background: BOTH_FILL, mark: PAPER, kind: 'cross' },
  { id: 'nm-hie-u', size: 12, background: HIE_FILL, mark: INK, kind: 'lines' },
  { id: 'nm-multi-u', size: 12, background: MULTI_FILL, mark: INK, kind: 'dots' },
  { id: 'nm-both-u', size: 12, background: BOTH_FILL, mark: PAPER, kind: 'cross' },
  // Hidden by the overlay filter: pale paper with grey hatching, so it never
  // reads as the flat tint of "none".
  { id: 'nm-hidden', size: 5, background: PAPER, mark: GREY_MARK, kind: 'lines' },
];

export const BASE: Record<StateCategory, { fill: string; id: string | null; label: string }> = {
  none: { fill: PAPER_TINT, id: null, label: 'No state or multi-state network for this use case in our sources' },
  hidden: { fill: PAPER, id: 'nm-hidden', label: 'Hidden by current filters' },
  state_hie: { fill: HIE_FILL, id: 'nm-hie', label: 'State health information exchange' },
  multi_state: { fill: MULTI_FILL, id: 'nm-multi', label: 'Multi-state network' },
  both: { fill: BOTH_FILL, id: 'nm-both', label: 'State exchange and multi-state network' },
};

/** Categories that can carry the lighter "use-case detail pending" pattern. */
const HAS_PENDING: ReadonlySet<StateCategory> = new Set(['state_hie', 'multi_state', 'both']);

export function cellStyle(cell: { category: StateCategory; verified: boolean }): CellStyle {
  const b = BASE[cell.category];
  const pending = !cell.verified && HAS_PENDING.has(cell.category);
  return {
    fill: b.fill,
    patternId: pending ? `${b.id}-u` : b.id,
    label: pending ? `${b.label} (use-case detail pending)` : b.label,
  };
}

const LEGEND_ORDER: StateCategory[] = ['none', 'state_hie', 'multi_state', 'both'];

/**
 * Legend rows for the categories always shown, one row per pending variant in
 * use, and the "hidden" row only when a filter is hiding a state.
 */
export function legendFor(
  cells: Record<string, { category: StateCategory; verified: boolean }>,
): { key: string; label: string; style: CellStyle }[] {
  const values = Object.values(cells);
  const rows: { key: string; label: string; style: CellStyle }[] = LEGEND_ORDER.map((category) => ({
    key: category,
    label: BASE[category].label,
    style: cellStyle({ category, verified: true }),
  }));
  for (const category of LEGEND_ORDER) {
    if (!HAS_PENDING.has(category)) continue;
    if (!values.some((c) => c.category === category && !c.verified)) continue;
    const style = cellStyle({ category, verified: false });
    rows.push({ key: `${category}-pending`, label: style.label, style });
  }
  if (values.some((c) => c.category === 'hidden')) {
    rows.push({ key: 'hidden', label: BASE.hidden.label, style: cellStyle({ category: 'hidden', verified: true }) });
  }
  return rows;
}

export const NATIONAL_NOTE =
  'National routes (QHINs, vendor networks, payer APIs, Direct) are not tied to one state.';
