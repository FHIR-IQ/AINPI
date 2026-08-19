import fs from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';
import type { PrimerScoreboard } from '@/lib/primer-types';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/provider-data-primer.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'A primer on provider and endpoint data',
  description:
    'What every identifier means, what each FHIR resource holds, how they join, and which joins are safe. Plus a scoreboard of six directory metrics with a measured baseline. Written for somebody capable who does not already live in this data.',
  openGraph: {
    title: 'A primer on provider and endpoint data',
    description:
      'NPI, pseudo-EIN, PAC ID, CCN, taxonomy, and the six FHIR resources: what they mean, how they join, and where the joins break.',
    url: 'https://ainpi.dev/primer',
    type: 'article',
  },
};

/** Read at build time. Absent scoreboard degrades to the prose alone. */
function loadScoreboard(): PrimerScoreboard | null {
  try {
    const p = path.join(process.cwd(), 'public/api/v1/primer-scoreboard.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')) as PrimerScoreboard;
  } catch {
    return null;
  }
}

export default function PrimerPage() {
  const doc = loadMarkdown(DOC_PATH, 'A primer on provider and endpoint data');
  const board = loadScoreboard();

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <article className="prose prose-slate max-w-none prose-headings:font-serif prose-headings:font-normal prose-a:text-primary-700 prose-table:text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.body}</ReactMarkdown>
        </article>

        {board && (
          <section className="mt-10">
            <h2 className="mb-1 font-serif text-2xl text-ink">{board.title}</h2>
            <p className="measure mb-6 text-sm text-gray-600">{board.note}</p>

            <div className="divide-y divide-gray-200 border border-gray-300 bg-white">
              {board.metrics.map((m) => (
                <div key={m.key} className="grid gap-4 p-5 sm:grid-cols-[9rem_1fr]">
                  <div>
                    {/* A metric with no value yet must not render as zero.
                        Zero is itself one of the findings here, so the two
                        states have to look different. */}
                    <p className="stat text-3xl leading-none text-ink">
                      {m.value === null ? '—' : m.value}
                      {m.value === null ? '' : (
                        <span className="ml-0.5 text-base text-gray-500">
                          {m.unit.startsWith('%') ? '%' : ''}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      {m.unit.replace(/^%\s*/, '') || 'of the total'}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-ink">{m.label}</p>
                    <p className="measure mt-0.5 text-sm text-gray-700">
                      {m.question}
                    </p>
                    <p className="measure mt-2 text-sm text-gray-600">{m.detail}</p>
                    <p className="measure mt-2 text-sm text-gray-500">
                      <span className="eyebrow mr-2">Could be</span>
                      {m.headroom}
                    </p>
                    {m.finding && (
                      <Link
                        href={`/findings/${m.finding}`}
                        className="mt-2 inline-block text-sm text-primary-700 underline"
                      >
                        How this was measured
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-4 text-xs text-gray-500">
              Measured against the {board.release_date} release. Recompute with{' '}
              <code className="rounded-sm bg-gray-100 px-1">
                analysis/primer_scoreboard.py
              </code>
              . Raw payload:{' '}
              <a href="/api/v1/primer-scoreboard.json" className="underline">
                /api/v1/primer-scoreboard.json
              </a>
            </p>
          </section>
        )}

        <section className="mt-10 border border-gray-300 bg-white p-6">
          <h2 className="mb-2 font-serif text-2xl text-ink">
            Corrections wanted
          </h2>
          <p className="measure text-sm text-gray-700">
            If any of this is wrong, or right in the wrong release, we would
            rather know than be quoted. Every number is reproducible from public
            data and the analysis code is open, so a disagreement can be settled
            by running it rather than by argument.
          </p>
          <p className="measure mt-3 text-sm text-gray-700">
            Open an issue on{' '}
            <a
              href="https://github.com/FHIR-IQ/AINPI/issues/new/choose"
              className="text-primary-700 underline"
            >
              GitHub
            </a>{' '}
            or read{' '}
            <Link href="/methodology" className="text-primary-700 underline">
              the methodology
            </Link>
            .
          </p>
        </section>

        <footer className="mt-12 border-t border-gray-200 pt-6 text-sm text-gray-500">
          Source:{' '}
          <a href={GITHUB_URL} className="text-primary-700 hover:underline">
            {DOC_PATH}
          </a>
        </footer>
      </main>
    </div>
  );
}
