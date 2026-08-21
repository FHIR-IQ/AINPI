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
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-08-17 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · 2026-08-17"
        headlineA="Nearly 8 in 10 doctors."
        headlineB="1 in 12,995 pharmacists."
        caption="The national directory is supposed to say where each health worker works. We checked all 227,727 it lists as active in Pennsylvania and asked which ones it actually says that for. It is not spread evenly across the professions. It tracks who bills Medicare, not who provides care, and nothing in the directory tells you that."
        stats={[
          {
            label: 'Nurse practitioners and PAs with a workplace',
            delta: '77.9%',
            tone: 'gain',
          },
          { label: 'Dentists with a workplace', delta: '4.7%', tone: 'loss' },
          {
            label: 'Pharmacy workers with a workplace',
            delta: '1 of 12,995',
            tone: 'loss',
          },
        ]}
        reportSlug="2026-08-21-update"
        releaseDate="2026-08-17"
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
