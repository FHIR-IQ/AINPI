import type { Metadata } from 'next';
import Link from 'next/link';

import Navbar from '@/components/Navbar';
import { loadExplorerIndex } from '@/lib/load-api-v1';
import { CURRENT_RELEASE } from '@/lib/release';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Explore the directory by place',
  description:
    'Drill into the federal provider directory by state, county and ZIP: how ' +
    'many practitioners it lists, how many it can say work somewhere, and how ' +
    'that varies by profession.',
};

function pct(n: number | null): string {
  return n === null ? '—' : `${n.toFixed(1)}%`;
}

export default function ExplorerIndexPage() {
  const idx = loadExplorerIndex();

  if (!idx) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <main className="max-w-4xl mx-auto px-4 py-16">
          <p className="text-sm text-gray-600">
            The explorer dataset has not been generated yet. Run{' '}
            <code className="font-mono text-xs">python analysis/explorer_geo.py</code>.
          </p>
        </main>
      </div>
    );
  }

  const national = idx.states.reduce(
    (a, s) => ({
      practitioners: a.practitioners + s.practitioners,
      with_role: a.with_role + s.with_role,
      orgs_provider: a.orgs_provider + s.orgs_provider,
    }),
    { practitioners: 0, with_role: 0, orgs_provider: 0 },
  );
  const nationalRole = (100 * national.with_role) / national.practitioners;

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <p className="eyebrow mb-2">Value explorer</p>
        <h1 className="font-serif text-3xl sm:text-4xl text-ink mb-4">
          What the directory knows, by place
        </h1>
        <p className="lede measure mb-8">
          Every practitioner, organization and location the federal directory
          lists, grouped by state, county and ZIP. Pick a state to drill in.
        </p>

        <dl className="mb-10 flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <dd className="stat text-2xl text-ink">
              {national.practitioners.toLocaleString()}
            </dd>
            <dt className="text-xs text-gray-600">practitioners with an address</dt>
          </div>
          <div>
            <dd className="stat text-2xl text-ink">{nationalRole.toFixed(1)}%</dd>
            <dt className="text-xs text-gray-600">have a workplace listed</dt>
          </div>
          <div>
            <dd className="stat text-2xl text-ink">
              {national.orgs_provider.toLocaleString()}
            </dd>
            <dt className="text-xs text-gray-600">provider organizations</dt>
          </div>
          <div>
            <dd className="stat text-2xl text-ink">{idx.states.length}</dd>
            <dt className="text-xs text-gray-600">jurisdictions</dt>
          </div>
        </dl>

        {/* Two absences that a blank map would misrepresent as a bug. */}
        <div className="mb-10 grid gap-4 sm:grid-cols-2">
          <div className="border border-gray-300 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
              No payer layer, and why
            </p>
            <p className="text-sm text-gray-700">
              {idx.payer_geography.note}
            </p>
          </div>
          <div className="border border-gray-300 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
              Organizations are not one number
            </p>
            <p className="text-sm text-gray-700">
              About half the directory&rsquo;s organization records are tax
              records filed under the same NPI as a real organization. They are
              counted separately throughout and never added together, because
              adding them roughly doubles the count.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-300 text-left">
                <th className="py-2 pr-4 font-medium text-gray-600">State</th>
                <th className="py-2 pr-4 font-medium text-gray-600 text-right">
                  Practitioners
                </th>
                <th className="py-2 pr-4 font-medium text-gray-600 text-right">
                  Has a workplace
                </th>
                <th className="py-2 pr-4 font-medium text-gray-600 text-right">
                  Provider orgs
                </th>
                <th className="py-2 pr-4 font-medium text-gray-600 text-right">
                  Counties
                </th>
                <th className="py-2 font-medium text-gray-600 text-right">ZIPs</th>
              </tr>
            </thead>
            <tbody>
              {idx.states.map((s) => (
                <tr key={s.state} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/explorer/${s.state.toLowerCase()}`}
                      className="text-primary-600 hover:underline font-medium"
                    >
                      {s.state}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {s.practitioners.toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{pct(s.role_pct)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {s.orgs_provider.toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{s.counties}</td>
                  <td className="py-2 text-right tabular-nums">{s.zips}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 border-t border-gray-300 pt-6 text-xs text-gray-600 measure space-y-2">
          <p>
            Release {CURRENT_RELEASE}. Methodology {idx.methodology_version}.
          </p>
          <p>{idx.notes}</p>
          <p>
            Looking for one provider rather than a place?{' '}
            <Link href="/npd" className="text-primary-600 hover:underline">
              Search by name or NPI
            </Link>
            . Data as JSON:{' '}
            <a
              href="/api/v1/explorer/index.json"
              className="text-primary-600 hover:underline font-mono"
            >
              /api/v1/explorer/index.json
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
