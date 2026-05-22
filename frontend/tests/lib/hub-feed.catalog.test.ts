import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - catalog', () => {
  it('returns a catalog row for every finding in FINDINGS', () => {
    const { catalog } = loadHubFeed();
    expect(catalog.length).toBeGreaterThan(20); // 27 findings as of 2026-05-22
  });

  it('catalog rows map status to the canonical TimelineStatus literals', () => {
    const { catalog } = loadHubFeed();
    const statuses = new Set(catalog.map((r) => r.status));
    for (const s of statuses) {
      expect(['published', 'pre-registered', 'null']).toContain(s);
    }
  });

  it('catalog includes a row for H40 with status published', () => {
    const { catalog } = loadHubFeed();
    const h40 = catalog.find((r) => r.slug === 'excluded-billing-medicare-partb-by-hcpcs');
    expect(h40?.hNumber).toBe('H40');
    expect(h40?.status).toBe('published');
  });

  it('catalog rows carry an updated date that parses as ISO YYYY-MM-DD', () => {
    const { catalog } = loadHubFeed();
    for (const row of catalog) {
      expect(row.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('catalog is sorted by updated date desc by default', () => {
    const { catalog } = loadHubFeed();
    for (let i = 1; i < catalog.length; i++) {
      expect(catalog[i - 1].updated >= catalog[i].updated).toBe(true);
    }
  });
});
