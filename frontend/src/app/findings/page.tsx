import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import { FINDINGS } from '@/data/findings';

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
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Findings</h1>
        <p className="text-lg text-gray-600 mb-2">
          Pre-registered audit findings on the CMS National Provider Directory.
        </p>
        <p className="text-sm text-gray-500 mb-8">
          Each finding lists its null hypothesis, denominator, and data source{' '}
          <em>before</em> results drop. Methodology:{' '}
          <a href="/methodology" className="text-primary-600 hover:underline">
            /methodology
          </a>
          .
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FINDINGS.map((f) => (
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
                <span className="ml-auto inline-flex items-center rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-[10px] font-medium">
                  {f.status}
                </span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1.5">
                {f.title}
              </h2>
              <p className="text-sm text-gray-600 line-clamp-3">{f.summary}</p>
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}
