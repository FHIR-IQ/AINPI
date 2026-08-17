import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { loadLandscape } from '@/lib/load-api-v1';
import { loadHubFeed } from '@/lib/hub-feed';
import LandscapeExplorer from './landscape/landscape-explorer';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'AINPI: provider data landscape',
  description:
    'Every state and specialty in the CMS National Provider Directory, scored on six dimensions of accuracy: completeness, cross-source agreement, currency, endpoint reachability, federal integrity, and specialty validity. Free and public, and the scoring maps to the REAL Health Providers Act.',
  openGraph: {
    title: 'AINPI: provider data landscape',
    description:
      'Every state and specialty in the federal provider directory, scored on six dimensions of accuracy. Free, public, and mapped to HR 7148 § 6220.',
    url: 'https://ainpi.dev/',
    type: 'website',
  },
};

export default function HomePage() {
  const payload = loadLandscape();
  const { lead } = loadHubFeed();

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-3xl mb-8 rise">
          <p className="eyebrow mb-3">
            Provider data landscape · One cell per state × specialty
          </p>
          <h1 className="text-4xl sm:text-5xl mb-4 text-balance">
            Where the federal provider directory is accurate, and where it is not
          </h1>
          <p className="lede measure">
            Every state and specialty in the CMS National Provider Directory,
            scored on six dimensions of accuracy. One tile is one state and
            specialty. Tile size is the number of active practitioners. Tile
            color is whichever dimension you pick, and the layout holds still
            when you switch, so you can watch one metric at a time. Click a tile
            to check its providers against NPPES, the OIG exclusion list, and
            SAM.gov. The scoring maps to the{' '}
            <Link href="/real-health-providers" className="underline text-primary-700">
              REAL Health Providers Act
            </Link>
            . For excluded providers by state, open the{' '}
            <Link href="/map" className="underline text-primary-700">
              map
            </Link>
            .
          </p>
        </div>

        {/*
          Measured work, above the treemap.

          The landscape below is a deterministic synthetic seed and says so in
          its own banner. Until it is replaced with BigQuery values, the front
          page was leading with numbers a reader is told not to cite, while
          every measured finding sat behind a nav click. This block puts the
          current lead finding and the deepest state slice above it.

          The lead comes from loadHubFeed(), the same source /findings uses, so
          it follows `featured` and does not need editing each release.
        */}
        <section className="mb-10 grid gap-4 md:grid-cols-2">
          <div className="flex flex-col border border-gray-300 bg-white p-6">
            <p className="eyebrow mb-2">Latest finding · measured</p>
            <h2 className="mb-2 font-serif text-2xl leading-snug text-ink">
              <Link href={lead.href} className="hover:text-signal">
                {lead.title}
              </Link>
            </h2>
            {lead.heroStats?.length ? (
              <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
                {lead.heroStats.map((s) => (
                  <div key={s.label}>
                    <dd className="stat text-2xl text-ink">{s.value}</dd>
                    <dt className="text-xs text-gray-600">{s.label}</dt>
                  </div>
                ))}
              </dl>
            ) : null}
            <p className="measure mb-4 flex-1 text-sm text-gray-700">
              {lead.summary}
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                href={lead.href}
                className="border border-primary-600 bg-primary-600 px-3 py-1.5 text-white hover:bg-primary-700"
              >
                Read the finding
              </Link>
              <Link
                href="/findings"
                className="border border-gray-300 px-3 py-1.5 text-gray-700 hover:border-gray-500"
              >
                All findings
              </Link>
            </div>
          </div>

          <div className="flex flex-col border border-gray-300 bg-white p-6">
            <p className="eyebrow mb-2">Worked example · one state, end to end</p>
            <h2 className="mb-2 font-serif text-2xl leading-snug text-ink">
              <Link href="/states/pa/connectivity" className="hover:text-signal">
                Can software actually reach your clinician?
              </Link>
            </h2>
            <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
              <div>
                <dd className="stat text-2xl text-ink">227,727</dd>
                <dt className="text-xs text-gray-600">PA practitioners traced</dt>
              </div>
              <div>
                <dd className="stat text-2xl text-ink">38.1%</dd>
                <dt className="text-xs text-gray-600">have an organization</dt>
              </div>
              <div>
                <dd className="stat text-2xl text-ink">19.3%</dd>
                <dt className="text-xs text-gray-600">reach an endpoint</dt>
              </div>
            </dl>
            <p className="measure mb-4 flex-1 text-sm text-gray-700">
              Pennsylvania traced the whole way through: practitioner to
              organization to location to endpoint to EHR vendor, with a county
              map you can zoom and a named list of the organizations nothing
              public reaches.
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                href="/states/pa/connectivity"
                className="border border-primary-600 bg-primary-600 px-3 py-1.5 text-white hover:bg-primary-700"
              >
                Open the map
              </Link>
              <Link
                href="/states"
                className="border border-gray-300 px-3 py-1.5 text-gray-700 hover:border-gray-500"
              >
                All 51 states
              </Link>
            </div>
          </div>
        </section>

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
            {/* The caveat belongs above the numbers it qualifies, not below
                them. A reader who sees "1.1M practitioners" first and the word
                "synthetic" 400px later has already believed the number. */}
            {payload.methodology_version.includes('seed') && (
              <div className="mb-4 bg-amber-50 border border-amber-300 rounded-lg p-4 text-sm text-amber-900">
                <strong>These cell numbers are not measured yet.</strong> The
                current payload is a deterministic synthetic seed used to build
                and test the visualization. The shape of the data is real; the
                values are not. Do not cite any cell-level number on this page.
                Running{' '}
                <code className="bg-amber-100 px-1 rounded">python analysis/landscape.py</code>{' '}
                against BigQuery replaces it with measured values. Every
                published finding at{' '}
                <Link href="/findings" className="underline">/findings</Link> is
                measured and citable; this page is not, yet.
              </div>
            )}

            <LandscapeExplorer payload={payload} />

            <section className="mt-8 bg-white border border-gray-200 p-6">
              <h2 className="eyebrow border-b border-gray-300 pb-2 mb-4 block">
                How to read this
              </h2>
              <ul className="list-disc list-inside space-y-1.5 text-sm text-gray-700">
                <li>
                  <strong>Spatial layout does not change</strong> when you flip
                  layers: only color animates. The same cell sits in the same
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
                  diverging scale (rust = worse, blue = better; chosen so it
                  survives colour-vision deficiency and greyscale printing,
                  which a red-to-green scale does not). Higher completeness,
                  agreement, reachability, integrity, and specialty validity are
                  better; lower median update days are better.
                </li>
              </ul>
            </section>

            <section className="mt-4 bg-white border border-gray-200 p-6">
              <h2 className="eyebrow border-b border-gray-300 pb-2 mb-4 block">
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

          </>
        )}
      </main>
    </div>
  );
}
