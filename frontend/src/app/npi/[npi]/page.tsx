import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Navbar from '@/components/Navbar';
import InlineSubscribe from '@/components/InlineSubscribe';
import { allCohortNpis, getCohortRow, type NpiCohortRow } from '@/lib/load-npi-cohort';

export const dynamic = 'force-static';
// COST CONTRACT: unknown NPIs 404 statically. No runtime data reads, no
// live BigQuery. See load-npi-cohort.ts.
export const dynamicParams = false;

export function generateStaticParams(): { npi: string }[] {
  return allCohortNpis().map((npi) => ({ npi }));
}

export function generateMetadata({ params }: { params: { npi: string } }): Metadata {
  const row = getCohortRow(params.npi);
  if (!row) return { title: 'NPI report card — AINPI' };
  const title = `${row.name} (NPI ${row.npi}) — federal directory data-quality report — AINPI`;
  const description =
    `Data-quality signals for NPI ${row.npi} from public federal databases ` +
    `(OIG LEIE, SAM.gov, NPPES), with primary-source verification links. ` +
    `Signals are data-quality flags, not investigative findings.`;
  return {
    title,
    description,
    openGraph: { title, description, url: `https://ainpi.dev/npi/${row.npi}`, type: 'article' },
  };
}

interface SignalDef {
  code: string;
  label: string;
  weight: string;
  explain: (row: NpiCohortRow) => string;
  verifyLabel: string;
  verifyUrl: (row: NpiCohortRow) => string;
}

const SIGNALS: SignalDef[] = [
  {
    code: 'oig_excluded',
    label: 'OIG LEIE exclusion',
    weight: '1.5',
    explain: (r) =>
      `This NPI appears on the HHS Office of Inspector General List of Excluded ` +
      `Individuals/Entities${r.leie_excldate ? ` with exclusion date ${r.leie_excldate}` : ''} ` +
      `and no reinstatement date in the ingested monthly file.`,
    verifyLabel: 'Search the LEIE',
    verifyUrl: () => 'https://exclusions.oig.hhs.gov/',
  },
  {
    code: 'sam_excluded',
    label: 'SAM.gov exclusion record',
    weight: '1.5',
    explain: (r) =>
      `A SAM.gov Public Extract exclusion record carries this NPI` +
      `${r.sam_active_date ? ` (active date ${r.sam_active_date})` : ''}. ` +
      `Known caveat: the SAM NPI field is sometimes clerically wrong and can point at a ` +
      `different person than the named excluded party. Verify the SAM record name against ` +
      `NPPES before relying on this signal.`,
    verifyLabel: 'Search SAM.gov exclusions',
    verifyUrl: () => 'https://sam.gov/search/?index=ex',
  },
  {
    code: 'not_in_nppes',
    label: 'Not found in NPPES',
    weight: '1.0',
    explain: () =>
      'This NPI appears in the federal directory but was not found in the NPPES public ' +
      'registry snapshot used for the cross-check.',
    verifyLabel: 'Look up in NPPES Registry',
    verifyUrl: (r) => `https://npiregistry.cms.hhs.gov/provider-view/${r.npi}`,
  },
  {
    code: 'nppes_deactivated',
    label: 'NPPES-deactivated',
    weight: '0.8',
    explain: (r) =>
      `NPPES marks this NPI deactivated` +
      `${r.nppes_deactivation_date ? ` as of ${r.nppes_deactivation_date}` : ''}, ` +
      `while the federal directory still lists it.`,
    verifyLabel: 'Look up in NPPES Registry',
    verifyUrl: (r) => `https://npiregistry.cms.hhs.gov/provider-view/${r.npi}`,
  },
  {
    code: 'luhn_fail',
    label: 'NPI fails the Luhn check',
    weight: '1.0',
    explain: () =>
      'The NPI does not pass the ISO-7812 Luhn check digit that every valid NPI must ' +
      'satisfy, which indicates a data-entry or synthetic-value error.',
    verifyLabel: 'Look up in NPPES Registry',
    verifyUrl: (r) => `https://npiregistry.cms.hhs.gov/provider-view/${r.npi}`,
  },
];

