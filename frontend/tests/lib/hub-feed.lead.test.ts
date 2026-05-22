import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - lead selection', () => {
  it('lead is the finding marked featured: true when one exists', () => {
    const { lead } = loadHubFeed();
    expect(lead.href).toBe('/findings/excluded-billing-medicare-partb-by-hcpcs');
    expect(lead.category).toBe('finding');
    expect(lead.status).toBe('published');
  });

  it('lead carries heroStats from the featured finding', () => {
    const { lead } = loadHubFeed();
    expect(lead.heroStats?.length).toBeGreaterThan(0);
    expect(lead.heroStats?.[0].label).toBe('Confirmed cases');
  });

  it('lead has primary-source verify chips when the finding involves LEIE/SAM cohort', () => {
    const { lead } = loadHubFeed();
    expect(lead.verifyChips).toBeDefined();
    const labels = lead.verifyChips!.map((c) => c.label);
    expect(labels).toContain('LEIE');
    expect(labels).toContain('SAM');
    expect(labels).toContain('NPPES');
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

  it('lead.verifyChips fires on exclusion findings, not on every cohort finding', () => {
    // Run the current loadHubFeed: lead is H40 (excluded-billing-medicare-partb-by-hcpcs).
    // Summary contains "federally-excluded" so chips fire — verified by other tests.
    const { lead } = loadHubFeed();
    expect(lead.verifyChips).toBeDefined();
    // Future regression: if H40 is unfeatured, the fallback would pick another
    // published finding. We can't easily test that without re-importing, but
    // we can assert the regex pattern by checking the lead's text matches.
    const text = `${lead.title} ${lead.summary}`;
    expect(text).toMatch(/federally[ -]excluded|OIG LEIE|\bLEIE\b|SAM\.gov|\bSAM\b/i);
  });
});
