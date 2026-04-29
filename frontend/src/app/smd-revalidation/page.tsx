import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import AuthorByline from '@/components/AuthorByline';
import { SEED_STATES } from '@/data/states';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Provider revalidation — citable methodology for state Medicaid agencies — AINPI',
  description:
    'How state Medicaid agencies can cite the AINPI methodology in their response to the 2026-04-23 CMS State Medicaid Director letter on provider revalidation strategies. Anchored in 42 CFR 455.436 and 455.450.',
  openGraph: {
    title: 'Provider revalidation — citable methodology for state Medicaid agencies',
    description:
      'How state Medicaid agencies can cite the AINPI methodology in their response to the 2026-04-23 CMS State Medicaid Director letter.',
    url: 'https://ainpi.dev/smd-revalidation',
    type: 'article',
  },
};

export default function SmdRevalidationPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 mb-2">
          Methodology brief · For state Medicaid agencies
        </p>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          Provider revalidation strategy — a citable open methodology
        </h1>
        <p className="text-lg text-gray-700 mb-2">
          State Medicaid Directors received a letter from CMS on 2026-04-23
          requesting a comprehensive two-year provider revalidation strategy
          within 30 days, with a 10-day notice gate for &ldquo;swift
          revalidation of high-risk providers.&rdquo; This page maps the
          AINPI methodology onto the five required strategy elements and
          provides citation language your team can use directly.
        </p>
        <p className="text-sm text-gray-500 mb-6 font-mono">
          Submission deadline: 30 days after receipt of letter ·
          Submit to: programintegrity@cms.hhs.gov
        </p>

        <AuthorByline lastReviewed="2026-04-29" />

        <section className="mt-8 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            What CMS asked for
          </h2>
          <p className="text-gray-800 mb-3">
            The letter, signed by Administrator Mehmet Oz, cites Title XIX of
            the Social Security Act §§{' '}
            <a
              href="https://www.ssa.gov/OP_Home/ssact/title19/1902.htm"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              1902(a)(4), 1902(a)(27), 1902(a)(77), 1902(a)(78), and 1902(kk)(4)
            </a>{' '}
            and the implementing regulations at{' '}
            <a
              href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-C/part-455/subpart-E"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              42 CFR §§ 431.107, 455.410, 455.414, 455.416, 455.21, and 455.450
            </a>
            . It asks each state to submit, within 30 days, a strategy
            covering five elements:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-800">
            <li>
              <strong>Methodology and timeline</strong> for off-cycle provider
              revalidation, with explicit focus on high-risk provider types
              under 42 CFR § 455.450 and on providers without an NPI.
            </li>
            <li>
              <strong>Metrics</strong> to measure effectiveness and progress —
              <em> including links to any public-facing data or reporting</em>.
            </li>
            <li>
              <strong>Ongoing accuracy verification</strong> approach for
              provider information.
            </li>
            <li>
              <strong>Consistency across FFS and managed care</strong>{' '}
              delivery systems, including oversight of MCO provider
              directories.
            </li>
            <li>
              <strong>Coordination</strong> with relevant law enforcement
              partners.
            </li>
          </ol>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            The regulatory anchor for ongoing verification
          </h2>
          <p className="text-gray-800 mb-3">
            The most concrete recurring obligation is in{' '}
            <a
              href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-C/part-455/subpart-E/section-455.436"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              42 CFR § 455.436 — Federal database checks
            </a>
            . State agencies must confirm provider identity and exclusion
            status against four federal databases:
          </p>
          <table className="w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="py-2 px-3">Database</th>
                <th className="py-2 px-3">Required cadence</th>
                <th className="py-2 px-3">AINPI today</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className="py-2 px-3">
                  <a
                    href="https://npiregistry.cms.hhs.gov/"
                    target="_blank"
                    rel="noopener"
                    className="underline"
                  >
                    NPPES (NPI registry)
                  </a>
                </td>
                <td className="py-2 px-3">At enrollment + reenrollment</td>
                <td className="py-2 px-3 text-green-700">
                  Yes — H10/H11/H13 join NDH against NPPES <code>npi_raw</code> snapshot,
                  matched switch-aware against all 15 taxonomy slots
                </td>
              </tr>
              <tr>
                <td className="py-2 px-3">
                  <a
                    href="https://oig.hhs.gov/exclusions/leie-database-supplement-downloads/"
                    target="_blank"
                    rel="noopener"
                    className="underline"
                  >
                    OIG LEIE (List of Excluded Individuals/Entities)
                  </a>
                </td>
                <td className="py-2 px-3">Monthly</td>
                <td className="py-2 px-3 text-amber-700">
                  Roadmap — see{' '}
                  <a
                    href="https://github.com/FHIR-IQ/AINPI/issues?q=is%3Aissue+label%3Aroadmap+leie"
                    target="_blank"
                    rel="noopener"
                    className="underline"
                  >
                    LEIE ingestion issue
                  </a>
                </td>
              </tr>
              <tr>
                <td className="py-2 px-3">
                  <a
                    href="https://sam.gov/content/exclusions"
                    target="_blank"
                    rel="noopener"
                    className="underline"
                  >
                    SAM.gov exclusions (formerly EPLS)
                  </a>
                </td>
                <td className="py-2 px-3">Monthly</td>
                <td className="py-2 px-3 text-amber-700">
                  Roadmap — same milestone as LEIE
                </td>
              </tr>
              <tr>
                <td className="py-2 px-3">
                  <a
                    href="https://www.ssa.gov/dataexchange/request_dmf.html"
                    target="_blank"
                    rel="noopener"
                    className="underline"
                  >
                    SSA Death Master File (DMF)
                  </a>
                </td>
                <td className="py-2 px-3">At enrollment + reenrollment</td>
                <td className="py-2 px-3 text-gray-600">
                  Out of scope — Limited Access DMF requires SSA certification;
                  the public file excludes deaths in the last 3 years
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-gray-500">
            42 CFR § 455.436 also permits the Secretary to prescribe additional
            databases. The CMS Preclusion List is{' '}
            <strong>not in this category and is not publicly downloadable</strong>
            {' '}— it is restricted to Medicare Advantage Part C plans and Part D
            sponsors. AINPI cannot ingest it. State agencies relying on
            Preclusion List signal must coordinate with their MCOs directly.
          </p>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            How AINPI maps onto the five required strategy elements
          </h2>
          <table className="w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="py-2 px-3 w-1/3">Strategy element</th>
                <th className="py-2 px-3">AINPI asset</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr className="align-top">
                <td className="py-3 px-3 font-medium">
                  1. Off-cycle revalidation methodology, high-risk + non-NPI focus
                </td>
                <td className="py-3 px-3 text-gray-700">
                  AINPI&apos;s <a href="/findings/npi-taxonomy-correctness" className="underline">H10/H13 findings</a>{' '}
                  produce a state-filterable cohort of NPIs that fail NPPES match
                  or specialty agreement. The{' '}
                  <a href="/findings/high-risk-cohort" className="underline">high-risk cohort finding</a>{' '}
                  combines this with NPPES deactivation, Luhn validity, and
                  endpoint liveness into a transparent composite score. Non-NPI
                  providers are explicitly out of scope and should be addressed
                  via state-roster join logic in your MMIS.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-3 px-3 font-medium">
                  2. Metrics with public-facing data or reporting
                </td>
                <td className="py-3 px-3 text-gray-700">
                  The static <code>/api/v1/findings/&lt;slug&gt;.json</code>{' '}
                  contract is itself the public-facing reporting layer. Each
                  finding carries <code>methodology_version</code>,{' '}
                  <code>commit_sha</code>, and <code>generated_at</code> for
                  audit. State-scoped slices live at{' '}
                  <a href="/states" className="underline">/states/&lt;state&gt;</a>.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-3 px-3 font-medium">
                  3. Ongoing accuracy verification
                </td>
                <td className="py-3 px-3 text-gray-700">
                  Findings refresh weekly via a GitHub Actions cron pinned to
                  the public NPD release. Pre-registration (null hypothesis +
                  denominator published before numbers) is the trust contract.
                  See{' '}
                  <a href="/methodology" className="underline">/methodology</a>.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-3 px-3 font-medium">
                  4. Consistency across FFS and managed care directories
                </td>
                <td className="py-3 px-3 text-gray-700">
                  AINPI&apos;s <a href="/provider-search" className="underline">
                    payer FHIR directory search
                  </a>{' '}
                  already queries live commercial payer directories
                  (Anthem/BCBS, UnitedHealth, Aetna, Cigna, Humana). The MCO
                  parity tool — currently in development — extends this to
                  compare a state FFS roster against its MCO directories. See{' '}
                  <a
                    href="https://github.com/FHIR-IQ/AINPI/issues?q=is%3Aissue+label%3Aroadmap+mco"
                    target="_blank"
                    rel="noopener"
                    className="underline"
                  >
                    the open issue
                  </a>{' '}
                  for status.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-3 px-3 font-medium">
                  5. Coordination with law enforcement
                </td>
                <td className="py-3 px-3 text-gray-700">
                  AINPI does not coordinate with law enforcement directly. The
                  high-risk cohort export (CSV of flagged NPIs with reason
                  codes) is the artifact a state PI unit hands to its MFCU or
                  state Attorney General&apos;s office. Coordination
                  governance is the state agency&apos;s responsibility.
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Worked example: Virginia
          </h2>
          <p className="text-gray-800 mb-3">
            Virginia&apos;s Department of Medical Assistance Services (DMAS)
            administers Cardinal Care, with approximately 1.8 million
            enrollees and six contracted managed care organizations. The
            state-scoped AINPI page at{' '}
            <a href="/states/va" className="underline font-medium">
              /states/va
            </a>{' '}
            re-runs the cleanly state-filterable subset of the AINPI hypothesis
            catalog against Virginia-resident NDH resources, with side-by-side
            national context and a verify-yourself sample of NPIs the
            DMAS Program Integrity team can hand to investigators.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            {SEED_STATES.map((s) => (
              <a
                key={s.code}
                href={`/states/${s.code.toLowerCase()}`}
                className="block bg-gray-50 hover:bg-gray-100 rounded p-3 text-sm border border-gray-200"
              >
                <p className="font-medium text-gray-900">{s.name}</p>
                <p className="text-xs text-gray-600 mt-0.5">
                  {s.medicaid_program_name}
                </p>
                <p className="text-xs text-primary-600 mt-1">
                  /states/{s.code.toLowerCase()} →
                </p>
              </a>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Want your state added? Email{' '}
            <a href="mailto:gene@fhiriq.com" className="underline">
              gene@fhiriq.com
            </a>{' '}
            with the state code, or run{' '}
            <code>analysis/state_findings.py</code> directly — the methodology
            is open under Apache-2.0.
          </p>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Citation language for your CMS response
          </h2>
          <p className="text-sm text-gray-700 mb-3">
            Suggested verbatim text for element 2 (metrics with public-facing
            data or reporting) of your state&apos;s strategy submission:
          </p>
          <blockquote className="border-l-4 border-primary-200 pl-4 italic text-gray-800 text-sm leading-relaxed">
            <p>
              For ongoing verification of provider-directory accuracy under 42
              CFR § 431.107 and § 455.436, [State agency] adopts the AINPI
              methodology framework (Vestel, FHIR IQ) — an open, versioned,
              reproducible audit of the federal CMS National Provider Directory
              and NPPES, distributed under Apache-2.0.
            </p>
            <p className="mt-2">
              State-scoped findings, including NPI/NPPES match rates, taxonomy
              consistency, organization deduplication, temporal staleness, and
              referential integrity for [State]&apos;s provider population, are
              published continuously at{' '}
              <code>https://ainpi.dev/states/&lt;state&gt;</code>. Underlying
              analysis code, methodology version, and audit trail are public at{' '}
              <code>https://github.com/FHIR-IQ/AINPI</code>.
            </p>
            <p className="mt-2">
              The framework is independent of any vendor and is cited by [State
              agency] as one input to a broader program-integrity strategy that
              includes monthly OIG LEIE and SAM.gov exclusion checks per 42 CFR
              § 455.436, MFCU coordination per 42 CFR § 1002, and managed care
              directory oversight per 42 CFR § 438.602.
            </p>
          </blockquote>
          <p className="mt-3 text-xs text-gray-500">
            Pin to a specific release tag (e.g.{' '}
            <code>github.com/FHIR-IQ/AINPI/releases/tag/v1.0.0</code>) for
            reproducibility under audit. See{' '}
            <a
              href="https://github.com/FHIR-IQ/AINPI/blob/main/CITATION.cff"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              CITATION.cff
            </a>{' '}
            for Zotero / EndNote import.
          </p>
        </section>

        <section className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-800 mb-3">
            Honest limitations
          </h2>
          <ul className="list-disc list-inside space-y-1 text-sm text-amber-900">
            <li>
              <strong>Non-NPI providers are not addressable</strong> through
              AINPI. Your strategy must explicitly describe how your MMIS
              identifies and revalidates atypical providers via name + address
              tuples.
            </li>
            <li>
              <strong>OIG LEIE and SAM.gov are not yet ingested</strong> by
              AINPI. Until they are, the high-risk cohort here uses
              NPPES-only signals; your team should run independent monthly
              checks against both per 42 CFR § 455.436.
            </li>
            <li>
              <strong>The CMS Preclusion List is not public</strong>. AINPI
              cannot help you measure exposure on it. MCOs in your state have
              direct access and should report monthly.
            </li>
            <li>
              <strong>SSA Death Master File access is restricted</strong>. The
              public DMF excludes deaths within the last three years. The
              full Limited Access DMF requires SSA certification, which is a
              state-by-state procurement effort.
            </li>
            <li>
              <strong>AINPI is provider-directory only</strong>. It does not
              ingest claims, beneficiary, utilization, or quality data. Nothing
              on this site implicates fraud evidence on individual providers —
              flags here are data-quality signals, not investigative findings.
            </li>
          </ul>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            For state agency staff
          </h2>
          <p className="text-sm text-gray-700">
            If your state agency is preparing its 30-day response and would
            like a state-scoped analysis run, a methodology walkthrough for
            your CMS response, or a custom MCO directory parity scan, contact{' '}
            <a
              href="mailto:gene@fhiriq.com"
              className="underline font-medium"
            >
              gene@fhiriq.com
            </a>
            . Open methodology stays free; bespoke implementation work is a
            separate engagement through{' '}
            <a
              href="https://fhiriq.com"
              target="_blank"
              rel="noopener"
              className="underline font-medium"
            >
              FHIR IQ
            </a>
            .
          </p>
        </section>

        <footer className="mt-12 pt-8 border-t text-xs text-gray-500 space-y-1">
          <p>
            Source documents:{' '}
            <a
              href="https://www.medicaid.gov/sites/default/files/2026-04/smd-provider-revalidation-strategy-2026-04-23.pdf"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              CMS State Medicaid Director letter, 2026-04-23
            </a>
            {' · '}
            <a
              href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-C/part-455/subpart-E"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              42 CFR Part 455 Subpart E
            </a>
            {' · '}
            <a href="/methodology" className="underline">
              AINPI methodology
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
