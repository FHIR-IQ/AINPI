/**
 * /for-state-medicaid/<state> — CMO-facing forwardable explainer.
 *
 * Built for the state Medicaid CMO listserve. Three-band layout
 * (per the audience-framing rule):
 *   1. Hero: count + action, the lede that earns interest.
 *   2. "What this is" + "What you can do today" — short, action-first.
 *   3. "Why this matters now" — anchors to the CMS State Medicaid
 *      Director letter (2026-04-23, response due 2026-05-23).
 *   4. Collapsed "For your technical team" — links to the
 *      methodology, findings, GitHub, and per-state JSON for
 *      the PI / MMIS / data team to pick up after a CMO forward.
 *
 * No H-numbers, no JSON references, no methodology version string in
 * the lede. Acronyms used: NPI, CMS, OIG, LEIE, NPPES, MMIS, PI, CMO.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Navbar from '@/components/Navbar';
import {
  ALL_STATE_NAMES,
  allStateCodes,
  findStateByCode,
} from '@/data/states';
import {
  loadStateClaimsAudit,
  loadStateCohort,
  loadStateFindings,
} from '@/lib/load-api-v1';

export const dynamic = 'force-static';

interface PageParams {
  params: { state: string };
}

export function generateStaticParams() {
  return allStateCodes().map((state) => ({ state }));
}

export function generateMetadata({ params }: PageParams): Metadata {
  const code = params.state.toUpperCase();
  const name = ALL_STATE_NAMES[code];
  if (!name) return { title: 'State not found · AINPI' };
  const cohort = loadStateCohort(code);
  const title = `${cohort.length} federally-excluded providers in ${name} · AINPI for state Medicaid`;
  const description = `${cohort.length} providers in ${name} are on a federal exclusion list today AND still appear in the federal provider directory. Free, public, citable for your 2026-05-23 SMD-letter response. Built for state Medicaid agencies.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://ainpi.dev/for-state-medicaid/${code.toLowerCase()}`,
      type: 'article',
    },
  };
}

export default function ForStateMedicaidPage({ params }: PageParams) {
  const code = params.state.toUpperCase();
  const state = findStateByCode(code);
  if (!state) notFound();

  const cohort = loadStateCohort(code);
  const cohortCount = cohort.length;
  const samples = cohort.slice(0, 3);

  const cohortCsvUrl = `/api/v1/states/${code.toLowerCase()}-cohort-critical.csv`;

  // Per-state directory-hygiene findings, surfaced in plain English for the
  // CMO audience. Pulled from the same state JSON that drives /states/<code>.
  const stateFindings = loadStateFindings(code);
  const orgDupeRow = stateFindings?.findings.find(
    (f) => f.slug === 'duplicate-detection',
  );
  const taxonomyRow = stateFindings?.findings.find(
    (f) => f.slug === 'npi-taxonomy-correctness',
  );

  // Per-state claims-side cross-audit. Every state has its own findings
  // now — H29 / H30a / H30b / H31 / H32 each ran against this state's
  // critical cohort and dropped per-state CSVs we read at build time.
  const claims = loadStateClaimsAudit(code);
  // Any state with ≥1 claims-side match anywhere shows the rich band.
  const hasClaimsData =
    claims.medicaid.full_window_matches > 0 ||
    claims.partb.full_window_matches > 0 ||
    claims.partd.full_window_matches > 0 ||
    claims.deactivated_billing.matches > 0 ||
    claims.industry_payments.full_window_matches > 0;
  const fmtUsd = (n: number) =>
    n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `$${(n / 1_000).toFixed(0)}K`
        : `$${n.toFixed(0)}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      {/* Band 1 — Hero (the lede that earns interest) */}
      <section className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-12 sm:py-16">
          <div className="text-xs font-bold tracking-wider uppercase text-blue-700 mb-3">
            AINPI · for state Medicaid agencies
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-gray-900 mb-6 leading-tight">
            <span className="text-blue-600 tabular-nums">{cohortCount}</span>{' '}
            federally-excluded providers in {state.name} are still listed in
            the federal provider directory today.
          </h1>
          <p className="text-lg text-gray-700 mb-6 leading-relaxed">
            Each one is currently on the OIG LEIE or SAM.gov exclusion list
            <em> and</em> still appears in the CMS National Directory of
            Healthcare. We have produced a per-provider file your
            Program-Integrity and MMIS teams can act on this week — with
            primary-source verification links on every row so nothing has
            to be taken on faith.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href={cohortCsvUrl}
              className="inline-flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold text-sm transition-colors"
            >
              Download the {state.name} file ({cohortCount} providers, CSV) →
            </a>
            <Link
              href="#how-to-use"
              className="inline-flex items-center gap-2 px-5 py-3 bg-white hover:bg-gray-50 text-blue-700 border border-blue-600 rounded-md font-semibold text-sm transition-colors"
            >
              How to use this
            </Link>
          </div>
        </div>
      </section>

      {/* Band 2 — What this is */}
      <section className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            What this is, in five sentences
          </h2>
          <ul className="space-y-4 text-gray-800 text-base leading-relaxed">
            <li className="flex gap-3">
              <span className="font-bold text-blue-600 shrink-0 w-6">1.</span>
              <span>
                <strong>AINPI is a free, public audit of the federal
                provider directory.</strong> We re-ingest every CMS bulk
                release (currently May 2026) and check what is in the
                federal directory against the federal exclusion and
                deactivation databases.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-blue-600 shrink-0 w-6">2.</span>
              <span>
                <strong>It was built for state Medicaid agencies.</strong>{' '}
                Specifically for the workflow CMS asked you to run in the
                2026-04-23 State Medicaid Director letter on comprehensive
                provider revalidation — and the response your team is
                writing by 2026-05-23.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-blue-600 shrink-0 w-6">3.</span>
              <span>
                <strong>We have already completed three of the four
                federal database checks</strong> the SMD letter asks
                each state to perform: NPPES, OIG LEIE, and SAM.gov.
                The fourth (SSA Death Master File) requires restricted
                access we do not have — but every state has access to
                it directly through SSA.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-blue-600 shrink-0 w-6">4.</span>
              <span>
                <strong>The output for {state.name} is the file above</strong>{' '}
                — {cohortCount} provider NPIs your state may be paying
                today through Medicaid, managed care, or the Medicaid
                directory, where the provider is on a current federal
                exclusion list. Each row carries verification URLs to
                LEIE, SAM, and the NPPES Registry so your PI staff can
                confirm any single case in under a minute.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-blue-600 shrink-0 w-6">5.</span>
              <span>
                <strong>This is a triage signal, not a fraud
                determination.</strong> The list is a starting point for
                your existing Program-Integrity and revalidation workflow,
                not a substitute for due process. Every row is verifiable
                against primary federal sources in one click.
              </span>
            </li>
          </ul>
        </div>
      </section>

      {/* Band 3 — What you can do today */}
      <section id="how-to-use" className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            What you can do today
          </h2>
          <p className="text-gray-600 mb-8">
            Three steps. Your PI team probably runs all three in the same
            week.
          </p>

          <ol className="space-y-6">
            <li className="flex gap-4">
              <span className="shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center">
                1
              </span>
              <div>
                <div className="font-semibold text-gray-900 mb-1">
                  Download the file
                </div>
                <p className="text-gray-700 text-sm mb-2">
                  <a
                    href={cohortCsvUrl}
                    className="text-blue-600 hover:underline font-mono text-xs"
                  >
                    ainpi.dev{cohortCsvUrl}
                  </a>
                </p>
                <p className="text-gray-700 text-sm">
                  Opens in Excel. {cohortCount} rows. Twelve columns
                  including LEIE exclusion date, SAM active date, NPPES
                  deactivation date, and one-click verification URLs to
                  the federal portals.
                </p>
              </div>
            </li>

            <li className="flex gap-4">
              <span className="shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center">
                2
              </span>
              <div>
                <div className="font-semibold text-gray-900 mb-1">
                  Hand it to your Program-Integrity or MMIS team
                </div>
                <p className="text-gray-700 text-sm">
                  Their existing workflow takes over from here:
                  verify each row against the federal portals (links on
                  the row), check whether your MMIS already has the
                  provider flagged, queue any unflagged matches for
                  revalidation or payment-suspension review. The
                  per-provider verification URLs mean no one has to take
                  AINPI&apos;s word for it — every flag is independently
                  checkable against the primary source.
                </p>
              </div>
            </li>

            <li className="flex gap-4">
              <span className="shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center">
                3
              </span>
              <div>
                <div className="font-semibold text-gray-900 mb-1">
                  Cite this in your SMD-letter response
                </div>
                <p className="text-gray-700 text-sm mb-2">
                  The CMS State Medicaid Director letter (2026-04-23,
                  response due <strong>2026-05-23</strong>) requires
                  states to demonstrate five elements of a comprehensive
                  provider-revalidation strategy. AINPI gives you the
                  &ldquo;public-facing data or reporting&rdquo; Element 2
                  asks for. Citation language ready to paste is at{' '}
                  <Link
                    href="/smd-revalidation"
                    className="text-blue-600 hover:underline"
                  >
                    ainpi.dev/smd-revalidation
                  </Link>
                  .
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* Sample-of-3 — credibility, primary-source verifiable */}
      {samples.length > 0 && (
        <section className="bg-gray-50 border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-6 sm:px-8 py-12">
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              Three rows from the {state.name} file you can verify in 30
              seconds
            </h2>
            <p className="text-gray-600 text-sm mb-6">
              Click any portal link. Confirm the same NPI shows as
              currently excluded on the federal source. This is the
              verification chain your PI team will run, but you can run
              it yourself in your browser right now.
            </p>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-xs uppercase tracking-wider text-gray-600">
                  <tr>
                    <th className="px-4 py-3 text-left">NPI</th>
                    <th className="px-4 py-3 text-left">Name (as in NPPES)</th>
                    <th className="px-4 py-3 text-left">On</th>
                    <th className="px-4 py-3 text-left">Effective date</th>
                    <th className="px-4 py-3 text-left">Verify</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {samples.map((r) => {
                    const sources = (r.reasons || '')
                      .split('|')
                      .filter(Boolean);
                    const onLeie = sources.includes('oig_excluded');
                    const onSam = sources.includes('sam_excluded');
                    const onNppes = sources.includes('nppes_deactivated');
                    const effective =
                      r.leie_excldate ||
                      r.sam_active_date ||
                      r.nppes_deactivation_date ||
                      '';
                    return (
                      <tr key={r.npi}>
                        <td className="px-4 py-3 font-mono text-xs text-gray-900">
                          {r.npi}
                        </td>
                        <td className="px-4 py-3 text-gray-900">{r.name}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {[
                            onLeie ? 'OIG LEIE' : null,
                            onSam ? 'SAM.gov' : null,
                            onNppes ? 'NPPES deactivated' : null,
                          ]
                            .filter(Boolean)
                            .join(' + ')}
                        </td>
                        <td className="px-4 py-3 text-gray-700 tabular-nums">
                          {effective}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="flex flex-wrap gap-2">
                            {onLeie && (
                              <a
                                href={r.leie_lookup_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                LEIE
                              </a>
                            )}
                            {onSam && (
                              <a
                                href={r.sam_lookup_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                SAM
                              </a>
                            )}
                            <a
                              href={r.nppes_lookup_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              NPPES
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Band 4 — Why this matters now */}
      <section className="bg-blue-50 border-b border-blue-100">
        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Why this matters now
          </h2>
          <p className="text-gray-800 mb-4 leading-relaxed">
            The CMS State Medicaid Director letter dated{' '}
            <strong>2026-04-23</strong> requires each state Medicaid
            agency to submit a comprehensive provider-revalidation
            strategy by <strong>2026-05-23</strong>. The letter is
            structured around five elements; the first four require
            checking enrolled providers against four federal databases:
          </p>
          <ul className="space-y-2 text-gray-800 mb-4 list-disc list-inside">
            <li>
              <strong>NPPES</strong> (national provider enumeration —
              currency and deactivation status)
            </li>
            <li>
              <strong>OIG LEIE</strong> (exclusion list)
            </li>
            <li>
              <strong>SAM.gov</strong> (federal exclusion / debarment
              system)
            </li>
            <li>
              <strong>SSA Death Master File</strong> (deceased-provider
              detection — restricted access; each state has its own
              channel)
            </li>
          </ul>
          <p className="text-gray-800 mb-4 leading-relaxed">
            AINPI has already completed the first three federal database
            checks for all states. For {state.name}, the output is the
            file above. Element 2 of the SMD letter asks for
            &ldquo;public-facing data or reporting&rdquo; — AINPI is
            that data, free, citable, and continuously refreshed against
            new federal releases.
          </p>
          <p className="text-gray-800 leading-relaxed">
            We have no contract requirement, no procurement process,
            and no AINPI-internal account creation. Your team downloads
            the file and runs their existing verification workflow.
          </p>
        </div>
      </section>

      {/* Band 4b — Cross-audit findings beyond the directory.
          Designed as citation-ready ammunition for Element 4 ("other
          comprehensive measures") of the SMD response. */}
      <section className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-12">
          <div className="text-xs font-bold tracking-wider uppercase text-emerald-700 mb-3">
            Cross-audit · ammunition for Element 4 of your SMD response
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            What the claims-side audit shows for {state.name}
          </h2>
          <p className="text-gray-700 mb-8 leading-relaxed">
            AINPI also cross-references {state.name}&apos;s{' '}
            {cohortCount} federally-excluded providers against five
            public federal claims and payment datasets: Medicaid
            spending (2018&ndash;2024), Medicare Part&nbsp;B billing
            (CY 2023), Medicare Part&nbsp;D prescribing with opioid
            metrics (CY 2023), Open Payments industry transfers (PY 2024),
            and NPPES deactivation status. Each finding below is
            citation-ready for the &ldquo;other comprehensive measures&rdquo;
            element of your CMS State Medicaid Director response.
            {!hasClaimsData && (
              <>
                {' '}
                {state.name} has zero matches across all five sources for
                its current critical-cohort &mdash; that&apos;s the
                strongest possible signal that the federal exclusion-
                revocation pipeline is working for your active cohort.
              </>
            )}
          </p>

          <div className="space-y-6">
            {/* Finding 1 — Medicaid spending */}
            <div className={`${claims.medicaid.strict_post_exclusion_matches === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'} border rounded-lg p-5`}>
              <div className={`text-xs font-bold uppercase tracking-wider ${claims.medicaid.strict_post_exclusion_matches === 0 ? 'text-emerald-800' : 'text-rose-800'} mb-2`}>
                {claims.medicaid.strict_post_exclusion_matches === 0 ? 'Working as designed' : 'Strict post-exclusion Medicaid payments'}
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Medicaid spending vs the federal exclusion list
              </h3>
              <p className="text-gray-700 text-sm leading-relaxed">
                <strong>
                  {claims.medicaid.strict_post_exclusion_matches} of{' '}
                  {claims.medicaid.full_window_matches}{' '}
                  matched {state.name} providers
                </strong>
                {' '}received Medicaid payment <em>strictly after</em>{' '}
                their LEIE or SAM exclusion took effect (
                {fmtUsd(claims.medicaid.strict_post_paid)} strict-post-
                exclusion, {fmtUsd(claims.medicaid.full_window_paid)}{' '}
                full-window 2018&ndash;2024 across all state Medicaid
                programs that paid the NPI). The HHS spending file has
                no state-of-payment column, so the full-window dollar
                figure aggregates payment from every state that paid
                the NPI; state attribution is by NPPES practice state.
                Detail file:{' '}
                <a
                  href={`/api/v1/states/${code.toLowerCase()}/h29-excluded-paid.csv`}
                  className="text-blue-600 hover:underline"
                >
                  h29-excluded-paid.csv
                </a>
                .
              </p>
            </div>

            {/* Finding 2 — Medicare Part B + Part D */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-2">
                Medicare Part B + Part D · CY 2023
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Federal Medicare billing by {state.name}&apos;s excluded cohort
              </h3>
              <p className="text-gray-700 text-sm leading-relaxed">
                <strong>
                  {claims.partb.full_window_matches} Part&nbsp;B billers
                </strong>{' '}
                ({fmtUsd(claims.partb.full_window_paid)} full-window;{' '}
                {claims.partb.strict_post_exclusion_matches} strictly
                post-exclusion at {fmtUsd(claims.partb.strict_post_paid)})
                and{' '}
                <strong>
                  {claims.partd.full_window_matches} Part&nbsp;D prescribers
                </strong>{' '}
                ({fmtUsd(claims.partd.full_window_drug_cost)} drug cost;{' '}
                {claims.partd.opioid_prescribers} opioid prescribers).
                Pre-exclusion billing reflects work the provider was
                authorized to do at the time; the strict-post-exclusion
                subset is the direct § 455.436 violation signal.
                {claims.partd.opioid_prescribers > 0 && (
                  <>
                    {' '}
                    Opioid-prescriber subset feeds directly into the DEA
                    Opioid Coordination queue under the 21st Century
                    Cures Act and 2018 SUPPORT Act.
                  </>
                )}
                {' '}Detail files:{' '}
                <a
                  href={`/api/v1/states/${code.toLowerCase()}/h30a-excluded-billing-partb.csv`}
                  className="text-blue-600 hover:underline"
                >
                  h30a Part&nbsp;B
                </a>
                {' '}·{' '}
                <a
                  href={`/api/v1/states/${code.toLowerCase()}/h30b-excluded-prescribing-partd.csv`}
                  className="text-blue-600 hover:underline"
                >
                  h30b Part&nbsp;D
                </a>
                .
              </p>
            </div>

            {/* Finding 3 — NPPES-deactivated × billing */}
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-rose-800 mb-2">
                MMIS reconciliation queue · closed identifiers
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                NPPES-deactivated NPIs in {state.name} still showing
                billing activity
              </h3>
              <p className="text-gray-700 text-sm leading-relaxed">
                <strong>
                  {claims.deactivated_billing.matches} NPPES-deactivated{' '}
                  {state.name}-state NPIs
                </strong>{' '}
                billed at least one public claims source strictly after
                their NPPES deactivation date.{' '}
                {claims.deactivated_billing.multi_source_matches > 0 && (
                  <>
                    <strong>
                      {claims.deactivated_billing.multi_source_matches}{' '}
                      of them appear in multiple sources
                    </strong>
                    {' '}(Medicaid + Medicare = stronger signal).{' '}
                  </>
                )}
                Post-deactivation totals: Medicaid{' '}
                {fmtUsd(claims.deactivated_billing.medicaid_post_deactivation_paid)},
                Medicare Part&nbsp;B{' '}
                {fmtUsd(claims.deactivated_billing.partb_post_deactivation_paid)},
                Medicare Part&nbsp;D{' '}
                {fmtUsd(claims.deactivated_billing.partd_post_deactivation_drug_cost)}{' '}
                drug cost. Each match is either a data-quality problem
                (NPI reused or misattributed) or evidence of work being
                done under a closed identifier &mdash; both are state PI
                triage flags. Detail file:{' '}
                <a
                  href={`/api/v1/states/${code.toLowerCase()}/h31-deactivated-paid.csv`}
                  className="text-blue-600 hover:underline"
                >
                  h31-deactivated-paid.csv
                </a>
                .
              </p>
            </div>

            {/* Finding 4 — Open Payments (Sunshine Act) */}
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-orange-800 mb-2">
                Sunshine Act surface · industry payments to excluded providers
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Federally excluded {state.name} providers receiving
                industry payments
              </h3>
              <p className="text-gray-700 text-sm leading-relaxed">
                <strong>
                  {claims.industry_payments.full_window_matches} federally-
                  excluded {state.name}-resident providers
                </strong>{' '}
                received pharmaceutical or device-manufacturer payments
                in Program Year 2024 (
                {fmtUsd(claims.industry_payments.full_window_paid)}{' '}
                full-window;{' '}
                {claims.industry_payments.strict_post_exclusion_matches}{' '}
                strictly post-exclusion at{' '}
                {fmtUsd(claims.industry_payments.strict_post_paid)}).
                The Sunshine Act surface is regulator territory for
                HHS-OIG, FDA, and DEA &mdash; but a state PI office
                citing this in a comprehensive-strategy submission is
                naming a real federal gap. Detail file:{' '}
                <a
                  href={`/api/v1/states/${code.toLowerCase()}/h32-excluded-industry-payments.csv`}
                  className="text-blue-600 hover:underline"
                >
                  h32-excluded-industry-payments.csv
                </a>
                .
              </p>
            </div>

            {/* Finding 5 — Federal directory hygiene context (per-state) */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-blue-800 mb-2">
                Directory hygiene context · for Element 3
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                The federal directory&apos;s coverage is excellent;
                currency is where the failures live
              </h3>
              <p className="text-gray-700 text-sm leading-relaxed">
                <strong>99.99984% of material Medicare Part&nbsp;B
                billers nationally are present in the federal
                directory</strong> (only 2 of 1.26M individual NPIs
                absent). What fails is <em>currency</em> &mdash; keeping
                deactivated and excluded providers <em>off</em> the list.
                {orgDupeRow && orgDupeRow.state_pct !== null && (
                  <>
                    {' '}
                    For {state.name} specifically: the organization-NPI
                    duplicate rate is{' '}
                    <strong className="tabular-nums">
                      {orgDupeRow.state_pct.toFixed(1)}%
                    </strong>
                    {' '}({orgDupeRow.state_numerator?.toLocaleString()}{' '}
                    of{' '}
                    {orgDupeRow.state_denominator?.toLocaleString()}{' '}
                    organization rows in {state.name}).
                  </>
                )}
                {taxonomyRow && taxonomyRow.state_pct !== null && (
                  <>
                    {' '}
                    NPI taxonomy correctness is{' '}
                    <strong className="tabular-nums">
                      {taxonomyRow.state_pct.toFixed(2)}%
                    </strong>
                    {' '}against the CMS Medicare crosswalk.
                  </>
                )}
              </p>
            </div>

            {/* Triage pattern (universal) */}
            <div className="bg-slate-100 border border-slate-300 rounded-lg p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Triage pattern · for your PI team
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Single-source flags are noise; multi-source flags
                converge on real cases
              </h3>
              <p className="text-gray-700 text-sm leading-relaxed">
                The strongest signals in {state.name}&apos;s cohort are
                the NPIs that appear in multiple files at once
                (exclusion list + Medicaid spending + Medicare
                Part&nbsp;B/D billing). AINPI produces the files; your
                PI team reads the multi-source matches first,
                single-source matches second. Pre-exclusion billing
                reflects work the provider was authorized to do at the
                time &mdash; the regulatorily significant subset is the
                strict-post-exclusion column in each file.
              </p>
            </div>
          </div>

          {/* Source / reproducibility note */}
          <div className="mt-8 pt-6 border-t border-gray-200 text-xs text-gray-500">
            All findings are reproducible from public federal sources.
            Methodology notes, source-release pinning, and the scripts
            that generate each file are in the AINPI{' '}
            <Link
              href="/findings"
              className="text-blue-600 hover:underline"
            >
              findings catalog
            </Link>
            . Citation language ready to paste for each element of the
            SMD response is at{' '}
            <Link
              href="/smd-revalidation"
              className="text-blue-600 hover:underline"
            >
              ainpi.dev/smd-revalidation
            </Link>
            .
          </div>
        </div>
      </section>

      {/* Band 5 — Cross-state context (so the CMO sees they're not alone) */}
      <section className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Other states
          </h2>
          <p className="text-gray-700 mb-6">
            AINPI runs this audit for every US state and DC.
            Each state&apos;s file is at{' '}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">
              ainpi.dev/for-state-medicaid/&lt;state&gt;
            </code>{' '}
            — for example,{' '}
            <Link
              href="/for-state-medicaid/va"
              className="text-blue-600 hover:underline"
            >
              Virginia
            </Link>
            ,{' '}
            <Link
              href="/for-state-medicaid/sc"
              className="text-blue-600 hover:underline"
            >
              South Carolina
            </Link>
            ,{' '}
            <Link
              href="/for-state-medicaid/pa"
              className="text-blue-600 hover:underline"
            >
              Pennsylvania
            </Link>
            ,{' '}
            <Link
              href="/for-state-medicaid/oh"
              className="text-blue-600 hover:underline"
            >
              Ohio
            </Link>
            ,{' '}
            <Link
              href="/for-state-medicaid/nc"
              className="text-blue-600 hover:underline"
            >
              North Carolina
            </Link>
            . The shape is identical state to state; only the file content
            differs.
          </p>
          <p className="text-gray-700 text-sm">
            Virginia has been the pilot state for this work; the
            Department of Medical Assistance Services (DMAS) shaped much
            of the format you see here.{' '}
            <Link
              href="/briefings/va"
              className="text-blue-600 hover:underline"
            >
              Read the Virginia briefing
            </Link>{' '}
            for the full deeper-dive version of what AINPI gives a state.
          </p>
        </div>
      </section>

      {/* Band 6 — Disclosure: for your technical team */}
      <section className="bg-gray-900 text-gray-200">
        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-12">
          <h2 className="text-xl font-bold text-white mb-2">
            For your technical team
          </h2>
          <p className="text-gray-400 text-sm mb-6">
            Pass these to the PI / MMIS / data team after a forward.
            None of this is required reading for the CMO version above.
          </p>
          <ul className="space-y-3 text-sm">
            <li>
              <Link
                href={`/states/${code.toLowerCase()}`}
                className="text-blue-300 hover:text-blue-200 hover:underline"
              >
                /states/{code.toLowerCase()}
              </Link>{' '}
              <span className="text-gray-400">
                — the state-scoped audit page: directory denominators,
                state-vs-national findings table, MCO landscape
                {state.medicaid_program_name ? `, ${state.medicaid_program_name} context` : ''}.
              </span>
            </li>
            <li>
              <Link
                href="/findings"
                className="text-blue-300 hover:text-blue-200 hover:underline"
              >
                /findings
              </Link>{' '}
              <span className="text-gray-400">
                — the full audit catalog. 30+ pre-registered findings
                with null hypothesis, denominator, source release,
                methodology version, and reproducibility script for each.
              </span>
            </li>
            <li>
              <Link
                href="/methodology"
                className="text-blue-300 hover:text-blue-200 hover:underline"
              >
                /methodology
              </Link>{' '}
              <span className="text-gray-400">
                — DAMA DMBOK mapping, L0–L7 data-quality scoring,
                reproducibility rules.
              </span>
            </li>
            <li>
              <Link
                href="/smd-revalidation"
                className="text-blue-300 hover:text-blue-200 hover:underline"
              >
                /smd-revalidation
              </Link>{' '}
              <span className="text-gray-400">
                — citation language ready to paste into your SMD-letter
                response, mapped to each of the five elements.
              </span>
            </li>
            <li>
              <a
                href={`https://ainpi.dev/api/v1/states/${code.toLowerCase()}.json`}
                className="text-blue-300 hover:text-blue-200 hover:underline font-mono text-xs"
              >
                /api/v1/states/{code.toLowerCase()}.json
              </a>{' '}
              <span className="text-gray-400">
                — programmatic per-state JSON for data-team consumption.
              </span>
            </li>
            <li>
              <a
                href="https://github.com/FHIR-IQ/AINPI"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-300 hover:text-blue-200 hover:underline"
              >
                github.com/FHIR-IQ/AINPI
              </a>{' '}
              <span className="text-gray-400">
                — every analysis script, every BigQuery extractor, the
                full audit code. AINPI is open-source.
              </span>
            </li>
          </ul>
        </div>
      </section>

      {/* Footer — who we are */}
      <section className="bg-gray-50">
        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-10 text-sm text-gray-600">
          <p className="mb-2">
            AINPI is produced by FHIR IQ. Built for state Medicaid
            agencies, shaped by direct work with the Virginia Department
            of Medical Assistance Services. Free, public, citable.
          </p>
          <p>
            Questions: reply to{' '}
            <a
              href="mailto:gene@fhiriq.com"
              className="text-blue-600 hover:underline"
            >
              gene@fhiriq.com
            </a>
            . We do not charge state Medicaid agencies for access, support,
            or per-state cohort builds.
          </p>
        </div>
      </section>
    </div>
  );
}
