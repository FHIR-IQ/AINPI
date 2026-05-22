# Findings hub redesign + site-wide optimization roadmap

**Date:** 2026-05-22
**Status:** Design (awaiting user approval before implementation plan)
**Owner:** Eugene Vestel
**Related:** All recent finding work (H40 / H42 / H37–H39) currently lands at separate IA destinations (`/findings`, `/reports/<slug>`, `/articles/<slug>`); this design consolidates discovery into a single hub at `/findings`.

## Why this exists

AINPI has grown organically into 20+ public URLs. Findings live at `/findings/[slug]`. Release updates live at `/reports/[slug]`. Long-form articles live at `/articles/[slug]`. Methodology version bumps live in `/methodology`. A visitor who wants to know "what's new" or "what does AINPI cover" has to jump between four IA buckets to assemble a picture. Subscribers receive emails linking to the latest report; they have no easy way to see *all* recent activity, or to compare today's finding against last week's.

The user's stated principles for the cleanup:

- **Trustworthy and relevant** — primary-source verification visible inline
- **Actionable** — clear "what to do with this number"
- **Appealing and visual** — strong visual hierarchy without clutter
- **Why it matters** — narrative framing alongside numbers
- **Engaging and unique** — distinct voice, not a generic dashboard
- **KISS** — keep it simple stupid

Inspirations selected for IA + visual treatment:

- **ProPublica · The Markup** — hero-story pattern, journalistic authority, the "lead" finding gets prominent treatment
- **OurWorldInData · BLS Latest Numbers** — reverse-chronological mixed-content feed with category chips + dates

These two map cleanly to AINPI's content shape: published findings carry headline numbers that work as lead stories; release updates + articles + methodology bumps want a stream-style display.

## What ships

### Section A — `/findings` becomes the canonical hub

Three vertically-stacked sections, top-to-bottom matching the visitor intent gradient:

```text
HERO            "show me the latest / loudest"
  ↓
TIMELINE        "what's been published recently, mixed type"
  ↓
CATALOG         "let me browse everything"
```

Existing per-item pages (`/findings/[slug]`, `/reports/[slug]`, `/articles/[slug]`, `/methodology`) **stay at their current URLs and stay rendered as-is**. The hub is a landing surface, not an absorption layer — subscriber emails that link to `/reports/2026-05-22-update` continue to resolve.

#### A.1 Hero (lead story)

One prominent block. Renders the most recent published finding by default; can be overridden via a `featured: true` flag in `frontend/src/data/findings.ts` if you want to keep an older finding featured for an extra week.

Layout:

