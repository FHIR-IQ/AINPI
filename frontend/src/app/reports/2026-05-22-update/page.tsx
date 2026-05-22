import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-05-22-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title:
    'AINPI 2026-05-22 update — H40 published, 1 confirmed case, 3 SAM-NPI false positives caught',
  description:
    'Sharpened H30a to per-(NPI, HCPCS, place-of-service) detail. Cross-audit surfaced 4 strict-post-exclusion candidates; primary-source verification confirms 1 (Eduardo Miranda MD, LEIE-excluded 2015, $880K Medicare Part B in CY 2023) and reveals 3 SAM-NPI-join false positives.',
  openGraph: {
    title:
      'AINPI 2026-05-22 — 1 confirmed strict-post-exclusion case, 3 SAM-NPI false positives caught',
    description:
      'Eight years post-exclusion, still billing Medicare $880,000 a year. The cross-audit surfaced 4 candidates; primary-source verification confirms 1 and catches 3 false positives in the cohort builder.',
    url: 'https://ainpi.dev/reports/2026-05-22-update',
    type: 'article',
  },
};

export default function May2026Update0522Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-05-22 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · 2026-05-22"
        headlineA="4 candidates."
        headlineB="1 confirmed. 3 caught."
        caption="H40 published: per-(NPI, HCPCS, POS) Medicare Part B detail. Primary-source verification confirms one $880K post-exclusion case and exposes three SAM-NPI-join false positives."
        stats={[
          { label: 'Confirmed strict-post', delta: '1', tone: 'gain' },
          { label: 'SAM-NPI false positives', delta: '3', tone: 'gain' },
          { label: 'CY 2023 paid (confirmed)', delta: '$880K', tone: 'gain' },
        ]}
        reportSlug="2026-05-22-update"
        releaseDate="2026-05-22"
        methodologyVersion="0.7.0-draft"
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
