'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ExternalLink, X } from 'lucide-react';
import type { LandscapePayload, LandscapeCell, LandscapeMetricDef } from '@/lib/landscape-types';
import { LANDSCAPE_METRICS } from '@/lib/landscape-types';
import type { LandscapeGroupBy } from '@/components/charts/LandscapeTreemap';

const LandscapeTreemap = dynamic(() => import('@/components/charts/LandscapeTreemap'), {
  ssr: false,
  loading: () => (
    <div className="h-[760px] flex items-center justify-center bg-white rounded-lg border border-gray-200 text-gray-500">
      Loading visualization…
    </div>
  ),
});

interface LandscapeExplorerProps {
  payload: LandscapePayload;
}

export default function LandscapeExplorer({ payload }: LandscapeExplorerProps) {
  const [metric, setMetric] = useState<LandscapeMetricDef>(LANDSCAPE_METRICS[0]);
  const [groupBy, setGroupBy] = useState<LandscapeGroupBy>('specialty');
  const [selectedCell, setSelectedCell] = useState<LandscapeCell | null>(null);

  const totalPractitioners = useMemo(
    () => payload.cells.reduce((s, c) => s + c.practitioners, 0),
    [payload.cells],
  );

  const baselineValue = payload.national_baseline[metric.key];
  const baselineFormatted = metric.format(baselineValue);

  return (
    <div className="space-y-4">
      {/* Stats strip — Karpathy-style summary card row */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Active practitioners
          </div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5 tabular-nums">
            {(totalPractitioners / 1_000_000).toFixed(1)}M
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            across {payload.cell_count.toLocaleString()} cells
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Current metric
          </div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5 tabular-nums">
            {baselineFormatted}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            national, practitioner-weighted
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            NDH release
          </div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5 tabular-nums">
            {payload.release}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">CMS public use file</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Methodology
          </div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5 tabular-nums">
            v{payload.methodology_version.split('-')[0]}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {payload.methodology_version.includes('seed') ? 'seed payload' : 'measured'}
          </div>
        </div>
      </div>

      {/* Controls — Layer + Tile-By */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Layer
          </div>
          <div className="flex flex-wrap gap-2">
            {LANDSCAPE_METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m)}
                className={
                  'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ' +
                  (m.key === metric.key
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                }
                aria-pressed={m.key === metric.key ? 'true' : 'false'}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Tile by
          </div>
          <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setGroupBy('specialty')}
              className={
                'px-3 py-1.5 font-medium ' +
                (groupBy === 'specialty'
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50')
              }
              aria-pressed={groupBy === 'specialty' ? 'true' : 'false'}
            >
              Specialty → state
            </button>
            <button
              type="button"
              onClick={() => setGroupBy('state')}
              className={
                'px-3 py-1.5 font-medium border-l border-gray-200 ' +
                (groupBy === 'state'
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50')
              }
              aria-pressed={groupBy === 'state' ? 'true' : 'false'}
            >
              State → specialty
            </button>
          </div>
          <p className="text-xs text-gray-500 flex-1 min-w-[200px]">
            {groupBy === 'specialty'
              ? 'Each box is one specialty. Cells inside it are states.'
              : 'Each box is one state. Cells inside it are specialties.'}
          </p>
        </div>
        <p className="text-sm text-gray-600 pt-2 border-t border-gray-100 leading-relaxed">
          <span className="font-medium text-gray-800">{metric.label}.</span>{' '}
          {metric.description}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* Treemap */}
        <div>
          <LandscapeTreemap
            cells={payload.cells}
            metric={metric}
            groupBy={groupBy}
            onCellClick={(c) =>
              setSelectedCell((prev) =>
                prev && prev.state === c.state && prev.specialty_code === c.specialty_code
                  ? null
                  : c
              )
            }
            selectedCell={selectedCell}
          />
        </div>

        {/* Side panel */}
        <aside className="bg-white rounded-lg border border-gray-200 p-4 lg:sticky lg:top-4 h-fit">
          {!selectedCell ? (
            <div className="text-sm text-gray-600">
              <p className="font-medium text-gray-900 mb-2">Click any cell</p>
              <p>
                The side panel shows the cell&apos;s scores across all six dimensions, a sample of
                NPIs in the cell, and primary-source verify links for each.
              </p>
              <p className="mt-3 text-xs text-gray-500">
                Primary sources: NPPES Registry, OIG LEIE, SAM.gov SearchExclusions. Each link is a
                direct query — no API key, no login.
              </p>
              <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-1.5">
                <p className="font-semibold text-gray-700 uppercase tracking-wider text-[10px]">
                  How to read this
                </p>
                <p>
                  Parent boxes are labeled at the top with the group name and its practitioner count.
                </p>
                <p>
                  Child cells inside each parent are colored by the selected layer — red is worse,
                  green is better.
                </p>
                <p>
                  Spatial layout doesn&apos;t change when you flip layers — only color animates.
                </p>
              </div>
            </div>
          ) : (
            <CellDetail
              cell={selectedCell}
              baseline={payload.national_baseline}
              onClose={() => setSelectedCell(null)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function CellDetail({
  cell,
  baseline,
  onClose,
}: {
  cell: LandscapeCell;
  baseline: LandscapePayload['national_baseline'];
  onClose: () => void;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            {cell.state_name} ({cell.state})
          </p>
          <h3 className="font-semibold text-gray-900 leading-tight mt-0.5">
            {cell.specialty_display}
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            {cell.practitioners.toLocaleString()} active practitioners · taxonomy prefix {cell.specialty_code}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close cell detail"
          className="text-gray-400 hover:text-gray-700 p-1 -mt-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Decomposed scores
        </p>
        <ul className="space-y-1.5 text-sm">
          {LANDSCAPE_METRICS.map((m) => {
            const v = cell.metrics[m.key];
            const b = baseline[m.key];
            const better =
              m.key === 'currency_days_median' ? v < b : v > b;
            return (
              <li key={m.key} className="flex items-center justify-between gap-2">
                <span className="text-gray-700">{m.label}</span>
                <span className="font-mono text-xs">
                  <span className={better ? 'text-green-700' : 'text-gray-900'}>
                    {m.format(v)}
                  </span>
                  <span className="text-gray-400 ml-2">vs {m.format(b)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {cell.sample_npis.length > 0 && (
        <div className="border-t border-gray-100 pt-3 mt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Verify a sample — primary sources
          </p>
          <p className="text-xs text-gray-500 mb-2">
            Each NPI links to the federal source of truth for that check. No login required.
          </p>
          <ul className="space-y-2">
            {cell.sample_npis.map((npi) => (
              <li key={npi} className="text-xs">
                <div className="font-mono font-medium text-gray-900">{npi}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-primary-600">
                  <a
                    href={`https://npiregistry.cms.hhs.gov/provider-view/${npi}`}
                    target="_blank"
                    rel="noopener"
                    className="hover:underline inline-flex items-center gap-0.5"
                  >
                    NPPES <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                  <a
                    href={`https://exclusions.oig.hhs.gov/Default.aspx?npi=${npi}`}
                    target="_blank"
                    rel="noopener"
                    className="hover:underline inline-flex items-center gap-0.5"
                  >
                    LEIE <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                  <a
                    href={`https://sam.gov/search/?keywords=${npi}&index=ex&sort=-modifiedDate`}
                    target="_blank"
                    rel="noopener"
                    className="hover:underline inline-flex items-center gap-0.5"
                  >
                    SAM <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-400 mt-3">
            Sample NPIs are deterministic per cell. They are not investigative findings — they are the
            substrate for you to verify the methodology yourself.
          </p>
        </div>
      )}
    </div>
  );
}
