import type { ApiV1FindingChart } from '@/lib/api-v1-types';

interface FindingChartProps {
  chart: ApiV1FindingChart;
}

const BAR_COLORS = [
  'bg-primary-600',
  'bg-purple-600',
  'bg-green-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-600',
  'bg-indigo-600',
];

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
    <div className="bg-white rounded-lg shadow-sm border p-5 mb-6">
      <div className="space-y-3">
        {chart.data.map((bar, i) => {
          const widthPct = Math.max((bar.value / max) * 100, 0.5);
          const color = BAR_COLORS[i % BAR_COLORS.length];
          return (
            <div key={bar.label}>
              <div className="flex justify-between items-baseline mb-1 text-sm">
                <span className="font-medium text-gray-700">{bar.label}</span>
                <span className="font-mono font-semibold text-gray-900 tabular-nums">
                  {formatValue(bar.value, chart.unit)}
                </span>
              </div>
              <div className="bg-gray-100 rounded-sm h-2 overflow-hidden">
                <div
                  className={`${color} h-2 rounded-sm transition-all`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {chart.unit && (
        <p className="mt-4 text-xs text-gray-400 text-right font-mono">
          unit: {chart.unit}
        </p>
      )}
    </div>
  );
}
