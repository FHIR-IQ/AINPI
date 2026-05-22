import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - articles', () => {
  it('emits one TimelineEntry per docs/articles/*.md', () => {
    const { timeline } = loadHubFeed();
    const articles = timeline.filter((e) => e.category === 'article');
    expect(articles.length).toBeGreaterThan(0);
  });

  it('the article slug strips the YYYY-MM-DD- date prefix from the filename', () => {
    const { timeline } = loadHubFeed();
    const article = timeline.find((e) => e.href === '/articles/eight-years-post-exclusion');
    expect(article).toBeDefined();
    expect(article?.category).toBe('article');
    expect(article?.date).toBe('2026-05-22');
  });

  it('article title comes from the first H1 in the markdown', () => {
    const { timeline } = loadHubFeed();
    const article = timeline.find((e) => e.href === '/articles/eight-years-post-exclusion');
    expect(article?.title).toMatch(/Eight years post-exclusion/);
  });
});