- Eyebrow chip: `Lead · YYYY-MM-DD` + finding number + status
- Headline (Georgia serif, ~24px, the finding's display title)
- 2–3 sentence summary pulled from the finding's `summary` field
- Stat row: 3–4 key numbers (numerator, paid, years post-exclusion, etc.) inline
- Primary-source verify chip row: `LEIE` · `SAM` · `NPPES` where applicable
- Primary CTA: `Open finding →` linking to `/findings/<slug>` (label is fixed; the lead finding identity travels through the headline and metadata, not the button text)
- Secondary text: "Or read the long-form: [article title]" if a related article links to the same H#

The hero block uses red (`#b91c1c`) as a **solid fill** on its accent bar and on the primary CTA. Other UI surfaces (finding category chips in the timeline, etc.) may use the same red as a **border/text color only** — never as a fill — so the hero stays visually distinct as the loudest element on the page.

#### A.2 Timeline (recent updates)

Reverse-chronological feed of the ~10 most recent items across all four content types. Each entry:

- Date column (left-rail, `MMM DD` format, tabular numbers, ~48px wide)
- Vertical accent rule (color-coded to category)
- Category chip (top of content area, colored: Finding/Update/Article/Methodology)
- Status pill if applicable (Published / Pre-registered / Null)
- Title (sentence case, ~13px bold)
- 1-sentence why-it-matters summary (~11px regular)
- Clicking the entry opens the corresponding `/findings/<slug>`, `/reports/<slug>`, `/articles/<slug>`, or `/methodology`

Category colors:

- **Finding** — red (#b91c1c) accent + red chip
- **Update** — blue (#1e40af) accent + blue chip
- **Article** — purple (#7c3aed) accent + purple chip
- **Methodology** — gray (#6b7280) accent + gray chip

Section header: "Recent updates" eyebrow + a "Subscribe" link inline (the same Resend signup form used in the Footer; just a link to `/subscribe` from here to keep markup simple).

Footer: "Older updates →" link to a `/findings/feed` secondary page that paginates beyond the 10 most recent. (Secondary page is a v1.1 addition — not blocking; the 10-most-recent timeline ships in v1.)

#### A.3 Catalog (full backlog)

Compact sortable table of all H-numbers. Four columns:

- `H#` — sortable (default desc)
- `Finding` — the title from `findings.ts`
- `Updated` — last-update date
- `Status` — pill: `PUB` (green) / `PRE` (gray) / `NULL` (amber)

Default sort: latest updated, desc. Click column header to toggle sort. **No filters in v1** — 42 rows is scannable, KISS. Healthdata.gov has thousands of datasets and needs filter chips; AINPI does not.

Rows are clickable; clicking opens `/findings/<slug>`.

Below 640px viewport, the table re-renders as a card stack (each row becomes a tappable card with H#/title/date/status).

### Section B — Homepage `/` integration

Below the existing map and above the existing footer, add a single slim "Latest from AINPI" strip:

```text
[Eyebrow: LATEST]  H40 published · 2026-05-22 — $880K Medicare billing, 8 years post-exclusion  [View all updates →]
```

One line, no chart, no card stack. Matches every news/research publisher's homepage pattern (NYT, ProPublica, OWID) without competing with the map for visual prominence.

The strip pulls from the same `loadHubFeed().lead` data the hub uses.

### Section C — Components, data flow, build behavior

#### New components

All under `frontend/src/components/findings-hub/`:

| Component | Job |
|---|---|
| `LeadStory.tsx` | Hero block. Props: `LeadStoryItem` typed object. Renders title, summary, stat row, verify chips, CTA. |
| `Timeline.tsx` | Container for the recent-updates feed. Renders an ordered list of `TimelineEntry`. |
| `TimelineEntry.tsx` | One row in the timeline. Date column + accent rule + category chip + title + summary + link. |
| `FindingsCatalogTable.tsx` | Compact sortable table for the catalog section. Three sort modes (latest / H# / status). Mobile: card stack. |
| `StatusPill.tsx` | Tiny shared pill for PUB / PRE / NULL. Reused across timeline + catalog. |
| `HomepageLatestStrip.tsx` | Single-line teaser for `/`. Uses the same `lead` item the hub uses. |

#### New data loader

`frontend/src/lib/hub-feed.ts` exports:

```ts
export interface TimelineEntry {
  date: string;        // ISO date
  category: 'finding' | 'update' | 'article' | 'methodology';
  status?: 'published' | 'pre-registered' | 'null';
  title: string;
  summary: string;
  href: string;        // /findings/<slug>, /reports/<slug>, /articles/<slug>, /methodology
  hNumbers?: string[]; // for findings + updates that bundle multiple H#s
}

export interface CatalogRow {
  hNumber: string;
  title: string;
  slug: string;
  updated: string;
  status: 'published' | 'pre-registered' | 'null';
}

export interface LeadStoryItem extends TimelineEntry {
  verifyChips?: { label: 'LEIE' | 'SAM' | 'NPPES'; href: string }[];
  stats?: { label: string; value: string }[];
  ctaLabel: string;
  ctaHref: string;
}

export interface HubFeed {
  lead: LeadStoryItem;
  timeline: TimelineEntry[];      // 10 most recent, lead excluded
  catalog: CatalogRow[];          // all findings sortable
}

export function loadHubFeed(): HubFeed;
```

Implementation reads at build time from:

- `frontend/src/data/findings.ts` — the FINDINGS catalog (every H#)
- `frontend/src/data/reports.ts` — the REPORTS catalog
- `docs/articles/*.md` filesystem scan — derive date from `YYYY-MM-DD-*.md` prefix and title from first `#` heading
- `docs/methodology/index.md` frontmatter — current methodology version

Merge logic:

1. For each published finding: emit one `TimelineEntry` with `category: 'finding'` and one `CatalogRow`. For each pre-registered or null finding: emit only a `CatalogRow`.
2. For each report: emit one `TimelineEntry` with `category: 'update'`.
3. For each article: emit one `TimelineEntry` with `category: 'article'`.
4. If methodology version differs from prior cached version (or in v1, fall back to a manually maintained `docs/methodology/version-log.md`): emit one `TimelineEntry` with `category: 'methodology'`.
5. Sort all timeline entries by `date` desc.
6. Lead = `findings.ts` entry where `featured: true`, else the most recent timeline entry with `category === 'finding'` AND `status === 'published'`.
7. Catalog = all `CatalogRow`s sorted desc by `updated`.

All filesystem reads happen during `next build`. The hub page is `force-static`; per-route trace excludes (already configured in `next.config.js` for the big `/api/v1/states/**` tree) continue to apply.

#### Modified routes

- `/findings/page.tsx` — currently a flat list; replaced by the new hub composition (`<LeadStory />` + `<Timeline />` + `<FindingsCatalogTable />`).
- `/page.tsx` (homepage) — adds `<HomepageLatestStrip />` between the existing map block and the footer.

### Section D — Visual + accessibility decisions

#### Color discipline

- Single accent (red `#b91c1c`) reserved for the hero — anchors a journalistic identity.
- Category chip colors stay desaturated (border + text rather than filled background) to avoid color noise.
- Status pills use semantic muted colors: green (PUB), gray (PRE), amber (NULL).
- Existing Tailwind palette — no new colors added.

#### Typography

- Hero headline in Georgia serif at ~24px (existing pattern used in `/reports/<slug>` pages).
- Timeline + catalog: existing Inter sans-serif at ~13/11px.
- Tabular numbers (`font-variant-numeric: tabular-nums`) on every date + numeric column.

#### Mobile

- Hero stacks naturally; stat row wraps to 2 columns.
- Timeline date column stays visible; content area narrows.
- Catalog table re-renders as card stack below 640px (single Tailwind responsive switch).
- Touch targets ≥44px on all clickable rows.

#### Accessibility

- `<article>` for the hero; `<ol>` for the timeline; `<table>` for the catalog with proper `<th scope="col">` and click-row pattern that also exposes a per-row keyboard-focusable link.
- Status pills carry `aria-label` text (e.g., `aria-label="Status: published"`).
- Category chips are decorative (color + text label); the underlying link is the semantic affordance.

### Section E — Out of scope for v1 (explicit non-changes)

- **Per-finding pages** (`/findings/[slug]`) — content + layout untouched. Hero pattern propagation is a Tier-1 follow-up.
- **Per-report pages** — untouched.
- **Per-article pages** — untouched.
- **Navbar** — still 5 items (Explore / Findings / For States / Methodology / Developer).
- **Map homepage** — only adds the slim teaser strip; map itself untouched. Theme switcher removal is a Tier-2 follow-up.
- **`/data-quality`, `/insights`, `/data-sources`** — untouched. Consolidation is a Tier-2 follow-up.
- **Methodology page** — still markdown-rendered. Hyperlinking H-numbers is a Tier-1 follow-up.
- **Subscribe flow** — uses existing `/subscribe` page; just one extra inline link in the hub timeline header.

### Section F — Testing

- **Vitest** unit tests for `loadHubFeed`: merge order, lead selection (featured flag wins; falls back to latest-published-finding), catalog sort defaults.
- **Vitest** component tests for `Timeline` (entries render in date order, category chips render with correct colors) and `FindingsCatalogTable` (sort toggle works, mobile card-stack switches at 640px).
- **Playwright** E2E: visit `/findings`, verify hero renders the expected lead, verify the timeline has at least one finding + one update + one article entry, verify clicking a catalog row navigates to `/findings/<slug>`. Visit `/`, verify the homepage Latest strip appears below the map.

Run via `npm run test && npm run test:e2e` per the existing CI pattern.

## Site-wide optimization roadmap (post v1)

Applying the same first principles across the rest of the site. Prioritized by impact / effort ratio. Each item is a candidate for its own one-PR follow-up after the hub v1 lands.

### Tier 1 — High leverage, low risk

- **Per-finding pages get the hub's hero + verify pattern.** Currently chart-first; redesign to hero-first with headline number + last-updated + LEIE/SAM/NPPES verify chips at the top, then "Why it matters" prose, then methodology, then sample cases inline (the Miranda detail on H40 is the canonical example), then cross-links to related findings + updates + articles. Largest visitor-experience win since per-finding pages are where deep links land.
- **Methodology cross-links.** Every H-number mentioned in `docs/methodology/index.md` becomes a hyperlink to `/findings/<slug>`. Trustworthy = traceable.
- **Last-refreshed footer everywhere.** Page-level `Last refreshed · YYYY-MM-DD · commit SHA` strip on every data-bearing page. Build-time injection.
- **Per-state pages get a state-filtered mini-timeline.** Borrow `Timeline.tsx` from the hub with a `stateFilter` prop. CMO-relevance amplifier.

### Tier 2 — Medium leverage, some scope work

- **Consolidate `/data-quality` + `/insights` + `/data-sources` under `/data`.** Three overlapping IA destinations. Restructure to a single `/data` landing with three sections — *Quality*, *Insights*, *Sources*. Old URLs 301-redirect.
- **Drop the 3-style theme switcher on `/`.** Pick Light cards default; ship that.
- **Open Graph share previews on every page.** Auto-generate OG images at build time per finding/state.

### Tier 3 — Cleanup + code hygiene

- **Fold `/briefings/va` into `/for-state-medicaid/va`.**
- **Fold `/smd-revalidation/cross-audit-roadmap` into `/smd-revalidation`.**
- **Audit + delete legacy auth pages** (`/dashboard`, `/audit-log`, `/providers/new`, `/demo`, `/login`, `/payer-healthcare-service-survey` if unused per Vercel Analytics).
- **Footer surfaces lead + latest** on every page.

### Tier 4 — Nice-to-haves

- **Navbar "fresh content" indicator** — small dot on Findings when hub content < 7 days old. Skip unless analytics show poor discovery.
- **RSS / Atom feed** — `/feed.xml` generated from the same `loadHubFeed()` data.

## References

- ProPublica section landings — <https://www.propublica.org/topics/health-care>
- The Markup investigations landing — <https://themarkup.org/investigations>
- Our World in Data research articles — <https://ourworldindata.org/latest>
- Bureau of Labor Statistics Latest Numbers — <https://www.bls.gov/data/>
- healthdata.gov dataset catalog — <https://healthdata.gov/browse>
- GAO Recent Reports — <https://www.gao.gov/reports-testimonies>

## Open considerations (handled in the implementation plan, not the design)

- **Methodology version-log source of truth.** v1 reads current version from `docs/methodology/index.md` frontmatter; version-bump timeline entries either need a manually maintained `docs/methodology/version-log.md` OR git-log parsing for changes to the `version` field. Implementation plan picks one.
- **Featured flag on findings.** Whether `featured: true` is a single-boolean override or a date-bounded `featuredUntil: '2026-06-05'` — implementation plan picks based on how often the editor expects to override the auto-default.
- **Hero stats source.** For findings without a structured `stats` array on the JSON, the hero block falls back to "headline only" (no stat row). Plan locks the structure.
