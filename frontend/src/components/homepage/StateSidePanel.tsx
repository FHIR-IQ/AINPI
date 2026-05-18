'use client';

import Link from 'next/link';
import type { StateAuditSummary } from '@/lib/homepage-data';

export interface SidePanelState {
  code: string;
  name: string;
  cohortSize: number;
  audit: StateAuditSummary;
}

interface StateSidePanelProps {
  state: SidePanelState | null;
  onClose: () => void;
}

/** Compact USD formatter ($1.2M / $167K / $0). */
function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default function StateSidePanel({ state, onClose }: StateSidePanelProps) {
  if (!state) return null;
  const lower = state.code.toLowerCase();
  const { audit } = state;

  return (
    <aside
      aria-label={`${state.name} findings`}
      className="fixed inset-y-0 right-0 w-full sm:w-[440px] bg-white shadow-2xl border-l border-slate-200 z-50 overflow-y-auto"
    >
      <div className="flex items-start justify-between px-6 py-5 border-b border-slate-200 sticky top-0 bg-white">
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
          className="text-slate-400 hover:text-slate-700 text-2xl leading-none shrink-0"
        >
          ×
        </button>
      </div>

      <div className="px-6 py-5 space-y-3 text-sm">
        <SummaryRow
          tone={audit.medicaid.strictMatches === 0 ? 'emerald' : 'rose'}
          label="Medicaid spending"
          headline={`${audit.medicaid.strictMatches} of ${audit.medicaid.fullWindowMatches} matched`}
          detail={
            <>
              <strong>{fmtUsd(audit.medicaid.strictPaid)}</strong> strict
              post-exclusion ·{' '}
              <span className="text-slate-500">
                {fmtUsd(audit.medicaid.fullWindowPaid)} full-window
              </span>
            </>
          }
        />
        <SummaryRow
          tone="amber"
          label="Medicare Part B + Part D · CY 2023"
          headline={`${audit.partbPartd.partbMatches} Part B · ${audit.partbPartd.partdMatches} Part D billers`}
          detail={
            audit.partbPartd.opioidPrescribers > 0 ? (
              <span className="text-rose-700">
                <strong>{audit.partbPartd.opioidPrescribers}</strong> opioid
                prescriber{audit.partbPartd.opioidPrescribers === 1 ? '' : 's'} —
                DEA-coordination signal
              </span>
            ) : (
              <span className="text-slate-500">No opioid prescribers in cohort</span>
            )
          }
        />
        <SummaryRow
          tone={audit.deactivatedBilling.matches > 0 ? 'rose' : 'slate'}
          label="NPPES-deactivated still billing"
          headline={`${audit.deactivatedBilling.matches} closed-identifier match${audit.deactivatedBilling.matches === 1 ? '' : 'es'}`}
          detail={
            audit.deactivatedBilling.multiSource > 0 ? (
              <span>
                <strong>{audit.deactivatedBilling.multiSource}</strong> in
                multiple sources (Medicaid + Medicare = stronger signal)
              </span>
            ) : (
              <span className="text-slate-500">MMIS reconciliation queue input</span>
            )
          }
        />
        <SummaryRow
          tone={audit.industryPayments.strictMatches > 0 ? 'orange' : 'slate'}
          label="Open Payments × exclusion · PY 2024"
          headline={`${audit.industryPayments.strictMatches} of ${audit.industryPayments.fullWindowMatches} strict post-exclusion`}
          detail={
            <>
              <strong>{fmtUsd(audit.industryPayments.strictPaid)}</strong>{' '}
              <span className="text-slate-500">strict-post industry payments</span>
            </>
          }
        />
        <SummaryRow
          tone="blue"
          label="Directory hygiene context"
          headline="99.99984% NDH completeness (national)"
          detail={
            <span className="text-slate-500">
              Coverage excellent; currency is the failure mode.
            </span>
          }
        />

        <div className="pt-2 flex flex-col gap-2">
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
          {audit.sampleNpi && (
            <a
              href={`https://npiregistry.cms.hhs.gov/provider-view/${audit.sampleNpi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-medium text-sm rounded-md"
            >
              Verify a sample NPI on NPPES Registry →
            </a>
          )}
          <Link
            href={`/states/${lower}`}
            className="text-xs text-slate-500 hover:text-slate-900 underline mt-1 text-center"
          >
            Technical state audit page (for data teams)
          </Link>
        </div>
      </div>
    </aside>
  );
}

type Tone = 'emerald' | 'amber' | 'rose' | 'orange' | 'blue' | 'slate';

const TONE_CLASS: Record<Tone, string> = {
  emerald: 'bg-emerald-50 border-emerald-200',
  amber: 'bg-amber-50 border-amber-200',
  rose: 'bg-rose-50 border-rose-200',
  orange: 'bg-orange-50 border-orange-200',
  blue: 'bg-blue-50 border-blue-200',
  slate: 'bg-slate-50 border-slate-200',
};

function SummaryRow({
  tone,
  label,
  headline,
  detail,
}: {
  tone: Tone;
  label: string;
  headline: string;
  detail: React.ReactNode;
}) {
  return (
    <div className={`${TONE_CLASS[tone]} border rounded-md px-3 py-2.5`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
        {label}
      </div>
      <div className="text-sm font-semibold text-slate-900 mt-0.5">
        {headline}
      </div>
      <div className="text-xs text-slate-700 mt-0.5">{detail}</div>
    </div>
  );
}
