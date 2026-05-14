import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/smd-revalidation/cross-audit-roadmap.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'AINPI × public claims data — cross-audit roadmap',
  description:
    "Roadmap for adding a claims-side audit layer to AINPI's directory findings, using only publicly downloadable, NPI-keyed datasets. Pre-registers H29–H36 (LEIE/SAM × Medicaid Provider Spending, Medicare Part B/D, Open Payments, DMEPOS, POS, Nursing Home ownership, NDH completeness).",
  openGraph: {
    title: 'AINPI cross-audit roadmap — directory findings × public claims data',
    description:
      'Phase-1 finding pre-registrations for H29 (excluded providers paid by Medicaid), H30 (excluded billing Medicare), H33 (excluded DMEPOS suppliers). State Medicaid PI deliverables enumerated.',
    url: 'https://ainpi.dev/smd-revalidation/cross-audit-roadmap',
    type: 'article',
  },
};

export default function CrossAuditRoadmapPage() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI cross-audit roadmap');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <nav aria-label="breadcrumb" className="mb-4 text-sm text-gray-500">
          <a href="/smd-revalidation" className="hover:text-primary-600">
            SMD revalidation
          </a>
          <span className="mx-2">/</span>
          <span className="text-gray-900">Cross-audit roadmap</span>
        </nav>
        <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-900 text-white px-2.5 py-1 font-mono">
            draft v0.1
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 font-medium">
            roadmap — findings pre-registered, results pending
          </span>
          <span className="text-gray-500">drafted 2026-05-14</span>
        </div>
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
          <a
            className="text-primary-600 hover:underline"
            href="https://github.com/FHIR-IQ/AINPI/issues"
          >
            Track Phase 1 on GitHub →
          </a>
        </footer>
      </main>
    </div>
  );
}
