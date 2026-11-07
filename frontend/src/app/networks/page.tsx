import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import { loadNetworks } from '@/lib/load-api-v1';
import { publishedFindingSlugs } from '@/lib/networks-published';
import NetworksClient from './networks-client';

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
    type: 'website',
  },
};

export default function NetworksPage() {
  const payload = loadNetworks();
  if (!payload) {
    // Fail the build rather than ship a page with no data.
    throw new Error('/networks: frontend/public/api/v1/networks.json could not be read or parsed.');
  }
  const publishedSlugs = publishedFindingSlugs(payload);
  // Computed once at build; the client never reads the clock for staleness.
  // The page is force-static, so "Needs re-check" only advances when the site
  // is rebuilt. The weekly refresh pushes to main and redeploys it; without
  // deploys for months, stale entries would go unmarked.
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
        <NetworksClient payload={payload} buildDate={buildDate} publishedSlugs={publishedSlugs} />
      </main>
    </div>
  );
}
