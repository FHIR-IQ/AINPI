import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-06-25-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title:
    'AINPI 2026-06-25 update — what is actually in an NDH endpoint record? (H44)',
  description:
    'H44 published: endpoint metadata coverage vs the HTE submission spec. Of the 9 endpoint fields the spec collects, 5 have no home in the NDH FHIR Endpoint profile (STU1), and the extensions that could carry the others are 0% populated across all 114,071 FHIR-REST endpoints. Today the NDH knows an endpoint address and payload type, and that is the whole record.',
  openGraph: {
    title:
      'AINPI 2026-06-25 — the NDH endpoint record is the address and nothing else',
    description:
      'H44: of 9 HTE endpoint-metadata fields, 5 have no FHIR home in STU1 and the rest are 0% populated. Only the address and payload type are present, on 100% of 114,071 FHIR-REST endpoints.',
    url: 'https://ainpi.dev/reports/2026-06-25-update',
    type: 'article',
  },
};

export default function June2026Update0625Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-06-25 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · 2026-06-25"
        headlineA="The endpoint record is the address."
        headlineB="And nothing else."
        caption="H44 published: of the 9 endpoint-metadata fields the HTE submission spec collects, 5 have no home in the NDH FHIR Endpoint profile (STU1), and the extensions that could carry the others are 0% populated across all 114,071 FHIR-REST endpoints."
        stats={[
          { label: 'Endpoint address present', delta: '100%', tone: 'gain' },
          { label: 'Metadata extensions used', delta: '0%', tone: 'gain' },
          { label: 'Spec fields with no FHIR home', delta: '5 of 9', tone: 'gain' },
        ]}
        reportSlug="2026-06-25-update"
        releaseDate="2026-06-25"
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
