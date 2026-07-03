import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import InlineSubscribe from '@/components/InlineSubscribe';
import { cohortSize } from '@/lib/load-npi-cohort';
import NpiLookupForm from './NpiLookupForm';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Per-NPI report cards — AINPI',
  description:
    'Data-quality report cards for the federal provider directory high-risk cohort: OIG LEIE, SAM.gov, and NPPES cross-checks per NPI, each with primary-source verification links.',
  openGraph: {
    title: 'Per-NPI report cards — AINPI',
    description:
      'Cross-source data-quality signals per NPI, with primary-source verification links. Signals, not investigative findings.',
    url: 'https://ainpi.dev/npi',
    type: 'website',
  },
};

export default function NpiIndexPage() {
  const n = cohortSize();

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 mb-2">
          Per-NPI report cards
        </p>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          What do the federal databases say about one provider record?
        </h1>
        <p className="text-gray-700 mb-6 max-w-2xl">
          AINPI cross-checks every record in the CMS National Provider Directory
          against the OIG LEIE, SAM.gov exclusions, and NPPES. The{' '}
          {n.toLocaleString()} records in the current high-risk cohort each have a
          report card: which signals fired, what they mean, and a primary-source link
          to verify each one yourself.
        </p>

        <section className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Look up an NPI
          </h2>
          <NpiLookupForm />
          <p className="text-xs text-gray-500 mt-3">
            Report cards exist for the {n.toLocaleString()} cohort records today. An
            NPI outside the cohort returns a not-found page; for those, the{' '}
            <Link href="/npd" className="underline">
              directory search
            </Link>{' '}
            covers all 7.4M records. Full-directory report cards are on the roadmap.
          </p>
        </section>

        <section className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-sm text-amber-900">
          <strong>Signals, not investigative findings.</strong> A flag on a report card
          is a cross-check between public federal databases. It can be stale, clerical,
          or attached to the wrong person (the SAM.gov NPI field has a documented
          false-positive history). Every card links the primary sources so you can
          verify in under a minute.
        </section>

        <section className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            What each card checks
          </h2>
          <ul className="text-sm text-gray-700 space-y-2">
            <li>
              <strong>OIG LEIE exclusion</strong> — the NPI appears on the HHS-OIG List
              of Excluded Individuals/Entities with no reinstatement.
            </li>
            <li>
              <strong>SAM.gov exclusion record</strong> — a SAM Public Extract exclusion
              carries this NPI (name-match caveat applies).
            </li>
            <li>
              <strong>Not found in NPPES</strong> — listed in the federal directory but
              absent from the NPPES public registry.
            </li>
            <li>
              <strong>NPPES-deactivated</strong> — NPPES marks the NPI deactivated while
              the directory still lists it.
            </li>
            <li>
              <strong>Luhn validity</strong> — the NPI fails its own check digit.
            </li>
          </ul>
          <p className="text-xs text-gray-500 mt-3">
            Methodology and weights:{' '}
            <Link href="/findings/high-risk-cohort" className="underline">
              high-risk cohort finding (H23)
            </Link>
            . Bulk data:{' '}
            <a
              href="/api/v1/findings/high-risk-cohort-export.csv"
              className="underline"
            >
              cohort export CSV
            </a>
            .
          </p>
        </section>

        <InlineSubscribe
          source="npi_index"
          prompt="Checks re-run on every federal directory release. Get the updates."
        />
      </main>
    </div>
  );
}
