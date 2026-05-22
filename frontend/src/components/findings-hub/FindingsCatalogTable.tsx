'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CatalogRow } from '@/lib/hub-feed';
import { StatusPill } from './StatusPill';

interface Props {
  rows: CatalogRow[];
}

type SortKey = 'updated' | 'hNumber' | 'status' | 'title';
type SortDir = 'asc' | 'desc';

function hNumberAsInt(s: string): number {
  return parseInt(s.replace(/[^\d]/g, '') || '0', 10);
}

const STATUS_ORDER: Record<CatalogRow['status'], number> = {
  published: 0,
  null: 1,
  'pre-registered': 2,
};

function ariaSortFor(col: SortKey, sortKey: SortKey, sortDir: SortDir): 'ascending' | 'descending' | 'none' {
  if (col !== sortKey) return 'none';
  return sortDir === 'asc' ? 'ascending' : 'descending';
}

export function FindingsCatalogTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function toggle(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'hNumber' || key === 'title' ? 'asc' : 'desc');
    }
  }

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'updated') cmp = a.updated.localeCompare(b.updated);
    else if (sortKey === 'hNumber') cmp = hNumberAsInt(a.hNumber) - hNumberAsInt(b.hNumber);
    else if (sortKey === 'status') cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    else if (sortKey === 'title') cmp = a.title.localeCompare(b.title);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <section className="bg-gray-50 border-t border-gray-200 px-5 py-6 sm:px-8" aria-labelledby="catalog-heading">
      <header className="flex items-baseline justify-between mb-2">
        <h2 id="catalog-heading" className="text-xs font-bold uppercase tracking-wider text-gray-600">
          All {rows.length} findings
        </h2>
        <span className="text-[10px] text-gray-500">Click any column header to sort</span>
      </header>

      {/* Desktop table (≥640px) */}
      <table className="hidden sm:table w-full bg-white border border-gray-200 text-xs">
        <thead>
          <tr className="bg-gray-100 text-[10px] uppercase tracking-wider text-gray-600">
            {/* eslint-disable-next-line jsx-a11y/aria-proptypes -- runtime values are always valid aria-sort literals */}
            <th scope="col" aria-sort={ariaSortFor('hNumber', sortKey, sortDir)} className="py-1.5 px-2 text-left w-10">
              <button type="button" onClick={() => toggle('hNumber')} className="font-bold">H#</button>
            </th>
            {/* eslint-disable-next-line jsx-a11y/aria-proptypes -- runtime values are always valid aria-sort literals */}
            <th scope="col" aria-sort={ariaSortFor('title', sortKey, sortDir)} className="py-1.5 px-2 text-left">
              <button type="button" onClick={() => toggle('title')} className="font-bold">Finding</button>
            </th>
            {/* eslint-disable-next-line jsx-a11y/aria-proptypes -- runtime values are always valid aria-sort literals */}
            <th scope="col" aria-sort={ariaSortFor('updated', sortKey, sortDir)} className="py-1.5 px-2 text-left w-24">
              <button type="button" onClick={() => toggle('updated')} className="font-bold">Updated</button>
            </th>
            {/* eslint-disable-next-line jsx-a11y/aria-proptypes -- runtime values are always valid aria-sort literals */}
            <th scope="col" aria-sort={ariaSortFor('status', sortKey, sortDir)} className="py-1.5 px-2 text-left w-16">
              <button type="button" onClick={() => toggle('status')} className="font-bold">Status</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.slug} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="py-1.5 px-2 font-bold text-gray-900">{row.hNumber}</td>
              <td className="py-1.5 px-2">
                <Link
                  href={`/findings/${row.slug}`}
                  className="text-primary-700 hover:underline"
                >
                  {row.title}
                </Link>
              </td>
              <td className="py-1.5 px-2 text-gray-600 tabular-nums">{row.updated}</td>
              <td className="py-1.5 px-2"><StatusPill status={row.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile card stack (<640px) */}
      <ol className="sm:hidden space-y-2">
        {sorted.map((row) => (
          <li key={row.slug}>
            <Link
              href={`/findings/${row.slug}`}
              className="block bg-white border border-gray-200 px-3 py-2 rounded-sm"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-sm text-gray-900">{row.hNumber}</span>
                <StatusPill status={row.status} />
                <span className="ml-auto text-[10px] text-gray-500 tabular-nums">{row.updated}</span>
              </div>
              <p className="text-xs text-gray-700 leading-snug">{row.title}</p>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
