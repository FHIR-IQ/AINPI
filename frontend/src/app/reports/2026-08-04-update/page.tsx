import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import ReleaseTeaser from '@/components/ReleaseTeaser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-08-04-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title:
    'AINPI 2026-08-04 update: a third of American hospitals serve a seventh of the people',
  description:
    'New rural health section: 1,847 of 5,366 US hospitals (34.4%) sit in nonmetro counties holding 13.8% of residents, and 1,338 are Critical Access. Plus a Pennsylvania deep dive on which hospitals software can actually find, and a correction to an earlier Epic claim.',
  openGraph: {
    title:
      'AINPI 2026-08-04: a third of American hospitals serve a seventh of the people',
    description:
      '34.4% of US hospitals sit in nonmetro counties serving 13.8% of the population. New rural health section with a state map and a Pennsylvania connectivity deep dive.',
    url: 'https://ainpi.dev/reports/2026-08-04-update',
    type: 'article',
  },
};

export default function August2026Update0804Page() {
  const doc = loadMarkdown(DOC_PATH, 'AINPI 2026-08-01 update');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <ReleaseTeaser
        eyebrow="Release update · 2026-08-04"
        headlineA="A third of the hospitals."
        headlineB="A seventh of the people."
        caption="1,847 of the 5,366 hospitals CMS lists sit in nonmetro counties, which hold 13.8% of US residents. Rural facilities are about 2.5 times as numerous as population alone implies. New rural health section, with a state map and a Pennsylvania deep dive on which hospitals software can actually find."
        stats={[
          { label: 'US hospitals in nonmetro counties', delta: '34.4%', tone: 'gain' },
          { label: 'Of residents living nonmetro', delta: '13.8%', tone: 'gain' },
          { label: 'Critical Access hospitals', delta: '1,338', tone: 'gain' },
        ]}
        reportSlug="2026-08-04-update"
        releaseDate="2026-08-04"
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
