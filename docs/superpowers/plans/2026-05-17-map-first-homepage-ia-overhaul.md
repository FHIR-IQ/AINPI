# Map-first homepage + IA overhaul · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/` redirect-to-search with a map-first dashboard featuring a 3-style theme switcher and a 5-metric choropleth, then collapse the 11-item navigation to 5 items.

**Architecture:** Next.js App Router server component fetches per-state data via the existing `loadStateClaimsAudit()` / `loadStateCohort()` helpers at build time, passes the aggregated structure to a client `MapHomepage` component, which orchestrates the existing `USChoroplethMap` plus three new client components (`ThemeSwitcher`, `MetricSwitcher`, `StateSidePanel`). Theme + metric live in client state; theme persists to `localStorage`. No new API routes.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind, D3 + topojson-client (already in `USChoroplethMap`), Vitest + @testing-library/react for unit tests, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-05-17-map-first-homepage-ia-overhaul-design.md`

---

## File structure (new + modified)

**New:**
- `frontend/src/lib/homepage-data.ts` — server-side aggregator that builds the per-state map data at build time.
- `frontend/src/components/homepage/ThemeSwitcher.tsx` — 3-pill picker with localStorage + prefers-color-scheme.
- `frontend/src/components/homepage/MetricSwitcher.tsx` — chip toggle for the 5 map metrics.
- `frontend/src/components/homepage/StateSidePanel.tsx` — click-to-drill overlay.
- `frontend/src/components/homepage/MapHomepage.tsx` — top-level orchestrator.
- `frontend/src/app/for-state-medicaid/page.tsx` — new index page listing all 51 state CMO surfaces.
- `frontend/tests/lib/homepage-data.test.ts`
- `frontend/tests/components/ThemeSwitcher.test.tsx`
- `frontend/tests/components/MetricSwitcher.test.tsx`
- `frontend/tests/components/StateSidePanel.test.tsx`
- `frontend/e2e/map-homepage.spec.ts`

**Modified:**
- `frontend/src/app/page.tsx` — replace `router.push('/npd')` with `<MapHomepage data={...} />`.
- `frontend/src/components/Navbar.tsx` — collapse 11 items to 5, demote Sign In to icon.
- `frontend/src/components/Footer.tsx` — reorganize to 3-column layout absorbing demoted nav items.

---

## Task 1: Server-side per-state data aggregator

Build a pure server-side function that aggregates per-state cohort + claims-audit data into the shape the homepage map needs. Pure function, easy to test, no UI dependencies — the right starting point.

**Files:**
- Create: `frontend/src/lib/homepage-data.ts`
- Create: `frontend/tests/lib/homepage-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/lib/homepage-data.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { loadHomepageMapData, type MapMetric } from '@/lib/homepage-data';

