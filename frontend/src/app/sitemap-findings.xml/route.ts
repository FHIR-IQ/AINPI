import { allSlugs } from '@/data/findings';

/**
 * A second, deliberately small sitemap listing only the pages that carry
 * schema.org/Dataset markup.
 *
 * The main sitemap holds ~10,200 URLs, of which ~10,164 are per-NPI pages.
 * Submitted alone it reports one aggregate coverage number, which cannot
 * answer the only question that matters for Dataset Search: are the findings
 * themselves indexed? Submitting this file as a second sitemap in Search
 * Console gives that subset its own discovered/indexed counts.
 *
 * Listing a URL in more than one sitemap is explicitly allowed by the sitemaps
 * protocol; this is not a duplicate-content signal.
 */
export const dynamic = 'force-static';

const SITE = 'https://ainpi.dev';

export function GET() {
  const paths = [
    '/findings',
    ...allSlugs().map((s) => `/findings/${s}`),
    '/rural-health',
    '/states/pa/rural-health',
  ];

  // Date only: these pages change when a refresh commits new numbers, and a
  // fabricated timestamp would misreport freshness to a crawler.
  const today = new Date().toISOString().slice(0, 10);

  const body = paths
    .map(
      (p) =>
        `  <url>\n    <loc>${SITE}${p}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n  </url>`,
    )
    .join('\n');

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
    {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
      },
    },
  );
}
