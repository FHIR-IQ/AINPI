import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import AuthorByline from '@/components/AuthorByline';
import {
  ARCHIVED_RELEASES,
  CURRENT_RELEASE,
  RETIRED_RELEASES,
} from '@/lib/release';

/** "a, b and c" from a list of release dates, oldest first. */
function listReleases(releases: readonly string[]): string {
  const asc = [...releases].sort();
  if (asc.length <= 1) return asc.join('');
  return `${asc.slice(0, -1).join(', ')} and ${asc[asc.length - 1]}`;
}

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'REAL Health Providers Act: an independent way to measure accuracy',
  description:
    'How AINPI maps to the verification, removal, and accuracy-scoring obligations of the Requiring Enhanced & Accurate Lists of Health Providers Act (HR 7148 § 6220). Public, reproducible, record-level cross-source verification for the 2028 compliance window and the 2029 machine-readable scoring requirement.',
  openGraph: {
    title: 'REAL Health Providers Act: an independent way to measure accuracy',
    description:
      'Record-level, cross-source provider directory verification mapped to the § 6220 obligations. Public methodology, machine-readable output.',
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
          Policy brief · For MA plans, payer ops, and commenters on CMS-4214-P
        </p>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          REAL Health Providers Act: measuring accuracy from outside the plan
        </h1>
        <p className="text-lg text-gray-700 mb-2">
          HR 7148 § 6220, the Requiring Enhanced and Accurate Lists of
          (REAL) Health Providers Act, was signed into law on 2026-02-03 as
          part of Public Law 119-75. From plan year 2028, network-based and
          certain private fee-for-service Medicare Advantage plans must
          verify each listed provider&apos;s directory information at least
          once every 90 days (up to 12 months for hospitals and other
          facilities the Secretary designates), remove a
          provider within 5 business days of determining it has left the
          network, and submit an annual accuracy analysis to HHS. For plan
          years beginning on or after January 1, 2029, HHS posts each
          plan&apos;s accuracy score in a machine-readable file on a CMS
          website, and the plan lists the score prominently on its own
          directory.
        </p>
        <p className="text-lg text-gray-700 mb-2">
          The hard part is not the cadence. It is the measurement
          methodology. A plan that checks its directory against its own
          records can confirm data that is wrong in both places; a check
          against outside sources can catch that. On 2026-10-16 CMS proposed
          a scoring method in{' '}
          <a href="https://www.federalregister.gov/public-inspection/2026-21420/medicare-program-implementation-of-sections-6219-6220-and-6224-of-the-consolidated-appropriations" target="_blank" rel="noopener" className="underline">
            CMS-4214-P
          </a>
          : a weighted score across directory elements, reported as a
          letter grade. Comments are due 2026-12-15. It is a proposal, not a
          final rule.
        </p>
        <p className="text-lg text-gray-700 mb-6">
          AINPI checks provider records against outside sources, one record at a
          time, and publishes the result so anyone can re-run it. Plans analyse
          their own directories; AINPI measures the public federal file, so
          its signals are an outside reference, not the plan&apos;s analysis.
          This page maps each § 6220 obligation except the enrollee
          cost-sharing protection, which AINPI has no signal for, to the
          closest AINPI signal, and provides citation language for comments
          on CMS-4214-P.
        </p>
        <p className="text-sm text-gray-500 mb-6 font-mono">
          Compliance window: plan year 2028 · Public scoring: plan year 2029
        </p>

        <AuthorByline lastReviewed="2026-10-18" />

        <section className="mt-8 bg-white border border-gray-200 p-6">
          <h2 className="eyebrow border-b border-gray-300 pb-2 mb-4 block">
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
                  &ldquo;Not less frequently than once every 90 days&rdquo; for
                  each provider listed. For &ldquo;a hospital or any other
                  facility determined appropriate by the Secretary,&rdquo; at
                  &ldquo;a lesser frequency specified by the Secretary but in
                  no case less frequently than once every 12 months.&rdquo; If
                  the plan cannot verify a provider, the directory must carry
                  &ldquo;an indication that the information of such provider
                  may not be up to date.&rdquo;
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Removal timeline</td>
                <td className="py-2 px-3 text-gray-700">
                  Remove a provider &ldquo;within 5 business days if the
                  organization determines that the provider is no longer a
                  provider participating in the network.&rdquo; The duty
                  attaches to the directory the plan must maintain &ldquo;on a
                  publicly available internet website.&rdquo;
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Directory information</td>
                <td className="py-2 px-3 text-gray-700">
                  &ldquo;Information enrollees may need to access covered
                  benefits,&rdquo; with eight elements named as examples
                  (&ldquo;such as&rdquo;): name, specialty, contact
                  information, primary office or facility addresses,
                  whether the provider is accepting new patients,
                  accommodations for people with disabilities, cultural and
                  linguistic capabilities, telehealth capabilities.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Annual accuracy analysis</td>
                <td className="py-2 px-3 text-gray-700">
                  From plan years beginning on or after January 1, 2028, an
                  annual analysis on a random sample of the directory. The
                  sample must include a random sample of each specialty with
                  a high inaccuracy rate &ldquo;as determined by the
                  Secretary&rdquo;; the statute says one such specialty
                  &ldquo;may be&rdquo; mental health or substance use disorder
                  treatment. The report to HHS includes an accuracy score
                  computed with a verification method HHS specifies.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">Public scoring (2029)</td>
                <td className="py-2 px-3 text-gray-700">
                  For plan years beginning on or after January 1, 2029, HHS
                  posts accuracy scores &ldquo;in a machine readable file, on
                  an internet website maintained by the Centers for Medicare
                  &amp; Medicaid Services,&rdquo; and each plan&apos;s score
                  is &ldquo;listed prominently on the plan&apos;s provider
                  directory.&rdquo;
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-2 px-3 font-medium">
                  Cost-sharing protection (2028)
                </td>
                <td className="py-2 px-3 text-gray-700">
                  If an enrollee receives a covered item or service from a
                  provider that is not in network but was listed in the
                  plan&apos;s directory on the date the appointment was made,
                  the enrollee pays no more than the in-network cost sharing. Plans must tell enrollees about
                  this protection before the annual election period (to the
                  extent practicable), in the directory, and in the first
                  explanation of benefits each plan year.
                </td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-3">
            Source: HR 7148 (119th Congress), Consolidated Appropriations
            Act, 2026, Public Law 119-75, Division J, Title II, § 6220,
            amending sections 1851, 1852 and 1857 of the Social Security Act.
            Quotations are from the enrolled bill text. Compliance begins plan
            year 2028. Public scoring begins with plan years on or after
            January 1, 2029.
          </p>
        </section>

        <section className="mt-6 bg-white border border-gray-200 p-6">
          <h2 className="eyebrow border-b border-gray-300 pb-2 mb-4 block">
            The measurement question
          </h2>
          <p className="text-gray-800 mb-3">
            § 6220 leaves the method to HHS. The Secretary &ldquo;shall
            specify plan verification methods, such as using telephonic
            verification or other approaches using data sources maintained by
            an MA organization or using publicly available data sets&rdquo;
            (SSA § 1857(e)(6)(B)(i)), and a scoring methodology that takes
            into account &ldquo;the administrative burden on plans and
            providers and the relative importance of certain provider
            directory information on enrollee ability to access care&rdquo;
            (§ 1857(e)(6)(B)(ii)).
          </p>
          <p className="text-gray-800 mb-3">
            What has happened so far, as checked on 2026-10-18. CMS and ONC
            held the public stakeholder meeting § 6220(c)(1) requires on
            2026-06-15, according to the proposed rule. On 2026-10-16 CMS
            issued{' '}
            <a href="https://www.federalregister.gov/public-inspection/2026-21420/medicare-program-implementation-of-sections-6219-6220-and-6224-of-the-consolidated-appropriations" target="_blank" rel="noopener" className="underline">
              CMS-4214-P
            </a>{' '}
            (file code CMS-4214-P, regulations.gov docket{' '}
            <a href="https://www.regulations.gov/commenton/CMS-2026-3533-0002" target="_blank" rel="noopener" className="underline">
              CMS-2026-3533
            </a>
            , comments due 5 p.m. EST on 2026-12-15; the Federal Register text
            prints the docket as CMS-2026-2533, which does not resolve on
            regulations.gov). It
            proposes verification methods (internal plan information,
            telephonic, e-mail, provider attestations, claims data, data
            sources maintained by CMS, and others CMS specifies; the preamble
            also proposes NPPES as one) and a weighted score: network
            participation 40%, specialty 10%, contact information 20%,
            office or facility address 20%, accepting new patients 3%,
            disability accommodations 3.5%, telehealth 3.5%, converted to a
            letter grade. For scoring, it would limit &ldquo;internal plan
            information&rdquo; to confirming network participation and
            specialty. The guidance to plans required by § 6220(c)(2) is due
            within 18 months of enactment (by 2027-08-03); none was found.
          </p>
          <p className="text-gray-800 mb-3">
            Three measurement paradigms are in play:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-800">
            <li>
              <strong>Field-level on plan-owned data.</strong> Count fields
              that the plan can confirm internally as correct. Easiest to
              implement. Cannot detect a plan&apos;s own data being wrong,
              because it is the plan&apos;s own definition of correct, so
              the score it yields is likely to run high.
            </li>
            <li>
              <strong>Phone-audit secret shopper.</strong> The method
              behind the Senate Finance Committee majority staff&apos;s{' '}
              <a
                href="https://www.finance.senate.gov/imo/media/doc/050323%20Ghost%20Network%20Hearing%20-%20Secret%20Shopper%20Study%20Report.pdf"
                target="_blank"
                rel="noopener"
                className="underline"
              >
                May 2023 study
              </a>
              , which called 120 mental health listings across 12 Medicare
              Advantage plans in 6 states and found &ldquo;more than
              80%&rdquo; were &ldquo;ghosts,&rdquo; meaning &ldquo;either
              unreachable, not accepting new patients, or not
              in-network.&rdquo; Appointments could be made for 18%.
              Catches real patient
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
            what the eight directory elements § 6220 names, taken together,
            most naturally map to.
          </p>
        </section>

        <section className="mt-6 bg-white border border-gray-200 p-6">
          <h2 className="eyebrow border-b border-gray-300 pb-2 mb-4 block">
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
                  AINPI ingests every public NDH release and computes
                  per-NPI delta. The warehouse holds {CURRENT_RELEASE}; the
                  archive keeps {listReleases(ARCHIVED_RELEASES)}
                  {RETIRED_RELEASES.length > 0
                    ? ` (${listReleases(RETIRED_RELEASES)} retired)`
                    : ''}
                  . The
                  in-development{' '}
                  <a href="/" className="underline">
                    landscape view
                  </a>{' '}
                  shows median{' '}
                  <code>meta.lastUpdated</code> age per state × specialty
                  cell. This is a proxy, not a compliance test: § 6220
                  requires the plan to verify its own directory, and the NDH
                  is not a plan directory. In the 2026-10-07 release every
                  practitioner record carries the same{' '}
                  <code>meta.lastUpdated</code> value (see{' '}
                  <a href="/findings/temporal-staleness" className="underline">
                    H18
                  </a>
                  ), so the proxy cannot yet separate records.
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
                  Directory-information completeness (8 named elements)
                </td>
                <td className="py-3 px-3 text-gray-700">
                  AINPI&apos;s{' '}
                  <a href="/findings/referential-integrity" className="underline">
                    H6-H8
                  </a>{' '}
                  and{' '}
                  <a href="/findings/npi-taxonomy-correctness" className="underline">
                    H9-H13
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
                  AINPI&apos;s pre-registered hypothesis catalog is
                  already a structured, reproducible accuracy analysis. Each
                  finding carries{' '}
                  <code>methodology_version</code>,{' '}
                  <code>commit_sha</code>,{' '}
                  <code>generated_at</code>, and a primary-source verify URL
                  per flagged NPI. The L0-L7 trust scoring framework documented
                  at <a href="/methodology" className="underline">/methodology</a>{' '}
                  decomposes the score into independently citable dimensions.
                </td>
              </tr>
              <tr className="align-top">
                <td className="py-3 px-3 font-medium">
                  High-inaccuracy specialty samples (MH / SUD may be one)
                </td>
                <td className="py-3 px-3 text-gray-700">
                  The H29-H36 claims-side cross-audit already filters by
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

        <section className="mt-6 bg-white border border-gray-200 p-6">
          <h2 className="eyebrow border-b border-gray-300 pb-2 mb-4 block">
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
                  All 8 directory elements § 6220 names present on the record
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
                  H1-H5 endpoint probe
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

        <section className="mt-6 bg-white border border-gray-200 p-6">
          <h2 className="eyebrow border-b border-gray-300 pb-2 mb-4 block">
            Citation language for comments on CMS-4214-P
          </h2>
          <p className="text-sm text-gray-700 mb-3">
            Suggested text for comments on the proposed accuracy scoring
            methodology (file code CMS-4214-P,{' '}
            <a href="https://www.regulations.gov/commenton/CMS-2026-3533-0002" target="_blank" rel="noopener" className="underline">
              docket CMS-2026-3533
            </a>
            , due 5 p.m. EST on 2026-12-15):
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

        <section className="mt-6 bg-white border border-gray-200 p-6">
          <h2 className="eyebrow border-b border-gray-300 pb-2 mb-4 block">
            For MA plan ops, regulators, and CMS-4214-P commenters
          </h2>
          <p className="text-sm text-gray-700">
            If you are preparing a comment on CMS-4214-P, building a plan accuracy program against
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
              href="https://www.congress.gov/bill/119th-congress/house-bill/7148"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              HR 7148 § 6220 (REAL Health Providers Act)
            </a>
            {' · '}
            <a
              href="https://www.congress.gov/119/bills/hr7148/BILLS-119hr7148enr.htm"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              Enrolled bill text
            </a>
            {' · '}
            <a
              href="https://www.federalregister.gov/public-inspection/2026-21420/medicare-program-implementation-of-sections-6219-6220-and-6224-of-the-consolidated-appropriations"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              CMS-4214-P proposed rule
            </a>
            {' · '}
            <a href="/methodology" className="underline">
              AINPI methodology
            </a>
            {' · '}
            <a href="/" className="underline">
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
