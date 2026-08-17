import { describe, it, expect } from 'vitest';
import { FINDINGS } from '@/data/findings';

describe('findings.ts featured flag + heroStats', () => {
  it('exactly one finding is featured: true (hub requires exactly one lead)', () => {
    const featured = FINDINGS.filter((f) => f.featured);
    expect(featured.length).toBe(1);
  });

  /**
   * The lead rotates with each release, so pinning it by slug guarantees a
   * false failure every time it moves. This asserts what the hub actually
   * needs: whichever finding leads is published and carries hero stats the
   * block can render. The previous version hardcoded H40 and broke the moment
   * the lead changed, which is a test reporting on its own fixture rather
   * than on the code.
   */
  it('the featured finding is publishable as a lead', () => {
    const lead = FINDINGS.find((f) => f.featured);
    expect(lead, 'no finding is marked featured').toBeDefined();
    expect(lead!.status).toBe('published');
    expect(lead!.heroStats?.length ?? 0).toBeGreaterThan(0);
    for (const stat of lead!.heroStats ?? []) {
      expect(stat.label.length).toBeGreaterThan(0);
      expect(stat.value.length).toBeGreaterThan(0);
    }
  });

  it('every finding carrying heroStats has well-formed ones, lead or not', () => {
    for (const f of FINDINGS.filter((x) => x.heroStats?.length)) {
      expect(f.heroStats!.length, `${f.slug} heroStats`).toBeLessThanOrEqual(4);
      for (const stat of f.heroStats!) {
        expect(stat.label.length, `${f.slug} stat label`).toBeGreaterThan(0);
        expect(stat.value.length, `${f.slug} stat value`).toBeGreaterThan(0);
      }
    }
  });
});
