import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-06-09-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title:
    'AINPI 2026-06-09 update — 99.98% of practitioners carry a phone on the record (H43)',
  description:
    'H43 published: practitioner phone-number reachability. 7,195,270 of 7,196,385 active practitioners (99.98%) in the 2026-05-08 NDH release carry a phone directly on the Practitioner record; the role/location traversal adds nothing.',
  openGraph: {
    title:
      'AINPI 2026-06-09 — practitioner phone numbers are on the record, not the location',
    description:
      '99.98% of active practitioners carry a phone directly on Practitioner.telecom in the 2026-05-08 NDH release. The pre-registered prior (phone on the location) was rejected by the data.',
    url: 'https://ainpi.dev/reports/2026-06-09-update',
    type: 'article',
  },
};

export default function June2026Update0609Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-06-09 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · 2026-06-09"
        headlineA="The phone is on the record."
        headlineB="Not the location."
        caption="H43 published: practitioner phone-number reachability. 99.98% of active practitioners carry a phone directly on the Practitioner record; the role/location traversal adds nothing."
        stats={[
          { label: 'Phone on record', delta: '99.98%', tone: 'gain' },
          { label: 'Active practitioners', delta: '7.2M', tone: 'gain' },
          { label: 'No phone anywhere', delta: '1,115', tone: 'gain' },
        ]}
        reportSlug="2026-06-09-update"
        releaseDate="2026-06-09"
        methodologyVersion="0.7.2-draft"
      />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <article className="prose prose-slate max-w-none prose-headings:font-semibold prose-a:text-primary-600 prose-code:font-mono prose-code:text-sm prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-table:text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.body}</ReactMarkdown>
        </article>
        <footer className="mt-16 pt-8 border-t text-sm text-gray-500 flex flex-wrap gap-4 items-center justify-between">
          <p>
            Source:{' '}
            <a className="text-primary-600 hover:underline" href={GITHUB_URL}>
              {DOC_PATH}
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
