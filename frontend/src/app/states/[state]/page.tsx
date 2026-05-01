import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Navbar from '@/components/Navbar';
import AuthorByline from '@/components/AuthorByline';
import { findStateByCode, allStateCodes } from '@/data/states';
import { loadStateFindings } from '@/lib/load-api-v1';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return allStateCodes().map((state) => ({ state }));
}

export async function generateMetadata({
  params,
}: {
  params: { state: string };
}): Promise<Metadata> {
  const entry = findStateByCode(params.state);
  if (!entry) return { title: 'State not found — AINPI' };

  const title = `${entry.name} provider directory audit — AINPI`;
  const description = `State-scoped slice of the AINPI audit of the CMS National Provider Directory, prepared as a citable methodology for ${entry.name}'s response to the 2026-04-23 CMS State Medicaid Director letter on provider revalidation.`;
  const url = `https://ainpi.dev/states/${entry.code.toLowerCase()}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

function fmt(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return n.toLocaleString();
  return n.toString();
}

function pct(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(2) + '%';
}

export default function StatePage({ params }: { params: { state: string } }) {
  const entry = findStateByCode(params.state);
  if (!entry) notFound();

  const data = loadStateFindings(entry.code);
  const isPublished = !!(data && data.status === 'published');
  const stateLower = entry.code.toLowerCase();

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <nav aria-label="breadcrumb" className="mb-4 text-sm text-gray-500">
          <a href="/states" className="hover:text-primary-600">
            States
          </a>
          <span className="mx-2">/</span>
          <span className="text-gray-900">{entry.name}</span>
        </nav>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          {entry.name} provider directory audit
        </h1>
        <p className="text-gray-600 mb-1">
          State-scoped view of the AINPI audit of the CMS National Provider Directory.
        </p>
        <p className="text-sm text-gray-500 mb-6 font-mono">
          NPD release {data?.release_date ?? '2026-04-09'}
          {' · '}methodology v{data?.methodology_version ?? '0.1.0-draft'}
          {data?.commit_sha && data.commit_sha !== 'pending' && (
            <>
              {' · '}commit <code>{data.commit_sha.slice(0, 7)}</code>
            </>
          )}
        </p>

        <AuthorByline
          lastReviewed={
            data?.generated_at ? data.generated_at.slice(0, 10) : '2026-04-29'
          }
        />

        {!isPublished && (
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
            <p className="font-medium mb-1">Pre-registration record.</p>
            <p>
              The methodology, denominators, and per-finding null hypotheses for{' '}
              {entry.name} are public on this page <em>before</em> the state-scoped numbers
              are computed. State numbers populate when{' '}
              <code className="text-xs bg-blue-100 px-1 py-0.5 rounded">
                analysis/state_findings.py {stateLower}
              </code>{' '}
              runs against the pinned NPD release. Pre-registration is the trust
              contract: methodology comes first, numbers follow.
            </p>
          </div>
        )}

        <section className="mt-8 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Why this page exists
          </h2>
          <p className="text-gray-800 leading-relaxed">
            On 2026-04-23 the Centers for Medicare &amp; Medicaid Services
            issued a letter to all 50 State Medicaid Directors requesting a
            comprehensive two-year provider revalidation strategy within 30
            days, citing 42 CFR §§ 431.107, 455.410, 455.414, 455.416, 455.21,
            and 455.450. The letter explicitly asks for &ldquo;links to any
            public-facing data or reporting&rdquo; that demonstrate ongoing
            verification of provider enrollment data. This page is one such
            artifact: a state-scoped, reproducible, source-cited slice of an
            independent audit of the federal NDH bulk export. Your state
            agency is welcome to cite it directly in its CMS response. See{' '}
            <a href="/methodology" className="underline">
              /methodology
            </a>{' '}
            for the full versioned methodology and audit trail.
          </p>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            {entry.name} program context
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-gray-500">Program</dt>
              <dd className="text-gray-900">{entry.medicaid_program_name}</dd>
            </div>
            <div>
              <dt className="text-gray-500">State agency</dt>
              <dd className="text-gray-900">{entry.agency}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Approximate enrollment</dt>
              <dd className="text-gray-900">{entry.enrollment_approx}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Managed care plans</dt>
              <dd className="text-gray-900">{entry.mcos.length} plans</dd>
            </div>
          </dl>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-primary-600 hover:underline">
              View MCOs
            </summary>
            <ul className="mt-2 list-disc list-inside text-gray-700 space-y-0.5">
              {entry.mcos.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </details>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            NDH resources tied to {entry.name}
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Counts of resources where the FHIR resource&apos;s service-address
            state equals <code>{entry.code}</code>. These are the state-level
            denominators against which the findings below are computed.
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">Practitioner</dt>
              <dd className="text-2xl font-mono text-gray-900">
                {fmt(data?.denominators.practitioner ?? null)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Organization</dt>
              <dd className="text-2xl font-mono text-gray-900">
                {fmt(data?.denominators.organization ?? null)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Location</dt>
              <dd className="text-2xl font-mono text-gray-900">
                {fmt(data?.denominators.location ?? null)}
              </dd>
            </div>
          </dl>
        </section>

        {data && data.findings && data.findings.length > 0 && (
          <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Findings, {entry.name} vs national
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Each row links to the published national finding for full
              methodology, null hypothesis, and audience implications.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-gray-500 border-b">
                  <tr>
                    <th className="py-2 pr-3">Finding</th>
                    <th className="py-2 pr-3">Hypotheses</th>
                    <th className="py-2 pr-3 text-right">{entry.code} rate</th>
                    <th className="py-2 pr-3 text-right">National</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.findings.map((f) => (
                    <tr key={f.slug} className="align-top">
                      <td className="py-3 pr-3">
                        <a
                          href={`/findings/${f.slug}`}
                          className="text-primary-600 hover:underline font-medium"
                        >
                          {f.title}
                        </a>
                        {!f.state_computable && f.not_computable_reason && (
                          <p className="mt-1 text-xs text-gray-500">
                            Not state-computable: {f.not_computable_reason}
                          </p>
                        )}
                        {f.state_computable && f.state_headline && (
                          <p className="mt-1 text-xs text-gray-700">{f.state_headline}</p>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-xs font-mono text-gray-500">
                        {f.hypotheses.join(', ')}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono">
                        {f.state_computable ? pct(f.state_pct) : (
                          <span className="text-gray-400">n/a</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono text-gray-600">
                        {pct(f.national_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {data && data.verify_samples && data.verify_samples.length > 0 && (
          <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Verify a sample yourself
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              The records below are concrete NPIs that AINPI flagged on this
              state&apos;s population. Each row links to the authoritative public
              NPPES NPI Registry so you can independently confirm the flag.
              Disagreement on any record can be filed as a{' '}
              <a
                href="https://github.com/FHIR-IQ/AINPI/issues/new/choose"
                target="_blank"
                rel="noopener"
                className="underline"
              >
                data quality bug
              </a>{' '}
              with a reproducible counter-example.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-gray-500 border-b">
                  <tr>
                    <th className="py-2 pr-3">NPI</th>
                    <th className="py-2 pr-3">Display name</th>
                    <th className="py-2 pr-3">Flag</th>
                    <th className="py-2 pr-3">Reason</th>
                    <th className="py-2 pr-3">Verify</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.verify_samples.map((s) => (
                    <tr key={s.npi}>
                      <td className="py-2 pr-3 font-mono">{s.npi}</td>
                      <td className="py-2 pr-3">{s.display_name}</td>
                      <td className="py-2 pr-3 text-xs">
                        <a href={`/findings/${s.flagged_by}`} className="underline">
                          {s.flagged_by}
                        </a>
                      </td>
                      <td className="py-2 pr-3 text-gray-700">{s.flag_reason}</td>
                      <td className="py-2 pr-3 text-xs">
                        <a
                          href={s.nppes_lookup_url}
                          target="_blank"
                          rel="noopener"
                          className="underline text-primary-600"
                        >
                          NPPES →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            How to cite this page in your CMS PR strategy response
          </h2>
          <p className="text-sm text-gray-700 mb-3">
            CMS&apos;s 2026-04-23 letter requests, in element 2: <em>&ldquo;The
            metrics you will use to measure the effectiveness and progress of
            your PR strategy, including links to any public-facing data or
            reporting.&rdquo;</em> Suggested citation language:
          </p>
          <blockquote className="border-l-4 border-primary-200 pl-4 italic text-gray-700 text-sm leading-relaxed">
            We have adopted the AINPI methodology framework (Vestel, FHIR IQ,
            v{data?.methodology_version ?? '0.1.0-draft'}) for ongoing
            verification of {entry.name} provider-directory data against the
            federal CMS National Provider Directory and NPPES. State-scoped
            findings are published at{' '}
            <code>https://ainpi.dev/states/{stateLower}</code>, with a versioned
            methodology and reproducible analysis code under Apache-2.0.
          </blockquote>
          <p className="mt-3 text-xs text-gray-500">
            See{' '}
            <a
              href="https://github.com/FHIR-IQ/AINPI/blob/main/CITATION.cff"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              CITATION.cff
            </a>{' '}
            for a Zotero / EndNote-importable form. Pin to a specific release
            tag for academic reproducibility.
          </p>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Methodology lineage
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-gray-500">NDH source</dt>
              <dd className="text-gray-900">
                <a
                  href="https://directory.cms.gov/"
                  target="_blank"
                  rel="noopener"
                  className="underline"
                >
                  CMS National Provider Directory
                </a>
                , release {data?.release_date ?? '2026-04-09'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">NPPES snapshot</dt>
              <dd className="text-gray-900">
                <code>bigquery-public-data.nppes.npi_raw</code>, dated 2026-02-09
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">NUCC taxonomy</dt>
              <dd className="text-gray-900">v17.0, January 2026 release</dd>
            </div>
            <div>
              <dt className="text-gray-500">CMS Medicare/NUCC crosswalk</dt>
              <dd className="text-gray-900">October 2025 release</dd>
            </div>
            <div>
              <dt className="text-gray-500">Methodology version</dt>
              <dd className="text-gray-900 font-mono">
                {data?.methodology_version ?? '0.1.0-draft'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Generated</dt>
              <dd className="text-gray-900 font-mono">
                {data?.generated_at ?? '—'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-800 mb-3">
            What this audit does NOT cover
          </h2>
          <ul className="list-disc list-inside space-y-1 text-sm text-amber-900">
            <li>
              <strong>Non-NPI providers.</strong> AINPI is NPI-keyed end-to-end.
              Atypical providers (e.g. personal-care assistants in some state
              programs) are out of scope. CMS&apos;s 2026-04-23 letter
              specifically calls these out as a population to address; a
              complementary state-roster join is required.
            </li>
            <li>
              <strong>CAQH credentialing data.</strong> Not in the NDH ingestion
              pipeline. See{' '}
              <a href="/insights" className="underline">
                /insights
              </a>{' '}
              for the full provenance discussion.
            </li>
            <li>
              <strong>Real-time attestation logs.</strong> NPD bulk files are
              periodic exports (current pinned release: {data?.release_date ?? '2026-04-09'}).
            </li>
            <li>
              <strong>Managed care plan internal directories.</strong> AINPI
              measures the federal NDH artifact only. Live MCO directory parity
              against the state FFS roster is a separate effort.
            </li>
            <li>
              <strong>Beneficiary or claims data.</strong> AINPI is provider-directory
              only. Nothing here implicates utilization, quality, or fraud
              evidence on individual providers.
            </li>
          </ul>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Correction protocol
          </h2>
          <p className="text-sm text-gray-700">
            If you can demonstrate that any number on this page is wrong with a
            reproducible counter-example, file a{' '}
            <a
              href="https://github.com/FHIR-IQ/AINPI/issues/new/choose"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              data quality bug issue
            </a>{' '}
            on GitHub. Confirmed corrections trigger a methodology version bump,
            an entry in the changelog, and a re-run of the affected JSON. The
            history is auditable in the public Git log.
          </p>
        </section>

        <footer className="mt-12 pt-8 border-t text-xs text-gray-500 space-y-1">
          <p className="font-mono">
            API:{' '}
            <a
              className="text-primary-600 hover:underline"
              href={`/api/v1/states/${stateLower}.json`}
            >
              /api/v1/states/{stateLower}.json
            </a>
          </p>
          <p>
            Related:{' '}
            <a href="/findings" className="underline">
              all findings
            </a>{' '}
            ·{' '}
            <a href="/methodology" className="underline">
              methodology
            </a>{' '}
            ·{' '}
            <a href="/states" className="underline">
              other states
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
