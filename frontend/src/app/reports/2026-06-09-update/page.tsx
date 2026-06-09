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
    'AINPI 2026-06-09 update — can you associate a practitioner with a phone number? (H43)',
  description:
    'H43 pre-registered: practitioner phone-number reachability. A phone can live on Practitioner.telecom, PractitionerRole.telecom, or the referenced Location.telecom — H43 resolves all three and reports the any-path union vs the on-record share.',
  openGraph: {
    title:
      'AINPI 2026-06-09 — where does a provider’s phone number actually live in the federal directory?',
    description:
      'Read Practitioner.telecom alone and NDH looks like it has almost no phone numbers. It does not — the phone is one or two hops away, on the role and the location. H43 measures the gap.',
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
        headlineA="Three resources."
        headlineB="One phone number."
        caption="H43 pre-registered: practitioner phone-number reachability. A phone can live on the Practitioner record, the role, or the referenced location — H43 resolves all three and reports the any-path union vs the on-record share."
        stats={[
          { label: 'Resolution paths', delta: '3', tone: 'gain' },
          { label: 'New finding', delta: 'H43', tone: 'gain' },
          { label: 'Methodology', delta: '0.7.2', tone: 'gain' },
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
