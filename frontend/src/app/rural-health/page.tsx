import type { Metadata } from 'next';
import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import RuralNational from './rural-national';
import type { RuralStateRow } from '@/components/charts/RuralStateMap';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Rural health: where the hospitals are, and who can reach them | AINPI',
  description:
    'A national baseline of rural hospital capacity built from public federal data. 34.4% of US hospitals sit in nonmetro counties serving 13.8% of the population, and 1,338 carry the Critical Access designation. State by state, with a Pennsylvania deep dive on FHIR endpoint reachability.',
  openGraph: {
    title: 'Rural health: where the hospitals are, and who can reach them',
    description:
      '34.4% of US hospitals sit in nonmetro counties serving 13.8% of the population. State-by-state rural hospital baseline from public federal data.',
    url: 'https://ainpi.dev/rural-health',
    type: 'article',
  },
};

interface RuralPayload {
  generated_at: string;
  methodology_version: string;
  summary: {
    hospitals: number;
    rural_hospitals: number;
    rural_share: number;
    critical_access: number;
    rural_population: number;
    population: number;
    rural_pop_share: number;
    unmatched_county: number;
  };
  states: RuralStateRow[];
  notes: string;
  sources: Record<string, string>;
}

function load(): RuralPayload | null {
  try {
    const p = path.join(process.cwd(), 'public', 'api', 'v1', 'rural-health.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')) as RuralPayload;
  } catch {
    return null;
  }
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{l}</div>
      <div className="text-2xl font-bold text-gray-900 mt-0.5 tabular-nums">{v}</div>
    </div>
  );
}

export default function RuralHealthPage() {
  const payload = load();

  if (!payload) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-amber-900 text-sm">
            Run <code>python analysis/rural_health_national.py</code> to generate{' '}
            <code>frontend/public/api/v1/rural-health.json</code>.
          </div>
        </main>
      </div>
    );
  }

  const s = payload.summary;
  const ratio = (s.rural_share / s.rural_pop_share).toFixed(1);
  const topCah = [...payload.states].sort((a, b) => b.critical_access - a.critical_access).slice(0, 3);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-3xl mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 mb-1">
            Rural health · National baseline
          </p>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            A third of American hospitals serve a seventh of the population
          </h1>
          <p className="text-gray-700">
            {s.rural_hospitals.toLocaleString()} of the {s.hospitals.toLocaleString()} hospitals CMS
            lists sit in nonmetro counties, which hold {s.rural_pop_share}% of US residents. Rural
            facilities are therefore about {ratio} times as numerous as population alone would
            suggest, because distance, not density, decides where a hospital has to be. That is the
            arithmetic behind every rural health program, and it is rarely stated. Click any state.
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Stat v={s.hospitals.toLocaleString()} l="Hospitals CMS lists" />
          <Stat v={`${s.rural_hospitals.toLocaleString()} (${s.rural_share}%)`} l="In nonmetro counties" />
          <Stat v={s.critical_access.toLocaleString()} l="Critical Access hospitals" />
          <Stat v={`${s.rural_pop_share}%`} l="Of residents live nonmetro" />
        </div>

        <RuralNational rows={payload.states} />

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            What the map shows
          </h2>
          <ul className="list-disc list-inside space-y-1.5 text-sm text-gray-700">
            <li>
              <strong>Facility count and population diverge sharply.</strong> Nonmetro counties hold{' '}
              {s.rural_pop_share}% of residents but {s.rural_share}% of hospitals. A funding formula
              weighted purely by population will under-serve the facilities; one weighted purely by
              facility count will over-serve them. Both numbers belong in the same sentence.
            </li>
            <li>
              <strong>Critical Access is concentrated.</strong> {s.critical_access.toLocaleString()}{' '}
              hospitals carry the designation nationally, led by {topCah.map((t) => `${t.name} (${t.critical_access})`).join(', ')}.
              These are the facilities with 25 beds or fewer, remote from the next hospital, and they
              are where a closure removes access rather than shifting it.
            </li>
            <li>
              <strong>Rural share is not a proxy for rural population.</strong> Vermont leads on
              hospital share while holding a modest rural population; Texas has many rural hospitals
              and a large metro population. Sorting the table by different columns makes the two
              measures separate visibly.
            </li>
          </ul>
        </section>

        <section className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wider mb-2">
            Pennsylvania: the connectivity layer
          </h2>
          <p className="text-sm text-blue-900 mb-2">
            Counting hospitals says where care is. It does not say whether those hospitals can be
            found by the software that routes patients, records and payment. We measured that for
            Pennsylvania: every hospital matched against the endpoint directories certified EHR
            vendors publish, which reveals both digital reachability and which EHR each facility runs.
          </p>
          <p className="text-sm text-blue-900">
            The result inverts the usual assumption. Rural hospitals are more findable than metro
            ones, and the apparent gaps turn out to be publishing patterns at two health systems
            rather than missing technology.{' '}
            <Link href="/states/pa/rural-health" className="underline font-medium">
              Open the Pennsylvania dashboard
            </Link>
            .
          </p>
        </section>

        <section className="mt-4 bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Method and limits
          </h2>
          <p className="text-sm text-gray-700">{payload.notes}</p>
          <p className="text-xs text-gray-500 mt-3">
            Sources: {Object.values(payload.sources).join(' · ')}. Rural classification is
            county-level, so a metro-county hospital may still serve a rural population and the
            Critical Access flag is the facility-level federal designation. Generated{' '}
            {payload.generated_at}. Methodology{' '}
            <Link href="/methodology" className="underline text-primary-700">
              {payload.methodology_version}
            </Link>
            . Compute script <code>analysis/rural_health_national.py</code>, which costs nothing to
            run. Payload:{' '}
            <a href="/api/v1/rural-health.json" className="underline text-primary-700">
              /api/v1/rural-health.json
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
