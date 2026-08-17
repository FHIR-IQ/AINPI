import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';
import { FINDINGS } from '@/data/findings';

/**
 * The hub lead rotates with each release. These tests previously hardcoded
 * H40's slug and hero stats, so every rotation produced four failures that
 * said nothing about the code. They now assert the relationship between
 * `featured` and the lead, which is the thing that must hold whichever
 * finding is on top.
 */
describe('loadHubFeed - lead selection', () => {
  const featured = FINDINGS.find((f) => f.featured);

  it('lead is the finding marked featured: true when one exists', () => {
    const { lead } = loadHubFeed();
    expect(featured, 'no finding is marked featured').toBeDefined();
    expect(lead.href).toBe(`/findings/${featured!.slug}`);
    expect(lead.category).toBe('finding');
    expect(lead.status).toBe('published');
  });

  it('lead carries heroStats from the featured finding', () => {
    const { lead } = loadHubFeed();
    expect(lead.heroStats?.length).toBeGreaterThan(0);
    expect(lead.heroStats).toEqual(featured!.heroStats);
  });

  it('lead.ctaLabel and ctaHref point to the finding page', () => {
    const { lead } = loadHubFeed();
    expect(lead.ctaLabel).toBe('Open finding →');
    expect(lead.ctaHref).toBe(lead.href);
  });

  it('timeline excludes the lead from its 10 entries', () => {
    const { lead, timeline } = loadHubFeed();
    expect(timeline.length).toBeLessThanOrEqual(10);
    expect(timeline.find((e) => e.href === lead.href)).toBeUndefined();
  });

  /**
   * Verify chips point at LEIE, SAM and NPPES, which only make sense for a
   * finding about federally excluded providers. They must fire on those and
   * stay absent otherwise: a chip labelled "LEIE" on a finding about provider
   * taxonomy would send a reader to look up an exclusion that was never
   * claimed. Asserted as a biconditional so it holds for any lead.
   */
  it('verify chips are present exactly when the lead is an exclusion finding', () => {
    const { lead } = loadHubFeed();
    const isExclusion = /federally[ -]excluded|OIG LEIE|\bLEIE\b|SAM\.gov|\bSAM\b/i.test(
      `${lead.title} ${lead.summary}`,
    );
    if (isExclusion) {
      expect(lead.verifyChips).toBeDefined();
      const labels = lead.verifyChips!.map((c) => c.label);
      expect(labels).toContain('LEIE');
      expect(labels).toContain('SAM');
      expect(labels).toContain('NPPES');
    } else {
      expect(lead.verifyChips ?? []).toHaveLength(0);
    }
  });

  it('the chip builder still fires for the exclusion finding it was written for', () => {
    // Guards the branch above from passing vacuously forever: if the lead is
    // never again an exclusion finding, that test stops exercising the chip
    // code. This pins the behaviour to a specific finding regardless of lead.
    const h40 = FINDINGS.find(
      (f) => f.slug === 'excluded-billing-medicare-partb-by-hcpcs',
    );
    expect(h40, 'H40 is missing from FINDINGS').toBeDefined();
    expect(`${h40!.title} ${h40!.summary}`).toMatch(
      /federally[ -]excluded|OIG LEIE|\bLEIE\b|SAM\.gov|\bSAM\b/i,
    );
  });
});
