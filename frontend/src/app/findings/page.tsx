import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import StatsStrip from '@/components/StatsStrip';
import { FINDINGS } from '@/data/findings';
import { loadStats, loadFinding } from '@/lib/load-api-v1';

const STATUS_STYLES: Record<string, string> = {
  published: 'bg-green-100 text-green-800',
  'in-progress': 'bg-amber-100 text-amber-800',
  'pre-registered': 'bg-blue-100 text-blue-800',
};

const STATUS_ORDER: Record<string, number> = {
  published: 0,
  'in-progress': 1,
  'pre-registered': 2,
};

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Findings — AINPI',
  description:
    'Pre-registered findings from the AINPI audit of the CMS National Provider Directory. Each finding states its null hypothesis, denominator, and data source before results drop.',
  openGraph: {
    title: 'Findings — AINPI',
    description:
      'Pre-registered findings from the AINPI audit of the CMS National Provider Directory.',
    url: 'https://ainpi.vercel.app/findings',
    type: 'website',
  },
};

export default function FindingsIndex() {
  const stats = loadStats();
  // Enrich each finding with its live status + headline from /api/v1
  const enriched = FINDINGS.map((f) => {
    const live = loadFinding(f.slug);
    return {
      ...f,
      liveStatus: live?.status || f.status,
      headline: live?.headline || null,
    };
  }).sort((a, b) =>
    (STATUS_ORDER[a.liveStatus] ?? 99) - (STATUS_ORDER[b.liveStatus] ?? 99),
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Findings</h1>
        <p className="text-lg text-gray-600 mb-2">
          Pre-registered audit findings on the CMS National Provider Directory.
        </p>
        <p className="text-sm text-gray-500 mb-6">
          Each finding lists its null hypothesis, denominator, and data source{' '}
          <em>before</em> results drop. Methodology:{' '}
          <a href="/methodology" className="text-primary-600 hover:underline">
            /methodology
          </a>
          .
        </p>

        <div className="mb-8">
          <StatsStrip stats={stats} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {enriched.map((f) => {
            const badgeClass = STATUS_STYLES[f.liveStatus] || 'bg-gray-100 text-gray-800';
            return (
              <a
                key={f.slug}
                href={`/findings/${f.slug}`}
                className="block bg-white rounded-lg shadow-sm border p-5 hover:border-primary-400 hover:shadow transition"
              >
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {f.hypotheses.map((h) => (
                    <span
                      key={h}
                      className="inline-flex items-center rounded-full bg-gray-900 text-white px-1.5 py-0.5 text-[10px] font-mono"
                    >
                      {h}
                    </span>
                  ))}
                  <span
                    className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeClass}`}
                  >
                    {f.liveStatus}
                  </span>
                </div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1.5">
                  {f.title}
                </h2>
                {f.headline ? (
                  <p className="text-sm text-gray-900 line-clamp-3 leading-snug">
                    {f.headline}
                  </p>
                ) : (
                  <p className="text-sm text-gray-600 line-clamp-3">{f.summary}</p>
                )}
              </a>
            );
          })}
        </div>
      </main>
    </div>
  );
}
