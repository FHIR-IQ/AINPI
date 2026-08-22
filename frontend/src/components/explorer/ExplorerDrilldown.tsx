'use client';

import { useMemo, useState } from 'react';

import type { ExplorerStatePayload, ExplorerZip } from '@/lib/explorer-types';

/**
 * County and ZIP drill-down.
 *
 * Follows the map rules this repo learned the expensive way, even though this
 * is a table rather than a choropleth:
 *
 *   Colour encodes a RATE, never a count. The bar behind each row is role
 *   coverage, not practitioner count. A count bar is a population chart: it
 *   ranks Philadelphia and Allegheny first no matter what you are measuring.
 *
 *   Missing is not zero. A county with no practitioners shows an em dash, not
 *   0.0%, because "we have nobody here" and "nobody here has a workplace" are
 *   different statements.
 *
 *   Organizations are never summed. Provider organizations and `ein` tax
 *   records sit in separate columns and stay there.
 */
export default function ExplorerDrilldown({
  data,
}: {
  data: ExplorerStatePayload;
}) {
  const [openCounty, setOpenCounty] = useState<string | null>(null);
  const [sort, setSort] = useState<'practitioners' | 'role_pct'>('practitioners');
  const [minSize, setMinSize] = useState(0);

  const counties = useMemo(() => {
    const rows = data.counties.filter((c) => c.practitioners >= minSize);
    return [...rows].sort((a, b) => {
      if (sort === 'role_pct') {
        // Counties with no practitioners have no rate. They sort last rather
        // than sorting as 0%, which would put them above genuinely poor ones.
        if (a.role_pct === null) return 1;
        if (b.role_pct === null) return -1;
        return b.role_pct - a.role_pct;
      }
      return b.practitioners - a.practitioners;
    });
  }, [data.counties, sort, minSize]);

  const zipsByCounty = useMemo(() => {
    const m = new Map<string, ExplorerZip[]>();
    for (const z of data.zips) {
      const key = z.county_fips ?? 'unknown';
      const arr = m.get(key) ?? [];
      arr.push(z);
      m.set(key, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.practitioners - a.practitioners);
    return m;
  }, [data.zips]);

  const maxRate = useMemo(
    () => Math.max(...data.counties.map((c) => c.role_pct ?? 0), 1),
    [data.counties],
  );

  return (
    <section>
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <label className="text-xs text-gray-600">
          <span className="block mb-1 uppercase tracking-wide">Sort by</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="border border-gray-300 bg-white px-2 py-1 text-sm"
          >
            <option value="practitioners">Practitioners</option>
            <option value="role_pct">Share with a workplace</option>
          </select>
        </label>
        <label className="text-xs text-gray-600">
          <span className="block mb-1 uppercase tracking-wide">
            Hide counties under
          </span>
          <select
            value={minSize}
            onChange={(e) => setMinSize(Number(e.target.value))}
            className="border border-gray-300 bg-white px-2 py-1 text-sm"
          >
            <option value={0}>no minimum</option>
            <option value={100}>100 practitioners</option>
            <option value={1000}>1,000 practitioners</option>
          </select>
        </label>
        <p className="text-xs text-gray-500 max-w-md">
          The bar is the share with a workplace listed, not the number of
          practitioners. Ranking by headcount would just rank by population.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-300 text-left">
              <th className="py-2 pr-3 font-medium text-gray-600">County</th>
              <th className="py-2 pr-3 font-medium text-gray-600 text-right">
                Practitioners
              </th>
              <th className="py-2 pr-3 font-medium text-gray-600">
                Has a workplace
              </th>
              <th className="py-2 pr-3 font-medium text-gray-600 text-right">
                Provider orgs
              </th>
              <th className="py-2 pr-3 font-medium text-gray-600 text-right">
                Tax records
              </th>
              <th className="py-2 font-medium text-gray-600 text-right">ZIPs</th>
            </tr>
          </thead>
          <tbody>
            {counties.map((c) => {
              const key = c.county_fips ?? 'unknown';
              const open = openCounty === key;
              const zips = zipsByCounty.get(key) ?? [];
              return (
                <>
                  <tr
                    key={key}
                    onClick={() => setOpenCounty(open ? null : key)}
                    className="border-b border-gray-200 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="py-2 pr-3">
                      <span className="text-gray-400 mr-1 inline-block w-3">
                        {open ? '−' : '+'}
                      </span>
                      {c.county}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {c.practitioners.toLocaleString()}
                    </td>
                    <td className="py-2 pr-3">
                      {c.role_pct === null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-2 bg-primary-600"
                            style={{
                              width: `${Math.max(2, (c.role_pct / maxRate) * 90)}px`,
                            }}
                            aria-hidden
                          />
                          <span className="tabular-nums text-xs">
                            {c.role_pct.toFixed(1)}%
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {c.orgs_provider.toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-500">
                      {c.orgs_ein.toLocaleString()}
                    </td>
                    <td className="py-2 text-right tabular-nums">{c.zip_count}</td>
                  </tr>
                  {open && (
                    <tr key={`${key}-detail`} className="bg-gray-50">
                      <td colSpan={6} className="px-4 py-4">
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                          Professions in {c.county}
                        </p>
                        <div className="flex flex-wrap gap-x-5 gap-y-1 mb-4 text-xs text-gray-700">
                          {Object.entries(c.by_category).map(([cat, n]) => (
                            <span key={cat}>
                              {cat}{' '}
                              <span className="tabular-nums font-medium text-ink">
                                {n.toLocaleString()}
                              </span>
                            </span>
                          ))}
                        </div>
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                          ZIPs ({zips.length}), largest first
                        </p>
                        <div className="overflow-x-auto">
                          <table className="text-xs w-full max-w-3xl">
                            <thead>
                              <tr className="text-left text-gray-500">
                                <th className="py-1 pr-4 font-medium">ZIP</th>
                                <th className="py-1 pr-4 font-medium text-right">
                                  Practitioners
                                </th>
                                <th className="py-1 pr-4 font-medium text-right">
                                  Has a workplace
                                </th>
                                <th className="py-1 font-medium text-right">
                                  Provider orgs
                                </th>
                              </tr>
                            </thead>
                            <tbody className="text-gray-700">
                              {zips.slice(0, 40).map((z) => (
                                <tr key={z.zip} className="border-t border-gray-200">
                                  <td className="py-1 pr-4 font-mono">{z.zip}</td>
                                  <td className="py-1 pr-4 text-right tabular-nums">
                                    {z.practitioners.toLocaleString()}
                                  </td>
                                  <td className="py-1 pr-4 text-right tabular-nums">
                                    {z.practitioners
                                      ? `${((100 * z.with_role) / z.practitioners).toFixed(0)}%`
                                      : '—'}
                                  </td>
                                  <td className="py-1 text-right tabular-nums">
                                    {z.orgs_provider.toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {zips.length > 40 && (
                          <p className="text-xs text-gray-500 mt-2">
                            Showing the 40 largest of {zips.length}. The full list
                            is in the JSON.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="font-serif text-xl text-ink mt-12 mb-3">
        By profession, statewide
      </h2>
      <div className="overflow-x-auto">
        <table className="text-sm w-full max-w-2xl border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-300 text-left">
              <th className="py-2 pr-4 font-medium text-gray-600">Profession</th>
              <th className="py-2 pr-4 font-medium text-gray-600 text-right">
                Practitioners
              </th>
              <th className="py-2 font-medium text-gray-600 text-right">
                Has a workplace
              </th>
            </tr>
          </thead>
          <tbody>
            {data.by_category.map((c) => (
              <tr key={c.category} className="border-b border-gray-200">
                <td className="py-2 pr-4">{c.category}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {c.practitioners.toLocaleString()}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {c.role_pct === null ? '—' : `${c.role_pct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
