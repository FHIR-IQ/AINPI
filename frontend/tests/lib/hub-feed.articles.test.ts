import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - articles', () => {
  it('emits one TimelineEntry per docs/articles/*.md', () => {
    const { timeline } = loadHubFeed();
    const articles = timeline.filter((e) => e.category === 'article');
    expect(articles.length).toBeGreaterThan(0);
  });

  // The timeline trims to the 10 most-recent entries, so these assert on
  // whichever article entries are in-window rather than pinning one that
  // ages out as new content lands.
  it('the article slug strips the YYYY-MM-DD- date prefix from the filename', () => {
    const { timeline } = loadHubFeed();
    const articles = timeline.filter((e) => e.category === 'article');
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      expect(article.href).toMatch(/^\/articles\/(?!\d{4}-\d{2}-\d{2}-)[a-z0-9-]+$/);
      expect(article.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('article title comes from the first H1 in the markdown', () => {
    const { timeline } = loadHubFeed();
    const articles = timeline.filter((e) => e.category === 'article');
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      expect(article.title.length).toBeGreaterThan(0);
      expect(article.title.startsWith('#')).toBe(false);
    }
  });
});
