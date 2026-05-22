# Findings hub redesign — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current flat `/findings` index with a three-section hub (hero + timeline + catalog) sourced from a new `loadHubFeed()` build-time aggregator, plus add a slim "Latest from AINPI" strip below the map on the homepage.

**Architecture:** New shared data loader at `frontend/src/lib/hub-feed.ts` aggregates published findings (`frontend/src/data/findings.ts`), release updates (`frontend/src/data/reports.ts`), articles (`docs/articles/*.md` filesystem scan), and methodology version bumps (a new `docs/methodology/version-log.md` with YAML frontmatter) into typed `HubFeed`. New components under `frontend/src/components/findings-hub/` consume that typed data. `/findings/page.tsx` is replaced; `/page.tsx` gets a small strip added at the bottom.

**Tech Stack:** Next.js 14 App Router (force-static SSG), TypeScript, Tailwind CSS, gray-matter for YAML frontmatter parsing (already used by `loadMarkdown`), Vitest + React Testing Library for unit tests, Playwright for E2E. No new runtime dependencies.

**Spec resolutions** (the three open considerations called out in the spec):

- **Methodology version-log source:** new file `docs/methodology/version-log.md` with a `versions:` array in frontmatter (one entry per past methodology version). v1 maintains it manually; no git-log parsing.
- **Featured flag on findings:** single boolean `featured?: boolean` on `Finding` (most one at a time; first match wins; falls back to most recent published finding when none is set).
- **Hero stats fallback:** optional `heroStats?: { label: string; value: string }[]` on `Finding`; the `LeadStory` block conditionally renders the stat row only when this array is populated.

---

## Task 0: Branch setup

**Files:** none yet — branch only.

- [ ] **Step 0.1: Cut a feature branch off main**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git checkout main
git pull --ff-only origin main
git checkout -b findings-hub-redesign-v1
```

- [ ] **Step 0.2: Confirm baseline build is clean**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: build succeeds (compiles); no need for it to be perfect, just confirming we're starting from a known-good state.

---

## Task 1: Methodology version log + base type definitions

**Files:**

- Create: `docs/methodology/version-log.md`
- Create: `frontend/src/lib/hub-feed.ts` (types only in this task)
- Test: `frontend/tests/lib/hub-feed.types.test.ts`

- [ ] **Step 1.1: Create methodology version log**

Write to `docs/methodology/version-log.md`:

```markdown
---
versions:
  - version: '0.7.0-draft'
    date: '2026-05-18'
    summary: 'PECOS-as-authoritative workstream (H37-H39) shipped; all-states claims-side cross-audit (H29-H36) covers 50 states + DC + PR; map-first homepage and CMO-facing per-state surface.'
  - version: '0.6.1-draft'
    date: '2026-05-14'
    summary: 'Strict post-exclusion attribution propagated through H29 / H30a / H30b / H32; H35 Stage B PPEF cross-walk fixed the structural null.'
  - version: '0.6.0-draft'
    date: '2026-05-08'
    summary: 'May NDH release ingested; first release-to-release deltas published.'
---

# Methodology version log

This file maps each historical methodology version to a release date and a one-line summary. The findings hub at `/findings` reads the frontmatter to surface methodology bumps as entries in the unified timeline.

Each entry is a contract: the corresponding `docs/methodology/index.md` content reflects that version's state at the date listed. Bump the top entry whenever `docs/methodology/index.md`'s `version` frontmatter changes.
```

- [ ] **Step 1.2: Write the failing type-shape test**

Write to `frontend/tests/lib/hub-feed.types.test.ts`:

```ts
import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  TimelineEntry,
  CatalogRow,
  LeadStoryItem,
  HubFeed,
} from '@/lib/hub-feed';

describe('hub-feed types', () => {
  it('TimelineEntry has the right shape', () => {
    const entry: TimelineEntry = {
      date: '2026-05-22',
      category: 'finding',
      status: 'published',
      title: 'H40 published',
      summary: '$880K post-exclusion billing',
      href: '/findings/excluded-billing-medicare-partb-by-hcpcs',
      hNumbers: ['H40'],
    };
    expect(entry.category).toBe('finding');
  });

  it('CatalogRow has the right shape', () => {
    const row: CatalogRow = {
      hNumber: 'H40',
      title: 'Federally excluded NPIs billing Medicare Part B by HCPCS',
      slug: 'excluded-billing-medicare-partb-by-hcpcs',
      updated: '2026-05-22',
      status: 'published',
    };
    expect(row.hNumber).toBe('H40');
  });

  it('LeadStoryItem extends TimelineEntry with verify/stats/cta', () => {
    const lead: LeadStoryItem = {
      date: '2026-05-22',
      category: 'finding',
      status: 'published',
      title: '$880K Medicare billing 8 years post-exclusion',
      summary: 'H40 surfaced 4 candidates; primary-source verification confirms 1.',
      href: '/findings/excluded-billing-medicare-partb-by-hcpcs',
      verifyChips: [
        { label: 'LEIE', href: 'https://exclusions.oig.hhs.gov/' },
      ],
      heroStats: [{ label: 'Confirmed', value: '1' }],
      ctaLabel: 'Open finding →',
      ctaHref: '/findings/excluded-billing-medicare-partb-by-hcpcs',
    };
    expect(lead.ctaLabel).toBe('Open finding →');
  });

  it('HubFeed bundles lead + timeline + catalog', () => {
    expectTypeOf<HubFeed>().toMatchTypeOf<{
      lead: LeadStoryItem;
      timeline: TimelineEntry[];
      catalog: CatalogRow[];
    }>();
  });
});
```

- [ ] **Step 1.3: Run the failing test**

```bash
cd frontend && npx vitest run tests/lib/hub-feed.types.test.ts
```

Expected: FAIL — module `@/lib/hub-feed` not found.

- [ ] **Step 1.4: Write the type definitions**

Write to `frontend/src/lib/hub-feed.ts`:

```ts
/**
 * /findings hub data layer.
 *
 * Aggregates published findings, release updates, articles, and methodology
 * version bumps into a single typed HubFeed consumed by the hub page and the
 * homepage's "Latest" strip. All filesystem reads happen at build time —
 * `loadHubFeed()` is only called from server components.
 */

export type TimelineCategory = 'finding' | 'update' | 'article' | 'methodology';
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
  verifyChips?: { label: 'LEIE' | 'SAM' | 'NPPES'; href: string }[];
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
```

- [ ] **Step 1.5: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/lib/hub-feed.types.test.ts
```

Expected: PASS.

- [ ] **Step 1.6: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add docs/methodology/version-log.md frontend/src/lib/hub-feed.ts frontend/tests/lib/hub-feed.types.test.ts
git commit -m "hub: types + methodology version log scaffold"
```

---

## Task 2: Add `featured` + `heroStats` to the Finding interface

**Files:**

- Modify: `frontend/src/data/findings.ts`
- Modify: `frontend/src/data/findings.ts` (set `featured: true` + `heroStats` on H40 entry for v1 lead)
- Test: `frontend/tests/data/findings-featured.test.ts`

- [ ] **Step 2.1: Write the failing test**

Write to `frontend/tests/data/findings-featured.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FINDINGS, type Finding } from '@/data/findings';

