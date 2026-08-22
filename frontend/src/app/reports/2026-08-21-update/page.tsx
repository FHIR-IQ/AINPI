import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-08-21-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title:
    'The directory just changed more in one release than in the last four',
  description:
    'We reloaded all 45 GB of the 2026-08-20 CMS National Provider Directory release and compared every number against the previous one. Where-they-work records more than doubled, a field that resolved to nothing now resolves completely, health insurers appeared, and endpoint attribution went backwards.',
  openGraph: {
    title:
      'The directory just changed more in one release than in the last four',
    description:
      'Nearly 10 million new where-they-work records, every profession improved, a broken hierarchy field fixed, insurers added, and one number that went the wrong way.',
    url: 'https://ainpi.dev/reports/2026-08-21-update',
    type: 'article',
  },
};

export default function August2026Update0821Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-08-21 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · 2026-08-21"
        headlineA="Ten million new records."
        headlineB="Five points of coverage."
        caption="CMS published the largest change to the national provider directory since we started measuring. We reloaded all 45 GB and re-ran every measurement against the previous release. The records saying where a clinician works more than doubled, and the share of clinicians the directory can place moved only five points, because most of the new records went to people it already described."
        stats={[
          {
            label: 'Where-they-work records',
            delta: '+135%',
            tone: 'gain',
          },
          {
            label: 'Clinicians with a workplace (PA)',
            delta: '38.1% → 43.7%',
            tone: 'gain',
          },
          {
            label: 'Web addresses naming their owner',
            delta: '16.9% → 14.7%',
            tone: 'loss',
          },
        ]}
        reportSlug="2026-08-21-update"
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
