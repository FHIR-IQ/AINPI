import { describe, it, expect } from 'vitest';
import { loadFinding, loadFindingDetail } from '@/lib/load-api-v1';

describe('mco-exposure-va finding', () => {
  it('loadFinding returns the typed shape', () => {
    const finding = loadFinding('mco-exposure-va');
    expect(finding).not.toBeNull();
    expect(finding?.slug).toBe('mco-exposure-va');
    expect(finding?.hypotheses).toEqual(['H26']);
    expect(typeof finding?.numerator).toBe('number');
    expect(typeof finding?.denominator).toBe('number');
    expect(finding?.chart?.data?.length).toBeGreaterThan(0);
  });

  it('loadFindingDetail returns mcos + samples + limitations', () => {
    const detail = loadFindingDetail('mco-exposure-va') as {
      mcos: { name: string; matched: number; queried: number; errors: number }[];
      samples: unknown[];
      limitations: string[];
    } | null;
    expect(detail).not.toBeNull();
    expect(detail?.mcos.length).toBeGreaterThanOrEqual(2);
    expect(detail?.limitations.length).toBeGreaterThanOrEqual(3);
    for (const m of detail?.mcos ?? []) {
      expect(typeof m.name).toBe('string');
      expect(m.queried).toBeGreaterThanOrEqual(0);
      expect(m.matched).toBeGreaterThanOrEqual(0);
      expect(m.matched).toBeLessThanOrEqual(m.queried);
    }
  });
});
