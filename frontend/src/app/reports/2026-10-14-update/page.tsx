import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-10-14-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'The directory got smaller, and almost nobody fell out of it',
  description:
    'The 2026-10-07 CMS National Provider Directory release is a quarter smaller than August, 24.8M records against 32.5M, yet Pennsylvania clinician coverage held at 44.0%. 997 insurers and 7,575 health plans arrived; none of the insurers has a web address in the directory.',
  openGraph: {
    title: 'The directory got smaller, and almost nobody fell out of it',
    description:
      '7.7M fewer records in the 2026-10-07 release, coverage unchanged. 997 insurers named, 0 reachable. Phone coverage and Pennsylvania record reachability slipped.',
    url: 'https://ainpi.dev/reports/2026-10-14-update',
    type: 'article',
  },
};

export default function October2026Update1014Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-10-14 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · 2026-10-14"
        headlineA="A quarter smaller."
        headlineB="997 insurers, none reachable."
        caption="CMS published a new National Provider Directory on 7 October. We reloaded it and re-ran every check. The file lost 7.7 million records, mostly tax-only organizations and duplicate where-they-work records, and the share of Pennsylvania clinicians it describes held steady. Insurers arrived by the hundreds, without a single web address."
        stats={[
          { label: 'Records, August to October', delta: '−23.7%', tone: 'loss' },
          {
            label: 'Pennsylvania clinicians with a workplace',
            delta: '43.7% → 44.0%',
            tone: 'gain',
          },
          {
            label: 'Insurers with a web address',
            delta: '0 of 997',
            tone: 'loss',
          },
        ]}
        reportSlug="2026-10-14-update"
        releaseDate="2026-10-14"
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
