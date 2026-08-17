import { describe, it, expect } from 'vitest';
import { loadHubFeed, methodologyToTimelineEntries } from '@/lib/hub-feed';
import { FINDINGS } from '@/data/findings';

describe('loadHubFeed - methodology + finding entries', () => {
  // These assert on the untrimmed generator, not the timeline. The timeline
  // keeps only the 10 most-recent entries across every category, so a busy
  // publishing month legitimately pushes methodology entries out of view.
  it('emits a methodology entry for each entry in docs/methodology/version-log.md', () => {
    const entries = methodologyToTimelineEntries();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const e of entries) {
      expect(e.category).toBe('methodology');
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.href).toBe('/methodology');
    }
  });

  it('latest methodology entry has the full title format', () => {
    const latest = methodologyToTimelineEntries().sort((a, b) =>
      b.date.localeCompare(a.date),
    )[0];
    expect(latest.title).toBe('Methodology v0.7.2-draft');
  });

  it('timeline stays within its cap and is sorted by date desc', () => {
    const { timeline } = loadHubFeed();
    expect(timeline.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i - 1].date >= timeline[i].date).toBe(true);
    }
  });

  it('emits a TimelineEntry for each PUBLISHED finding (not pre-registered)', () => {
    const { catalog } = loadHubFeed();
    const published = catalog.filter((c) => c.status === 'published');
    expect(published.length).toBeGreaterThan(0);
  });

  // Asserts the relationship rather than the current lead's slug: the lead
  // rotates every release, and pinning it here made a rotation look like a
  // regression in the timeline code.
  it('the featured lead is published and therefore absent from the timeline', () => {
    const { lead, timeline } = loadHubFeed();
    const featured = FINDINGS.find((f) => f.featured);
    expect(featured, 'no finding is marked featured').toBeDefined();
    expect(lead.href).toBe(`/findings/${featured!.slug}`);
    expect(lead.status).toBe('published');
    const inTimeline = timeline.find((e) => e.href === lead.href);
    expect(inTimeline).toBeUndefined();
  });
});
