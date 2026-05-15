import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-05-14-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'AINPI 2026-05-14 update — claims-side cross-audit shipped',
  description:
    '8 new findings link AINPI\'s directory cohort to the money: Medicaid spending, Medicare Part B/D, Open Payments, DMEPOS, nursing-home ownership, and NDH completeness. Plus two methodology corrections — strict post-exclusion attribution and the H35 Stage B structural-null fix.',
  openGraph: {
    title: 'AINPI 2026-05-14 update — claims-side cross-audit shipped',
    description:
      'Last week was the directory. This week is the money. 8 new findings. Strict-post-exclusion attribution. H35 Stage B via PPEF cross-walk.',
    url: 'https://ainpi.dev/reports/2026-05-14-update',
    type: 'article',
  },
};

export default function May2026Update0514Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-05-14 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · 2026-05-14"
        headlineA="Last week, the directory."
        headlineB="This week, the money."
        caption="8 new findings link AINPI's directory cohort to Medicaid spending, Medicare billing, Open Payments, and ownership disclosures."
        stats={[
          { label: 'New findings', delta: '+8', tone: 'gain' },
          { label: 'NDH completeness', delta: '99.99984%', tone: 'gain' },
          { label: 'Strict $ to VA cohort', delta: '$0', tone: 'gain' },
        ]}
        reportSlug="2026-05-14-update"
        releaseDate="2026-05-14"
        methodologyVersion="0.6.1-draft"
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
