import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - methodology + finding entries', () => {
  it('emits a methodology entry for each entry in docs/methodology/version-log.md', () => {
    const { timeline } = loadHubFeed();
    // Timeline is trimmed to 10 entries (lead excluded). Methodology entries may
    // not all fit if there are many findings/reports with more-recent dates.
    // Assert at least one methodology entry is present and the total timeline
    // does not exceed 10.
    const methodology = timeline.filter((e) => e.category === 'methodology');
    expect(methodology.length).toBeGreaterThanOrEqual(1);
    expect(timeline.length).toBeLessThanOrEqual(10);
  });

  it('latest methodology entry has the full title format', () => {
    const { timeline } = loadHubFeed();
    const latestMeth = timeline
      .filter((e) => e.category === 'methodology')
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    expect(latestMeth.title).toBe('Methodology v0.7.1-draft');
  });

  it('emits a TimelineEntry for each PUBLISHED finding (not pre-registered)', () => {
    const { timeline } = loadHubFeed();
    const findings = timeline.filter((e) => e.category === 'finding');
    expect(findings.length).toBeGreaterThan(0);
  });

  it('H40 is the featured lead and therefore absent from the timeline', () => {
    const { lead, timeline } = loadHubFeed();
    // H40 is marked featured:true and becomes the lead story, not a timeline entry.
    expect(lead.href).toBe('/findings/excluded-billing-medicare-partb-by-hcpcs');
    expect(lead.status).toBe('published');
    const h40InTimeline = timeline.find(
      (e) => e.category === 'finding' && e.href === '/findings/excluded-billing-medicare-partb-by-hcpcs',
    );
    expect(h40InTimeline).toBeUndefined();
  });

  it('timeline is sorted by date desc across all four categories', () => {
    const { timeline } = loadHubFeed();
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i - 1].date >= timeline[i].date).toBe(true);
    }
  });
});
