import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - reports', () => {
  it('emits a TimelineEntry for each web-format report', () => {
    const { timeline } = loadHubFeed();
    const updates = timeline.filter((e) => e.category === 'update');
    expect(updates.length).toBeGreaterThan(0);
  });

  it('emits an entry for the 2026-05-22 update', () => {
    const { timeline } = loadHubFeed();
    const may22 = timeline.find((e) => e.href === '/reports/2026-05-22-update');
    expect(may22).toBeDefined();
    expect(may22?.category).toBe('update');
    expect(may22?.date).toBe('2026-05-22');
  });

  it('skips non-web report entries (PDF + CSV)', () => {
    const { timeline } = loadHubFeed();
    const excluded = [
      '/downloads/ainpi-state-of-ndh-v1.0.0.pdf',
      '/api/v1/states/va-cohort-critical.csv',
    ];
    for (const url of excluded) {
      expect(timeline.some((e) => e.href === url)).toBe(false);
    }
  });

  it('timeline is sorted by date desc', () => {
    const { timeline } = loadHubFeed();
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i - 1].date >= timeline[i].date).toBe(true);
    }
  });

  it('only includes /reports/* entries; excludes /briefings/* and other web reports', () => {
    const { timeline } = loadHubFeed();
    const updates = timeline.filter((e) => e.category === 'update');
    for (const update of updates) {
      expect(update.href.startsWith('/reports/')).toBe(true);
    }
  });

  it('excludes the va-briefing which is web-format but not a release update', () => {
    const { timeline } = loadHubFeed();
    expect(timeline.some((e) => e.href === '/briefings/va')).toBe(false);
  });
});
