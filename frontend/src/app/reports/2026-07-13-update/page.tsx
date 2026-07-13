import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-07-13-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title:
    'AINPI 2026-07-13 update — no June release, and the missing endpoints are already public',
  description:
    'The NDH manifest still serves the May release after 66 days. Meanwhile the CMS directory team published a scrape of 31,255 certified-EHR FHIR endpoints with NPIs and states attached, while 98.7% of NDH organizations carried zero endpoints in the April release. H45 pre-registered: the per-state gap between publicly-published endpoints and what the NDH carries.',
  openGraph: {
    title:
      'AINPI 2026-07-13 — the endpoints the NDH is missing are already public',
    description:
      'No June NDH release. The CMS team scraped 31,255 CEHRT FHIR endpoints from HTI-1 bundles; 98.7% of NDH orgs carried zero endpoints in April. H45 measures the gap, state by state.',
    url: 'https://ainpi.dev/reports/2026-07-13-update',
    type: 'article',
  },
};

export default function July2026Update0713Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-07-13 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · 2026-07-13"
        headlineA="No June release."
        headlineB="The missing endpoints are already public."
        caption="The NDH manifest still serves the 2026-05-07 files, 66 days on. Meanwhile the CMS directory team's public scrape of certified-EHR HTI-1 bundles holds 31,255 FHIR endpoints with NPIs and states attached, while 98.7% of NDH organizations carried zero endpoints in the April release. H45, pre-registered today, measures that gap state by state."
        stats={[
          { label: 'Days since last NDH release', delta: '66', tone: 'gain' },
          { label: 'CEHRT endpoints in the public scrape', delta: '31,255', tone: 'gain' },
          { label: 'NDH orgs with zero endpoints (April)', delta: '98.7%', tone: 'gain' },
        ]}
        reportSlug="2026-07-13-update"
        releaseDate="2026-07-13"
        methodologyVersion="0.7.2-draft"
      />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <article className="prose prose-slate max-w-none prose-headings:font-semibold prose-a:text-primary-600 prose-code:font-mono prose-code:text-sm prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-table:text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.body}</ReactMarkdown>
        </article>
        <footer className="mt-12 pt-6 border-t border-gray-200 text-sm text-gray-500">
          Source:{' '}
          <a href={GITHUB_URL} className="text-primary-600 hover:underline">
            {DOC_PATH}
          </a>
        </footer>
      </main>
    </div>
  );
}