export default function NpiReportCardPage({ params }: { params: { npi: string } }) {
  const row = getCohortRow(params.npi);
  if (!row) notFound();

  const active = SIGNALS.filter((s) => row.reasons.includes(s.code));
  const clean = SIGNALS.filter((s) => !row.reasons.includes(s.code));
  const samOnly =
    row.reasons.includes('sam_excluded') && !row.reasons.includes('oig_excluded');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 mb-2">
          Per-NPI report card · High-risk cohort (H23)
        </p>
        <h1 className="text-3xl font-bold text-gray-900 mb-1">{row.name}</h1>
        <p className="text-gray-600 font-mono mb-6">
          NPI {row.npi}
          {row.state ? ` · ${row.state}` : ''} · composite score {row.score} ·{' '}
          <span className={row.bucket === 'critical' ? 'text-red-700 font-semibold' : 'text-amber-700 font-semibold'}>
            {row.bucket}
          </span>
        </p>

        <section className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-8 text-sm text-amber-900">
          <strong>These are data-quality signals, not investigative findings.</strong>{' '}
          Every signal below is a cross-check between public federal databases and can
          be independently verified at the linked primary source in under a minute.
          Nothing on this page implicates wrongdoing by any person; matching records
          can be stale, clerical, or (for SAM NPI fields specifically) attached to the
          wrong person. Verify before acting.
          {samOnly && (
            <>
              {' '}
              <strong>
                This record is flagged by SAM.gov only, without LEIE corroboration — the
                signal class with a known false-positive history. Treat as unverified
                until the SAM record name is matched against NPPES.
              </strong>
            </>
          )}
        </section>

        <section className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Signals present ({active.length})
          </h2>
          <div className="space-y-4">
            {active.map((s) => (
              <div key={s.code} className="border-l-4 border-red-300 pl-4">
                <p className="font-medium text-gray-900">
                  {s.label}{' '}
                  <span className="text-xs text-gray-500 font-mono">weight {s.weight}</span>
                </p>
                <p className="text-sm text-gray-700 mt-1">{s.explain(row)}</p>
                <a
                  href={s.verifyUrl(row)}
                  target="_blank"
                  rel="noopener"
                  className="text-sm text-primary-600 hover:underline"
                >
                  {s.verifyLabel} →
                </a>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Checks that came back clean ({clean.length})
          </h2>
          <ul className="text-sm text-gray-600 space-y-1">
            {clean.map((s) => (
              <li key={s.code}>
                <span className="text-green-700">✓</span> {s.label}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500 mt-3">
            Scoring: composite of the five signals at the weights shown (methodology
            v0.4.0 of the{' '}
            <Link href="/findings/high-risk-cohort" className="underline">
              high-risk cohort finding
            </Link>
            ). Critical bucket = score ≥ 1.5 (LEIE or SAM exclusion present).
          </p>
        </section>

        <section className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Verify this record at the primary sources
          </h2>
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              href={`https://npiregistry.cms.hhs.gov/provider-view/${row.npi}`}
              target="_blank"
              rel="noopener"
              className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 text-gray-800"
            >
              NPPES Registry
            </a>
            <a
              href="https://exclusions.oig.hhs.gov/"
              target="_blank"
              rel="noopener"
              className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 text-gray-800"
            >
              OIG LEIE search
            </a>
            <a
              href="https://sam.gov/search/?index=ex"
              target="_blank"
              rel="noopener"
              className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 text-gray-800"
            >
              SAM.gov exclusions
            </a>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            No API key, no login. LEIE and SAM search by name; NPPES resolves the NPI
            directly.
          </p>
        </section>

        <InlineSubscribe
          source="npi_page"
          prompt="AINPI re-runs these checks on every federal directory release. Get the updates."
        />

        <footer className="mt-10 pt-6 border-t text-xs text-gray-500 space-y-1">
          <p>
            Sources: CMS National Provider Directory bulk export, OIG LEIE monthly file,
            SAM.gov Public Extract V2, NPPES public dissemination. Methodology:{' '}
            <Link href="/methodology" className="underline">
              /methodology
            </Link>
            {' · '}
            <Link href="/findings/high-risk-cohort" className="underline">
              high-risk cohort finding
            </Link>
          </p>
          <p>
            This page exists for the records in the current high-risk cohort. For any
            other NPI, use the{' '}
            <Link href="/npd" className="underline">
              directory search
            </Link>
            .
          </p>
        </footer>
      </main>
    </div>
  );
}
