import { loadHubFeed } from '@/lib/hub-feed';

/**
 * RSS 2.0 feed over the same aggregated timeline the findings hub renders:
 * published findings, release updates, articles and methodology bumps.
 *
 * A research project that publishes on a cadence should be followable without
 * handing over an email address. It also gives Substack, feed readers and
 * aggregators a machine-readable way to pick work up, which is distribution
 * the newsletter cannot reach.
 *
 * Static: the feed only changes when content is rebuilt and deployed.
 */
export const dynamic = 'force-static';

const SITE = 'https://ainpi.dev';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function GET() {
  const { lead, timeline } = loadHubFeed();

  // Lead first, then the timeline, newest first.
  const items = [lead, ...timeline]
    .filter((e, i, arr) => arr.findIndex((x) => x.href === e.href) === i)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 40);

  const body = items
    .map((e) => {
      const url = `${SITE}${e.href}`;
      // RFC 822 date, midday UTC so a date-only value cannot slip a day
      // backwards in a reader west of Greenwich.
      const pub = new Date(`${e.date}T12:00:00Z`).toUTCString();
      return `    <item>
      <title>${esc(e.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pub}</pubDate>
      <category>${esc(e.category)}</category>
      <description>${esc(e.summary ?? '')}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AINPI: findings and updates</title>
    <link>${SITE}</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
    <description>An open, reproducible audit of the CMS National Provider Directory. Pre-registered findings, release updates and articles.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(`${items[0]?.date ?? '2026-01-01'}T12:00:00Z`).toUTCString()}</lastBuildDate>
${body}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
