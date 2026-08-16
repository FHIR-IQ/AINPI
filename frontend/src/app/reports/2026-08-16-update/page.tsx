import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-08-16-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'AINPI 2026-08-16 update: a crosswalk from FHIR base URL to NPI',
  description:
    'New download resolving 19,334 FHIR base URLs in the CMS National Provider Directory to the organization that runs them, with NPI attached. Only 16.9% of the 114,071 FHIR endpoints can be attributed to anyone, and the gap is concentrated in 16 vendor hosts that publish no organization link at all.',
  openGraph: {
    title: 'AINPI 2026-08-16: a crosswalk from FHIR base URL to NPI',
    description:
      '19,334 FHIR base URLs resolved to an organization and NPI, free to download. The other 83% of endpoints in the federal directory have no owner.',
    url: 'https://ainpi.dev/reports/2026-08-16-update',
    type: 'article',
  },
};

export default function August2026Update0816Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-08-16 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · 2026-08-16"
        headlineA="19,334 endpoints have an owner."
        headlineB="94,737 do not."
        caption="A new download resolves 19,334 FHIR base URLs in the CMS National Provider Directory to the organization that runs them, with the NPI attached. That is 16.9% of the 114,071 FHIR endpoints in the directory. Nothing is broken: zero references dangle. The rest were never populated, and 16 vendor hosts account for 49,036 of them."
        stats={[
          { label: 'FHIR endpoints resolved to an organization', delta: '16.9%', tone: 'gain' },
          { label: 'Base URLs in the published crosswalk', delta: '19,334', tone: 'gain' },
          { label: 'Endpoints on hosts publishing no org link', delta: '49,036', tone: 'loss' },
        ]}
        reportSlug="2026-08-16-update"
        releaseDate="2026-08-16"
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
