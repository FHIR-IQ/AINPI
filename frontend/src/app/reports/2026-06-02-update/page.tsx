import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-06-02-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title:
    'AINPI 2026-06-02 update — landscape becomes the front door, REAL Health audit framework published',
  description:
    'The provider data landscape replaces the choropleth as the AINPI homepage — a hierarchical treemap that shows the federal directory by structure, mass, and quality in one frame. Paired with a policy brief that maps every § 6220 obligation to the AINPI signal that measures it.',
  openGraph: {
    title:
      'AINPI 2026-06-02 — provider data landscape + REAL Health audit framework',
    description:
      'New homepage: a Karpathy-style treemap of every state × specialty cell, scored across six dimensions. Plus the REAL Health Providers Act policy brief that maps each § 6220 obligation to the AINPI signal that measures it.',
    url: 'https://ainpi.dev/reports/2026-06-02-update',
    type: 'article',
  },
};

export default function Update2026Jun02Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-06-02 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · 2026-06-02"
        headlineA="Landscape becomes the front door."
        headlineB="REAL Health audit framework published."
        caption="A hierarchical treemap replaces the choropleth as the AINPI homepage — 548 cells, six dimensions, one cell per state × specialty. Paired with a policy brief that maps every § 6220 obligation to the AINPI signal that measures it."
        stats={[
          { label: 'Landscape cells', delta: '548', tone: 'gain' },
          { label: 'Audit dimensions', delta: '6', tone: 'gain' },
          { label: 'Compliance window opens', delta: 'PY 2028', tone: 'gain' },
        ]}
        reportSlug="2026-06-02-update"
        releaseDate="2026-06-02"
        methodologyVersion="0.7.1-draft"
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
