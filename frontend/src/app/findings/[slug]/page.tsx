import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { findBySlug, allSlugs } from '@/data/findings';
import { loadFinding } from '@/lib/load-api-v1';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return allSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const finding = findBySlug(params.slug);
  if (!finding) return { title: 'Finding not found — AINPI' };

  const title = `${finding.title} — AINPI`;
  const description = finding.ogTagline || finding.summary;
  const url = `https://ainpi.vercel.app/findings/${finding.slug}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      type: 'article',
      tags: finding.hypotheses,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    'pre-registered': 'bg-blue-100 text-blue-800',
    'in-progress': 'bg-amber-100 text-amber-800',
    published: 'bg-green-100 text-green-800',
  };
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ' +
        (styles[status] || 'bg-gray-100 text-gray-800')
      }
    >
      {status}
    </span>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

export default function FindingPage({ params }: { params: { slug: string } }) {
  const finding = findBySlug(params.slug);
  if (!finding) notFound();

  const live = loadFinding(finding.slug);
  const hasNumbers = !!(live && live.headline);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <nav aria-label="breadcrumb" className="mb-4 text-sm text-gray-500">
          <a href="/findings" className="hover:text-primary-600">
            Findings
          </a>
          <span className="mx-2">/</span>
          <span className="text-gray-900">{finding.slug}</span>
        </nav>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          {finding.hypotheses.map((h) => (
            <span
              key={h}
              className="inline-flex items-center rounded-full bg-gray-900 text-white px-2 py-0.5 text-xs font-mono"
            >
              {h}
            </span>
          ))}
          <StatusBadge status={live?.status || finding.status} />
          {live?.release_date && (
            <span className="text-xs text-gray-500">NPD release {live.release_date}</span>
          )}
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          {finding.title}
        </h1>
        <p className="text-lg text-gray-600 mb-8">{finding.summary}</p>

        {hasNumbers && live?.headline && (
          <section className="bg-gray-900 text-white rounded-lg p-6 mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
              Headline
            </h2>
            <p className="text-xl font-semibold leading-snug">{live.headline}</p>
            {live.numerator != null && live.denominator != null && (
              <p className="mt-3 text-sm text-gray-300 font-mono">
                {fmt(live.numerator)} / {fmt(live.denominator)} ={' '}
                {((live.numerator / live.denominator) * 100).toFixed(2)}%
              </p>
            )}
          </section>
        )}

        <section className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Null hypothesis
          </h2>
          <p className="text-gray-900">{finding.nullHypothesis}</p>
        </section>

        <section className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Denominator
          </h2>
          <p className="text-gray-900">{finding.denominator}</p>
        </section>

        <section className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Data source
          </h2>
          <p className="text-gray-900">{finding.dataSource}</p>
        </section>

        {live?.notes && (
          <section className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-sm text-amber-900">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-1">
              Notes
            </h2>
            <p>{live.notes}</p>
          </section>
        )}

        {!hasNumbers && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
            <p className="font-medium mb-1">Pre-registered — results not yet published.</p>
            <p>
              This finding is listed here <em>before</em> results drop. That is the
              project&apos;s trust contract: the null hypothesis and the computation are
              public first, and numbers follow. Methodology:{' '}
              <a href="/methodology" className="underline">
                /methodology
              </a>
              .
            </p>
          </div>
        )}

        <footer className="mt-12 pt-8 border-t text-sm text-gray-500 space-y-1">
          <p>
            Hypotheses mapped:{' '}
            {finding.hypotheses.map((h, i) => (
              <span key={h}>
                <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{h}</code>
                {i < finding.hypotheses.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>
          {live && (
            <p className="text-xs font-mono">
              API:{' '}
              <a className="text-primary-600 hover:underline" href={`/api/v1/findings/${finding.slug}.json`}>
                /api/v1/findings/{finding.slug}.json
              </a>
              {' · '}methodology v{live.methodology_version}
              {live.commit_sha && live.commit_sha !== 'pending' && (
                <> · commit <code>{live.commit_sha.slice(0, 7)}</code></>
              )}
            </p>
          )}
        </footer>
      </main>
    </div>
  );
}
