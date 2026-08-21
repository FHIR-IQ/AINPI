import { describe, it, expect } from 'vitest';
import { articlesToTimelineEntries, loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - articles', () => {
  // These assert on the generator, not the timeline. The timeline keeps the
  // 10 most-recent entries across every category, so articles age out as
  // findings and reports land. The previous version filtered the timeline and
  // required at least one article, which turned "we published four things
  // this week" into a test failure.
  it('emits one TimelineEntry per docs/articles/*.md', () => {
    expect(articlesToTimelineEntries().length).toBeGreaterThan(0);
  });

  it('the article slug strips the YYYY-MM-DD- date prefix from the filename', () => {
    for (const article of articlesToTimelineEntries()) {
      expect(article.href).toMatch(/^\/articles\/(?!\d{4}-\d{2}-\d{2}-)[a-z0-9-]+$/);
      expect(article.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('article title comes from the first H1 in the markdown', () => {
    for (const article of articlesToTimelineEntries()) {
      expect(article.title.length).toBeGreaterThan(0);
      expect(article.title.startsWith('#')).toBe(false);
    }
  });

  it('any article that is in-window in the timeline is well formed', () => {
    const { timeline } = loadHubFeed();
    for (const a of timeline.filter((e) => e.category === 'article')) {
      expect(a.href).toMatch(/^\/articles\//);
      expect(a.title.length).toBeGreaterThan(0);
    }
  });
});
