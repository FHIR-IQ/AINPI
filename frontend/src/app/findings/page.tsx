import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import { loadHubFeed } from '@/lib/hub-feed';
import { LeadStory } from '@/components/findings-hub/LeadStory';
import { Timeline } from '@/components/findings-hub/Timeline';
import { FindingsCatalogTable } from '@/components/findings-hub/FindingsCatalogTable';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Findings — AINPI',
  description:
    'AINPI audit findings + recent updates from the audit of the CMS National Provider Directory. Latest published research, methodology bumps, and the full catalog of pre-registered findings.',
  openGraph: {
    title: 'AINPI Findings hub',
    description:
      'Latest findings, recent updates, and the full catalog of pre-registered findings against the CMS National Provider Directory.',
    url: 'https://ainpi.dev/findings',
    type: 'website',
  },
};

export default function FindingsHubPage() {
  const { lead, timeline, catalog } = loadHubFeed();
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-3xl mx-auto bg-white shadow-sm">
        <LeadStory item={lead} />
        <Timeline entries={timeline} />
        <FindingsCatalogTable rows={catalog} />
      </main>
    </div>
  );
}
