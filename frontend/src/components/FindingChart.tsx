import type { ApiV1FindingChart } from '@/lib/api-v1-types';

interface FindingChartProps {
  chart: ApiV1FindingChart;
}

/**
 * Ranked bar chart for a finding's supporting numbers.
 *
 * **One hue, on purpose.** This previously cycled seven colours by array
 * index. Index carries no meaning in any finding's chart data, so the colour
 * was encoding nothing while looking like it encoded something: on H54's
 * profession ranking it painted advanced practice blue and physicians purple
 * as though they were different kinds of thing. Bar length already carries the
 * value. A second, arbitrary channel only competes with it, and a seven-hue
 * rotation is neither greyscale-safe nor colour-blind-safe, which the rest of
 * this codebase's ramps are required to be.
 *
 * The container uses the design system's hairline and 2px radius rather than
 * the rounded-lg-plus-shadow it had, which was scaffold default.
 */
function formatValue(v: number, unit?: string): string {
  if (unit === 'percent') return `${v.toFixed(v < 1 ? 3 : v < 10 ? 2 : 1)}%`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (Number.isInteger(v)) return v.toLocaleString();
  return v.toFixed(2);
}

export default function FindingChart({ chart }: FindingChartProps) {
  if (!chart.data || chart.data.length === 0) return null;

  const max = Math.max(...chart.data.map((b) => b.value), 0.0001);

  return (
    <div className="mb-6 rounded-sm border border-gray-200 bg-white p-5">
      <div className="space-y-3">
        {chart.data.map((bar) => {
          // A floor so a genuine near-zero still renders a mark. H54's
          // pharmacy bar is 1 of 12,995: it must be visible as a sliver, not
          // vanish into an empty track that reads as missing data.
          const widthPct = Math.max((bar.value / max) * 100, 0.5);
          return (
            <div key={bar.label}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="font-medium text-gray-700">{bar.label}</span>
                <span className="font-mono font-semibold tabular-nums text-gray-900">
                  {formatValue(bar.value, chart.unit)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-sm bg-gray-100">
                <div
                  className="h-2 rounded-sm bg-primary-600"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {chart.unit && (
        <p className="mt-4 text-right font-mono text-xs text-gray-400">
          unit: {chart.unit}
        </p>
      )}
    </div>
  );
}
