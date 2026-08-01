import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-08-01-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title:
    'AINPI 2026-08-01 update — half the states have a Medicaid directory you can actually open',
  description:
    'H46 published: CMS lists a Medicaid provider directory for 32 of 51 states and DC, and 5 of those listed URLs do not resolve. 27 of 51 (52.9%) have a catalogued directory the public can open. Plus the federated payer registry baseline: 2,557 plans enumerated, zero endpoints published.',
  openGraph: {
    title:
      'AINPI 2026-08-01 — 27 of 51 states have a Medicaid directory that actually opens',
    description:
      'H46: CMS lists directories for 32 of 51 states and DC; Arizona, Delaware, Kansas, Maine and Ohio have listed URLs that fail. The payer registry has 2,557 plans enumerated and zero endpoints.',
    url: 'https://ainpi.dev/reports/2026-08-01-update',
    type: 'article',
  },
};

export default function August2026Update0801Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-08-01 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · 2026-08-01"
        headlineA="Listed is not the same as live."
        headlineB="27 of 51 states clear both bars."
        caption="H46 measures CMS's own catalog of state Medicaid provider directories on two layers: 32 of 51 states and DC carry a URL, and 5 of those URLs do not resolve. Separately, the federated payer registry now holds 2,557 enumerated Medicare Advantage plans and zero published endpoints."
        stats={[
          { label: 'States + DC with a working listed directory', delta: '27 of 51', tone: 'gain' },
          { label: 'Listed URLs that do not resolve', delta: '5 of 32', tone: 'gain' },
          { label: 'Payer registry endpoints published', delta: '0', tone: 'gain' },
        ]}
        reportSlug="2026-08-01-update"
        releaseDate="2026-08-01"
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
