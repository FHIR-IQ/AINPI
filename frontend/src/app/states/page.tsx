import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import AuthorByline from '@/components/AuthorByline';
import { SEED_STATES } from '@/data/states';
import { loadStateFindings } from '@/lib/load-api-v1';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'State directory audits — AINPI',
  description:
    'State-scoped slices of the AINPI audit of the CMS National Provider Directory, prepared as citable methodology for state Medicaid agencies responding to the 2026-04-23 CMS letter on provider revalidation.',
};

export default function StatesIndex() {
  const states = SEED_STATES.map((s) => {
    const data = loadStateFindings(s.code);
    return {
      ...s,
      status: data?.status ?? 'pre-registered',
      generated_at: data?.generated_at ?? null,
      practitioner_n: data?.denominators?.practitioner ?? null,
    };
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          State directory audits
        </h1>
        <p className="text-gray-600 mb-1">
          State-scoped slices of the AINPI audit of the CMS National Provider Directory.
        </p>
        <p className="text-sm text-gray-500 mb-6">
          Prepared as citable methodology for state Medicaid agencies responding
          to the{' '}
          <a
            href="https://www.medicaid.gov/sites/default/files/2026-04/smd-provider-revalidation-strategy-2026-04-23.pdf"
            target="_blank"
            rel="noopener"
            className="underline"
          >
            2026-04-23 CMS State Medicaid Director letter
          </a>{' '}
          on provider revalidation strategies.
        </p>

        <AuthorByline />

        <section className="mt-8 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            What CMS asked for, in element 2
          </h2>
          <blockquote className="border-l-4 border-primary-200 pl-4 italic text-gray-700 text-sm">
            &ldquo;The metrics you will use to measure the effectiveness and
            progress of your PR strategy, including links to any public-facing
            data or reporting.&rdquo;
          </blockquote>
          <p className="mt-3 text-sm text-gray-700">
            Each state page below is one such public-facing artifact. The
            methodology and denominators are pre-registered before numbers
            populate; numbers are reproducible from a pinned NPD release with
            open analysis code under Apache-2.0. State agencies are welcome to
            cite these pages directly in their CMS response.
          </p>
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Available states
          </h2>
          <div className="space-y-3">
            {states.map((s) => (
              <a
                key={s.code}
                href={`/states/${s.code.toLowerCase()}`}
                className="block bg-white rounded-lg border border-gray-200 hover:border-primary-300 hover:shadow-sm transition p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {s.name}{' '}
                      <span className="text-sm font-mono text-gray-400">
                        ({s.code})
                      </span>
                    </h3>
                    <p className="text-sm text-gray-600 mt-0.5">
                      {s.medicaid_program_name} · {s.agency}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {s.enrollment_approx} · {s.mcos.length} MCOs
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={
                        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ' +
                        (s.status === 'published'
                          ? 'bg-green-100 text-green-800'
                          : s.status === 'in-progress'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-100 text-blue-800')
                      }
                    >
                      {s.status}
                    </span>
                    {s.generated_at && (
                      <p className="text-xs text-gray-500 mt-1 font-mono">
                        {s.generated_at.slice(0, 10)}
                      </p>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>

        <section className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-blue-900 mb-2">
            Need your state added?
          </h2>
          <p className="text-sm text-blue-900">
            Each state page is a state-filtered re-run of the same six published
            findings, with state-specific MCO context and a citation block. If
            your state agency would like an audit slice prepared for your CMS
            response, email{' '}
            <a
              href="mailto:gene@fhiriq.com"
              className="underline font-medium"
            >
              gene@fhiriq.com
            </a>{' '}
            with the state code. Underlying methodology is open under Apache-2.0,
            so a state IT team can also run the analysis script directly — see{' '}
            <a
              href="https://github.com/FHIR-IQ/AINPI/blob/main/analysis/state_findings.py"
              target="_blank"
              rel="noopener"
              className="underline font-medium"
            >
              <code>analysis/state_findings.py</code>
            </a>
            .
          </p>
        </section>

        <footer className="mt-10 pt-6 border-t text-xs text-gray-500">
          <p>
            Methodology: <a href="/methodology" className="underline">/methodology</a>
            {' · '}
            All findings: <a href="/findings" className="underline">/findings</a>
            {' · '}
            API contract:{' '}
            <a
              href="/api/v1/stats.json"
              className="underline font-mono"
            >
              /api/v1/*.json
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
