import type { ApiV1Stats } from '@/lib/api-v1-types';

function fmt(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function pct(n: number | null): string {
  return n == null ? '—' : n.toFixed(1) + '%';
}

interface StatsStripProps {
  stats: ApiV1Stats | null;
  variant?: 'light' | 'dark';
}

export default function StatsStrip({ stats, variant = 'light' }: StatsStripProps) {
  if (!stats) return null;

  const cellBg = variant === 'dark' ? 'bg-gray-900 text-white' : 'bg-white';
  const labelColor = variant === 'dark' ? 'text-gray-400' : 'text-gray-500';
  const numberColor = variant === 'dark' ? 'text-white' : 'text-gray-900';

  return (
    <section className={`${cellBg} rounded-lg border shadow-sm p-4 sm:p-6`}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
        <Metric
          label="Resources processed"
          value={fmt(stats.counters.resources_processed)}
          labelColor={labelColor}
          numberColor={numberColor}
        />
        <Metric
          label="NPIs flagged"
          value={
            stats.counters.npis_flagged == null || stats.counters.npis_checked == null
              ? '—'
              : pct(
                  (stats.counters.npis_flagged / stats.counters.npis_checked) * 100,
                )
          }
          labelColor={labelColor}
          numberColor={numberColor}
        />
        <Metric
          label="Endpoints live"
          value={pct(stats.counters.endpoints_live_pct)}
          labelColor={labelColor}
          numberColor={numberColor}
        />
        <Metric
          label="Findings"
          value={`${stats.counters.findings_published} published / ${stats.counters.findings_pre_registered} pre-reg`}
          small
          labelColor={labelColor}
          numberColor={numberColor}
        />
      </div>
      <div className={`mt-3 pt-3 border-t text-xs ${labelColor} flex flex-wrap gap-x-4 gap-y-1`}>
        <span>NPD release {stats.release_date}</span>
        <span>methodology v{stats.methodology_version}</span>
        <span>generated {stats.generated_at.slice(0, 10)}</span>
        {stats.commit_sha && stats.commit_sha !== 'pending' && (
          <span>
            commit <code className="font-mono">{stats.commit_sha.slice(0, 7)}</code>
          </span>
        )}
        <a href="/api/v1/stats.json" className="ml-auto hover:underline font-mono">
          /api/v1/stats.json
        </a>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  small,
  labelColor,
  numberColor,
}: {
  label: string;
  value: string;
  small?: boolean;
  labelColor: string;
  numberColor: string;
}) {
  return (
    <div>
      <p className={`text-xs font-medium uppercase tracking-wider ${labelColor}`}>
        {label}
      </p>
      <p className={`${small ? 'text-base' : 'text-2xl'} font-bold mt-1 ${numberColor}`}>
        {value}
      </p>
    </div>
  );
}