describe('findings.ts featured flag + heroStats', () => {
  it('at most one finding has featured: true', () => {
    const featured = FINDINGS.filter((f) => f.featured);
    expect(featured.length).toBeLessThanOrEqual(1);
  });

  it('h40 is featured and carries heroStats for the v1 hub launch', () => {
    const h40 = FINDINGS.find((f) => f.slug === 'excluded-billing-medicare-partb-by-hcpcs');
    expect(h40?.featured).toBe(true);
    expect(h40?.heroStats?.length).toBeGreaterThan(0);
    expect(h40?.heroStats?.[0].label).toBeDefined();
    expect(h40?.heroStats?.[0].value).toBeDefined();
  });

  it('Finding interface accepts featured + heroStats as optional', () => {
    const f: Partial<Finding> = { featured: true, heroStats: [{ label: 'x', value: '1' }] };
    expect(f.featured).toBe(true);
  });
});
```

- [ ] **Step 2.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/data/findings-featured.test.ts
```

Expected: FAIL — `featured` and `heroStats` not in interface; H40 entry has neither.

- [ ] **Step 2.3: Extend the Finding interface**

Edit `frontend/src/data/findings.ts`, find the `Finding` interface definition, and add two optional fields:

```ts
export interface Finding {
  slug: string;
  hypotheses: string[];
  title: string;
  summary: string;
  nullHypothesis: string;
  denominator: string;
  dataSource: string;
  status: FindingStatus;
  ogTagline?: string;
  implications?: Implication[];
  /** Marks this finding as the hub's lead story. At most one finding may be featured. */
  featured?: boolean;
  /** Stat row pairs shown in the hub hero block. Omit to render headline-only. */
  heroStats?: { label: string; value: string }[];
}
```

- [ ] **Step 2.4: Set the v1 lead on H40**

In `frontend/src/data/findings.ts`, locate the entry with `slug: 'excluded-billing-medicare-partb-by-hcpcs'` and add the two fields immediately after `ogTagline`:

```ts
    ogTagline:
      'Sharpens H30a from "billed Part B" to per-HCPCS, per-place-of-service post-exclusion billing — the per-claim recoupment unit.',
    featured: true,
    heroStats: [
      { label: 'Confirmed cases', value: '1' },
      { label: 'CY 2023 paid', value: '$880K' },
      { label: 'Years post-exclusion', value: '8' },
    ],
    implications: [
```

- [ ] **Step 2.5: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/data/findings-featured.test.ts
```

Expected: PASS.

- [ ] **Step 2.6: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/data/findings.ts frontend/tests/data/findings-featured.test.ts
git commit -m "hub: add featured + heroStats fields, mark H40 as v1 lead"
```

---

## Task 3: `loadHubFeed()` — catalog rows from FINDINGS

**Files:**

- Modify: `frontend/src/lib/hub-feed.ts`
- Test: `frontend/tests/lib/hub-feed.catalog.test.ts`

- [ ] **Step 3.1: Write the failing test**

Write to `frontend/tests/lib/hub-feed.catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - catalog', () => {
  it('returns a catalog row for every finding in FINDINGS', () => {
    const { catalog } = loadHubFeed();
    expect(catalog.length).toBeGreaterThan(40); // we have 42+ findings
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
```

- [ ] **Step 3.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/lib/hub-feed.catalog.test.ts
```

Expected: FAIL — `loadHubFeed` throws "not yet implemented".

- [ ] **Step 3.3: Implement catalog loader**

Edit `frontend/src/lib/hub-feed.ts` and replace the throwing `loadHubFeed` with a real implementation. Replace the `// Implementation lives in subsequent tasks.` block and `throw new Error` line with:

```ts
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { FINDINGS, type Finding, type FindingStatus } from '@/data/findings';

// Next.js runs from frontend/, so repo root is one level up
const REPO_ROOT = path.join(process.cwd(), '..');

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
  // Lead + timeline are filled in subsequent tasks. Provide a placeholder
  // lead so the type is satisfied during this task's tests.
  const placeholderLead: LeadStoryItem = {
    date: '2026-05-22',
    category: 'finding',
    status: 'published',
    title: 'loadHubFeed lead pending later tasks',
    summary: 'Lead selection logic is added in Task 7.',
    href: '/findings',
    ctaLabel: 'Open finding →',
    ctaHref: '/findings',
  };
  return {
    lead: placeholderLead,
    timeline: [],
    catalog,
  };
}
```

- [ ] **Step 3.4: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/lib/hub-feed.catalog.test.ts
```

Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/lib/hub-feed.ts frontend/tests/lib/hub-feed.catalog.test.ts
git commit -m "hub(catalog): load + sort findings into CatalogRow[]"
```

---

## Task 4: `loadHubFeed()` — reports + finding date refinement

**Files:**

- Modify: `frontend/src/lib/hub-feed.ts`
- Test: `frontend/tests/lib/hub-feed.reports.test.ts`

- [ ] **Step 4.1: Write the failing test**

Write to `frontend/tests/lib/hub-feed.reports.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - reports', () => {
  it('emits a TimelineEntry for each web-format report', () => {
    const { timeline } = loadHubFeed();
    const updates = timeline.filter((e) => e.category === 'update');
    expect(updates.length).toBeGreaterThan(0);
  });

  it('emits an entry for the 2026-05-22 update', () => {
    const { timeline } = loadHubFeed();
    const may22 = timeline.find((e) => e.href === '/reports/2026-05-22-update');
    expect(may22).toBeDefined();
    expect(may22?.category).toBe('update');
    expect(may22?.date).toBe('2026-05-22');
  });

  it('skips CSV format report entries (only web-format reports become timeline updates)', () => {
    const { timeline } = loadHubFeed();
    const csvLikeEntries = timeline.filter((e) => e.href.endsWith('.csv'));
    expect(csvLikeEntries.length).toBe(0);
  });

  it('timeline is sorted by date desc', () => {
    const { timeline } = loadHubFeed();
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i - 1].date >= timeline[i].date).toBe(true);
    }
  });
});
```

