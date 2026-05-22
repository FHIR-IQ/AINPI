/**
 * /findings hub data layer.
 *
 * Aggregates published findings, release updates, articles, and methodology
 * version bumps into a single typed HubFeed consumed by the hub page and the
 * homepage's "Latest" strip. All filesystem reads happen at build time —
 * `loadHubFeed()` is only called from server components.
 */

export type TimelineCategory = 'finding' | 'update' | 'article' | 'methodology';
/**
 * Status of a published finding.
 * - `published` — finding has a result (positive or negative numerator).
 * - `pre-registered` — finding catalog entry only; results not yet computed.
 * - `null` — the null hypothesis was NOT rejected; result is reported as null.
 */
export type TimelineStatus = 'published' | 'pre-registered' | 'null';

export interface TimelineEntry {
  /** ISO date (YYYY-MM-DD). Canonical sort key. */
  date: string;
  category: TimelineCategory;
  /** Set only when `category === 'finding'`. */
  status?: TimelineStatus;
  title: string;
  /** One-sentence why-it-matters. Plain text; no markdown. */
  summary: string;
  /** Internal path; renderer wraps in next/link. */
  href: string;
  /** H-numbers bundled into this entry (a single update can span H29–H36). */
  hNumbers?: string[];
}

export interface CatalogRow {
  hNumber: string;
  title: string;
  slug: string;
  /** ISO date. */
  updated: string;
  status: TimelineStatus;
}

export interface LeadStoryItem extends TimelineEntry {
  /** Primary-source verification chips shown in the hero. */
  verifyChips?: { label: 'LEIE' | 'SAM' | 'NPPES'; url: string }[];
  /** Stat row shown in the hero; omit when finding has no `heroStats`. */
  heroStats?: { label: string; value: string }[];
  /** CTA button text. Fixed; the lead identity lives in the headline. */
  ctaLabel: string;
  /** CTA destination. Usually `href` itself. */
  ctaHref: string;
}

export interface HubFeed {
  lead: LeadStoryItem;
  /** 10 most recent timeline entries, lead excluded. */
  timeline: TimelineEntry[];
  /** All catalog rows; sortable in the UI but loader returns default sort. */
  catalog: CatalogRow[];
}

// Implementation lives in subsequent tasks.
export function loadHubFeed(): HubFeed {
  throw new Error('loadHubFeed not yet implemented');
}
