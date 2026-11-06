import type { NetworksPayload } from '@/lib/api-v1-types';
import { FINDINGS } from '@/data/findings';

/**
 * The finding slugs that networks.json links to and that are published, in
 * first-reference order. Server-only: it reads the findings catalog, which is
 * too large to ship to the browser, and hands the client a plain array.
 */
export function publishedFindingSlugs(p: NetworksPayload): string[] {
  const published = new Set(FINDINGS.filter((f) => f.status === 'published').map((f) => f.slug));
  const out: string[] = [];
  for (const links of [...p.use_cases.map((u) => u.ainpi_links), ...p.routes.map((r) => r.ainpi_links)]) {
    for (const l of links) {
      if (l.finding_slug && published.has(l.finding_slug) && !out.includes(l.finding_slug)) out.push(l.finding_slug);
    }
  }
  return out;
}