- [ ] **Step 4.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/lib/hub-feed.reports.test.ts
```

Expected: FAIL — `timeline` is empty.

- [ ] **Step 4.3: Wire reports.ts into the timeline**

Edit `frontend/src/lib/hub-feed.ts`. Add an import:

```ts
import { REPORTS, type ReportOption } from '@/data/reports';
```

Add a helper near `findingsToCatalog`:

```ts
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
    const date = reportDate(r);
    if (!date) continue;
    out.push({
      date,
      category: 'update',
      title: r.title,
      summary: r.description,
      href: r.url.startsWith('http') ? r.url : r.url,
    });
  }
  return out;
}
```

Update `loadHubFeed`:

```ts
export function loadHubFeed(): HubFeed {
  const catalog = findingsToCatalog();
  const timeline = reportsToTimelineEntries().sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const placeholderLead: LeadStoryItem = {
    date: '2026-05-22',
    category: 'finding',
    status: 'published',
    title: 'loadHubFeed lead pending later tasks',
    summary: 'Lead selection logic is added in Task 7.',
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
```

- [ ] **Step 4.4: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/lib/hub-feed.reports.test.ts
```

Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/lib/hub-feed.ts frontend/tests/lib/hub-feed.reports.test.ts
git commit -m "hub(timeline): include web-format reports as update entries"
```

---

## Task 5: `loadHubFeed()` — articles filesystem scan

**Files:**

- Modify: `frontend/src/lib/hub-feed.ts`
- Test: `frontend/tests/lib/hub-feed.articles.test.ts`

- [ ] **Step 5.1: Write the failing test**

Write to `frontend/tests/lib/hub-feed.articles.test.ts`:

```ts
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
```

- [ ] **Step 5.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/lib/hub-feed.articles.test.ts
```

Expected: FAIL — no `article`-category entries.

- [ ] **Step 5.3: Wire articles into the timeline**

Edit `frontend/src/lib/hub-feed.ts`. Add a helper near `reportsToTimelineEntries`:

```ts
const ARTICLES_DIR = path.join(REPO_ROOT, 'docs', 'articles');

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
```

Update `loadHubFeed`:

```ts
export function loadHubFeed(): HubFeed {
  const catalog = findingsToCatalog();
  const timeline = [
    ...reportsToTimelineEntries(),
    ...articlesToTimelineEntries(),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const placeholderLead: LeadStoryItem = {
    date: '2026-05-22',
    category: 'finding',
    status: 'published',
    title: 'loadHubFeed lead pending later tasks',
    summary: 'Lead selection logic is added in Task 7.',
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
```

- [ ] **Step 5.4: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/lib/hub-feed.articles.test.ts
```

Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/lib/hub-feed.ts frontend/tests/lib/hub-feed.articles.test.ts
git commit -m "hub(timeline): include docs/articles/*.md as article entries"
```

---

## Task 6: `loadHubFeed()` — methodology version bumps + published-finding entries

**Files:**

- Modify: `frontend/src/lib/hub-feed.ts`
- Test: `frontend/tests/lib/hub-feed.methodology-and-findings.test.ts`

- [ ] **Step 6.1: Write the failing test**

Write to `frontend/tests/lib/hub-feed.methodology-and-findings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - methodology + finding entries', () => {
  it('emits a methodology entry for each entry in docs/methodology/version-log.md', () => {
    const { timeline } = loadHubFeed();
    const methodology = timeline.filter((e) => e.category === 'methodology');
    expect(methodology.length).toBeGreaterThan(0);
  });

  it('latest methodology entry is v0.7.0-draft', () => {
    const { timeline } = loadHubFeed();
    const latestMeth = timeline
      .filter((e) => e.category === 'methodology')
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    expect(latestMeth.title).toMatch(/0\.7\.0/);
  });

  it('emits a TimelineEntry for each PUBLISHED finding (not pre-registered)', () => {
    const { timeline } = loadHubFeed();
    const findings = timeline.filter((e) => e.category === 'finding');
    expect(findings.length).toBeGreaterThan(0);
  });

  it('H40 published finding appears in the timeline as a finding entry', () => {
    const { timeline } = loadHubFeed();
    const h40 = timeline.find(
      (e) => e.category === 'finding' && e.href === '/findings/excluded-billing-medicare-partb-by-hcpcs',
    );
    expect(h40).toBeDefined();
    expect(h40?.status).toBe('published');
  });

  it('timeline is sorted by date desc across all four categories', () => {
    const { timeline } = loadHubFeed();
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i - 1].date >= timeline[i].date).toBe(true);
    }
  });
});
```

- [ ] **Step 6.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/lib/hub-feed.methodology-and-findings.test.ts
```

Expected: FAIL — methodology + finding entries missing.

- [ ] **Step 6.3: Wire methodology + published findings**

Edit `frontend/src/lib/hub-feed.ts`. Add helpers near `articlesToTimelineEntries`:

```ts
const VERSION_LOG_PATH = path.join(REPO_ROOT, 'docs', 'methodology', 'version-log.md');

interface VersionLogEntry {
  version: string;
  date: string;
  summary: string;
}

function methodologyToTimelineEntries(): TimelineEntry[] {
  if (!fs.existsSync(VERSION_LOG_PATH)) return [];
  const raw = fs.readFileSync(VERSION_LOG_PATH, 'utf-8');
  const { data } = matter(raw);
  const versions = (data.versions as VersionLogEntry[]) ?? [];
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
```

Update `loadHubFeed`:

```ts
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
    title: 'loadHubFeed lead pending later tasks',
    summary: 'Lead selection logic is added in Task 7.',
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
```

- [ ] **Step 6.4: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/lib/hub-feed.methodology-and-findings.test.ts
```

Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/lib/hub-feed.ts frontend/tests/lib/hub-feed.methodology-and-findings.test.ts
git commit -m "hub(timeline): include published findings + methodology version bumps"
```

---

## Task 7: `loadHubFeed()` — lead selection + timeline trim

**Files:**

- Modify: `frontend/src/lib/hub-feed.ts`
- Test: `frontend/tests/lib/hub-feed.lead.test.ts`

- [ ] **Step 7.1: Write the failing test**

Write to `frontend/tests/lib/hub-feed.lead.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadHubFeed } from '@/lib/hub-feed';

describe('loadHubFeed - lead selection', () => {
  it('lead is the finding marked featured: true when one exists', () => {
    const { lead } = loadHubFeed();
    expect(lead.href).toBe('/findings/excluded-billing-medicare-partb-by-hcpcs');
    expect(lead.category).toBe('finding');
    expect(lead.status).toBe('published');
  });

  it('lead carries heroStats from the featured finding', () => {
    const { lead } = loadHubFeed();
    expect(lead.heroStats?.length).toBeGreaterThan(0);
    expect(lead.heroStats?.[0].label).toBe('Confirmed cases');
  });

  it('lead has primary-source verify chips when the finding involves LEIE/SAM cohort', () => {
    const { lead } = loadHubFeed();
    expect(lead.verifyChips).toBeDefined();
    const labels = lead.verifyChips!.map((c) => c.label);
    expect(labels).toContain('LEIE');
    expect(labels).toContain('SAM');
    expect(labels).toContain('NPPES');
  });

  it('lead.ctaLabel and ctaHref point to the finding page', () => {
    const { lead } = loadHubFeed();
    expect(lead.ctaLabel).toBe('Open finding →');
    expect(lead.ctaHref).toBe(lead.href);
  });

  it('timeline excludes the lead from its 10 entries', () => {
    const { lead, timeline } = loadHubFeed();
    expect(timeline.length).toBeLessThanOrEqual(10);
    expect(timeline.find((e) => e.href === lead.href)).toBeUndefined();
  });
});
```

- [ ] **Step 7.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/lib/hub-feed.lead.test.ts
```

Expected: FAIL — placeholder lead in the loader.

- [ ] **Step 7.3: Replace placeholder with real lead selection**

Edit `frontend/src/lib/hub-feed.ts`. Add a helper near the other timeline builders:

```ts
/** Detect cohort-based findings that warrant LEIE/SAM/NPPES verify chips. */
function findingVerifyChips(f: Finding): LeadStoryItem['verifyChips'] {
  const usesCohort =
    /excluded|cohort|LEIE|SAM|NPPES/i.test(f.summary) ||
    /excluded|cohort/i.test(f.title);
  if (!usesCohort) return undefined;
  return [
    { label: 'LEIE', href: 'https://exclusions.oig.hhs.gov/' },
    { label: 'SAM', href: 'https://sam.gov/search/?index=ex' },
    { label: 'NPPES', href: 'https://npiregistry.cms.hhs.gov/' },
  ];
}

function buildLead(allEntries: TimelineEntry[]): LeadStoryItem {
  // Prefer the editor's featured finding if any.
  const featured = FINDINGS.find((f) => f.featured);
  if (featured) {
    return {
      date: findingUpdatedDate(featured),
      category: 'finding',
      status: 'published',
      title: featured.title,
      summary: featured.ogTagline ?? featured.summary.slice(0, 280),
      href: `/findings/${featured.slug}`,
      hNumbers: featured.hypotheses,
      heroStats: featured.heroStats,
      verifyChips: findingVerifyChips(featured),
      ctaLabel: 'Open finding →',
      ctaHref: `/findings/${featured.slug}`,
    };
  }
  // Fallback: latest published finding from the timeline.
  const latest = allEntries.find(
    (e) => e.category === 'finding' && e.status === 'published',
  );
  if (!latest) {
    throw new Error(
      'loadHubFeed: no featured finding and no published finding in timeline; cannot build lead.',
    );
  }
  // We have a TimelineEntry but need the Finding for verifyChips / heroStats.
  const f = FINDINGS.find((x) => `/findings/${x.slug}` === latest.href);
  return {
    ...latest,
    heroStats: f?.heroStats,
    verifyChips: f ? findingVerifyChips(f) : undefined,
    ctaLabel: 'Open finding →',
    ctaHref: latest.href,
  };
}
```

Update `loadHubFeed`:

```ts
export function loadHubFeed(): HubFeed {
  const catalog = findingsToCatalog();
  const allEntries = [
    ...publishedFindingsToTimelineEntries(),
    ...reportsToTimelineEntries(),
    ...articlesToTimelineEntries(),
    ...methodologyToTimelineEntries(),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const lead = buildLead(allEntries);
  const timeline = allEntries.filter((e) => e.href !== lead.href).slice(0, 10);
  return { lead, timeline, catalog };
}
```

- [ ] **Step 7.4: Run all hub-feed tests, confirm everything still passes**

```bash
cd frontend && npx vitest run tests/lib/hub-feed
```

Expected: all 5 hub-feed test files pass.

- [ ] **Step 7.5: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/lib/hub-feed.ts frontend/tests/lib/hub-feed.lead.test.ts
git commit -m "hub(lead): select featured finding (fallback latest published); trim timeline to 10"
```

---

## Task 8: `StatusPill` component

**Files:**

- Create: `frontend/src/components/findings-hub/StatusPill.tsx`
- Test: `frontend/tests/components/findings-hub/StatusPill.test.tsx`

- [ ] **Step 8.1: Write the failing test**

Write to `frontend/tests/components/findings-hub/StatusPill.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from '@/components/findings-hub/StatusPill';

describe('StatusPill', () => {
  it('renders PUB label for published', () => {
    render(<StatusPill status="published" />);
    expect(screen.getByText('PUB')).toBeInTheDocument();
  });

  it('renders PRE label for pre-registered', () => {
    render(<StatusPill status="pre-registered" />);
    expect(screen.getByText('PRE')).toBeInTheDocument();
  });

  it('renders NULL label for null', () => {
    render(<StatusPill status="null" />);
    expect(screen.getByText('NULL')).toBeInTheDocument();
  });

  it('has an aria-label that names the status', () => {
    render(<StatusPill status="published" />);
    const pill = screen.getByLabelText('Status: published');
    expect(pill).toBeInTheDocument();
  });
});
```

- [ ] **Step 8.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/components/findings-hub/StatusPill.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 8.3: Implement StatusPill**

Write to `frontend/src/components/findings-hub/StatusPill.tsx`:

```tsx
import type { TimelineStatus } from '@/lib/hub-feed';

interface Props {
  status: TimelineStatus;
}

const LABEL: Record<TimelineStatus, string> = {
  published: 'PUB',
  'pre-registered': 'PRE',
  null: 'NULL',
};

const STYLE: Record<TimelineStatus, string> = {
  published: 'bg-green-100 text-green-800 ring-green-200',
  'pre-registered': 'bg-gray-100 text-gray-700 ring-gray-200',
  null: 'bg-amber-100 text-amber-800 ring-amber-200',
};

export function StatusPill({ status }: Props) {
  return (
    <span
      aria-label={`Status: ${status}`}
      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider ring-1 ${STYLE[status]}`}
    >
      {LABEL[status]}
    </span>
  );
}
```

- [ ] **Step 8.4: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/components/findings-hub/StatusPill.test.tsx
```

Expected: PASS.

- [ ] **Step 8.5: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/components/findings-hub/StatusPill.tsx frontend/tests/components/findings-hub/StatusPill.test.tsx
git commit -m "hub(component): StatusPill for PUB / PRE / NULL"
```

---

## Task 9: `TimelineEntry` component

**Files:**

- Create: `frontend/src/components/findings-hub/TimelineEntry.tsx`
- Test: `frontend/tests/components/findings-hub/TimelineEntry.test.tsx`

- [ ] **Step 9.1: Write the failing test**

Write to `frontend/tests/components/findings-hub/TimelineEntry.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimelineEntryRow } from '@/components/findings-hub/TimelineEntry';
import type { TimelineEntry } from '@/lib/hub-feed';

const sample: TimelineEntry = {
  date: '2026-05-22',
  category: 'finding',
  status: 'published',
  title: 'H40 published',
  summary: '$880K Medicare billing 8 years post-exclusion.',
  href: '/findings/excluded-billing-medicare-partb-by-hcpcs',
  hNumbers: ['H40'],
};

describe('TimelineEntryRow', () => {
  it('renders date in MMM DD format', () => {
    render(<TimelineEntryRow entry={sample} />);
    expect(screen.getByText('May 22')).toBeInTheDocument();
  });

  it('renders title as a link to the entry href', () => {
    render(<TimelineEntryRow entry={sample} />);
    const link = screen.getByRole('link', { name: /H40 published/ });
    expect(link).toHaveAttribute('href', '/findings/excluded-billing-medicare-partb-by-hcpcs');
  });

  it('renders summary text', () => {
    render(<TimelineEntryRow entry={sample} />);
    expect(screen.getByText(/\$880K Medicare billing/)).toBeInTheDocument();
  });

  it('renders the category chip with the correct text', () => {
    render(<TimelineEntryRow entry={sample} />);
    expect(screen.getByText(/Finding/i)).toBeInTheDocument();
  });

  it('renders StatusPill when entry has a status', () => {
    render(<TimelineEntryRow entry={sample} />);
    expect(screen.getByText('PUB')).toBeInTheDocument();
  });

  it('renders an article entry without a status pill', () => {
    const article: TimelineEntry = {
      date: '2026-05-22',
      category: 'article',
      title: 'Eight years post-exclusion',
      summary: 'Long-form companion to H40.',
      href: '/articles/eight-years-post-exclusion',
    };
    render(<TimelineEntryRow entry={article} />);
    expect(screen.queryByText('PUB')).not.toBeInTheDocument();
    expect(screen.getByText(/Article/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 9.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/components/findings-hub/TimelineEntry.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement TimelineEntryRow**

Write to `frontend/src/components/findings-hub/TimelineEntry.tsx`:

```tsx
import Link from 'next/link';
import type { TimelineEntry, TimelineCategory } from '@/lib/hub-feed';
import { StatusPill } from './StatusPill';

interface Props {
  entry: TimelineEntry;
}

const CATEGORY_LABEL: Record<TimelineCategory, string> = {
  finding: 'Finding',
  update: 'Update',
  article: 'Article',
  methodology: 'Methodology',
};

const CATEGORY_RULE: Record<TimelineCategory, string> = {
  finding: 'border-l-red-700',
  update: 'border-l-blue-700',
  article: 'border-l-purple-700',
  methodology: 'border-l-gray-400',
};

const CATEGORY_CHIP: Record<TimelineCategory, string> = {
  finding: 'bg-red-50 text-red-800 ring-red-200',
  update: 'bg-blue-50 text-blue-800 ring-blue-200',
  article: 'bg-purple-50 text-purple-800 ring-purple-200',
  methodology: 'bg-gray-50 text-gray-700 ring-gray-200',
};

function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate();
  return `${month} ${day}`;
}

export function TimelineEntryRow({ entry }: Props) {
  const hRange = entry.hNumbers?.length
    ? entry.hNumbers.length === 1
      ? entry.hNumbers[0]
      : `${entry.hNumbers[0]}–${entry.hNumbers[entry.hNumbers.length - 1]}`
    : null;
  return (
    <li className="flex gap-3 py-3">
      <time
        dateTime={entry.date}
        className="w-14 shrink-0 text-right text-xs text-gray-500 tabular-nums pt-0.5"
      >
        {shortDate(entry.date)}
      </time>
      <div className={`flex-1 border-l-2 pl-3 ${CATEGORY_RULE[entry.category]}`}>
        <div className="flex flex-wrap items-center gap-1.5 mb-1">
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider ring-1 ${CATEGORY_CHIP[entry.category]}`}
          >
            {CATEGORY_LABEL[entry.category]}
            {hRange ? ` · ${hRange}` : null}
          </span>
          {entry.status ? <StatusPill status={entry.status} /> : null}
        </div>
        <Link
          href={entry.href}
          className="block text-sm font-bold text-gray-900 hover:text-primary-700 leading-snug"
        >
          {entry.title}
        </Link>
        {entry.summary ? (
          <p className="mt-0.5 text-xs text-gray-600 leading-snug">{entry.summary}</p>
        ) : null}
      </div>
    </li>
  );
}
```

- [ ] **Step 9.4: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/components/findings-hub/TimelineEntry.test.tsx
```

Expected: PASS.

- [ ] **Step 9.5: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/components/findings-hub/TimelineEntry.tsx frontend/tests/components/findings-hub/TimelineEntry.test.tsx
git commit -m "hub(component): TimelineEntryRow with date column + category chip"
```

---

## Task 10: `Timeline` component

**Files:**

- Create: `frontend/src/components/findings-hub/Timeline.tsx`
- Test: `frontend/tests/components/findings-hub/Timeline.test.tsx`

- [ ] **Step 10.1: Write the failing test**

Write to `frontend/tests/components/findings-hub/Timeline.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Timeline } from '@/components/findings-hub/Timeline';
import type { TimelineEntry } from '@/lib/hub-feed';

const entries: TimelineEntry[] = [
  {
    date: '2026-05-22',
    category: 'finding',
    status: 'published',
    title: 'H40 published',
    summary: '$880K case.',
    href: '/findings/excluded-billing-medicare-partb-by-hcpcs',
    hNumbers: ['H40'],
  },
  {
    date: '2026-05-22',
    category: 'article',
    title: 'Eight years post-exclusion',
    summary: 'Long-form.',
    href: '/articles/eight-years-post-exclusion',
  },
  {
    date: '2026-05-18',
    category: 'finding',
    status: 'published',
    title: 'H37 published',
    summary: '508K PECOS taxonomy mismatches.',
    href: '/findings/pecos-taxonomy-disagreement',
    hNumbers: ['H37'],
  },
];

describe('Timeline', () => {
  it('renders one row per entry as an ordered list', () => {
    const { container } = render(<Timeline entries={entries} />);
    const list = container.querySelector('ol');
    expect(list).toBeInTheDocument();
    expect(list?.children.length).toBe(entries.length);
  });

  it('renders the section header "Recent updates"', () => {
    render(<Timeline entries={entries} />);
    expect(screen.getByText(/Recent updates/i)).toBeInTheDocument();
  });

  it('renders a subscribe link to /subscribe', () => {
    render(<Timeline entries={entries} />);
    const link = screen.getByRole('link', { name: /Subscribe/i });
    expect(link).toHaveAttribute('href', '/subscribe');
  });

  it('handles empty entries gracefully with a placeholder', () => {
    render(<Timeline entries={[]} />);
    expect(screen.getByText(/No recent updates/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 10.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/components/findings-hub/Timeline.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 10.3: Implement Timeline**

Write to `frontend/src/components/findings-hub/Timeline.tsx`:

```tsx
import Link from 'next/link';
import type { TimelineEntry } from '@/lib/hub-feed';
import { TimelineEntryRow } from './TimelineEntry';

interface Props {
  entries: TimelineEntry[];
}

export function Timeline({ entries }: Props) {
  return (
    <section className="bg-white border-t border-gray-200 px-5 py-6 sm:px-8" aria-labelledby="recent-updates-heading">
      <header className="flex items-baseline justify-between mb-3">
        <h2
          id="recent-updates-heading"
          className="text-xs font-bold uppercase tracking-wider text-gray-600"
        >
          Recent updates
        </h2>
        <span className="text-xs text-gray-400">
          Showing last {Math.min(entries.length, 10)} ·{' '}
          <Link href="/subscribe" className="text-primary-600 hover:underline">
            Subscribe
          </Link>
        </span>
      </header>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No recent updates yet.</p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {entries.map((entry) => (
            <TimelineEntryRow key={`${entry.date}-${entry.href}`} entry={entry} />
          ))}
        </ol>
      )}
    </section>
  );
}
```

- [ ] **Step 10.4: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/components/findings-hub/Timeline.test.tsx
```

Expected: PASS.

- [ ] **Step 10.5: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/components/findings-hub/Timeline.tsx frontend/tests/components/findings-hub/Timeline.test.tsx
git commit -m "hub(component): Timeline section with subscribe affordance"
```

---

## Task 11: `LeadStory` component

**Files:**

- Create: `frontend/src/components/findings-hub/LeadStory.tsx`
- Test: `frontend/tests/components/findings-hub/LeadStory.test.tsx`

- [ ] **Step 11.1: Write the failing test**

Write to `frontend/tests/components/findings-hub/LeadStory.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LeadStory } from '@/components/findings-hub/LeadStory';
import type { LeadStoryItem } from '@/lib/hub-feed';

const lead: LeadStoryItem = {
  date: '2026-05-22',
  category: 'finding',
  status: 'published',
  title: '$880K Medicare billing 8 years post-exclusion',
  summary: 'H40 surfaced 4 candidates; primary-source verification confirms 1.',
  href: '/findings/excluded-billing-medicare-partb-by-hcpcs',
  heroStats: [
    { label: 'Confirmed cases', value: '1' },
    { label: 'CY 2023 paid', value: '$880K' },
  ],
  verifyChips: [
    { label: 'LEIE', href: 'https://exclusions.oig.hhs.gov/' },
    { label: 'NPPES', href: 'https://npiregistry.cms.hhs.gov/' },
  ],
  ctaLabel: 'Open finding →',
  ctaHref: '/findings/excluded-billing-medicare-partb-by-hcpcs',
};

describe('LeadStory', () => {
  it('renders the headline title as an <h1>', () => {
    render(<LeadStory item={lead} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('$880K Medicare billing');
  });

  it('renders the summary', () => {
    render(<LeadStory item={lead} />);
    expect(screen.getByText(/H40 surfaced 4 candidates/)).toBeInTheDocument();
  });

  it('renders heroStats as label/value pairs', () => {
    render(<LeadStory item={lead} />);
    expect(screen.getByText('Confirmed cases')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('CY 2023 paid')).toBeInTheDocument();
    expect(screen.getByText('$880K')).toBeInTheDocument();
  });

  it('renders verify chips as external links with rel=noopener', () => {
    render(<LeadStory item={lead} />);
    const leieLink = screen.getByRole('link', { name: 'LEIE' });
    expect(leieLink).toHaveAttribute('href', 'https://exclusions.oig.hhs.gov/');
    expect(leieLink).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders the CTA button linking to ctaHref', () => {
    render(<LeadStory item={lead} />);
    const cta = screen.getByRole('link', { name: 'Open finding →' });
    expect(cta).toHaveAttribute('href', '/findings/excluded-billing-medicare-partb-by-hcpcs');
  });

  it('omits the stat row when heroStats is absent', () => {
    const minimal = { ...lead, heroStats: undefined };
    render(<LeadStory item={minimal} />);
    expect(screen.queryByText('Confirmed cases')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 11.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/components/findings-hub/LeadStory.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 11.3: Implement LeadStory**

Write to `frontend/src/components/findings-hub/LeadStory.tsx`:

```tsx
import Link from 'next/link';
import type { LeadStoryItem } from '@/lib/hub-feed';

interface Props {
  item: LeadStoryItem;
}

function formatDate(iso: string): string {
  return iso;
}

export function LeadStory({ item }: Props) {
  return (
    <article className="px-5 py-6 sm:px-8 bg-gradient-to-br from-orange-50 to-white border-b-4 border-red-700">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-red-700 text-white text-[10px] font-bold uppercase tracking-wider">
          Lead · {formatDate(item.date)}
        </span>
        {item.hNumbers?.length ? (
          <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">
            Finding {item.hNumbers.join(', ')}
          </span>
        ) : null}
        {item.status === 'published' ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-white text-green-800 ring-1 ring-green-300 text-[10px] font-bold uppercase tracking-wider">
            Primary-source verified
          </span>
        ) : null}
      </div>
      <h1 className="font-serif text-2xl sm:text-3xl font-bold leading-tight text-gray-900 mb-2">
        {item.title}
      </h1>
      <p className="text-sm sm:text-base text-gray-700 leading-snug mb-3">
        {item.summary}
      </p>

      {item.heroStats?.length ? (
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs mb-3">
          {item.heroStats.map((s) => (
            <div key={s.label} className="flex gap-1.5">
              <dt className="text-gray-500">{s.label}</dt>
              <dd className="font-bold text-gray-900 tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {item.verifyChips?.length ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs mb-3">
          <span className="text-gray-500">Verify:</span>
          {item.verifyChips.map((chip, i) => (
            <span key={chip.label}>
              <a
                href={chip.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-red-700 underline hover:no-underline"
              >
                {chip.label}
              </a>
              {i < item.verifyChips!.length - 1 ? <span className="text-gray-400 ml-2">·</span> : null}
            </span>
          ))}
        </div>
      ) : null}

      <Link
        href={item.ctaHref}
        className="inline-flex items-center bg-red-700 text-white px-4 py-2 rounded-sm text-sm font-semibold hover:bg-red-800"
      >
        {item.ctaLabel}
      </Link>
    </article>
  );
}
```

- [ ] **Step 11.4: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/components/findings-hub/LeadStory.test.tsx
```

Expected: PASS.

- [ ] **Step 11.5: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/components/findings-hub/LeadStory.tsx frontend/tests/components/findings-hub/LeadStory.test.tsx
git commit -m "hub(component): LeadStory hero with heroStats + verify chips + CTA"
```

---

## Task 12: `FindingsCatalogTable` component

**Files:**

- Create: `frontend/src/components/findings-hub/FindingsCatalogTable.tsx`
- Test: `frontend/tests/components/findings-hub/FindingsCatalogTable.test.tsx`

- [ ] **Step 12.1: Write the failing test**

Write to `frontend/tests/components/findings-hub/FindingsCatalogTable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FindingsCatalogTable } from '@/components/findings-hub/FindingsCatalogTable';
import type { CatalogRow } from '@/lib/hub-feed';

const rows: CatalogRow[] = [
  { hNumber: 'H40', title: 'Excluded billing Medicare Part B by HCPCS', slug: 'excluded-billing-medicare-partb-by-hcpcs', updated: '2026-05-22', status: 'published' },
  { hNumber: 'H42', title: 'Excluded telehealth-dominant post-exclusion', slug: 'excluded-telehealth-dominant-post-exclusion', updated: '2026-05-22', status: 'null' },
  { hNumber: 'H37', title: 'PECOS-NPPES taxonomy disagreement', slug: 'pecos-taxonomy-disagreement', updated: '2026-05-18', status: 'published' },
];

describe('FindingsCatalogTable', () => {
  it('renders a header row with H#, Finding, Updated, Status', () => {
    render(<FindingsCatalogTable rows={rows} />);
    expect(screen.getByRole('columnheader', { name: /H#/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Finding/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Updated/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Status/i })).toBeInTheDocument();
  });

  it('renders one body row per CatalogRow', () => {
    render(<FindingsCatalogTable rows={rows} />);
    expect(screen.getByText('H40')).toBeInTheDocument();
    expect(screen.getByText('H42')).toBeInTheDocument();
    expect(screen.getByText('H37')).toBeInTheDocument();
  });

  it('renders each title as a link to /findings/<slug>', () => {
    render(<FindingsCatalogTable rows={rows} />);
    const h40Link = screen.getByRole('link', { name: /Excluded billing Medicare Part B by HCPCS/i });
    expect(h40Link).toHaveAttribute('href', '/findings/excluded-billing-medicare-partb-by-hcpcs');
  });

  it('renders the status pill text for each row', () => {
    render(<FindingsCatalogTable rows={rows} />);
    expect(screen.getAllByText('PUB').length).toBe(2);
    expect(screen.getByText('NULL')).toBeInTheDocument();
  });

  it('default sort is latest updated desc; H40 (May 22) before H37 (May 18)', () => {
    render(<FindingsCatalogTable rows={rows} />);
    const allRows = screen.getAllByRole('row');
    // [0] header, [1] H40 or H42 (both May 22), [2] H40 or H42, [3] H37
    const firstBody = allRows[1].textContent ?? '';
    const lastBody = allRows[3].textContent ?? '';
    expect(firstBody).toMatch(/H4[02]/);
    expect(lastBody).toContain('H37');
  });

  it('clicking the H# header toggles sort to ascending by H#', () => {
    render(<FindingsCatalogTable rows={rows} />);
    fireEvent.click(screen.getByRole('columnheader', { name: /H#/i }));
    const allRows = screen.getAllByRole('row');
    // After click: H37 first
    expect(allRows[1].textContent).toContain('H37');
  });
});
```

- [ ] **Step 12.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/components/findings-hub/FindingsCatalogTable.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 12.3: Implement FindingsCatalogTable**

Write to `frontend/src/components/findings-hub/FindingsCatalogTable.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CatalogRow } from '@/lib/hub-feed';
import { StatusPill } from './StatusPill';

interface Props {
  rows: CatalogRow[];
}

type SortKey = 'updated' | 'hNumber' | 'status';
type SortDir = 'asc' | 'desc';

function hNumberAsInt(s: string): number {
  return parseInt(s.replace(/[^\d]/g, '') || '0', 10);
}

const STATUS_ORDER: Record<CatalogRow['status'], number> = {
  published: 0,
  null: 1,
  'pre-registered': 2,
};

export function FindingsCatalogTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function toggle(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'hNumber' ? 'asc' : 'desc');
    }
  }

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'updated') cmp = a.updated.localeCompare(b.updated);
    else if (sortKey === 'hNumber') cmp = hNumberAsInt(a.hNumber) - hNumberAsInt(b.hNumber);
    else if (sortKey === 'status') cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <section className="bg-gray-50 border-t border-gray-200 px-5 py-6 sm:px-8" aria-labelledby="catalog-heading">
      <header className="flex items-baseline justify-between mb-2">
        <h2 id="catalog-heading" className="text-xs font-bold uppercase tracking-wider text-gray-600">
          All {rows.length} findings
        </h2>
        <span className="text-[10px] text-gray-500">Click any column header to sort</span>
      </header>

      {/* Desktop table (≥640px) */}
      <table className="hidden sm:table w-full bg-white border border-gray-200 text-xs">
        <thead>
          <tr className="bg-gray-100 text-[10px] uppercase tracking-wider text-gray-600">
            <th scope="col" className="py-1.5 px-2 text-left w-10">
              <button onClick={() => toggle('hNumber')} className="font-bold">H#</button>
            </th>
            <th scope="col" className="py-1.5 px-2 text-left">
              <button onClick={() => toggle('updated')} className="font-bold">Finding</button>
            </th>
            <th scope="col" className="py-1.5 px-2 text-left w-24">
              <button onClick={() => toggle('updated')} className="font-bold">Updated</button>
            </th>
            <th scope="col" className="py-1.5 px-2 text-left w-16">
              <button onClick={() => toggle('status')} className="font-bold">Status</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.slug} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="py-1.5 px-2 font-bold text-gray-900">{row.hNumber}</td>
              <td className="py-1.5 px-2">
                <Link
                  href={`/findings/${row.slug}`}
                  className="text-primary-700 hover:underline"
                >
                  {row.title}
                </Link>
              </td>
              <td className="py-1.5 px-2 text-gray-600 tabular-nums">{row.updated}</td>
              <td className="py-1.5 px-2"><StatusPill status={row.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile card stack (<640px) */}
      <ol className="sm:hidden space-y-2">
        {sorted.map((row) => (
          <li key={row.slug}>
            <Link
              href={`/findings/${row.slug}`}
              className="block bg-white border border-gray-200 px-3 py-2 rounded-sm"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-sm text-gray-900">{row.hNumber}</span>
                <StatusPill status={row.status} />
                <span className="ml-auto text-[10px] text-gray-500 tabular-nums">{row.updated}</span>
              </div>
              <p className="text-xs text-gray-700 leading-snug">{row.title}</p>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 12.4: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/components/findings-hub/FindingsCatalogTable.test.tsx
```

Expected: PASS.

- [ ] **Step 12.5: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/components/findings-hub/FindingsCatalogTable.tsx frontend/tests/components/findings-hub/FindingsCatalogTable.test.tsx
git commit -m "hub(component): sortable FindingsCatalogTable with mobile card stack"
```

---

## Task 13: Replace `/findings/page.tsx` with the new hub composition

**Files:**

- Modify: `frontend/src/app/findings/page.tsx`
- Test: `frontend/tests/app/findings-hub-page.test.tsx`

- [ ] **Step 13.1: Write the failing test**

Write to `frontend/tests/app/findings-hub-page.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FindingsHub from '@/app/findings/page';

describe('FindingsHub page', () => {
  it('renders the lead story, timeline, and catalog sections', () => {
    render(<FindingsHub />);
    // Lead's H1 is present (verifies <LeadStory> rendered)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    // Timeline section heading
    expect(screen.getByText(/Recent updates/i)).toBeInTheDocument();
    // Catalog section heading
    expect(screen.getByText(/All \d+ findings/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 13.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/app/findings-hub-page.test.tsx
```

Expected: FAIL — old page renders flat list, no "Recent updates" heading.

- [ ] **Step 13.3: Replace the page with the new composition**

Overwrite `frontend/src/app/findings/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import { loadHubFeed } from '@/lib/hub-feed';
import { LeadStory } from '@/components/findings-hub/LeadStory';
import { Timeline } from '@/components/findings-hub/Timeline';
import { FindingsCatalogTable } from '@/components/findings-hub/FindingsCatalogTable';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Findings — AINPI',
  description:
    'AINPI audit findings + recent updates from the audit of the CMS National Provider Directory. Latest published research, methodology bumps, and the full catalog of pre-registered findings.',
  openGraph: {
    title: 'AINPI Findings hub',
    description:
      'Latest findings, recent updates, and the full catalog of pre-registered findings against the CMS National Provider Directory.',
    url: 'https://ainpi.dev/findings',
    type: 'website',
  },
};

export default function FindingsHubPage() {
  const { lead, timeline, catalog } = loadHubFeed();
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-3xl mx-auto bg-white shadow-sm">
        <LeadStory item={lead} />
        <Timeline entries={timeline} />
        <FindingsCatalogTable rows={catalog} />
      </main>
    </div>
  );
}
```

- [ ] **Step 13.4: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/app/findings-hub-page.test.tsx
```

Expected: PASS.

- [ ] **Step 13.5: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/app/findings/page.tsx frontend/tests/app/findings-hub-page.test.tsx
git commit -m "hub: /findings page composes LeadStory + Timeline + Catalog"
```

---

## Task 14: `HomepageLatestStrip` + integration into `/page.tsx`

**Files:**

- Create: `frontend/src/components/findings-hub/HomepageLatestStrip.tsx`
- Modify: `frontend/src/app/page.tsx`
- Test: `frontend/tests/components/findings-hub/HomepageLatestStrip.test.tsx`

- [ ] **Step 14.1: Write the failing test**

Write to `frontend/tests/components/findings-hub/HomepageLatestStrip.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomepageLatestStrip } from '@/components/findings-hub/HomepageLatestStrip';
import type { LeadStoryItem } from '@/lib/hub-feed';

const lead: LeadStoryItem = {
  date: '2026-05-22',
  category: 'finding',
  status: 'published',
  title: '$880K Medicare billing 8 years post-exclusion',
  summary: 'short summary',
  href: '/findings/excluded-billing-medicare-partb-by-hcpcs',
  ctaLabel: 'Open finding →',
  ctaHref: '/findings/excluded-billing-medicare-partb-by-hcpcs',
};

describe('HomepageLatestStrip', () => {
  it('renders an eyebrow "Latest"', () => {
    render(<HomepageLatestStrip lead={lead} />);
    expect(screen.getByText(/^Latest$/i)).toBeInTheDocument();
  });

  it('renders the lead title', () => {
    render(<HomepageLatestStrip lead={lead} />);
    expect(screen.getByText(/\$880K Medicare billing/)).toBeInTheDocument();
  });

  it('renders the lead date in ISO format', () => {
    render(<HomepageLatestStrip lead={lead} />);
    expect(screen.getByText('2026-05-22')).toBeInTheDocument();
  });

  it('renders a "View all updates" link to /findings', () => {
    render(<HomepageLatestStrip lead={lead} />);
    const link = screen.getByRole('link', { name: /View all updates/i });
    expect(link).toHaveAttribute('href', '/findings');
  });
});
```

- [ ] **Step 14.2: Run the failing test**

```bash
cd frontend && npx vitest run tests/components/findings-hub/HomepageLatestStrip.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 14.3: Implement HomepageLatestStrip**

Write to `frontend/src/components/findings-hub/HomepageLatestStrip.tsx`:

```tsx
import Link from 'next/link';
import type { LeadStoryItem } from '@/lib/hub-feed';

interface Props {
  lead: LeadStoryItem;
}

export function HomepageLatestStrip({ lead }: Props) {
  return (
    <div className="bg-white border-t border-gray-200 px-5 sm:px-8 py-3">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
        <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-red-700 text-white text-[10px] font-bold uppercase tracking-wider w-fit">
          Latest
        </span>
        <Link href={lead.href} className="flex-1 text-gray-900 hover:text-red-700">
          <span className="font-semibold">{lead.title}</span>
          <span className="text-gray-500 ml-2 text-xs tabular-nums">· {lead.date}</span>
        </Link>
        <Link href="/findings" className="text-xs text-primary-600 hover:underline whitespace-nowrap">
          View all updates →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 14.4: Integrate into homepage**

Overwrite `frontend/src/app/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import MapHomepage from '@/components/homepage/MapHomepage';
import { loadHomepageMapData } from '@/lib/homepage-data';
import { HomepageLatestStrip } from '@/components/findings-hub/HomepageLatestStrip';
import { loadHubFeed } from '@/lib/hub-feed';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'AINPI — Audit of the federal provider directory',
  description:
    'A free, public audit of the CMS National Directory of Healthcare. Click any state to see federally-excluded NPIs still listed in the federal directory and the claims-side cross-audit for that state.',
};

export default function HomePage() {
  const data = loadHomepageMapData();
  const { lead } = loadHubFeed();
  return (
    <>
      <Navbar />
      <MapHomepage data={data} />
      <HomepageLatestStrip lead={lead} />
    </>
  );
}
```

- [ ] **Step 14.5: Run tests, confirm pass**

```bash
cd frontend && npx vitest run tests/components/findings-hub/HomepageLatestStrip.test.tsx
```

Expected: PASS.

- [ ] **Step 14.6: Commit**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/src/components/findings-hub/HomepageLatestStrip.tsx frontend/src/app/page.tsx frontend/tests/components/findings-hub/HomepageLatestStrip.test.tsx
git commit -m "hub: HomepageLatestStrip below the map on /"
```

---

## Task 15: E2E smoke + full build verification

**Files:**

- Create: `frontend/e2e/findings-hub.spec.ts`

- [ ] **Step 15.1: Write the Playwright spec**

Write to `frontend/e2e/findings-hub.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('/findings hub', () => {
  test('renders lead, timeline, and catalog sections', async ({ page }) => {
    await page.goto('/findings');
    // Lead has an H1
    await expect(page.locator('h1').first()).toBeVisible();
    // Timeline section heading
    await expect(page.getByText(/Recent updates/i)).toBeVisible();
    // Catalog header
    await expect(page.getByText(/All \d+ findings/)).toBeVisible();
  });

  test('clicking a catalog row navigates to the finding page', async ({ page }) => {
    await page.goto('/findings');
    const link = page.getByRole('link', { name: /Excluded billing Medicare Part B by HCPCS/i }).first();
    await link.click();
    await expect(page).toHaveURL(/\/findings\/excluded-billing-medicare-partb-by-hcpcs/);
  });

  test('clicking a timeline entry navigates correctly', async ({ page }) => {
    await page.goto('/findings');
    const article = page.getByRole('link', { name: /Eight years post-exclusion/i }).first();
    await article.click();
    await expect(page).toHaveURL(/\/articles\/eight-years-post-exclusion/);
  });

  test('lead CTA navigates to the finding page', async ({ page }) => {
    await page.goto('/findings');
    await page.getByRole('link', { name: 'Open finding →' }).click();
    await expect(page).toHaveURL(/\/findings\/excluded-billing-medicare-partb-by-hcpcs/);
  });
});

test.describe('/ homepage Latest strip', () => {
  test('strip renders below the map with the lead title and a View all link', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/^Latest$/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /View all updates/i })).toHaveAttribute('href', '/findings');
  });
});
```

- [ ] **Step 15.2: Run vitest full suite to confirm no regressions**

```bash
cd frontend && npm run test
```

Expected: all tests pass, no failures.

- [ ] **Step 15.3: Run Playwright E2E**

```bash
cd frontend && npm run test:e2e -- findings-hub.spec.ts
```

Expected: 5 specs pass.

- [ ] **Step 15.4: Full Next.js build to verify static-page generation**

```bash
cd frontend && npm run build 2>&1 | tail -25
```

Expected:

- `/findings` is in the static-page manifest as `○ (Static)`
- `/` is in the static-page manifest as `○ (Static)`
- No "Max serverless function size" warnings
- Exit code 0

- [ ] **Step 15.5: Commit E2E spec**

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI
git add frontend/e2e/findings-hub.spec.ts
git commit -m "hub(e2e): Playwright smoke for /findings + / latest strip"
```

- [ ] **Step 15.6: Push branch + open PR**

```bash
git push -u origin findings-hub-redesign-v1
gh pr create --title "Findings hub redesign v1 — hero + timeline + catalog" --body "$(cat <<'PRBODY'
## Summary

Replaces the flat \`/findings\` index with the three-section hub designed in [docs/superpowers/specs/2026-05-22-findings-hub-redesign-design.md](docs/superpowers/specs/2026-05-22-findings-hub-redesign-design.md):

- **Hero** — lead finding (H40 in v1) with title, summary, heroStats, LEIE/SAM/NPPES verify chips, and CTA.
- **Timeline** — 10 most-recent items across findings + updates + articles + methodology version bumps.
- **Catalog** — sortable table of all 42 findings; mobile card stack below 640px.
- **Homepage strip** — slim "Latest from AINPI" line below the map linking to the hub.

Per-item pages (/findings/[slug], /reports/[slug], /articles/[slug], /methodology) unchanged — the hub is a landing layer, not an absorption layer.

Newsletter emails already sent on 2026-05-22 link to /reports/2026-05-22-update; that URL continues to resolve.

## Test plan

- [x] Vitest unit + component tests pass
- [x] Playwright E2E (5 specs) pass
- [x] Local \`npm run build\` succeeds, both pages are \`○ Static\`
- [ ] On Vercel preview deploy: visit /findings and / and verify hero/timeline/catalog/strip render with current content

PRBODY
)"
```

---

## Self-review (run before declaring complete)

- [ ] **Spec coverage:**
  - Spec Section A.1 Hero → Tasks 11 (component) + 13 (integration)
  - Spec Section A.2 Timeline → Tasks 9 (entry) + 10 (container) + 13 (integration)
  - Spec Section A.3 Catalog → Task 12 (incl. mobile card stack)
  - Spec Section B Homepage strip → Task 14
  - Spec Section C Data flow / `loadHubFeed` → Tasks 1, 3, 4, 5, 6, 7
  - Spec Section D Visual + accessibility → embedded in component tasks
  - Spec Section E Out of scope → no tasks (correctly absent)
  - Spec Section F Testing → Vitest tasks + Task 15 E2E
- [ ] **No placeholders:** scan for TODO / TBD / "implement later". None found.
- [ ] **Type consistency:** `TimelineEntry`, `CatalogRow`, `LeadStoryItem`, `HubFeed` defined in Task 1 used unchanged in Tasks 3–14. `StatusPill` accepts `TimelineStatus` (not a different status enum). `LeadStoryItem.verifyChips[].label` literal type `'LEIE' | 'SAM' | 'NPPES'` matches what Task 7 emits.
- [ ] **Spec roadmap items (Tier 1–4):** explicitly OUT of v1 scope per arguments. No tasks for them.

---

**Estimated total effort:** 15 tasks × ~10–20 minutes each via subagent-driven-development = ~3–5 hours of focused implementation.
