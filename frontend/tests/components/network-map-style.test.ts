import { describe, it, expect } from 'vitest';
import { cellStyle, LEGEND } from '@/components/charts/network-map-style';
import type { StateCategory } from '@/lib/networks';

const CATS: StateCategory[] = ['none', 'state_hie', 'multi_state', 'both'];

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

describe('cellStyle', () => {
  it('gives four distinct patterns and fills', () => {
    const s = CATS.map((category) => cellStyle('PA', { category, verified: true }));
    expect(new Set(s.map((x) => x.patternId)).size).toBe(4);
    expect(new Set(s.map((x) => x.fill)).size).toBe(4);
  });
  it('unverified differs in pattern from verified for non-none categories', () => {
    for (const category of ['state_hie', 'multi_state', 'both'] as StateCategory[]) {
      const v = cellStyle('PA', { category, verified: true });
      const u = cellStyle('PA', { category, verified: false });
      expect(u.patternId).not.toBe(v.patternId);
    }
  });
  it('out of scope codes are Not covered', () => {
    expect(cellStyle('PR', { category: 'both', verified: true }).label).toBe('Not covered');
    expect(cellStyle('PA', undefined).label).toBe('Not covered');
  });
  it('a jurisdiction with no listed network is not labelled Not covered', () => {
    const st = cellStyle('RI', { category: 'none', verified: true });
    expect(st.label).toBe('None listed in our sources');
    expect(st.patternId).toBeNull();
  });
  it('fills pairwise differ in luminance by at least 0.08', () => {
    const l = CATS.map((category) => lum(cellStyle('PA', { category, verified: true }).fill));
    for (let i = 0; i < l.length; i++)
      for (let j = i + 1; j < l.length; j++) expect(Math.abs(l[i] - l[j])).toBeGreaterThanOrEqual(0.08);
  });
  it('legend has required entries', () => {
    const labels = LEGEND.map((e) => e.label);
    expect(labels).toContain('Network operates here; use-case detail pending');
    expect(labels).toContain('National routes (QHINs, vendor networks, payer APIs, Direct) are not tied to one state');
  });
});
