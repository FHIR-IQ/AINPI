'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
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

  const totals = {
    cohort: data.states.reduce((s, x) => s + x.metrics.cohortSize, 0),
    deactivated: data.states.reduce((s, x) => s + x.metrics.deactivatedStillBilling, 0),
    industry: data.states.reduce(
      (s, x) => s + x.metrics.industryPaymentsPostExclusion,
      0,
    ),
  };

  // Resolve theme on mount (avoids SSR/CSR mismatch).
  useEffect(() => {
    setTheme(initialTheme());
  }, []);

  const onThemeChange = (next: Theme) => {
    setTheme(next);
    persistTheme(next);
  };

  const stateValues = useMemo(
    () =>
      data.states.map((s) => ({
        state: s.code,
        value: s.metrics[metric],
      })),
    [data.states, metric],
  );

  const onStateClick = (code: string) => {
    const entry = data.states.find((s) => s.code === code);
    if (!entry) return;
    setSelected({
      code: entry.code,
      name: entry.name,
      cohortSize: entry.metrics.cohortSize,
      audit: entry.audit,
    });
  };

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
                  {totals.cohort.toLocaleString()}
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
              value={totals.cohort.toLocaleString()}
              caption="federally-excluded NPIs"
            />
            <KpiCard
              label="Still billing"
              value={totals.deactivated.toLocaleString()}
              caption="deactivated NPIs"
              tone="loss"
            />
            <KpiCard
              label="Industry $"
              value={totals.industry.toLocaleString()}
              caption="strict post-exclusion matches"
              tone="loss"
            />
          </div>
        )}

        {/* Metric switcher */}
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm opacity-80">
            <p>Click any state to see its findings.</p>
            {data.releaseDate && (
              <p className="text-xs opacity-70 mt-0.5">
                Last NDH refresh: <span className="tabular-nums">{data.releaseDate}</span>
                {data.methodologyVersion && ` · methodology v${data.methodologyVersion}`}
              </p>
            )}
          </div>
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

        {/* Accessible state directory — keyboard-and-screen-reader navigable mirror
            of the choropleth's click affordance. Also indexed by search engines so
            every state name appears in the page body. */}
        <ul className="sr-only" aria-label="State directory">
          {data.states.map((s) => (
            <li key={s.code}>
              <button type="button" onClick={() => onStateClick(s.code)}>
                {s.name}: {s.metrics[metric].toLocaleString()} {data.availableMetrics.find((m) => m.slug === metric)?.label.toLowerCase() ?? metric}
              </button>
            </li>
          ))}
        </ul>

        {/* Minimal layout: stats below map */}
        {theme === 'minimal' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-center">
            <MiniStat label="cohort" value={totals.cohort.toLocaleString()} />
            <MiniStat
              label="deactivated billing"
              value={totals.deactivated.toLocaleString()}
            />
            <MiniStat
              label="industry $"
              value={totals.industry.toLocaleString()}
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
