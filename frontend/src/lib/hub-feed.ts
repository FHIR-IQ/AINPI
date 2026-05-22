/**
 * /findings hub data layer.
 *
 * Aggregates published findings, release updates, articles, and methodology
 * version bumps into a single typed HubFeed consumed by the hub page and the
 * homepage's "Latest" strip. All filesystem reads happen at build time —
 * `loadHubFeed()` is only called from server components.
 */

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { FINDINGS, type Finding, type FindingStatus } from '@/data/findings';
import { REPORTS, type ReportOption } from '@/data/reports';

// Next.js runs from frontend/, so repo root is one level up
const REPO_ROOT = path.join(process.cwd(), '..');
const ARTICLES_DIR = path.join(REPO_ROOT, 'docs', 'articles');
const VERSION_LOG_PATH = path.join(REPO_ROOT, 'docs', 'methodology', 'version-log.md');

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

/** Map FindingStatus from findings.ts to the hub-feed TimelineStatus literal. */
function normalizeStatus(s: FindingStatus): TimelineStatus {
  if (s === 'pre-registered') return 'pre-registered';
  if (s === 'in-progress') return 'pre-registered';
  return 'published';
}

/**
 * Extract a per-finding updated date. v1 uses the first H-number in the
 * hypotheses array as a tag and looks up the most recent reports.ts entry
 * mentioning that H-number. If no match, falls back to a sensible default
 * (2026-05-08 — the date H1-H28 were captured against). Later refinement
 * could maintain a per-finding `updated` field on findings.ts directly.
 */
function findingUpdatedDate(f: Finding): string {
  // v1 simplification: use the most-recently-published bundle date that
  // touches any of this finding's H-numbers. Implementation arrives in
  // Task 4 when we wire reports.ts. For now, use a static lookup that
  // gets a reasonable date from the H-number range.
  const hNum = parseInt(f.hypotheses[0]?.replace(/[^\d]/g, '') || '0', 10);
  if (hNum >= 40) return '2026-05-22';
  if (hNum >= 37) return '2026-05-18';
  if (hNum >= 29) return '2026-05-14';
  if (hNum >= 27) return '2026-05-08';
  if (hNum >= 23) return '2026-05-02';
  return '2026-05-08';
}

/**
 * The reports.ts version field is the canonical date prefix for web reports.
 * Format: '2026-05-22-update' → '2026-05-22'. Returns null for reports whose
 * version doesn't carry an ISO date prefix.
 */
function reportDate(r: ReportOption): string | null {
  const m = r.version.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function reportsToTimelineEntries(): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const r of REPORTS) {
    if (r.format !== 'web') continue; // Skip PDF + CSV reports
    // va-briefing is format:'web' but lives at /briefings/va — without this
    // filter, briefings and any future web-format docs would bleed into the
    // release-updates feed.
    if (!r.url.startsWith('/reports/')) continue;
    const date = reportDate(r);
    if (!date) continue;
    out.push({
      date,
      category: 'update',
      title: r.title,
      summary: r.description,
      href: r.url,
    });
  }
  return out;
}

function articlesToTimelineEntries(): TimelineEntry[] {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  const out: TimelineEntry[] = [];
  for (const name of fs.readdirSync(ARTICLES_DIR)) {
    if (!name.endsWith('.md')) continue;
    const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
    if (!dateMatch) continue;
    const [, date, slug] = dateMatch;
    const filepath = path.join(ARTICLES_DIR, name);
    const raw = fs.readFileSync(filepath, 'utf-8');
    const { content } = matter(raw);
    const h1 = content.match(/^#\s+(.+)$/m);
    const title = h1 ? h1[1].trim() : slug.replace(/-/g, ' ');
    // First substantive paragraph after the H1 becomes the summary.
    const afterH1 = content.split(/^#\s+.+$/m)[1] ?? '';
    const firstPara = afterH1
      .split(/\n\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('*') && !p.startsWith('#'));
    const summary = firstPara ? firstPara.slice(0, 220) : '';
    out.push({
      date,
      category: 'article',
      title,
      summary,
      href: `/articles/${slug}`,
    });
  }
  return out;
}

export interface VersionLogEntry {
  version: string;
  date: string;
  summary: string;
}

function methodologyToTimelineEntries(): TimelineEntry[] {
  if (!fs.existsSync(VERSION_LOG_PATH)) return [];
  const raw = fs.readFileSync(VERSION_LOG_PATH, 'utf-8');
  const { data } = matter(raw);
  const versions = ((data.versions as VersionLogEntry[]) ?? []).filter(
    (v) => v && v.version && v.date && v.summary,
  );
  return versions.map((v) => ({
    date: v.date,
    category: 'methodology' as const,
    title: `Methodology v${v.version}`,
    summary: v.summary,
    href: '/methodology',
  }));
}

function publishedFindingsToTimelineEntries(): TimelineEntry[] {
  return FINDINGS.filter((f) => f.status === 'published').map((f) => ({
    date: findingUpdatedDate(f),
    category: 'finding' as const,
    status: 'published' as const,
    title: f.title,
    summary: f.ogTagline ?? f.summary.slice(0, 220),
    href: `/findings/${f.slug}`,
    hNumbers: f.hypotheses,
  }));
}

function findingsToCatalog(): CatalogRow[] {
  return FINDINGS.map((f) => ({
    hNumber: f.hypotheses[0] ?? 'H?',
    title: f.title,
    slug: f.slug,
    updated: findingUpdatedDate(f),
    status: normalizeStatus(f.status),
  })).sort((a, b) => b.updated.localeCompare(a.updated));
}

export function loadHubFeed(): HubFeed {
  const catalog = findingsToCatalog();
  const timeline = [
    ...publishedFindingsToTimelineEntries(),
    ...reportsToTimelineEntries(),
    ...articlesToTimelineEntries(),
    ...methodologyToTimelineEntries(),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const placeholderLead: LeadStoryItem = {
    date: '2026-05-22',
    category: 'finding',
    status: 'published',
    title: '__lead_placeholder__',
    summary: '__lead_placeholder__',
    href: '/findings',
    ctaLabel: 'Open finding →',
    ctaHref: '/findings',
  };
  return {
    lead: placeholderLead,
    timeline,
    catalog,
  };
}
