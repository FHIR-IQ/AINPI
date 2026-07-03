import fs from 'node:fs';
import path from 'node:path';
import type { MetadataRoute } from 'next';
import { allSlugs } from '@/data/findings';
import { allStateCodes } from '@/data/states';
import { REPORTS } from '@/data/reports';
import { allCohortNpis } from '@/lib/load-npi-cohort';

const BASE = 'https://ainpi.dev';

// Next.js runs from frontend/, so repo root is one level up (same convention
// as hub-feed.ts).
const ARTICLES_DIR = path.join(process.cwd(), '..', 'docs', 'articles');

function articleSlugs(): string[] {
  try {
    return fs
      .readdirSync(ARTICLES_DIR)
      .filter((n) => n.endsWith('.md'))
      .map((n) => n.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''));
  } catch {
    return [];
  }
}

/**
 * Static sitemap generated at build time. Every public content page is
 * listed; auth-gated and app-utility routes are deliberately absent (they
 * are also disallowed in robots.ts).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: { path: string; priority: number }[] = [
    { path: '/', priority: 1.0 },
    { path: '/findings', priority: 0.9 },
    { path: '/real-health-providers', priority: 0.9 },
    { path: '/map', priority: 0.8 },
    { path: '/methodology', priority: 0.8 },
    { path: '/for-state-medicaid', priority: 0.8 },
    { path: '/smd-revalidation', priority: 0.7 },
    { path: '/smd-revalidation/cross-audit-roadmap', priority: 0.5 },
    { path: '/pecos', priority: 0.7 },
    { path: '/states', priority: 0.7 },
    { path: '/data-sources', priority: 0.6 },
    { path: '/data-quality', priority: 0.6 },
    { path: '/npd', priority: 0.6 },
    { path: '/npi', priority: 0.7 },
    { path: '/provider-search', priority: 0.6 },
    { path: '/insights', priority: 0.5 },
    { path: '/developer', priority: 0.5 },
    { path: '/briefings/va', priority: 0.5 },
    { path: '/download', priority: 0.5 },
    { path: '/subscribe', priority: 0.5 },
    { path: '/faq', priority: 0.3 },
    { path: '/privacy', priority: 0.2 },
    { path: '/security', priority: 0.2 },
  ];

  const entries: MetadataRoute.Sitemap = staticPages.map((p) => ({
    url: `${BASE}${p.path}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: p.priority,
  }));

  for (const slug of allSlugs()) {
    entries.push({
      url: `${BASE}/findings/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    });
  }

  for (const code of allStateCodes()) {
    entries.push({
      url: `${BASE}/states/${code.toLowerCase()}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.6,
    });
    entries.push({
      url: `${BASE}/for-state-medicaid/${code.toLowerCase()}`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    });
  }

  for (const r of REPORTS) {
    if (r.format === 'web' && r.url.startsWith('/reports/')) {
      entries.push({
        url: `${BASE}${r.url}`,
        lastModified: now,
        changeFrequency: 'monthly',
        priority: 0.6,
      });
    }
  }

  for (const npi of allCohortNpis()) {
    entries.push({
      url: `${BASE}/npi/${npi}`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    });
  }

  for (const slug of articleSlugs()) {
    entries.push({
      url: `${BASE}/articles/${slug}`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    });
  }

  return entries;
}
