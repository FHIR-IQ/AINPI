import type { NetworksPayload } from '@/lib/api-v1-types';
import { FINDINGS } from '@/data/findings';

/**
 * The distinct finding slugs that networks.json links to and that are
 * published. Server-only: it reads the findings catalog, which is too large to
 * ship to the browser, and hands the client a plain array.
 */
export function publishedFindingSlugs(p: NetworksPayload): string[] {
  const published = new Set(FINDINGS.filter((f) => f.status === 'published').map((f) => f.slug));
  const linked = [...p.use_cases, ...p.routes].flatMap((x) => x.ainpi_links).map((l) => l.finding_slug);
  return [...new Set(linked)].filter((s): s is string => s !== undefined && published.has(s));
}
