'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { RuralStateRow } from '@/components/charts/RuralStateMap';
import InlineSubscribe from '@/components/InlineSubscribe';

const RuralStateMap = dynamic(() => import('@/components/charts/RuralStateMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[380px] flex items-center justify-center bg-white rounded-lg border border-gray-200 text-gray-500">
      Loading map…
    </div>
  ),
});

type SortKey = 'rural_share' | 'rural' | 'critical_access' | 'hospitals' | 'name';

export default function RuralNational({ rows }: { rows: RuralStateRow[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('rural_share');

  const sorted = useMemo(() => {
    const r = [...rows];
    r.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : (b[sort] as number) - (a[sort] as number),
    );
    return r;
  }, [rows, sort]);

  const pick = selected ? rows.find((r) => r.state === selected) : null;

  return (
    <div className="space-y-4">
      <RuralStateMap rows={rows} selected={selected} onSelect={setSelected} />

      {pick && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-x-8 gap-y-2">
          <div>
            <div className="text-lg font-bold text-gray-900">{pick.name}</div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-primary-700 underline"
            >
              Clear
            </button>
          </div>
          <div className="text-sm text-gray-700">
            <strong>{pick.rural}</strong> of {pick.hospitals} hospitals in nonmetro counties (
            {pick.rural_share}%)
          </div>
          <div className="text-sm text-gray-700">
            <strong>{pick.critical_access}</strong> Critical Access
          </div>
          <div className="text-sm text-gray-700">
            <strong>{pick.rural_pop_share}%</strong> of residents in nonmetro counties
          </div>
          {pick.state === 'PA' && (
            <Link href="/states/pa/rural-health" className="text-sm underline text-primary-700">
              Open the Pennsylvania hospital detail
            </Link>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2 text-sm">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Sort by
          </span>
          {(
            [
              ['rural_share', 'Rural share'],
              ['rural', 'Rural hospitals'],
              ['critical_access', 'Critical Access'],
              ['hospitals', 'Total hospitals'],
              ['name', 'State'],
            ] as [SortKey, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              aria-pressed={sort === k ? 'true' : 'false'}
              className={
                'px-2.5 py-1 rounded-full text-xs font-medium border ' +
                (sort === k
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">State</th>
                <th className="text-right px-3 py-2 font-semibold">Hospitals</th>
                <th className="text-right px-3 py-2 font-semibold">In nonmetro counties</th>
                <th className="text-right px-3 py-2 font-semibold">Rural share</th>
                <th className="text-right px-3 py-2 font-semibold">Critical Access</th>
                <th className="text-right px-3 py-2 font-semibold">Rural population</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((r) => (
                <tr
                  key={r.state}
                  className={
                    'hover:bg-gray-50 cursor-pointer ' + (selected === r.state ? 'bg-blue-50' : '')
                  }
                  onClick={() => setSelected(selected === r.state ? null : r.state)}
                >
                  <td className="px-3 py-1.5 font-medium text-gray-900">{r.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.hospitals}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.rural}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                    {r.rural_share}%
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.critical_access}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                    {r.rural_pop_share}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <InlineSubscribe
          source="rural_health"
          prompt="Get new findings by email when they publish."
        />
      </div>
    </div>
  );
}
