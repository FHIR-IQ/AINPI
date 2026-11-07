import { describe, it, expect } from 'vitest';
import { BASE, cellStyle, legendFor } from '@/components/charts/network-map-style';
import type { StateCategory } from '@/lib/networks';

const CATS: StateCategory[] = ['none', 'hidden', 'state_hie', 'multi_state', 'both'];

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

describe('cellStyle', () => {
  it('gives every category a distinct pattern and label', () => {
    const s = CATS.map((category) => cellStyle({ category, verified: true }));
    expect(new Set(s.map((x) => x.patternId)).size).toBe(CATS.length);
    expect(new Set(s.map((x) => x.label)).size).toBe(CATS.length);
  });
  it('unverified differs in pattern from verified for the network categories', () => {
    for (const category of ['state_hie', 'multi_state', 'both'] as StateCategory[]) {
      const v = cellStyle({ category, verified: true });
      const u = cellStyle({ category, verified: false });
      expect(u.patternId).not.toBe(v.patternId);
      expect(u.label).toBe(`${v.label} (use-case detail pending)`);
    }
  });
  it('a jurisdiction with no listed network has a flat fill and the sources label', () => {
    const st = cellStyle({ category: 'none', verified: true });
    expect(st.label).toBe('No state or multi-state network for this use case in our sources');
    expect(st.patternId).toBeNull();
  });
  it('hidden by a filter never reads as a statement about the sources', () => {
    const st = cellStyle({ category: 'hidden', verified: true });
    expect(st.label).toBe('Hidden by current filters');
    expect(st.patternId).toBe('nm-hidden');
    expect(st.label).not.toMatch(/sources/);
  });
  it('fills of the four network categories pairwise differ in luminance by at least 0.08', () => {
    const l = (['none', 'state_hie', 'multi_state', 'both'] as StateCategory[]).map((category) =>
      lum(cellStyle({ category, verified: true }).fill),
    );
    for (let i = 0; i < l.length; i++)
      for (let j = i + 1; j < l.length; j++) expect(Math.abs(l[i] - l[j])).toBeGreaterThanOrEqual(0.08);
  });
});

describe('legendFor', () => {
  it('always shows the four categories, labelled from BASE', () => {
    const labels = legendFor({ PA: { category: 'none', verified: true } }).map((e) => e.label);
    expect(labels).toEqual([BASE.none.label, BASE.state_hie.label, BASE.multi_state.label, BASE.both.label]);
  });
  it('adds a pending row for each category drawn as pending, and the hidden row only when used', () => {
    const rows = legendFor({
      PA: { category: 'multi_state', verified: false },
      OH: { category: 'hidden', verified: true },
    });
    const labels = rows.map((e) => e.label);
    expect(labels).toContain('Multi-state network (use-case detail pending)');
    expect(labels).not.toContain('State health information exchange (use-case detail pending)');
    expect(labels).toContain('Hidden by current filters');
  });
});
