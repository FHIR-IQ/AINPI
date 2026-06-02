import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import AuthorByline from '@/components/AuthorByline';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'REAL Health Providers Act — independent audit substrate — AINPI',
  description:
    'How AINPI maps to the verification, removal, and accuracy-scoring obligations of the Requiring Enhanced & Accurate Lists of Health Providers Act (HR 7148 § 6220). Public, reproducible, record-level cross-source verification for the 2028 compliance window and the 2029 machine-readable scoring requirement.',
  openGraph: {
    title: 'REAL Health Providers Act — independent audit substrate',
    description:
      'Record-level, cross-source provider directory verification mapped to every § 6220 requirement. Public methodology, machine-readable output.',
    url: 'https://ainpi.dev/real-health-providers',
    type: 'article',
  },
};

export default function RealHealthProvidersPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 mb-2">
          Policy brief · For MA plans, payer ops, and the CMS scoring methodology RFC
        </p>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          REAL Health Providers Act — an independent audit substrate
        </h1>
        <p className="text-lg text-gray-700 mb-2">
          HR 7148 § 6220 — the Requiring Enhanced &amp; Accurate Lists of
          Health Providers Act — was signed into law on 2026-02-03. Medicare
          Advantage plans must verify every provider record every 90 days,
          remove departed providers within 5 business days, and submit an
          annual accuracy analysis to HHS. Starting with plan year 2029, CMS
          will publish each plan&apos;s accuracy score in a machine-readable
          format on cms.gov.
        </p>
        <p className="text-lg text-gray-700 mb-2">
          The hard part is not the cadence. It is the measurement methodology:
          a plan that grades its own homework can score itself 99% by counting
          field-level confirmations against its own data. A plan measured
          against external ground truth scores very differently. CMS has not
          yet defined which approach the 2029 published score will use.
        </p>
        <p className="text-lg text-gray-700 mb-6">
          AINPI is a public, reproducible, record-level cross-source verification
          substrate for the exact decomposed metrics § 6220 requires. This page
          maps each obligation to the existing AINPI signal that measures it,
          and provides citation language for plans and submitters to the 2028
          rulemaking.
        </p>
        <p className="text-sm text-gray-500 mb-6 font-mono">
          Compliance window: plan year 2028 · Public scoring: plan year 2029
        </p>

        <AuthorByline lastReviewed="2026-06-02" />

        <section className="mt-8 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            What § 6220 actually requires
          </h2>
          <table className="w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="py-2 px-3">Obligation</th>
                <th className="py-2 px-3">Specifics</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Verification cadence</td>
                <td className="py-2 px-3 text-gray-700">
                  Every 90 days for individual providers. Every 12 months for
                  hospitals and facilities. Unverified providers must be
                  explicitly flagged in the directory.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Removal timeline</td>
                <td className="py-2 px-3 text-gray-700">
                  Within 5 business days of determining a provider is no longer
                  in network. Applies to both online and printed directories.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Required fields</td>
                <td className="py-2 px-3 text-gray-700">
                  Name, specialty, contact information, primary
                  office/facility address, new-patient acceptance, disability
                  accommodations, cultural and linguistic capabilities,
                  telehealth capabilities.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Annual accuracy analysis</td>
                <td className="py-2 px-3 text-gray-700">
                  Random sample of providers. Oversampling of high-error
                  specialties (mental health, substance use disorder). Findings
                  and accuracy score reported to HHS.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Public scoring (2029)</td>
                <td className="py-2 px-3 text-gray-700">
                  Each plan&apos;s accuracy score must be displayed prominently
                  in its directory. HHS will publish scores in
                  machine-readable format on cms.gov.
                </td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-3">
            Source: HR 7148, Consolidated Appropriations Act 2026 § 6220.
            Compliance begins plan year 2028. Public scoring begins plan year
            2029.
          </p>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            The unresolved measurement question
          </h2>
          <p className="text-gray-800 mb-3">
            CMS has not yet defined how the 2029 published accuracy score is
            calculated. Three measurement paradigms compete:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-800">
            <li>
              <strong>Field-level on plan-owned data.</strong> Count fields
              that the plan can confirm internally as correct. Easiest to
              implement; produces scores in the high-90s. Cannot detect a
              plan&apos;s own data being wrong because it is the plan&apos;s
              own definition of correct.
            </li>
            <li>
              <strong>Phone-audit secret shopper.</strong> The methodology
              behind the Senate Finance Committee&apos;s May 2023 finding of
              80%+ ghost networks in mental health. Catches real patient
              access failures but creates administrative burden, scales
              poorly, and lags reality by months.
            </li>
            <li>
              <strong>Cross-source intersection.</strong> Provider-owned
              reality (NPPES, PECOS, provider-attested location and
              availability) joined to payer-owned reality (active contract,
              effective dates, claims observation). Scored at record level
              against independent sources of truth.
            </li>
          </ol>
          <p className="text-gray-800 mt-3">
            Decomposed cross-source scoring is the only approach a plan
            cannot grade itself on. It is what AINPI implements. It is also
            what § 6220&apos;s eight required fields — taken together — most
            naturally map to.
          </p>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            How AINPI maps to each obligation
          </h2>
          <table className="w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="py-2 px-3 w-1/3">§ 6220 obligation</th>
                <th className="py-2 px-3">AINPI signal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr className="align-top">
                <td className="py-3 px-3 font-medium">
                  90-day verification cadence
                </td>
                <td className="py-3 px-3 text-gray-700">
                  AINPI ingests every public NDH release (2026-04-09 and
                  2026-05-08 archived to date) and computes per-NPI delta. The
                  in-development{' '}
                  <a href="/landscape" className="underline">
                    landscape view
                  </a>{' '}
                  shows median{' '}
                  <code>meta.lastUpdated</code> age per state × specialty
                  cell. A plan whose median freshness exceeds 90 days fails the
                  cadence test independently of its own attestation.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-3 px-3 font-medium">
                  5 business day removal
                </td>
                <td className="py-3 px-3 text-gray-700">
                  Per-NPI history view (in development) cross-references each
                  practitioner across NDH releases. NPIs disappearing from
                  one source while persisting in a plan&apos;s directory are
                  the audit signal. The{' '}
                  <a href="/findings/temporal-staleness" className="underline">
                    H18 temporal-staleness finding
                  </a>{' '}
                  is the public methodology.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-3 px-3 font-medium">
                  Required-field completeness (8 fields)
                </td>
                <td className="py-3 px-3 text-gray-700">
                  AINPI&apos;s{' '}
                  <a href="/findings/referential-integrity" className="underline">
                    H6–H8
                  </a>{' '}
                  and{' '}
                  <a href="/findings/npi-taxonomy-correctness" className="underline">
                    H9–H13
                  </a>{' '}
                  measure presence and validity of name, NPI, specialty
                  taxonomy, and address fields. New-patient acceptance, ADA
                  accommodations, cultural / linguistic, and telehealth fields
                  are scoped into the landscape&apos;s Completeness layer.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-3 px-3 font-medium">
                  Annual accuracy analysis
                </td>
                <td className="py-3 px-3 text-gray-700">
                  AINPI&apos;s pre-registered H1–H42 hypothesis catalog is
                  already a structured, reproducible accuracy analysis. Each
                  finding carries{' '}
                  <code>methodology_version</code>,{' '}
                  <code>commit_sha</code>,{' '}
                  <code>generated_at</code>, and a primary-source verify URL
                  per flagged NPI. The L0–L7 trust scoring framework documented
                  at <a href="/methodology" className="underline">/methodology</a>{' '}
                  decomposes the score into independently citable dimensions.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-3 px-3 font-medium">
                  MH / SUD oversampling
                </td>
                <td className="py-3 px-3 text-gray-700">
                  The H29–H36 claims-side cross-audit already filters by
                  taxonomy. Mental-health and SUD specialties can be sliced
                  cleanly from the same pipeline; the existing per-state
                  audit slice generator (<code>analysis/state_findings.py</code>)
                  is the template.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-3 px-3 font-medium">
                  Machine-readable score format (2029)
                </td>
                <td className="py-3 px-3 text-gray-700">
                  The public{' '}
                  <a href="/developer" className="underline">
                    /api/v1
                  </a>{' '}
                  contract is already machine-readable. Each finding is a
                  typed JSON file with stable URLs that downstream consumers
                  (regulators, plans, researchers) can pin to a specific
                  release tag for reproducibility under audit.
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Six decomposed dimensions
          </h2>
          <p className="text-gray-800 mb-3">
            A single accuracy percentage is not auditable. AINPI publishes six
            independently citable dimensions, each backed by a primary source.
            A plan can be strong on one and weak on another; both signals
            matter to CMS, the patient, and the regulator.
          </p>
          <table className="w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="py-2 px-3">Dimension</th>
                <th className="py-2 px-3">What it measures</th>
                <th className="py-2 px-3">Primary source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Completeness</td>
                <td className="py-2 px-3 text-gray-700">
                  All 8 required fields present on the record
                </td>
                <td className="py-2 px-3 text-gray-600">NDH bulk file</td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Correctness</td>
                <td className="py-2 px-3 text-gray-700">
                  Field values agree across NPPES, PECOS, NDH, and payer FHIR
                  directories
                </td>
                <td className="py-2 px-3 text-gray-600">
                  NPPES, PECOS, payer FHIR
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Currency</td>
                <td className="py-2 px-3 text-gray-700">
                  Days since the record was last updated by its publisher
                </td>
                <td className="py-2 px-3 text-gray-600">
                  <code>meta.lastUpdated</code>
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Reachability</td>
                <td className="py-2 px-3 text-gray-700">
                  Whether the managing organization&apos;s FHIR endpoint
                  actually responds
                </td>
                <td className="py-2 px-3 text-gray-600">
                  H1–H5 endpoint probe
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Integrity</td>
                <td className="py-2 px-3 text-gray-700">
                  Record is not flagged by federal exclusion databases
                </td>
                <td className="py-2 px-3 text-gray-600">
                  OIG LEIE, SAM.gov, NPPES deactivation
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Exposure</td>
                <td className="py-2 px-3 text-gray-700">
                  Record does not leak PII patterns (SSN, etc.) that should
                  not appear in a directory record
                </td>
                <td className="py-2 px-3 text-gray-600">
                  H27 PII exposure scan
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-gray-500">
            Each dimension is computed at record level, not field level. A
            plan that scores 99% on Completeness but 60% on Correctness is
            describing a different failure mode than one with the reverse,
            and both deserve to be visible in the public score.
          </p>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Citation language for the 2028 scoring methodology RFC
          </h2>
          <p className="text-sm text-gray-700 mb-3">
            Suggested verbatim text for CMS / HHS rulemaking submissions on
            how the public accuracy score should be computed:
          </p>
          <blockquote className="border-l-4 border-primary-200 pl-4 italic text-gray-800 text-sm leading-relaxed">
            <p>
              The published plan accuracy score required under HR 7148 § 6220
              should be computed at record level against external sources of
              truth, not at field level against plan-owned data, and should
              be decomposed into independently citable dimensions
              (completeness, cross-source correctness, currency, reachability,
              integrity, exposure) rather than collapsed to a single percentage.
            </p>
            <p className="mt-2">
              The open AINPI methodology framework (Vestel, FHIR IQ), distributed
              under Apache-2.0, implements record-level cross-source verification
              of the federal CMS National Provider Directory against NPPES,
              PECOS, OIG LEIE, SAM.gov, and live payer FHIR directories. It
              produces typed, versioned JSON with primary-source verify URLs
              per record at{' '}
              <code>https://ainpi.dev/api/v1/findings/&lt;slug&gt;.json</code>.
            </p>
            <p className="mt-2">
              The framework is independent of any plan or vendor and is offered
              as a reference implementation for the 2029 public scoring
              requirement. Underlying code, methodology version, and audit
              trail are public at{' '}
              <code>https://github.com/FHIR-IQ/AINPI</code>.
            </p>
          </blockquote>
          <p className="mt-3 text-xs text-gray-500">
            Pin to a specific release tag (e.g.{' '}
            <code>github.com/FHIR-IQ/AINPI/releases/tag/v1.0.0</code>) for
            reproducibility under audit.
          </p>
        </section>

        <section className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-800 mb-3">
            Honest limitations
          </h2>
          <ul className="list-disc list-inside space-y-1 text-sm text-amber-900">
            <li>
              <strong>AINPI is provider-directory only.</strong> It does not
              measure bookability or patient access outcomes directly. Phone
              audit, CAHPS access data, and appointment-wait-time telemetry
              remain complementary inputs to a complete patient-centric
              accuracy framework.
            </li>
            <li>
              <strong>Cross-source agreement requires a published source.</strong>{' '}
              Plans that maintain proprietary roster data not exposed in NPPES,
              PECOS, or a public FHIR endpoint cannot be cross-checked by any
              third party. The first lever for accuracy is provider-sourced
              data published in interoperable form.
            </li>
            <li>
              <strong>SSA Death Master File is not yet ingested.</strong>{' '}
              The Limited Access DMF requires SSA certification; AINPI
              currently relies on NPPES deactivation as a proxy.
            </li>
            <li>
              <strong>The CMS Preclusion List is not public.</strong> AINPI
              cannot measure exposure on it. MA plans have direct access and
              should report monthly.
            </li>
            <li>
              <strong>Flags here are data-quality signals, not investigative
              findings.</strong> Nothing on this site implicates fraud
              evidence on individual providers. A SAM.gov match on an NPI
              field requires NPPES name-match verification before any audit
              referral, per the 2026-05-22 H40 worked example.
            </li>
          </ul>
        </section>

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            For MA plan ops, regulators, and CMS scoring methodology
            submitters
          </h2>
          <p className="text-sm text-gray-700">
            If you are preparing a comment for the 2028 CMS scoring
            methodology rulemaking, building a plan accuracy program against
            § 6220, or need a state-scoped or plan-scoped accuracy slice run
            against an open methodology, contact{' '}
            <a href="mailto:gene@fhiriq.com" className="underline font-medium">
              gene@fhiriq.com
            </a>
            . The methodology stays free under Apache-2.0; bespoke
            implementation work is a separate engagement through{' '}
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
              href="https://www.congress.gov/bill/118th-congress/house-bill/7148"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              HR 7148 § 6220 (REAL Health Providers Act)
            </a>
            {' · '}
            <a href="/methodology" className="underline">
              AINPI methodology
            </a>
            {' · '}
            <a href="/landscape" className="underline">
              Provider data landscape
            </a>
            {' · '}
            <a href="/smd-revalidation" className="underline">
              State Medicaid revalidation companion brief
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
