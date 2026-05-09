import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-05-08-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;
const VIDEO_HREF = '/video/2026-05-08-update/';

export const metadata: Metadata = {
  title: 'AINPI 2026-05-08 update — first comparable-release deltas',
  description:
    'CMS pushed a new NDH bulk export. AINPI re-ingested everything and reports release-to-release deltas: Endpoint −73%, Location −61%, OrgAffiliation +147%, SSN exposures 46 → 41, Org NPI duplicates 383K → 1.41M, plus two source-side schema breaks consumers should know about.',
  openGraph: {
    title: 'AINPI 2026-05-08 update — first comparable-release deltas',
    description:
      'Endpoint −73%, Location −61%, OrgAffiliation +147%. SSN exposures 46 → 41 (CMS partially scrubbed). Org NPI duplicates 383K → 1.41M.',
    url: 'https://ainpi.dev/reports/2026-05-08-update',
    type: 'article',
    videos: [
      {
        url: 'https://ainpi.dev/video/2026-05-08-update/',
        type: 'text/html',
      },
    ],
  },
};

export default function May2026Update0508Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-05-08 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · Δ April → May"
        headlineA="The shape"
        headlineB="changed."
        caption="CMS pushed a new bulk export. AINPI re-ingested every resource and re-ran every H-series check."
        stats={[
          { label: 'Endpoint', delta: '−73%', tone: 'loss' },
          { label: 'Location', delta: '−61%', tone: 'loss' },
          { label: 'OrgAffil', delta: '+147%', tone: 'gain' },
        ]}
        videoHref={VIDEO_HREF}
        reportSlug="2026-05-08-update"
        releaseDate="2026-05-08"
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
          <a
            className="text-primary-600 hover:underline"
            href={VIDEO_HREF}
            target="_blank"
            rel="noopener noreferrer"
          >
            Watch the 48-second video →
          </a>
        </footer>
      </main>
    </div>
  );
}
