import { describe, it, expect } from 'vitest';
import { FINDINGS } from '@/data/findings';

describe('findings.ts featured flag + heroStats', () => {
  it('exactly one finding is featured: true (hub requires exactly one lead)', () => {
    const featured = FINDINGS.filter((f) => f.featured);
    expect(featured.length).toBe(1);
  });

  it('h40 is the featured finding and carries the v1 hub heroStats', () => {
    const h40 = FINDINGS.find((f) => f.slug === 'excluded-billing-medicare-partb-by-hcpcs');
    expect(h40?.featured).toBe(true);
    expect(h40?.heroStats).toEqual([
      { label: 'Confirmed cases', value: '1' },
      { label: 'CY 2023 paid', value: '$880K' },
      { label: 'Years post-exclusion', value: '8' },
    ]);
  });
});
