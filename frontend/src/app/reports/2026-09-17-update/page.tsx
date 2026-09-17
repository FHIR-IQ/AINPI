import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-09-17-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'The archive is open: every release of the directory since May, kept, free',
  description:
    'CMS keeps only the newest copy of the national provider directory. We kept both releases so far and put the archive on Databricks Marketplace for free, readable with or without a Databricks account. Plus what is new on the site.',
  openGraph: {
    title: 'The archive is open: every release of the directory since May, kept, free',
    description:
      '54,162,643 rows across six tables and two releases, partitioned by release so comparing versions is one line of a query. On Databricks Marketplace, free.',
    url: 'https://ainpi.dev/reports/2026-09-17-update',
    type: 'article',
  },
};

export default function September2026Update0917Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-09-17 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Update · 2026-09-17"
        headlineA="CMS keeps one release."
        headlineB="We kept both."
        caption="The government publishes the national provider directory as one file and keeps only the newest copy. The archive of every release since May is now on Databricks Marketplace, free, readable with or without a Databricks account, and split by release so comparing two versions is one line of a query."
        stats={[
          { label: 'Releases archived', delta: '2', tone: 'gain' },
          { label: 'Rows across six tables', delta: '54.2M', tone: 'gain' },
          { label: 'Cost to use it', delta: 'Free', tone: 'gain' },
        ]}
        reportSlug="2026-09-17-update"
        releaseDate="2026-08-20"
        methodologyVersion="0.7.3-draft"
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
