import Link from 'next/link';

import type { ConnectivityFunnelStep } from '@/lib/connectivity-types';

/**
 * The funnel, drawn as proportional bars against a constant denominator.
 *
 * Deliberately not a classic funnel chart. A funnel's tapering trapezoids make
 * the last steps visually larger than their values, which is exactly wrong here
 * where the interesting number is a 2% tail. Every bar is measured against the
 * same baseline so the collapse is legible at a glance and the small values
 * stay small.
 *
 * Server component: no interactivity, so no client bundle.
 */
export default function ConnectivityChain({
  steps,
  total,
}: {
  steps: ConnectivityFunnelStep[];
  total: number;
}) {
  const denominator = total || 1;

  return (
    <ol className="space-y-4">
      {steps.map((step, i) => {
        const width = Math.max((step.count / denominator) * 100, 0.4);
        const excluded = Boolean(step.excluded_from_total);
        const prev = i > 0 && !excluded ? steps[i - 1] : null;
        const dropped =
          prev && !prev.excluded_from_total ? prev.count - step.count : 0;

        return (
          <li
            key={step.step}
            className={`border-l-2 pl-4 ${
              excluded ? 'border-amber-300' : 'border-gray-300'
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-sm font-medium text-ink">
                {step.step}
                {excluded ? (
                  <span className="ml-2 border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-900">
                    outside the chain
                  </span>
                ) : null}
              </h3>
              <p className="font-mono text-sm text-ink">
                {step.count.toLocaleString('en-US')}
                <span className="ml-2 text-gray-500">{step.pct}%</span>
              </p>
            </div>

            <div className="my-2 h-2 w-full bg-gray-100">
              <div
                className={excluded ? 'h-2 bg-amber-300' : 'h-2 bg-primary-600'}
                style={{ width: `${width}%` }}
              />
            </div>

            <p className="measure text-xs text-gray-600">
              {step.note}{' '}
              {step.finding ? (
                <Link
                  href={`/findings/${step.finding}`}
                  className="text-primary-600 underline hover:text-signal"
                >
                  See the finding
                </Link>
              ) : null}
            </p>

            {dropped > 0 ? (
              <p className="mt-1 font-mono text-xs text-signal">
                &minus;{dropped.toLocaleString('en-US')} lost at this step
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
