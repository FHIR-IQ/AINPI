'use client';

import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import {
  HCS_CATEGORIES,
  HCS_MUST_SUPPORT_FIELDS,
  HCS_FHIR_PROFILES,
  HCS_CADENCES,
  HCS_ROLE_TYPES,
} from '@/data/healthcare-service-survey';

interface Aggregate {
  total_responses: number;
  generated_at: string;
  counts: {
    categoriesUsed: { code: string; count: number }[];
    categoriesPain: { code: string; count: number }[];
    mustSupportPopulated: { code: string; count: number }[];
    fhirProfile: { code: string; count: number }[];
    roleType: { code: string; count: number }[];
    publishCadence: { code: string; count: number }[];
    wantsFollowUp: number;
  };
}

function displayFor(
  bucket: { code: string; display: string }[],
  code: string,
): string {
  return bucket.find((b) => b.code === code)?.display ?? code;
}

function Bar({
  rows,
  total,
  vocabulary,
  emptyLabel,
}: {
  rows: { code: string; count: number }[];
  total: number;
  vocabulary: { code: string; display: string }[];
  emptyLabel: string;
}) {
  if (rows.length === 0 || total === 0) {
    return <p className="text-sm text-gray-500 italic">{emptyLabel}</p>;
  }
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const pct = total > 0 ? (r.count / total) * 100 : 0;
        return (
          <div key={r.code} className="grid grid-cols-[160px_1fr_70px] items-center gap-3 text-sm">
            <span className="truncate" title={displayFor(vocabulary, r.code)}>
              <span className="font-mono text-xs text-gray-500 mr-1.5">{r.code}</span>
              {displayFor(vocabulary, r.code)}
            </span>
            <div className="bg-gray-100 rounded h-4 relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-primary-500"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
            <span className="text-right text-gray-700 tabular-nums">
              {r.count} <span className="text-gray-400 text-xs">({pct.toFixed(0)}%)</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function ResultsPage() {
  const [data, setData] = useState<Aggregate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/healthcare-service-survey')
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) setError(d.error);
        else setData(d as Aggregate);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'fetch failed'));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <nav aria-label="breadcrumb" className="mb-4 text-sm text-gray-500">
          <a href="/payer-healthcare-service-survey" className="hover:text-primary-600">
            HealthcareService survey
          </a>
          <span className="mx-2">/</span>
          <span className="text-gray-900">Running aggregate</span>
        </nav>
        <header className="mb-8">
          <p className="text-xs uppercase tracking-widest text-primary-600 font-mono mb-2">
            Live aggregate · counts only · no PII
          </p>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            HealthcareService survey — running results
          </h1>
          <p className="text-gray-700">
            What we&apos;re hearing from the community so far. These counts
            feed the AINPI recommendation back to the NPD weekly call. Small-n
            disclaimer applies — read the numbers as directional, not statistical,
            until response count gets meaningful (target 30+).
          </p>
        </header>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-800 mb-6">
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="bg-white border rounded-lg p-8 text-center text-sm text-gray-500">
            Loading aggregate…
          </div>
        )}

        {data && (
          <>
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
              <div className="bg-white border rounded-lg p-4">
                <p className="text-xs uppercase tracking-wider text-gray-500 font-mono">Responses</p>
                <p className="text-2xl font-bold text-gray-900 tabular-nums">{data.total_responses}</p>
              </div>
              <div className="bg-white border rounded-lg p-4">
                <p className="text-xs uppercase tracking-wider text-gray-500 font-mono">Want follow-up</p>
                <p className="text-2xl font-bold text-emerald-700 tabular-nums">{data.counts.wantsFollowUp}</p>
              </div>
              <div className="bg-white border rounded-lg p-4">
                <p className="text-xs uppercase tracking-wider text-gray-500 font-mono">Roles answering</p>
                <p className="text-2xl font-bold text-gray-900 tabular-nums">{data.counts.roleType.length}</p>
              </div>
              <div className="bg-white border rounded-lg p-4">
                <p className="text-xs uppercase tracking-wider text-gray-500 font-mono">Refreshed</p>
                <p className="text-xs text-gray-600 font-mono">{data.generated_at.slice(0, 19).replace('T', ' ')}Z</p>
              </div>
            </section>

            <section className="bg-white border rounded-lg p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Categories published today</h2>
              <p className="text-sm text-gray-600 mb-4">
                Which HealthcareServiceCategoryVS codes respondents report publishing.
              </p>
              <Bar
                rows={data.counts.categoriesUsed}
                total={data.total_responses}
                vocabulary={HCS_CATEGORIES}
                emptyLabel="No category responses yet."
              />
            </section>

            <section className="bg-white border rounded-lg p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Categories causing the most rework</h2>
              <p className="text-sm text-gray-600 mb-4">
                The asymmetry between this chart and the one above is where the recommendation should land.
              </p>
              <Bar
                rows={data.counts.categoriesPain}
                total={data.total_responses}
                vocabulary={HCS_CATEGORIES}
                emptyLabel="No pain-point responses yet."
              />
            </section>

            <section className="bg-white border rounded-lg p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">NDH must-support fields populated</h2>
              <p className="text-sm text-gray-600 mb-4">
                Which S-flagged elements respondents reliably populate today.
              </p>
              <Bar
                rows={data.counts.mustSupportPopulated}
                total={data.total_responses}
                vocabulary={HCS_MUST_SUPPORT_FIELDS}
                emptyLabel="No must-support responses yet."
              />
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-white border rounded-lg p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">FHIR profile in use</h2>
                <p className="text-sm text-gray-600 mb-4">Primary profile the respondent conforms to.</p>
                <Bar
                  rows={data.counts.fhirProfile}
                  total={data.total_responses}
                  vocabulary={HCS_FHIR_PROFILES}
                  emptyLabel="No profile responses yet."
                />
              </div>
              <div className="bg-white border rounded-lg p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Publishing cadence</h2>
                <p className="text-sm text-gray-600 mb-4">How often respondents republish the data.</p>
                <Bar
                  rows={data.counts.publishCadence}
                  total={data.total_responses}
                  vocabulary={HCS_CADENCES}
                  emptyLabel="No cadence responses yet."
                />
              </div>
            </section>

            <section className="bg-white border rounded-lg p-6 mb-10">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Who&apos;s answering</h2>
              <p className="text-sm text-gray-600 mb-4">
                Respondent role distribution. Watch for over-indexing on one slice when reading the rest.
              </p>
              <Bar
                rows={data.counts.roleType}
                total={data.total_responses}
                vocabulary={HCS_ROLE_TYPES}
                emptyLabel="No role responses yet."
              />
            </section>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <a
                href="/payer-healthcare-service-survey"
                className="inline-flex items-center px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-md"
              >
                Add your response →
              </a>
              <a
                href="/api/v1/healthcare-service-survey"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-primary-600 hover:underline"
              >
                /api/v1/healthcare-service-survey (raw JSON)
              </a>
              <a
                href="https://github.com/FHIR-IQ/AINPI/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:underline"
              >
                Track the recommendation on GitHub →
              </a>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
