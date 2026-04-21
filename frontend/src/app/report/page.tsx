import type { Metadata } from 'next';
import { FINDINGS } from '@/data/findings';
import { loadFinding, loadStats } from '@/lib/load-api-v1';
import FindingChart from '@/components/FindingChart';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'The State of the National Provider Directory — AINPI v1.0',
  description:
    'Full AINPI v1.0 report — all six pre-registered findings against the CMS NPD 2026-04-09 release in one printable document.',
  robots: { index: true, follow: true },
};

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

export default function ReportPage() {
  const stats = loadStats();

  return (
    <>
      {/* Print-tuning styles: hide site chrome, set single-page flow */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              nav, footer, .no-print { display: none !important; }
              body { background: white !important; }
              .page-break { page-break-before: always; }
              main { max-width: none !important; padding: 0 !important; }
              a[href]:after { content: " (" attr(href) ")"; font-size: 0.8em; color: #666; }
              a[href^="/"]:after { content: " (ainpi.vercel.app" attr(href) ")"; }
              a[href^="#"]:after,
              a[href^="mailto:"]:after { content: ""; }
            }
            @page {
              size: Letter;
              margin: 0.75in;
            }
          `,
        }}
      />

      {/* Print CTA (hidden when printing) */}
      <div className="no-print bg-primary-50 border-b border-primary-200 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-primary-900 flex-1">
            <strong>Tip:</strong> use your browser&apos;s <em>Print → Save as PDF</em> to
            export this report. It&apos;s styled for Letter paper at 0.75-inch margins.
          </p>
          <button
            type="button"
            onClick={() => typeof window !== 'undefined' && window.print()}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition-colors"
            suppressHydrationWarning
          >
            Save as PDF
          </button>
          <a
            href="/findings"
            className="text-sm text-primary-700 hover:underline"
          >
            Web version →
          </a>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 bg-white">
        {/* Title block */}
        <header className="mb-12 pb-8 border-b">
          <p className="text-xs uppercase tracking-widest text-gray-500 font-mono mb-2">
            AINPI · v1.0.0
          </p>
          <h1 className="text-4xl font-bold text-gray-900 mb-3 leading-tight">
            The State of the National Provider Directory
          </h1>
          <p className="text-lg text-gray-700 mb-6">
            Six pre-registered findings against the CMS NPD {stats?.release_date || '2026-04-09'} release.
          </p>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-xs text-gray-500">NPD release</dt>
              <dd className="font-semibold">{stats?.release_date || '2026-04-09'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Methodology</dt>
              <dd className="font-semibold">v{stats?.methodology_version || '0.2.0-draft'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Resources audited</dt>
              <dd className="font-semibold">{fmt(stats?.counters.resources_processed)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Findings published</dt>
              <dd className="font-semibold">{stats?.counters.findings_published ?? 6} / 6</dd>
            </div>
          </dl>
          <p className="mt-6 text-xs text-gray-500">
            Author: Eugene Vestel, FHIR IQ · <a href="mailto:gene@fhiriq.com">gene@fhiriq.com</a> · <a href="https://ainpi.vercel.app">ainpi.vercel.app</a>
            <br />
            Generated at: {stats?.generated_at || 'unknown'}
          </p>
        </header>

        {/* Executive summary */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Executive summary</h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            The CMS National Provider Directory (NPD) ships {fmt(stats?.counters.resources_processed)} FHIR
            R4 resources across six resource types. AINPI is an independent,
            open-source audit of that bulk export. Six pre-registered
            hypotheses (bundled into six finding slugs) were declared
            publicly <em>before</em> the numbers dropped; this report
            publishes the results.
          </p>
          <p className="text-gray-700 leading-relaxed mb-3">
            The findings cluster in four narratives. First, the NPD&apos;s
            own <code>meta.lastUpdated</code> timestamp is a bulk-export
            stamp, not a per-resource freshness signal — the 30-day and
            90-day regulatory update cadences cannot be measured from the
            bulk files. Second, referential integrity is essentially
            perfect where references are declared, but coverage of the
            Endpoint↔Organization link is sparse in both directions.
            Third, the NPD uses <em>two different</em> specialty code
            systems on two different resources with no cross-walk. Fourth,
            declared FHIR-REST endpoints clear the 85% Medicare Advantage
            network-adequacy implied ceiling on basic reachability but
            not on SMART discovery.
          </p>
          <p className="text-gray-700 leading-relaxed">
            Every number in this report is reproducible from the scripts in
            the <a href="https://github.com/FHIR-IQ/AINPI/tree/main/analysis">analysis/</a>
            {' '}directory of the repository. Methodology at{' '}
            <a href="https://ainpi.vercel.app/methodology">/methodology</a>.
          </p>
        </section>

        {/* Each finding on its own section */}
        {FINDINGS.map((f) => {
          const live = loadFinding(f.slug);
          return (
            <section key={f.slug} className="page-break mb-12 pt-8 border-t">
              <p className="text-xs uppercase tracking-widest text-primary-600 font-mono mb-2">
                {f.hypotheses.join(' · ')}
              </p>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">{f.title}</h2>
              {live?.headline && (
                <div className="bg-gray-900 text-white rounded-lg p-5 mb-6">
                  <p className="text-lg font-semibold leading-snug">{live.headline}</p>
                  {live.numerator != null && live.denominator != null && (
                    <p className="mt-2 text-sm text-gray-300 font-mono">
                      {fmt(live.numerator)} / {fmt(live.denominator)} ={' '}
                      {((live.numerator / live.denominator) * 100).toFixed(2)}%
                    </p>
                  )}
                </div>
              )}

              {live?.chart && <FindingChart chart={live.chart} />}

              <div className="mt-6 grid grid-cols-1 gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Null hypothesis
                  </h3>
                  <p className="text-sm text-gray-800">{f.nullHypothesis}</p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Denominator
                  </h3>
                  <p className="text-sm text-gray-800">{f.denominator}</p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Data source
                  </h3>
                  <p className="text-sm text-gray-800">{f.dataSource}</p>
                </div>
                {live?.notes && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Notes
                    </h3>
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                      {live.notes}
                    </p>
                  </div>
                )}
              </div>
            </section>
          );
        })}

        {/* Closing */}
        <section className="page-break pt-8 border-t text-sm text-gray-600">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">About this report</h2>
          <p className="mb-3">
            This report covers the AINPI v1.0.0 release. All methodology,
            pipeline code, BigQuery analyses, and the FHIR endpoint crawler
            are open source under Apache-2.0:
          </p>
          <ul className="list-disc list-inside space-y-1 mb-6">
            <li>Main repo: <a href="https://github.com/FHIR-IQ/AINPI">github.com/FHIR-IQ/AINPI</a></li>
            <li>Crawler: <a href="https://github.com/FHIR-IQ/ainpi-probe">github.com/FHIR-IQ/ainpi-probe</a></li>
            <li>Usage examples: <a href="https://github.com/FHIR-IQ/ainpi-examples">github.com/FHIR-IQ/ainpi-examples</a></li>
            <li>Live site: <a href="https://ainpi.vercel.app">ainpi.vercel.app</a></li>
            <li>Public URL contract: <a href="https://ainpi.vercel.app/api/v1/stats.json">ainpi.vercel.app/api/v1/stats.json</a></li>
          </ul>
          <p className="mb-3">
            To cite: see <a href="https://github.com/FHIR-IQ/AINPI/blob/main/CITATION.cff">CITATION.cff</a>.
            To contribute: see <a href="https://github.com/FHIR-IQ/AINPI/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>.
            To subscribe: <a href="https://ainpi.vercel.app/subscribe">ainpi.vercel.app/subscribe</a>.
          </p>
          <p className="mt-6 text-xs text-gray-500">
            © 2026 FHIR IQ · Apache-2.0 · Report version v1.0.0
          </p>
        </section>
      </main>
    </>
  );
}
