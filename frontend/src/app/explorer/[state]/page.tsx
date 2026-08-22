import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import Navbar from '@/components/Navbar';
import ExplorerDrilldown from '@/components/explorer/ExplorerDrilldown';
import { allExplorerStates, loadExplorerState } from '@/lib/load-api-v1';

/**
 * force-static + dynamicParams=false is a cost contract, not a preference.
 *
 * This is a crawlable drill-down: a crawler that walks state -> county -> ZIP
 * generates thousands of page views. Backed by live BigQuery that is an
 * unbounded bill, which is the same reasoning that keeps /npi static and 404s
 * an unknown NPI rather than falling back to a lookup. Do not add a dynamic
 * fallback here.
 *
 * The payload also lives under public/api/v1/explorer/**, which next.config.js
 * excludes from lambda bundles, so a request-time read would fail anyway.
 */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return allExplorerStates().map((state) => ({ state }));
}

export function generateMetadata({
  params,
}: {
  params: { state: string };
}): Metadata {
  const code = params.state.toUpperCase();
  return {
    title: `${code}: the directory by county and ZIP`,
    description:
      `Every practitioner, organization and location the federal provider ` +
      `directory lists in ${code}, by county, ZIP and profession.`,
  };
}

export default function ExplorerStatePage({
  params,
}: {
  params: { state: string };
}) {
  const data = loadExplorerState(params.state);
  if (!data) notFound();

  const t = data.totals;
  const rolePct = t.practitioners ? (100 * t.with_role) / t.practitioners : 0;

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <p className="eyebrow mb-2">
          <Link href="/explorer" className="hover:underline">
            Value explorer
          </Link>{' '}
          / {data.state}
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl text-ink mb-6">
          {data.state}: the directory by county and ZIP
        </h1>

        <dl className="mb-8 flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <dd className="stat text-2xl text-ink">
              {t.practitioners.toLocaleString()}
            </dd>
            <dt className="text-xs text-gray-600">practitioners</dt>
          </div>
          <div>
            <dd className="stat text-2xl text-ink">{rolePct.toFixed(1)}%</dd>
            <dt className="text-xs text-gray-600">have a workplace</dt>
          </div>
          <div>
            <dd className="stat text-2xl text-ink">
              {t.orgs_provider.toLocaleString()}
            </dd>
            <dt className="text-xs text-gray-600">provider organizations</dt>
          </div>
          <div>
            <dd className="stat text-2xl text-ink">
              {t.orgs_ein.toLocaleString()}
            </dd>
            <dt className="text-xs text-gray-600">tax records (not added)</dt>
          </div>
          <div>
            <dd className="stat text-2xl text-ink">{data.counties.length}</dd>
            <dt className="text-xs text-gray-600">counties</dt>
          </div>
        </dl>

        <ExplorerDrilldown data={data} />

        <div className="mt-12 border-t border-gray-300 pt-6 text-xs text-gray-600 measure space-y-2">
          <p>
            Release {data.release_date}. Methodology {data.methodology_version}.
          </p>
          <p>{data.notes}</p>
          <p>
            Data as JSON:{' '}
            <a
              href={`/api/v1/explorer/${data.state.toLowerCase()}.json`}
              className="text-primary-600 hover:underline font-mono"
            >
              /api/v1/explorer/{data.state.toLowerCase()}.json
            </a>
            . Looking for one provider?{' '}
            <Link href="/npd" className="text-primary-600 hover:underline">
              Search by name or NPI
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
