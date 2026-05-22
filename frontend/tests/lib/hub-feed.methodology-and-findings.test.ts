import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - methodology + finding entries', () => {
  it('emits a methodology entry for each entry in docs/methodology/version-log.md', () => {
    const { timeline } = loadHubFeed();
    const methodology = timeline.filter((e) => e.category === 'methodology');
    expect(methodology.length).toBe(3); // current version-log.md has 3 entries
  });

  it('latest methodology entry has the full title format', () => {
    const { timeline } = loadHubFeed();
    const latestMeth = timeline
      .filter((e) => e.category === 'methodology')
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    expect(latestMeth.title).toBe('Methodology v0.7.0-draft');
  });

  it('emits a TimelineEntry for each PUBLISHED finding (not pre-registered)', () => {
    const { timeline } = loadHubFeed();
    const findings = timeline.filter((e) => e.category === 'finding');
    expect(findings.length).toBeGreaterThan(0);
  });

  it('H40 published finding appears in the timeline as a finding entry', () => {
    const { timeline } = loadHubFeed();
    const h40 = timeline.find(
      (e) => e.category === 'finding' && e.href === '/findings/excluded-billing-medicare-partb-by-hcpcs',
    );
    expect(h40).toBeDefined();
    expect(h40?.status).toBe('published');
  });

  it('timeline is sorted by date desc across all four categories', () => {
    const { timeline } = loadHubFeed();
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i - 1].date >= timeline[i].date).toBe(true);
    }
  });
});
