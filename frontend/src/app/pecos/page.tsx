import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'PECOS as authoritative source — AINPI',
  description:
    'CMS designated PECOS as authoritative for Medicare enrollment under the 2026 verification rules. State Medicaid systems must demonstrate alignment. AINPI surfaces the three classes of misalignment: taxonomy code disagreement, stale practice locations, and ownership disclosure currency.',
  openGraph: {
    title: 'PECOS as authoritative source — what the 2026 verification rules mean for your record',
    description:
      'Taxonomy code disagreement, stale practice locations, and ownership-disclosure currency under CMS\'s 2026 verification rules.',
    url: 'https://ainpi.dev/pecos',
    type: 'article',
  },
};

export default function PecosPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Hero */}
        <div className="mb-10">
          <div className="text-xs font-bold uppercase tracking-wider text-blue-700 mb-3">
            AINPI · PECOS workstream · 2026-05-18 release
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4 leading-tight">
            CMS designated PECOS as authoritative for Medicare enrollment.
            Most providers have never actually looked at what is in their
            record.
          </h1>
          <p className="text-lg text-slate-700 leading-relaxed mb-6">
            That matters now in a way it didn&apos;t before. Under the 2026
            verification rules, state Medicaid systems must demonstrate
            alignment with PECOS records. The window between &ldquo;we
            found a discrepancy&rdquo; and &ldquo;your enrollment is
            affected&rdquo; is a lot shorter than it used to be.
          </p>

          {/* Headline numbers from H37/H38/H39 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-rose-50 border border-rose-200 rounded-md p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-800">
                PECOS-NPPES taxonomy mismatch (H37)
              </div>
              <div className="text-3xl font-bold tabular-nums text-rose-700">
                508,064
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                27.31% of 1.86M comparable Medicare-enrolled NPIs
              </div>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-md p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-orange-800">
                Behavioral-health subset (H38)
              </div>
              <div className="text-3xl font-bold tabular-nums text-orange-700">
                44,875
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                30.38% of 147K BH providers · highest recoupment risk
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                Multi-state PECOS records (H39)
              </div>
              <div className="text-3xl font-bold tabular-nums text-amber-700">
                255,700
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                NPIs enrolled in ≥2 US states · 10.0% of 2.56M NPIs
              </div>
            </div>
          </div>
        </div>

        {/* Three misalignment classes */}
        <section className="space-y-5 mb-12">
          <h2 className="text-2xl font-bold text-slate-900">
            Three classes of misalignment that matter
          </h2>

          <div className="bg-rose-50 border border-rose-200 rounded-lg p-6">
            <div className="text-xs font-bold uppercase tracking-wider text-rose-800 mb-2">
              1 · Taxonomy code · highest-recoupment risk
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">
              Wrong taxonomy doesn&apos;t generate a soft warning. It
              generates a denial.
            </h3>
            <p className="text-slate-700 leading-relaxed mb-3">
              Your taxonomy code tells payers exactly what type of services
              you&apos;re billing for. In behavioral health especially,
              the wrong code triggers automatic rejection — not a
              flag-and-investigate. Depending on how long the wrong code
              has been in your record, you&apos;re looking at a recoupment
              conversation that covers the entire period it was wrong.
            </p>
            <p className="text-slate-700 leading-relaxed">
              PECOS records don&apos;t update themselves. If you changed
              credentialing, switched specialties, or moved from W2 to
              private practice without filing a CMS-855B/I refile, your
              PECOS taxonomy probably reflects the old you.
            </p>
            <div className="mt-4 text-sm">
              <strong className="text-slate-900">AINPI finding:</strong>{' '}
              <Link
                href="/findings/pecos-taxonomy-disagreement"
                className="text-blue-700 hover:underline"
              >
                H37 — PECOS PROVIDER_TYPE vs NPPES NUCC taxonomy
                disagreement
              </Link>
              {' · '}
              <Link
                href="/findings/pecos-behavioral-health-taxonomy"
                className="text-blue-700 hover:underline"
              >
                H38 — behavioral-health subset (highest recoupment cohort)
              </Link>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-2">
              2 · Practice location currency · the stale-record problem
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">
              Partnership moves, retirements, and group splits don&apos;t
              auto-update PECOS.
            </h3>
            <p className="text-slate-700 leading-relaxed mb-3">
              The PPEF (CMS Public Provider Enrollment Extract) has
              ~2.98M enrollment records but only ~2.47M individual NPIs.
              That means roughly half a million NPIs have multiple
              enrollment records. Most are legitimate — telehealth,
              multi-state practice, hospital + private practice. But a
              meaningful subset have CONFLICTING state addresses that
              signal a stale record: a partnership move never refiled,
              a retirement never closed, a group-practice split where one
              half kept the legacy enrollment alive.
            </p>
            <p className="text-slate-700 leading-relaxed">
              Under the new authoritative-source rule, if state Medicaid
              runs a verification check and your PECOS record points to an
              address you haven&apos;t practiced from in three years, that
              record might win.
            </p>
            <div className="mt-4 text-sm">
              <strong className="text-slate-900">AINPI finding:</strong>{' '}
              <Link
                href="/findings/pecos-multi-enrollment-state-mismatch"
                className="text-blue-700 hover:underline"
              >
                H39 — multi-enrollment NPIs with conflicting state
                addresses
              </Link>
            </div>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
            <div className="text-xs font-bold uppercase tracking-wider text-purple-800 mb-2">
              3 · Ownership disclosure currency
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">
              Disclosures that were never updated after a partnership
              change.
            </h3>
            <p className="text-slate-700 leading-relaxed mb-3">
              The 2023 CMS Disclosure of Ownership and Additional
              Disclosable Parties IFR requires ownership disclosures be
              kept current. AINPI&apos;s H35 Stage B audit already
              cross-walks the CMS Quarterly All Owners files against
              federal exclusion lists via the PPEF
              ASSOCIATE_ID → NPI cross-walk; the PECOS-currency lens
              extends that to &ldquo;ownership disclosure was last
              updated when.&rdquo;
            </p>
            <p className="text-slate-700 leading-relaxed">
              If you bought into or out of a practice partnership and the
              disclosure update never made it back to CMS, your ownership
              record is now a flag waiting to happen.
            </p>
            <div className="mt-4 text-sm">
              <strong className="text-slate-900">AINPI finding:</strong>{' '}
              <Link
                href="/findings/nh-hospice-hh-ownership-flags"
                className="text-blue-700 hover:underline"
              >
                H35 — SNF / hospice / HHA / hospital owners on federal
                exclusion lists (PPEF-cross-walked)
              </Link>
            </div>
          </div>
        </section>

        {/* What to do */}
        <section className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            What to do this week
          </h2>
          <ol className="space-y-4 text-slate-800">
            <li className="flex gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center">
                1
              </span>
              <div>
                <strong>Look at your PECOS record.</strong> The
                authoritative-source rule presumes you have. Log in to{' '}
                <a
                  href="https://pecos.cms.hhs.gov/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 hover:underline"
                >
                  pecos.cms.hhs.gov
                </a>{' '}
                and compare PROVIDER_TYPE / NUCC taxonomy / practice
                location to what you actually do today.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center">
                2
              </span>
              <div>
                <strong>
                  If you&apos;re a behavioral-health provider, do this
                  first.
                </strong>{' '}
                Behavioral-health wrong-taxonomy is the highest-recoupment
                category. The denial is automatic, the recoupment covers
                the full window the wrong code was in place.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center">
                3
              </span>
              <div>
                <strong>
                  If you moved or split a partnership, close the old
                  enrollment.
                </strong>{' '}
                A CMS-855B/I refile or termination submission is trivial
                relative to the cost of an active-but-stale record winning
                a verification check.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center">
                4
              </span>
              <div>
                <strong>
                  If you operate a group practice, audit the roster.
                </strong>{' '}
                AINPI&apos;s per-state CSVs (forthcoming when H37–H39
                ship) will list NPIs in your state with PECOS misalignment
                so you can triage before payer audits catch them.
              </div>
            </li>
          </ol>
        </section>

        {/* For state Medicaid offices */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">
            For state Medicaid agencies
          </h2>
          <p className="text-slate-700 mb-4 leading-relaxed">
            The 2026-04-23 CMS State Medicaid Director letter Element 3
            requires using federal database information in revalidation.
            The 2026 PECOS authoritative-source rule sharpens what that
            means in practice. AINPI&apos;s H37 / H38 / H39 work will
            publish:
          </p>
          <ul className="list-disc list-inside text-slate-700 space-y-1 mb-4">
            <li>Per-state CSV of NPIs with PECOS-NPPES taxonomy mismatch</li>
            <li>
              Behavioral-health subset (highest-recoupment risk, smallest
              cohort, easiest to triage)
            </li>
            <li>Per-state CSV of NPIs with conflicting multi-state enrollments</li>
          </ul>
          <p className="text-slate-700 leading-relaxed">
            Same shape as the existing{' '}
            <Link href="/for-state-medicaid/va" className="text-blue-700 hover:underline">
              /for-state-medicaid/&lt;state&gt;
            </Link>{' '}
            CMO-facing pages. The PECOS workstream slots in as the next
            layer of ammunition for SMD-letter Element 4
            (&ldquo;other comprehensive measures&rdquo;).
          </p>
        </section>

        {/* Pre-registration */}
        <section className="border border-slate-200 rounded-lg p-6 bg-white mb-12">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Pre-registration status
          </div>
          <p className="text-sm text-slate-700 mb-3">
            H37, H38, and H39 are pre-registered with their null
            hypotheses, denominators, and data sources fixed before
            computation. The PPEF file (~321 MB) is already on disk for
            the H35 Stage B work; no new data ingestion is required.
          </p>
          <p className="text-sm text-slate-700">
            See:{' '}
            <Link href="/findings/pecos-taxonomy-disagreement" className="text-blue-700 hover:underline">
              H37
            </Link>{' '}
            ·{' '}
            <Link href="/findings/pecos-behavioral-health-taxonomy" className="text-blue-700 hover:underline">
              H38
            </Link>{' '}
            ·{' '}
            <Link href="/findings/pecos-multi-enrollment-state-mismatch" className="text-blue-700 hover:underline">
              H39
            </Link>{' '}
            ·{' '}
            <Link href="/methodology" className="text-blue-700 hover:underline">
              methodology v0.7.0-draft
            </Link>
          </p>
        </section>

        {/* Sources */}
        <footer className="border-t border-slate-200 pt-6 text-sm text-slate-500">
          <p className="mb-2">
            <strong className="text-slate-700">Primary sources:</strong>{' '}
            <a
              href="https://pecos.cms.hhs.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
            >
              pecos.cms.hhs.gov
            </a>{' '}
            ·{' '}
            <a
              href="https://data.cms.gov/provider-characteristics/medicare-provider-supplier-enrollment/medicare-fee-for-service-public-provider-enrollment"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
            >
              PPEF dataset
            </a>{' '}
            ·{' '}
            <a
              href="https://npiregistry.cms.hhs.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
            >
              NPPES Registry
            </a>
          </p>
          <p>
            AINPI is a free, public audit produced by FHIR IQ. Apache-2.0.
          </p>
        </footer>
      </main>
    </div>
  );
}