describe('loadHomepageMapData', () => {
  it('returns one entry per published state (50 + DC + PR = 52)', () => {
    const data = loadHomepageMapData();
    expect(data.states.length).toBeGreaterThanOrEqual(51);
    expect(data.states.length).toBeLessThanOrEqual(52);
    expect(data.states.every((s) => /^[A-Z]{2}$/.test(s.code))).toBe(true);
  });

  it('each state carries the 5 metric values', () => {
    const data = loadHomepageMapData();
    const va = data.states.find((s) => s.code === 'VA');
    expect(va).toBeDefined();
    expect(typeof va!.metrics.cohortSize).toBe('number');
    expect(typeof va!.metrics.strictPostExclusion).toBe('number');
    expect(typeof va!.metrics.deactivatedStillBilling).toBe('number');
    expect(typeof va!.metrics.industryPaymentsPostExclusion).toBe('number');
    expect(typeof va!.metrics.compositeRiskScore).toBe('number');
  });

  it('cohort size matches the published cohort CSV row count', () => {
    const data = loadHomepageMapData();
    const va = data.states.find((s) => s.code === 'VA');
    // The VA cohort file has 125 critical NPIs as of the 2026-05-08 release.
    expect(va!.metrics.cohortSize).toBeGreaterThan(100);
    expect(va!.metrics.cohortSize).toBeLessThan(200);
  });

  it('compositeRiskScore is between 0 and 100 inclusive', () => {
    const data = loadHomepageMapData();
    for (const s of data.states) {
      expect(s.metrics.compositeRiskScore).toBeGreaterThanOrEqual(0);
      expect(s.metrics.compositeRiskScore).toBeLessThanOrEqual(100);
    }
  });

  it('the metrics list is exposed for the UI', () => {
    const data = loadHomepageMapData();
    const slugs = data.availableMetrics.map((m) => m.slug);
    expect(slugs).toEqual([
      'cohortSize',
      'strictPostExclusion',
      'deactivatedStillBilling',
      'industryPaymentsPostExclusion',
      'compositeRiskScore',
    ]);
    expect(data.availableMetrics[0].label).toBe('Critical cohort size');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run tests/lib/homepage-data.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/homepage-data'`.

- [ ] **Step 3: Implement the aggregator**

Create `frontend/src/lib/homepage-data.ts`:

```typescript
/**
 * Server-side aggregator for the homepage map.
 *
 * Reads the per-state cohort + claims-audit CSVs at build time and emits a
 * single typed structure with one entry per US jurisdiction. The MapHomepage
 * client component binds the choropleth to this structure. No HTTP fetch on
 * the client.
 */
import { loadStateCohort, loadStateClaimsAudit } from './load-api-v1';

export type MapMetricSlug =
  | 'cohortSize'
  | 'strictPostExclusion'
  | 'deactivatedStillBilling'
  | 'industryPaymentsPostExclusion'
  | 'compositeRiskScore';

export interface MapMetric {
  slug: MapMetricSlug;
  label: string;
  /** One-sentence description for the metric switcher tooltip. */
  description: string;
  /** Unit hint for the legend ('count' | 'usd' | 'score'). */
  unit: 'count' | 'usd' | 'score';
}

export interface StateMapEntry {
  code: string;
  name: string;
  metrics: Record<MapMetricSlug, number>;
}

export interface HomepageMapData {
  generatedAt: string;
  states: StateMapEntry[];
  availableMetrics: MapMetric[];
}

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const AVAILABLE_METRICS: MapMetric[] = [
  {
    slug: 'cohortSize',
    label: 'Critical cohort size',
    description: 'Federally-excluded NPIs (LEIE or SAM active, score ≥ 1.5) in this state.',
    unit: 'count',
  },
  {
    slug: 'strictPostExclusion',
    label: 'Strict post-exclusion violations',
    description: 'Cohort NPIs paid by Medicaid, Part B, or Part D after their exclusion took effect.',
    unit: 'count',
  },
  {
    slug: 'deactivatedStillBilling',
    label: 'Deactivated still billing',
    description: 'NPPES-deactivated NPIs in this state still showing billing activity.',
    unit: 'count',
  },
  {
    slug: 'industryPaymentsPostExclusion',
    label: 'Industry payments post-exclusion',
    description: 'Excluded NPIs in this state receiving pharma/device payments after exclusion (PY 2024).',
    unit: 'count',
  },
  {
    slug: 'compositeRiskScore',
    label: 'Composite risk score (0-100)',
    description: 'Min-max normalized blend of cohort size + strict-post + deactivated-billing + industry payments.',
    unit: 'score',
  },
];

function rawMetrics(state: string): {
  cohortSize: number;
  strictPostExclusion: number;
  deactivatedStillBilling: number;
  industryPaymentsPostExclusion: number;
} {
  const cohort = loadStateCohort(state);
  const audit = loadStateClaimsAudit(state);
  return {
    cohortSize: cohort.length,
    strictPostExclusion:
      audit.medicaid.strict_post_exclusion_matches +
      audit.partb.strict_post_exclusion_matches +
      audit.partd.strict_post_exclusion_matches,
    deactivatedStillBilling: audit.deactivated_billing.matches,
    industryPaymentsPostExclusion: audit.industry_payments.strict_post_exclusion_matches,
  };
}

function normalize(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

export function loadHomepageMapData(): HomepageMapData {
  const codes = Object.keys(STATE_NAMES);
  const raw = codes.map((code) => ({ code, ...rawMetrics(code) }));

  const maxCohort = Math.max(...raw.map((r) => r.cohortSize), 1);
  const maxStrict = Math.max(...raw.map((r) => r.strictPostExclusion), 1);
  const maxDeact = Math.max(...raw.map((r) => r.deactivatedStillBilling), 1);
  const maxIndustry = Math.max(...raw.map((r) => r.industryPaymentsPostExclusion), 1);

  const states: StateMapEntry[] = raw.map((r) => {
    const cohortScore = normalize(r.cohortSize, maxCohort);
    const strictScore = normalize(r.strictPostExclusion, maxStrict);
    const deactScore = normalize(r.deactivatedStillBilling, maxDeact);
    const industryScore = normalize(r.industryPaymentsPostExclusion, maxIndustry);
    const composite = Math.round((cohortScore + strictScore + deactScore + industryScore) / 4);
    return {
      code: r.code,
      name: STATE_NAMES[r.code],
      metrics: {
        cohortSize: r.cohortSize,
        strictPostExclusion: r.strictPostExclusion,
        deactivatedStillBilling: r.deactivatedStillBilling,
        industryPaymentsPostExclusion: r.industryPaymentsPostExclusion,
        compositeRiskScore: composite,
      },
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    states,
    availableMetrics: AVAILABLE_METRICS,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run tests/lib/homepage-data.test.ts
```

Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/homepage-data.ts frontend/tests/lib/homepage-data.test.ts
git commit -m "feat(homepage): server-side per-state map data aggregator + composite risk score"
```

---

## Task 2: ThemeSwitcher client component

Three-pill picker with localStorage persistence and `prefers-color-scheme` fallback. Pure client component, fully testable with jsdom.

**Files:**
- Create: `frontend/src/components/homepage/ThemeSwitcher.tsx`
- Create: `frontend/tests/components/ThemeSwitcher.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/ThemeSwitcher.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThemeSwitcher, { type Theme } from '@/components/homepage/ThemeSwitcher';

function setMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    localStorage.clear();
    setMatchMedia(false);
  });

  it('defaults to light when no localStorage and no system preference', () => {
    const onChange = vi.fn();
    render(<ThemeSwitcher value="light" onChange={onChange} />);
    expect(screen.getByRole('button', { name: /light cards/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows dark as selected when value="dark"', () => {
    render(<ThemeSwitcher value="dark" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /dark dashboard/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('calls onChange when a different theme is clicked', () => {
    const onChange = vi.fn();
    render(<ThemeSwitcher value="light" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /dark dashboard/i }));
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('exposes the three theme labels', () => {
    render(<ThemeSwitcher value="light" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /light cards/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dark dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /minimal map/i })).toBeInTheDocument();
  });
});

describe('initialTheme helper', () => {
  it('returns localStorage value when set', async () => {
    localStorage.setItem('ainpi-theme', 'minimal');
    setMatchMedia(true);
    const { initialTheme } = await import('@/components/homepage/ThemeSwitcher');
    expect(initialTheme()).toBe('minimal');
  });

  it('returns dark when prefers-color-scheme: dark and no localStorage', async () => {
    localStorage.clear();
    setMatchMedia(true);
    const { initialTheme } = await import('@/components/homepage/ThemeSwitcher');
    expect(initialTheme()).toBe('dark');
  });

  it('returns light when prefers-color-scheme: light and no localStorage', async () => {
    localStorage.clear();
    setMatchMedia(false);
    const { initialTheme } = await import('@/components/homepage/ThemeSwitcher');
    expect(initialTheme()).toBe('light');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run tests/components/ThemeSwitcher.test.tsx
```

Expected: FAIL with `Cannot find module '@/components/homepage/ThemeSwitcher'`.

- [ ] **Step 3: Implement ThemeSwitcher**

Create `frontend/src/components/homepage/ThemeSwitcher.tsx`:

```tsx
'use client';

export type Theme = 'light' | 'dark' | 'minimal';

const THEMES: { value: Theme; label: string; icon: string }[] = [
  { value: 'light', label: 'Light cards', icon: '☀️' },
  { value: 'dark', label: 'Dark dashboard', icon: '🌙' },
  { value: 'minimal', label: 'Minimal map', icon: '⚡' },
];

const STORAGE_KEY = 'ainpi-theme';

/**
 * Resolve the initial theme on first render, in priority order:
 *   1. localStorage value (returning visitor's choice)
 *   2. prefers-color-scheme: dark → 'dark'
 *   3. fallback 'light'
 *
 * Safe to call during SSR (returns 'light' if window is undefined).
 */
export function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'minimal') {
    return stored;
  }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/** Persist the visitor's theme choice. */
export function persistTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, theme);
}

interface ThemeSwitcherProps {
  value: Theme;
  onChange: (next: Theme) => void;
}

export default function ThemeSwitcher({ value, onChange }: ThemeSwitcherProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Page style"
      className="inline-flex bg-white/90 backdrop-blur border border-slate-200 rounded-full p-1 gap-1 text-xs font-medium"
    >
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-pressed={t.value === value}
          aria-label={t.label}
          onClick={() => onChange(t.value)}
          className={`px-3 py-1.5 rounded-full transition-colors ${
            t.value === value
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span aria-hidden="true">{t.icon}</span> {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run tests/components/ThemeSwitcher.test.tsx
```

Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/homepage/ThemeSwitcher.tsx frontend/tests/components/ThemeSwitcher.test.tsx
git commit -m "feat(homepage): ThemeSwitcher with localStorage + prefers-color-scheme fallback"
```

---

## Task 3: MetricSwitcher client component

Chip toggle for the 5 map metrics. Pure controlled component.

**Files:**
- Create: `frontend/src/components/homepage/MetricSwitcher.tsx`
- Create: `frontend/tests/components/MetricSwitcher.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/MetricSwitcher.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MetricSwitcher from '@/components/homepage/MetricSwitcher';
import type { MapMetric } from '@/lib/homepage-data';

const METRICS: MapMetric[] = [
  { slug: 'cohortSize', label: 'Cohort size', description: '', unit: 'count' },
  { slug: 'strictPostExclusion', label: 'Strict post', description: '', unit: 'count' },
  { slug: 'deactivatedStillBilling', label: 'Deactivated', description: '', unit: 'count' },
];

describe('MetricSwitcher', () => {
  it('renders one chip per metric', () => {
    render(<MetricSwitcher metrics={METRICS} value="cohortSize" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /cohort size/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /strict post/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deactivated/i })).toBeInTheDocument();
  });

  it('marks the selected chip with aria-pressed', () => {
    render(<MetricSwitcher metrics={METRICS} value="strictPostExclusion" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /strict post/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /cohort size/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('calls onChange with the slug of the clicked metric', () => {
    const onChange = vi.fn();
    render(<MetricSwitcher metrics={METRICS} value="cohortSize" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /deactivated/i }));
    expect(onChange).toHaveBeenCalledWith('deactivatedStillBilling');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run tests/components/MetricSwitcher.test.tsx
```

Expected: FAIL with `Cannot find module '@/components/homepage/MetricSwitcher'`.

- [ ] **Step 3: Implement MetricSwitcher**

Create `frontend/src/components/homepage/MetricSwitcher.tsx`:

```tsx
'use client';

import type { MapMetric, MapMetricSlug } from '@/lib/homepage-data';

interface MetricSwitcherProps {
  metrics: MapMetric[];
  value: MapMetricSlug;
  onChange: (next: MapMetricSlug) => void;
}

export default function MetricSwitcher({ metrics, value, onChange }: MetricSwitcherProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Map metric"
      className="flex flex-wrap gap-2 text-xs"
    >
      {metrics.map((m) => {
        const selected = m.slug === value;
        return (
          <button
            key={m.slug}
            type="button"
            role="radio"
            aria-pressed={selected}
            title={m.description}
            onClick={() => onChange(m.slug)}
            className={`px-3 py-1.5 rounded-full border transition-colors ${
              selected
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
            }`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run tests/components/MetricSwitcher.test.tsx
```

Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/homepage/MetricSwitcher.tsx frontend/tests/components/MetricSwitcher.test.tsx
git commit -m "feat(homepage): MetricSwitcher chip toggle for 5 map metrics"
```

---

## Task 4: StateSidePanel client component

Slide-in overlay that opens when a state is clicked. Renders cohort count + five summary rows + three CTAs.

**Files:**
- Create: `frontend/src/components/homepage/StateSidePanel.tsx`
- Create: `frontend/tests/components/StateSidePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/StateSidePanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StateSidePanel from '@/components/homepage/StateSidePanel';

describe('StateSidePanel', () => {
  it('renders nothing when no state is selected', () => {
    const { container } = render(<StateSidePanel state={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders state name and cohort count when open', () => {
    render(
      <StateSidePanel
        state={{ code: 'VA', name: 'Virginia', cohortSize: 125 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Virginia')).toBeInTheDocument();
    expect(screen.getByText(/125/)).toBeInTheDocument();
    expect(screen.getByText(/federally-excluded NPIs/i)).toBeInTheDocument();
  });

  it('has a Download CSV link with the correct per-state URL', () => {
    render(
      <StateSidePanel
        state={{ code: 'VA', name: 'Virginia', cohortSize: 125 }}
        onClose={vi.fn()}
      />,
    );
    const csvLink = screen.getByRole('link', { name: /download cohort csv/i });
    expect(csvLink).toHaveAttribute(
      'href',
      '/api/v1/states/va-cohort-critical.csv',
    );
  });

  it('has an Open full state report link to /for-state-medicaid/<state>', () => {
    render(
      <StateSidePanel
        state={{ code: 'TX', name: 'Texas', cohortSize: 404 }}
        onClose={vi.fn()}
      />,
    );
    const reportLink = screen.getByRole('link', { name: /open full state report/i });
    expect(reportLink).toHaveAttribute('href', '/for-state-medicaid/tx');
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <StateSidePanel
        state={{ code: 'VA', name: 'Virginia', cohortSize: 125 }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run tests/components/StateSidePanel.test.tsx
```

Expected: FAIL with `Cannot find module '@/components/homepage/StateSidePanel'`.

- [ ] **Step 3: Implement StateSidePanel**

Create `frontend/src/components/homepage/StateSidePanel.tsx`:

```tsx
'use client';

import Link from 'next/link';

export interface SidePanelState {
  code: string;
  name: string;
  cohortSize: number;
}

interface StateSidePanelProps {
  state: SidePanelState | null;
  onClose: () => void;
}

export default function StateSidePanel({ state, onClose }: StateSidePanelProps) {
  if (!state) return null;
  const lower = state.code.toLowerCase();
  return (
    <aside
      role="dialog"
      aria-label={`${state.name} findings`}
      className="fixed inset-y-0 right-0 w-full sm:w-[420px] bg-white shadow-2xl border-l border-slate-200 z-50 overflow-y-auto"
    >
      <div className="flex items-start justify-between px-6 py-5 border-b border-slate-200">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-blue-700">
            State of the federal directory · {state.code}
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mt-1">{state.name}</h2>
          <p className="text-sm text-slate-600 mt-1">
            <strong className="tabular-nums text-slate-900">
              {state.cohortSize.toLocaleString()}
            </strong>{' '}
            federally-excluded NPIs still listed in the federal directory.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
        >
          ×
        </button>
      </div>
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-slate-700 leading-relaxed">
          AINPI&apos;s cross-audit of {state.name} surfaces this cohort against
          Medicaid spending, Medicare Part&nbsp;B + Part&nbsp;D billing,
          NPPES-deactivated-still-billing, and Open Payments. The per-row CSV
          carries primary-source verification URLs for every NPI so your
          Program-Integrity team can verify any case in 30 seconds.
        </p>
        <div className="flex flex-col gap-2">
          <Link
            href={`/api/v1/states/${lower}-cohort-critical.csv`}
            className="inline-flex items-center justify-center px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-md"
          >
            Download cohort CSV ({state.cohortSize.toLocaleString()} NPIs)
          </Link>
          <Link
            href={`/for-state-medicaid/${lower}`}
            className="inline-flex items-center justify-center px-4 py-2.5 bg-white hover:bg-slate-50 text-blue-700 border border-blue-600 font-semibold text-sm rounded-md"
          >
            Open full state report →
          </Link>
          <Link
            href={`/states/${lower}`}
            className="text-sm text-slate-600 hover:text-slate-900 underline mt-1"
          >
            Technical state audit page (for data teams)
          </Link>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run tests/components/StateSidePanel.test.tsx
```

Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/homepage/StateSidePanel.tsx frontend/tests/components/StateSidePanel.test.tsx
git commit -m "feat(homepage): StateSidePanel overlay with cohort summary + CTAs"
```

---

## Task 5: MapHomepage orchestrator + replace `/` route

Wire the three new components together with the existing `USChoroplethMap`, then swap the homepage from a redirect to the new dashboard.

**Files:**
- Create: `frontend/src/components/homepage/MapHomepage.tsx`
- Modify: `frontend/src/app/page.tsx`

- [ ] **Step 1: Implement MapHomepage**

Create `frontend/src/components/homepage/MapHomepage.tsx`:

```tsx
'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import ThemeSwitcher, {
  initialTheme,
  persistTheme,
  type Theme,
} from './ThemeSwitcher';
import MetricSwitcher from './MetricSwitcher';
import StateSidePanel, { type SidePanelState } from './StateSidePanel';
import type { HomepageMapData, MapMetricSlug } from '@/lib/homepage-data';

// USChoroplethMap is D3-heavy — keep out of SSR.
const USChoroplethMap = dynamic(
  () => import('@/components/charts/USChoroplethMap'),
  { ssr: false, loading: () => <div className="h-[600px] bg-slate-100 animate-pulse" /> },
);

interface MapHomepageProps {
  data: HomepageMapData;
}

const THEME_CLASS: Record<Theme, string> = {
  light: 'bg-slate-50 text-slate-900',
  dark: 'bg-slate-950 text-slate-100',
  minimal: 'bg-white text-slate-900',
};

const COLOR_SCHEME: Record<Theme, 'blues' | 'reds' | 'greens'> = {
  light: 'blues',
  dark: 'reds',
  minimal: 'blues',
};

export default function MapHomepage({ data }: MapHomepageProps) {
  const [theme, setTheme] = useState<Theme>('light');
  const [metric, setMetric] = useState<MapMetricSlug>('cohortSize');
  const [selected, setSelected] = useState<SidePanelState | null>(null);

  // Resolve theme on mount (avoids SSR/CSR mismatch).
  useEffect(() => {
    setTheme(initialTheme());
  }, []);

  const onThemeChange = (next: Theme) => {
    setTheme(next);
    persistTheme(next);
  };

  const stateValues = data.states.map((s) => ({
    state: s.code,
    value: s.metrics[metric],
  }));

  const onStateClick = (code: string) => {
    const entry = data.states.find((s) => s.code === code);
    if (!entry) return;
    setSelected({
      code: entry.code,
      name: entry.name,
      cohortSize: entry.metrics.cohortSize,
    });
  };

  const topStat = data.states.reduce(
    (sum, s) => sum + s.metrics.cohortSize,
    0,
  );

  return (
    <main className={`min-h-screen ${THEME_CLASS[theme]} transition-colors`}>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-6">
        {/* Header band: stat + theme switcher */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-2">
              An audit of the federal provider directory · live
            </div>
            {theme === 'dark' ? (
              <h1 className="text-4xl sm:text-5xl font-bold leading-tight max-w-3xl">
                <span className="tabular-nums text-blue-400">
                  {topStat.toLocaleString()}
                </span>{' '}
                federally-excluded NPIs are still listed in the federal provider
                directory today.
              </h1>
            ) : (
              <h1 className="text-3xl sm:text-4xl font-bold leading-tight max-w-2xl">
                State of the federal provider directory
              </h1>
            )}
          </div>
          <ThemeSwitcher value={theme} onChange={onThemeChange} />
        </div>

        {/* Light cards layout: 3 KPI stats above map */}
        {theme === 'light' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <KpiCard
              label="Cohort"
              value={topStat.toLocaleString()}
              caption="federally-excluded NPIs"
            />
            <KpiCard
              label="Still billing"
              value={data.states
                .reduce((s, x) => s + x.metrics.deactivatedStillBilling, 0)
                .toLocaleString()}
              caption="deactivated NPIs"
              tone="loss"
            />
            <KpiCard
              label="Industry $"
              value={data.states
                .reduce(
                  (s, x) => s + x.metrics.industryPaymentsPostExclusion,
                  0,
                )
                .toLocaleString()}
              caption="strict post-exclusion matches"
              tone="loss"
            />
          </div>
        )}

        {/* Metric switcher */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm opacity-80">Click any state to see its findings.</p>
          <MetricSwitcher
            metrics={data.availableMetrics}
            value={metric}
            onChange={setMetric}
          />
        </div>

        {/* Map */}
        <div className="rounded-lg overflow-hidden bg-white shadow-sm">
          <USChoroplethMap
            data={stateValues}
            title=""
            colorScheme={COLOR_SCHEME[theme]}
            onStateClick={onStateClick}
            selectedState={selected?.code ?? null}
          />
        </div>

        {/* Minimal layout: stats below map */}
        {theme === 'minimal' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-center">
            <MiniStat label="cohort" value={topStat.toLocaleString()} />
            <MiniStat
              label="deactivated billing"
              value={data.states
                .reduce((s, x) => s + x.metrics.deactivatedStillBilling, 0)
                .toLocaleString()}
            />
            <MiniStat
              label="industry $"
              value={data.states
                .reduce(
                  (s, x) => s + x.metrics.industryPaymentsPostExclusion,
                  0,
                )
                .toLocaleString()}
            />
            <MiniStat label="NDH complete" value="99.99984%" />
          </div>
        )}
      </section>

      <StateSidePanel state={selected} onClose={() => setSelected(null)} />
    </main>
  );
}

function KpiCard({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  tone?: 'loss' | 'gain';
}) {
  const valueColor =
    tone === 'loss' ? 'text-red-600' : tone === 'gain' ? 'text-emerald-600' : 'text-slate-900';
  return (
    <div className="bg-white border border-slate-200 rounded-md p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`text-3xl font-bold tabular-nums ${valueColor}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{caption}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs opacity-70">
      <div className="text-xl font-bold tabular-nums text-slate-900 mb-0.5">
        {value}
      </div>
      {label}
    </div>
  );
}
```

- [ ] **Step 2: Replace the homepage route**

Modify `frontend/src/app/page.tsx`. Replace the entire file with:

```tsx
import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import MapHomepage from '@/components/homepage/MapHomepage';
import { loadHomepageMapData } from '@/lib/homepage-data';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'AINPI — Audit of the federal provider directory',
  description:
    'A free, public audit of the CMS National Directory of Healthcare. Click any state to see federally-excluded NPIs still listed in the federal directory and the claims-side cross-audit for that state.',
};

export default function HomePage() {
  const data = loadHomepageMapData();
  return (
    <>
      <Navbar />
      <MapHomepage data={data} />
    </>
  );
}
```

- [ ] **Step 3: Build to verify static prerender**

```bash
cd frontend && npm run build 2>&1 | grep -E "^\\s*[├└].*/" | head -8
```

Expected: `/ ○` (static) appearing in the route table; no errors.

- [ ] **Step 4: Run full test suite to confirm no regressions**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass (existing 86 + the 3 new tests = ~104 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/homepage/MapHomepage.tsx frontend/src/app/page.tsx
git commit -m "feat(homepage): map-first / route with theme + metric + side panel"
```

---

## Task 6: Navbar consolidation — 11 items to 5

**Files:**
- Modify: `frontend/src/components/Navbar.tsx`

- [ ] **Step 1: Replace the Navbar contents**

Replace the entire `frontend/src/components/Navbar.tsx` with:

```tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, User, Map, FileText, MapPin, BookOpen, Code2 } from 'lucide-react';

const NAV_ITEMS: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: '/', label: 'Explore', icon: <Map className="w-4 h-4 mr-1.5" /> },
  { href: '/findings', label: 'Findings', icon: <FileText className="w-4 h-4 mr-1.5" /> },
  { href: '/for-state-medicaid', label: 'For States', icon: <MapPin className="w-4 h-4 mr-1.5" /> },
  { href: '/methodology', label: 'Methodology', icon: <BookOpen className="w-4 h-4 mr-1.5" /> },
  { href: '/developer', label: 'Developer', icon: <Code2 className="w-4 h-4 mr-1.5" /> },
];

export default function Navbar() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    setIsLoggedIn(!!localStorage.getItem('token'));
  }, []);

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-2xl font-bold text-primary-600">
            AINPI
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center text-slate-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {isLoggedIn ? (
              <button
                onClick={() => {
                  localStorage.removeItem('token');
                  setIsLoggedIn(false);
                  router.push('/');
                }}
                aria-label="Sign out"
                className="text-slate-500 hover:text-slate-900 p-2 rounded-full"
              >
                <LogOut className="w-5 h-5" />
              </button>
            ) : (
              <Link
                href="/login"
                aria-label="Sign in"
                className="text-slate-500 hover:text-slate-900 p-2 rounded-full"
              >
                <User className="w-5 h-5" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Build to verify no compile errors**

```bash
cd frontend && npm run build 2>&1 | grep -E "error|Error" | head -5
```

Expected: no errors. (Pre-existing dynamic-server-error warnings from API routes are unrelated and may print — ignore those.)

- [ ] **Step 3: Run the full test suite**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass. (Sign-in / token-related tests, if any exist, should be unaffected — the icon button still calls the same logic.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Navbar.tsx
git commit -m "refactor(navbar): collapse 11 items to 5; Sign In becomes icon

Explore · Findings · For States · Methodology · Developer.
NPD Search / Payer Search / Magic Scanner absorbed into Explore.
Data Quality / Insights absorbed into Findings.
VA Briefing / States absorbed into For States.
HCS Survey absorbed into Developer."
```

---

## Task 7: Footer 3-column reorganization

**Files:**
- Modify: `frontend/src/components/Footer.tsx`

- [ ] **Step 1: Inspect current Footer to preserve any project-specific copy**

```bash
sed -n '1,80p' frontend/src/components/Footer.tsx
```

Note any one-off copy (subscriber count, project provenance) so it survives the rewrite.

- [ ] **Step 2: Replace Footer.tsx body**

Replace the entire `frontend/src/components/Footer.tsx` with:

```tsx
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-300 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 sm:grid-cols-3 gap-8 text-sm">
        <div>
          <h3 className="text-xs font-bold tracking-wider uppercase text-slate-400 mb-3">
            Resources
          </h3>
          <ul className="space-y-2">
            <li><Link href="/methodology" className="hover:text-white">Methodology</Link></li>
            <li><Link href="/data-sources" className="hover:text-white">Data sources</Link></li>
            <li><Link href="/smd-revalidation" className="hover:text-white">SMD-response citation language</Link></li>
            <li><a href="https://github.com/FHIR-IQ/AINPI" target="_blank" rel="noopener noreferrer" className="hover:text-white">GitHub</a></li>
            <li><Link href="/faq" className="hover:text-white">FAQ</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-bold tracking-wider uppercase text-slate-400 mb-3">
            Tools
          </h3>
          <ul className="space-y-2">
            <li><Link href="/npd" className="hover:text-white">NPD search</Link></li>
            <li><Link href="/provider-search" className="hover:text-white">Cross-source provider search</Link></li>
            <li><Link href="/magic-scanner" className="hover:text-white">Magic Scanner</Link></li>
            <li><Link href="/payer-healthcare-service-survey" className="hover:text-white">Healthcare Service Survey</Link></li>
            <li><Link href="/data-quality" className="hover:text-white">Data quality dashboard</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-bold tracking-wider uppercase text-slate-400 mb-3">
            Stay current
          </h3>
          <ul className="space-y-2">
            <li><Link href="/subscribe" className="hover:text-white">Subscribe to updates</Link></li>
            <li><Link href="/reports/2026-05-14-update" className="hover:text-white">Latest release update</Link></li>
            <li><Link href="/insights" className="hover:text-white">Provenance + variance analysis</Link></li>
            <li><Link href="/api/v1/manifest.json" className="hover:text-white">API manifest (JSON)</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-800 px-4 sm:px-6 lg:px-8 py-5 text-center text-xs text-slate-500">
        Audit of the CMS National Directory of Healthcare · Methodology v0.6.1-draft · Apache-2.0 · Produced by FHIR IQ
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Build to verify no errors**

```bash
cd frontend && npm run build 2>&1 | grep -E "error|Error" | head -5
```

Expected: no new errors.

- [ ] **Step 4: Run the test suite**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Footer.tsx
git commit -m "refactor(footer): 3-column layout absorbing demoted nav items

Resources / Tools / Stay current. Preserves all surfaces the
consolidated Navbar dropped (NPD search, Payer search, Magic
Scanner, HCS Survey, Data quality dashboard, Insights, FAQ)."
```

---

## Task 8: New `/for-state-medicaid` index page

A lightweight directory of all 51 CMO-facing per-state pages. Cold-arrival entry point for state Medicaid CMOs who land without prior context.

**Files:**
- Create: `frontend/src/app/for-state-medicaid/page.tsx`

- [ ] **Step 1: Implement the index page**

Create `frontend/src/app/for-state-medicaid/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { ALL_STATE_NAMES, allStateCodes } from '@/data/states';
import { loadStateCohort } from '@/lib/load-api-v1';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'AINPI for state Medicaid agencies',
  description:
    'A free, public audit of the federal provider directory for state Medicaid CMOs. Pick your state for a forwardable per-state explainer.',
};

interface Row {
  code: string;
  name: string;
  count: number;
}

export default function ForStateMedicaidIndex() {
  const rows: Row[] = allStateCodes()
    .map((code): Row => ({
      code: code.toLowerCase(),
      name: ALL_STATE_NAMES[code.toUpperCase()] ?? code,
      count: loadStateCohort(code.toUpperCase()).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalCohort = rows.reduce((s, r) => s + r.count, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-xs font-bold uppercase tracking-wider text-blue-700 mb-3">
          AINPI · for state Medicaid agencies
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
          Pick your state.
        </h1>
        <p className="text-lg text-slate-700 max-w-2xl mb-2 leading-relaxed">
          Each state gets a forwardable explainer with the federally-excluded
          NPIs in that state, the claims-side cross-audit (Medicaid spending,
          Medicare Part&nbsp;B + Part&nbsp;D, NPPES-deactivated still billing,
          Open Payments), and citation-ready language for your 2026-05-23 CMS
          State Medicaid Director-letter response.
        </p>
        <p className="text-sm text-slate-500 mb-8">
          Cohort across all 51 jurisdictions:{' '}
          <strong className="text-slate-700 tabular-nums">
            {totalCohort.toLocaleString()}
          </strong>{' '}
          federally-excluded NPIs.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {rows.map((r) => (
            <Link
              key={r.code}
              href={`/for-state-medicaid/${r.code}`}
              className="flex items-center justify-between bg-white border border-slate-200 hover:border-blue-400 rounded-md px-3 py-2.5 text-sm transition-colors"
            >
              <span className="font-medium text-slate-900">{r.name}</span>
              <span className="text-xs tabular-nums text-slate-500">
                {r.count.toLocaleString()}
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify the route generates**

```bash
cd frontend && npm run build 2>&1 | grep "for-state-medicaid" | head -5
```

Expected output includes both `/for-state-medicaid` (○ Static) and `/for-state-medicaid/[state]` (● SSG).

- [ ] **Step 3: Run the test suite**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/for-state-medicaid/page.tsx
git commit -m "feat(for-state-medicaid): index page listing all 51 CMO-facing state pages"
```

---

## Task 9: E2E happy-path smoke test

Validates the full homepage → side-panel → state-report flow against a running dev server.

**Files:**
- Create: `frontend/e2e/map-homepage.spec.ts`

- [ ] **Step 1: Write the E2E test**

Create `frontend/e2e/map-homepage.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('map-first homepage', () => {
  test('renders the map, theme switcher, and metric switcher', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('radiogroup', { name: 'Page style' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Map metric' })).toBeVisible();
    // The choropleth SVG should be in the DOM after D3 mounts.
    await expect(page.locator('svg').first()).toBeVisible({ timeout: 10000 });
  });

  test('theme switcher cycles and persists', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /dark dashboard/i }).click();
    await expect(page.getByRole('button', { name: /dark dashboard/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.reload();
    await expect(page.getByRole('button', { name: /dark dashboard/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('nav has exactly 5 items', async ({ page }) => {
    await page.goto('/');
    const labels = ['Explore', 'Findings', 'For States', 'Methodology', 'Developer'];
    for (const label of labels) {
      await expect(page.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('for-state-medicaid index links to per-state pages', async ({ page }) => {
    await page.goto('/for-state-medicaid');
    const va = page.getByRole('link', { name: /Virginia/ });
    await expect(va).toBeVisible();
    await expect(va).toHaveAttribute('href', '/for-state-medicaid/va');
  });
});
```

- [ ] **Step 2: Run the E2E suite (dev mode)**

```bash
cd frontend && npm run test:e2e -- map-homepage.spec.ts
```

Expected: all 4 cases pass. (The Playwright config in `playwright.config.ts` boots its own dev server.)

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/map-homepage.spec.ts
git commit -m "test(e2e): smoke-test map homepage, theme persistence, nav, for-state index"
```

---

## Task 10: Open PR + auto-merge

- [ ] **Step 1: Push the branch**

```bash
git push -u origin map-first-homepage-ia-overhaul
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create \
  --title "Map-first homepage + 5-item IA overhaul" \
  --body "$(cat <<'EOF'
## Summary

Implements the design at `docs/superpowers/specs/2026-05-17-map-first-homepage-ia-overhaul-design.md`.

- `/` becomes a map-first dashboard (was redirect to /npd).
- 3-style theme switcher (Light cards default, Dark dashboard, Minimal map). System-aware fallback via `prefers-color-scheme: dark`.
- 5-metric switcher on the choropleth.
- Click any state → side-panel overlay with cohort summary, CSV download, and link to the full state report.
- Navbar consolidated from 11 items to 5: Explore · Findings · For States · Methodology · Developer.
- Footer reorganized into a 3-column layout (Resources / Tools / Stay current).
- New `/for-state-medicaid` index page listing all 51 jurisdictions.

## Test plan

- [x] `npm run test` passes (vitest)
- [x] `npm run test:e2e map-homepage.spec.ts` passes
- [x] `npm run build` clean
- [ ] CI green
- [ ] Vercel preview: map renders, theme switcher cycles, state click opens panel, nav has exactly 5 items

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Queue auto-merge**

```bash
gh pr merge --merge --auto
```

- [ ] **Step 4: Verify production once Vercel finishes deploying**

```bash
# Wait for the deploy
until curl -sI https://ainpi.dev/ | head -1 | grep -q "200"; do sleep 30; done
echo "Homepage live"
# Confirm the new content is there and not the old redirect
curl -sL https://ainpi.dev/ | grep -oE "(State of the federal|federally-excluded NPIs|Page style|Map metric)" | sort -u
# Confirm the for-state-medicaid index is reachable
curl -sI https://ainpi.dev/for-state-medicaid | head -1
```

Expected: 200 OK on both URLs; the homepage content greps match (no `<meta http-equiv="refresh">`-style redirect).

---

## Self-review notes

**Spec coverage:**

- 3-style theme switcher (B default, system-aware) — Task 2 + Task 5
- 5-metric switcher on the choropleth — Task 3 + Task 5
- Side-panel overlay on state click with three CTAs — Task 4
- Nav 11 → 5 + Sign In demoted to icon — Task 6
- Footer 3-column reorganization — Task 7
- New `/for-state-medicaid` index page — Task 8
- Mobile fallback — handled via Tailwind responsive classes in Tasks 4, 5, 8 (full-width side panel on `sm:` viewports, single-column footer + index grid on mobile, choropleth's own responsive behavior). E2E in Task 9 doesn't test mobile explicitly but adding a `test.use({ viewport: { width: 375, height: 667 } })` block is a low-cost follow-up if desired.
- Composite risk score formula — defined in Task 1 (`normalize` to 0-100, average four base metrics).

**Placeholder scan:** No `TBD`, `TODO`, `add appropriate handling`, or "similar to Task N" references. The composite risk score formula is concrete (min-max normalize each base metric to 0-100, average them).

**Type consistency:** `Theme` type lives in `ThemeSwitcher.tsx` and re-imported where needed. `MapMetricSlug` and `MapMetric` live in `homepage-data.ts`. `SidePanelState` lives in `StateSidePanel.tsx`. All names match across tasks. The `USChoroplethMap` props (`data: { state, value }[]`, `colorScheme`, `onStateClick`, `selectedState`) match what the existing component already exposes.
