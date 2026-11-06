import type { Metadata } from 'next';
import { Suspense } from 'react';
import Navbar from '@/components/Navbar';
import { loadNetworks } from '@/lib/load-api-v1';
import { DEFAULT_USE_CASE } from '@/lib/networks';
import NetworksClient, { NetworksExplorer } from './networks-client';

export const dynamic = 'force-static';

const DESCRIPTION =
  'How US health data moves for a given job: the routes it can take, the rules and standards behind each, and which networks our sources list for each state, with sources and last-checked dates.';

export const metadata: Metadata = {
  title: 'Health data networks',
  description: DESCRIPTION,
  openGraph: {
    title: 'Health data networks',
    description: DESCRIPTION,
    url: 'https://ainpi.dev/networks',
    type: 'article',
  },
};

export default function NetworksPage() {
  const payload = loadNetworks();
  // Computed once at build; the client never reads the clock for staleness.
  const buildDate = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="eyebrow m-0">Education</p>
        <h1 className="m-0 mt-2 font-serif text-4xl text-ink">Health data networks</h1>
        <p className="lede measure m-0 mt-4">
          Pick a job you need to do with health data. This page shows the routes that data can take for that job and
          the networks our sources list in each state. The lists are not complete. Every entry links to its source with the date it was last checked.
        </p>
        {payload ? (
          <Suspense fallback={<NetworksExplorer payload={payload} buildDate={buildDate} initialUse={DEFAULT_USE_CASE} />}>
            <NetworksClient payload={payload} buildDate={buildDate} />
          </Suspense>
        ) : (
          <p className="mt-8 text-sm text-gray-700">The networks data file could not be read.</p>
        )}
      </main>
    </div>
  );
}
