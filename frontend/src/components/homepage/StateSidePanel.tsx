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
            Download cohort CSV
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
