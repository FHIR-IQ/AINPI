import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import SpecialtyByOrgBrowser from '@/components/SpecialtyByOrgBrowser';
import { loadSpecialtyByOrg } from '@/lib/load-api-v1';

// Build-time read of a static payload. No runtime BigQuery, same cost
// contract as /npi: a public browsable route must not be able to bill.
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'One provider, different specialty at each organization',
  description:
    'Worked examples from the CMS National Directory of Healthcare showing practitioners whose recorded specialty differs between the organizations they work at, and what a flat one-specialty-per-provider format loses.',
  openGraph: {
    title: 'One provider, different specialty at each organization | AINPI',
    description:
      'Real examples of specialty recorded per organization in the NDH, and what a flat format cannot carry.',
    url: 'https://ainpi.dev/exploratory/specialty-by-organization',
    type: 'article',
  },
};

export default function SpecialtyByOrganizationPage() {
  const payload = loadSpecialtyByOrg();

  if (!payload) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <main className="max-w-3xl mx-auto px-4 py-16">
          <p className="text-ink">
            The examples are not published yet. Run{' '}
            <code className="font-mono text-sm">
              analysis/explore_specialty_context.py
            </code>
            .
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="rise">
          <p className="eyebrow mb-3">
            Exploratory · Release {payload.release_date}
          </p>
          <h1 className="text-3xl sm:text-4xl mb-4 text-balance">
            One provider, a different specialty at each place they work
          </h1>
          <p className="lede measure">
            A doctor can be a hospitalist at one group and an internist at
            another. The directory has somewhere to record that, and these are
            real people it recorded it for. Search the {payload.sample_size.toLocaleString()}{' '}
            examples below, or read what they add up to in{' '}
            <Link href="/articles/specialty-context" className="underline">
              the write-up
            </Link>
            .
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="border border-ink/15 rounded-[3px] bg-white p-4">
            <div className="stat-value">
              {payload.population_distinct_org_name.toLocaleString()}
            </div>
            <div className="stat-label">
              providers whose specialty differs between organizations
            </div>
          </div>
          <div className="border border-ink/15 rounded-[3px] bg-white p-4">
            <div className="stat-value">{payload.role_specialty_blank_pct}%</div>
            <div className="stat-label">
              of role records have no specialty recorded at all
            </div>
          </div>
          <div className="border border-ink/15 rounded-[3px] bg-white p-4">
            <div className="stat-value">1 in 6</div>
            <div className="stat-label">
              active providers have a specialty recorded at any organization
            </div>
          </div>
        </div>

        <section className="mt-10">
          <SpecialtyByOrgBrowser cases={payload.cases} />
        </section>

        <section className="mt-12 measure text-sm text-ink/70 space-y-3">
          <h2 className="font-serif text-lg text-ink">Reading these</h2>
          <p>
            Each card is one practitioner. Under them are the organizations the
            directory links them to, and the specialty it records at each one.
            Where those differ, the directory is carrying something a single
            provider-level specialty cannot express.
          </p>
          <p>
            The same organization name can appear twice on one card with
            different specialties. That is not a display error. The directory
            publishes more than one Organization record for the same
            organization, which is why the NPI is printed under every name.{' '}
            {payload.only_across_same_named_records.toLocaleString()} of the{' '}
            {payload.population.toLocaleString()} differ only across same-named
            records, so the stricter count of providers whose specialty differs
            between differently-named organizations is{' '}
            {payload.population_distinct_org_name.toLocaleString()}.
          </p>
          <p>{payload.sampling}</p>
          <p>
            Exploratory rather than a finding: this followed a question that was
            already being discussed rather than a hypothesis registered before
            the numbers existed. Data at{' '}
            <a
              href="/api/v1/exploratory/specialty-by-organization.json"
              className="underline"
            >
              /api/v1/exploratory/specialty-by-organization.json
            </a>
            , compute script{' '}
            <code className="font-mono text-xs">
              analysis/explore_specialty_context.py
            </code>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
