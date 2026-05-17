import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { ALL_STATE_NAMES, allStateCodes } from '@/data/states';
import { loadStateCohort } from '@/lib/load-api-v1';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'AINPI for state Medicaid agencies',
  description:
    'A free, public audit of the federal provider directory for state Medicaid CMOs. Pick your state for a forwardable per-state explainer.',
};

interface Row {
  code: string;
  name: string;
  count: number;
}

export default function ForStateMedicaidIndex() {
  const rows: Row[] = allStateCodes()
    .map((code): Row => ({
      code: code.toLowerCase(),
      name: ALL_STATE_NAMES[code.toUpperCase()] ?? code,
      count: loadStateCohort(code.toUpperCase()).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalCohort = rows.reduce((s, r) => s + r.count, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-xs font-bold uppercase tracking-wider text-blue-700 mb-3">
          AINPI · for state Medicaid agencies
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
          Pick your state.
        </h1>
        <p className="text-lg text-slate-700 max-w-2xl mb-2 leading-relaxed">
          Each state gets a forwardable explainer with the federally-excluded
          NPIs in that state, the claims-side cross-audit (Medicaid spending,
          Medicare Part&nbsp;B + Part&nbsp;D, NPPES-deactivated still billing,
          Open Payments), and citation-ready language for your 2026-05-23 CMS
          State Medicaid Director-letter response.
        </p>
        <p className="text-sm text-slate-500 mb-8">
          Cohort across all 51 jurisdictions:{' '}
          <strong className="text-slate-700 tabular-nums">
            {totalCohort.toLocaleString()}
          </strong>{' '}
          federally-excluded NPIs.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {rows.map((r) => (
            <Link
              key={r.code}
              href={`/for-state-medicaid/${r.code}`}
              className="flex items-center justify-between bg-white border border-slate-200 hover:border-blue-400 rounded-md px-3 py-2.5 text-sm transition-colors"
            >
              <span className="font-medium text-slate-900">{r.name}</span>
              <span className="text-xs tabular-nums text-slate-500">
                {r.count.toLocaleString()}
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
