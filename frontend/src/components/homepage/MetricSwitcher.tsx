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
      role="group"
      aria-label="Map metric"
      className="flex flex-wrap gap-2 text-xs"
    >
      {metrics.map((m) => {
        const selected = m.slug === value;
        return (
          <button
            key={m.slug}
            type="button"
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
