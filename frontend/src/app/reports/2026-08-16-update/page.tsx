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
  title:
    "AINPI: most web addresses in the national doctor directory don't say who they belong to",
  description:
    'We checked 114,071 web addresses in the CMS National Provider Directory. Only 19,334 say who owns them, about one in six. Nothing is broken, the names were never filled in. Free list of the ones that work, plus why health insurers are not in the directory yet.',
  openGraph: {
    title: "Most addresses in the national doctor directory don't say who they belong to",
    description:
      'Only one in six web addresses in the federal directory names an owner. Here is a free list of the 19,334 that do, and what we think should happen next.',
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
        headlineA="One in six web addresses"
        headlineB="says who owns it."
        caption="The national directory of doctors holds 114,071 web addresses that software uses to look up patient records. Only 19,334 of them say who they belong to. Picture a phone book where five out of six numbers have no name. Nothing here is broken, the names were simply never filled in, and we have published a free list of the ones that work."
        stats={[
          { label: 'Addresses that name an owner', delta: '19,334', tone: 'gain' },
          { label: 'Addresses with no name attached', delta: '94,737', tone: 'loss' },
          { label: 'Covered by 16 companies that never fill it in', delta: '49,036', tone: 'loss' },
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
