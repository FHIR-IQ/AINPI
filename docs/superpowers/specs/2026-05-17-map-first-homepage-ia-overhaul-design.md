# Map-first homepage + IA overhaul

**Date:** 2026-05-17
**Status:** Design (awaiting user review before implementation plan)

## Why this exists

AINPI has grown from a single-purpose audit page into a sprawling site: 11+ items in the primary navigation, a `/` route that redirects straight to `/npd` search, and no top-of-funnel surface that conveys "this is an audit of the federal provider directory" before showing the data.

Two related problems:

1. **No discovery surface.** First-time visitors land in NPD search, which assumes they have a specific NPI in mind. Greg Barabell's feedback (state Medicaid CMO listserve, 2026-05-15) called out the inverse pattern as the hook: "here are N providers you can take action on." That hook is per-state, geographic, and obvious — exactly what a choropleth map is for.
2. **Information architecture overload.** The Navbar currently has NPD Search · Data Quality · Findings · States · VA Briefing · Methodology · Insights · HCS Survey · Developer · Payer Search · Magic Scanner · Sign In. Best-practice IA for audit / public-good / data-portal sites runs 5-7 top-level items (see [healthdata.gov](https://www.healthdata.gov), [data.who.int](https://data.who.int/dashboards/global-progress)). The current breadth makes everything compete with everything.

This design proposes a map-first homepage with a 3-style theme switcher and a 5-item primary nav.

## What ships

### 1. A new `/` homepage

Map-first dashboard. Replaces the current `useRouter().push('/npd')` redirect. Built around the existing `USChoroplethMap` component in `frontend/src/components/charts/USChoroplethMap.tsx` (D3 + topojson-client, already supports `onStateClick` + `selectedState`).

#### Layout — three styles in one route

The homepage renders one of three layouts based on the visitor's theme selection:

- **Light cards (B, default)** — three KPI cards above the map (e.g. "8,619 federally-excluded NPIs · 870 deactivated still billing · $167K strict-post-exclusion industry payments"), 5-item nav, light surface. Healthdata.gov / WHO data dashboard tone.
- **Dark dashboard (A)** — single stat-anchored headline ("8,619 federally-excluded NPIs still listed in the federal directory"), metric chip toggle inline with the headline, map fills the rest of the viewport. amCharts demo tone. Renders dark.
- **Minimal map (C)** — short headline, map dominates the page, four small stats below the map, metric switcher in a dropdown in the map corner. Most audit-tool, least magazine-y.

All three share the same map, side-panel, footer, and nav. Only the surrounding chrome differs.

#### Theme switcher

A pill-button picker in the top-right of the homepage hero (NOT in the global Navbar — see scope note below). Three options: `☀️ Light cards` · `🌙 Dark dashboard` · `⚡ Minimal map`.

- **Default**: `Light cards` (B).
- **System-aware fallback**: if no `localStorage.ainpi-theme` exists and the browser reports `prefers-color-scheme: dark`, start on `Dark dashboard` (A). Otherwise start on `Light cards` (B).
- **Persistence**: `localStorage.ainpi-theme` = `light` | `dark` | `minimal`. Once a visitor picks, the picker beats the system default for that browser.
- **Scope**: homepage only (`/`). The CMO-forwardable per-state pages (`/for-state-medicaid/<state>`) stay in a single consistent style so a forwarded link renders the same to every recipient.

#### Map metric switcher

The choropleth itself encodes a switchable metric (chip toggles above or below the map depending on layout). The metrics, in default order:

1. **Critical cohort size** — count of federally-excluded NPIs in each state (LEIE or SAM active, score ≥ 1.5). Default selection. Most concrete number for CMOs.
2. **Strict-post-exclusion violations** — sum of Medicaid + Part B + Part D strict-post-exclusion match counts per state. The regulatorily significant signal.
3. **Deactivated still billing** — NPPES-deactivated NPIs in that state showing billing activity (H31 result per state).
4. **Industry payments post-exclusion** — count of LEIE/SAM-active NPIs in that state receiving Open Payments transfers strictly post-exclusion (H32).
5. **Composite risk score** — normalized blend of the four. Available but not surfaced first; tucked under an "Advanced" link.

The metric chip toggles update the choropleth color scale + tooltip in place. No page reload.

#### Click behavior — side-panel overlay

When a visitor clicks a state, a panel slides in from the right (Headless-UI Transition / framer-motion or plain Tailwind transitions). The panel renders:

- **Header**: state name + critical-cohort count (e.g., "Texas · 404 federally-excluded NPIs").
- **Five summary rows** matching the cross-audit band on `/for-state-medicaid/<state>` — Medicaid spending, Medicare Part B + D (with opioid count), NPPES-deactivated still billing, Open Payments, directory hygiene context.
- **Three CTAs**: "Download cohort CSV" (state-cohort-critical.csv) · "Open full state report" (link to `/for-state-medicaid/<state>`) · "Verify a sample NPI" (link to NPPES Registry for the first sample row).
- **Close** button (top-right of the panel) returns the visitor to the map with the previously-selected state still highlighted.

The panel reads per-state data via the existing `loadStateClaimsAudit(state)` helper plus `loadStateCohort(state)` (already added to `frontend/src/lib/load-api-v1.ts`). No new API surface required.

#### Mobile fallback

On viewports narrower than ~640px:

- The choropleth renders as a non-interactive SVG outline (still recognizable, no fine-grained tooltip).
- Below the map: a sortable list of states with the same per-state numbers, tap-to-open the side panel as a full-screen sheet.
- Theme switcher collapses to a single icon in the nav.

### 2. Navigation consolidation — 5 items

The 11-item Navbar collapses to:

| Nav | Absorbs | Lands at |
| --- | --- | --- |
| **Explore** | NPD Search, Payer Search, Magic Scanner | `/` (the new map homepage) |
| **Findings** | Data Quality, Insights | `/findings` (existing) |
| **For States** | States, VA Briefing | `/for-state-medicaid` (new index page) |
| **Methodology** | (unchanged) | `/methodology` (existing) |
| **Developer** | HCS Survey, Subscribe / API docs | `/developer` (existing) |

`Sign In` becomes a small right-aligned icon (user silhouette) that opens the login modal when clicked. The current "NEW" badges on individual items go away — the homepage's "last updated" line carries the freshness signal instead.

**`/for-state-medicaid` index (new page)**: a lightweight choropleth-or-list view of all 51 jurisdictions, each linking to its per-state CMO page. Same dataset as the homepage map, but the framing is "pick your state for the forwardable explainer" rather than "explore the audit." Functions as the primary entry-point Greg's listserve forwards will surface for CMOs who land cold.

**`/npd` and `/payer-search` are preserved as deep-link URLs** — Explore's hero has compact search forms that route to these, so external bookmarks and our own existing links don't break.

### 3. Footer

Reorganized to absorb the demoted nav items. Three columns, all centered around audit credibility:

- **Resources**: Methodology · Data sources · Citation language · GitHub
- **Tools**: NPD Search · Payer FHIR cross-search · Magic Scanner · HCS Survey
- **Stay current**: Subscribe (email) · Latest update (link to most recent `/reports/<date>-update`)

Below the columns: a one-line provenance footer ("Audit of the CMS National Directory of Healthcare · Last refresh: 2026-05-08 · Methodology v0.6.1-draft · Apache-2.0").

## Data flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Build time                                                     │
│                                                                 │
│  loadStats() ──────────────► /api/v1/stats.json                 │
│  loadStateCohort(state) ───► state-cohort-critical.csv          │
│  loadStateClaimsAudit() ───► state/h29..h32 CSVs                │
│                                                                 │
│  All per-state numbers materialize into a single TypeScript     │
│  object the homepage map binds to. Map renders client-side from │
│  the pre-baked JSON.                                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Client (homepage hero)                                         │
│                                                                 │
│  Theme picker ◄──► localStorage.ainpi-theme                     │
│                ◄──► prefers-color-scheme (system fallback)      │
│  Metric chips ◄──► current metric state (in-memory)             │
│  Map onStateClick ──► <StateSidePanel state={state} />          │
│  StateSidePanel ──► CTAs to /for-state-medicaid/<state>         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Components

New under `frontend/src/components/`:

- **`MapHomepage.tsx`** — top-level page component. Orchestrates theme, metric, side-panel state.
- **`ThemeSwitcher.tsx`** — 3-pill picker. Handles localStorage + prefers-color-scheme.
- **`MetricSwitcher.tsx`** — chip toggle for the 5 map metrics.
- **`StateSidePanel.tsx`** — the click-to-drill overlay. Reads per-state JSON, renders summary + CTAs.

Reused as-is:

- **`USChoroplethMap`** — already supports `onStateClick` + variable color scheme.
- **`loadStateClaimsAudit`, `loadStateCohort`, `loadStateFindings`** — already in `load-api-v1.ts`.

Modified:

- **`Navbar.tsx`** — drops to 5 items, demotes Sign In to right-aligned icon.
- **`Footer.tsx`** — reorganized 3-column layout absorbing demoted nav items.
- **`app/page.tsx`** — replaces the `router.push('/npd')` redirect with `<MapHomepage />`.

## Build / hosting unchanged

- All map data is pre-baked at build time from existing per-state JSON / CSV files. No new API routes.
- `/` becomes static (`force-static`) — same caching characteristics as the rest of the published-finding pages.
- The choropleth is client-rendered via the existing `USChoroplethMap` (which is already loaded via `next/dynamic` so D3 stays out of SSR).

## What this is NOT

To stay focused:

- **Not a redesign of `/findings` or `/methodology`** — those keep their current pages. Only the entry surface changes.
- **Not a new data source** — every number on the homepage already exists in `frontend/public/api/v1/`.
- **Not auth-gated** — the homepage is fully public, same as today.
- **Not a SPA framework swap** — still Next.js App Router, still static export where possible.
- **Not a Vercel infrastructure change** — same hosting setup.

## Testing

Unit (Vitest):

- `ThemeSwitcher` honors localStorage, falls back to `prefers-color-scheme`, cycles correctly.
- `MetricSwitcher` updates the metric prop the map binds to.
- `StateSidePanel` renders the right summary rows for a given state, falls back gracefully when claims-audit data is missing.

E2E (Playwright):

- A visitor lands on `/`, sees the map, clicks Virginia, sees the panel with VA-specific numbers, clicks "Open full state report" and lands on `/for-state-medicaid/va`.
- A visitor with `prefers-color-scheme: dark` lands on `/`, sees the Dark dashboard layout, switches to Light cards, the choice persists on reload.
- Mobile viewport: the map degrades to the SVG outline + list view; tap-to-open the side panel works.

## Open considerations (handled in implementation plan)

- **Composite risk score formula** — TBD as part of implementation. Likely a weighted sum normalized to the state's total provider count. The default-cohort-size metric is enough to ship without it.
- **Animation library** — Tailwind's built-in transitions probably suffice for the side panel. If we want amCharts-style state-hover lift, would consider framer-motion. Decided in implementation, no design impact.
- **Compact NPD search form on the homepage** — exact placement (above map vs in the nav vs in the hero) depends on a few responsive tests in the implementation pass. The fact that it exists is the design commitment.

## Out of scope (potential follow-ups)

- Map of countries (international payer directory cross-audit) — not in this design.
- Interactive findings catalog (sort/filter `/findings`) — separate spec when needed.
- Email digest customization (per-state alerts) — useful but not the priority.

## References

- amCharts US choropleth demo — https://www.amcharts.com/demos/trumps-reciprocal-tariffs-map/
- healthdata.gov — https://www.healthdata.gov
- WHO Global Progress Dashboard — https://data.who.int/dashboards/global-progress
- Greg Barabell DMAS feedback (2026-05-15) — captured in [[feedback-cmo-audience-framing]] memory.
