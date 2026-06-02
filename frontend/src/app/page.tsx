import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { loadLandscape } from '@/lib/load-api-v1';
import LandscapeExplorer from './landscape/landscape-explorer';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'AINPI — Provider data landscape',
  description:
    'A free, public audit substrate for the CMS National Provider Directory. Every US state × specialty cell scored across six dimensions of accuracy: completeness, cross-source agreement, currency, endpoint reachability, federal integrity, specialty validity. Designed for the REAL Health Providers Act compliance window.',
  openGraph: {
    title: 'AINPI — Provider data landscape',
    description:
      'Every US state × specialty cell, scored across six dimensions of provider directory accuracy. The audit substrate behind HR 7148 § 6220.',
    url: 'https://ainpi.dev/',
    type: 'website',
  },
};

export default function HomePage() {
  const payload = loadLandscape();

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-3xl mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 mb-1">
            Provider data landscape · One cell per state × specialty
          </p>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            The federal provider directory, decomposed
          </h1>
          <p className="text-gray-700">
            A free, public audit substrate for the CMS National Provider Directory
            and the{' '}
            <Link href="/real-health-providers" className="underline text-primary-700">
              REAL Health Providers Act
            </Link>
            . Each tile is one state × specialty cell. Area scales with the count
            of active practitioners. Color is the metric in the layer you select —
            switch layers without losing your place. Click any cell to verify the
            methodology against primary federal sources. Looking for the
            state-by-state federally-excluded view?{' '}
            <Link href="/map" className="underline text-primary-700">
              Open the map →
            </Link>
          </p>
        </div>

        {!payload ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-amber-900">
            <p className="font-medium mb-1">Landscape data not yet generated.</p>
            <p className="text-sm">
              Run <code className="bg-amber-100 px-1.5 py-0.5 rounded">python analysis/landscape.py</code>{' '}
              to produce <code>frontend/public/api/v1/landscape.json</code>. The
              weekly refresh cron handles this automatically.
            </p>
          </div>
        ) : (
          <>
            <LandscapeExplorer payload={payload} />

            <section className="mt-8 bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                How to read this
              </h2>
              <ul className="list-disc list-inside space-y-1.5 text-sm text-gray-700">
                <li>
                  <strong>Spatial layout does not change</strong> when you flip
                  layers — only color animates. The same cell sits in the same
                  place, so you can learn the geography once and watch each
                  metric move across it.
                </li>
                <li>
                  <strong>Area = scale.</strong> A large California allopathic-physician
                  cell carries more practitioners than the entire Vermont workforce;
                  the treemap encodes that directly.
                </li>
                <li>
                  <strong>Cells with fewer than 25 practitioners are suppressed</strong>{' '}
                  to protect against PHI risk on small populations and to keep
                  the visual readable.
                </li>
                <li>
                  <strong>Color is normalized per layer</strong> to a constant
                  diverging scale (red = worse, green = better). Higher completeness,
                  agreement, reachability, integrity, and specialty validity are
                  better; lower median update days are better.
                </li>
              </ul>
            </section>

            <section className="mt-4 bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Methodology &amp; data lineage
              </h2>
              <p className="text-sm text-gray-700 mb-2">
                Each metric is computed by pre-aggregation in BigQuery
                (<code>analysis/landscape.py</code>) and emitted as a typed JSON
                file: <a href="/api/v1/landscape.json" className="text-primary-700 underline">/api/v1/landscape.json</a>.
                External consumers, regulators, and researchers can pull the same
                file as the visualization. Methodology version:{' '}
                <code className="font-mono">{payload.methodology_version}</code>{' '}
                · Release: <code className="font-mono">{payload.release}</code>{' '}
                · Generated: <code className="font-mono">{payload.generated_at}</code>.
              </p>
              <p className="text-sm text-gray-700">
                Per-dimension methodology references:{' '}
                <Link href="/findings/referential-integrity" className="underline text-primary-700">completeness</Link>
                {' · '}
                <Link href="/findings/npi-taxonomy-correctness" className="underline text-primary-700">cross-source agreement</Link>
                {' · '}
                <Link href="/findings/temporal-staleness" className="underline text-primary-700">currency</Link>
                {' · '}
                <Link href="/findings/endpoint-liveness" className="underline text-primary-700">reachability</Link>
                {' · '}
                <Link href="/findings/high-risk-cohort" className="underline text-primary-700">integrity</Link>
                .
              </p>
            </section>

            {payload.methodology_version.includes('seed') && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
                <strong>Seed data notice:</strong> the current payload is a
                deterministic synthetic seed used for UI development. Run{' '}
                <code className="bg-amber-100 px-1 rounded">python analysis/landscape.py</code>{' '}
                against BigQuery to replace with measured values before relying
                on cell-level numbers for any external use.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
