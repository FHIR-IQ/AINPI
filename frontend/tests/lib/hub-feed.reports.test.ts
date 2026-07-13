import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - reports', () => {
  it('emits a TimelineEntry for each web-format report', () => {
    const { timeline } = loadHubFeed();
    const updates = timeline.filter((e) => e.category === 'update');
    expect(updates.length).toBeGreaterThan(0);
  });

  // The timeline trims to the 10 most-recent entries, so this asserts on the
  // newest report (stable by construction: REPORTS[0] is the latest web
  // report) rather than pinning a dated one that ages out of the window.
  it('emits an entry for the newest web report with its date derived from the version slug', () => {
    const { timeline } = loadHubFeed();
    const updates = timeline.filter((e) => e.category === 'update');
    expect(updates.length).toBeGreaterThan(0);
    const newest = updates[0];
    expect(newest.href).toMatch(/^\/reports\/\d{4}-\d{2}-\d{2}-/);
    expect(newest.href).toContain(newest.date);
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
