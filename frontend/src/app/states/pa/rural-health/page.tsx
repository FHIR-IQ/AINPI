import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { loadPaRuralHealth } from '@/lib/load-api-v1';
import RuralExplorer from './rural-explorer';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Pennsylvania rural hospitals: who publishes a FHIR endpoint | AINPI',
  description:
    'Every Pennsylvania hospital mapped by rural designation, health system, and EHR vendor, with whether it publishes a FHIR endpoint through its certified EHR. County overlays for median household income, age, and rural classification.',
  openGraph: {
    title: 'Pennsylvania rural hospitals: who publishes a FHIR endpoint',
    description:
      'PA hospitals by rural designation, health system, EHR vendor, and FHIR endpoint publication, with county overlays for income and age.',
    url: 'https://ainpi.dev/states/pa/rural-health',
    type: 'article',
  },
};

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="text-2xl font-bold text-gray-900 mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function PaRuralHealthPage() {
  const payload = loadPaRuralHealth();

  if (!payload) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-amber-900">
            <p className="font-medium mb-1">Payload not generated.</p>
            <p className="text-sm">
              Run{' '}
              <code className="bg-amber-100 px-1.5 py-0.5 rounded">
                python analysis/pa_rural_health.py --cehrt-cache &lt;path&gt;
              </code>{' '}
              to produce{' '}
              <code>frontend/public/api/v1/states/pa-rural-health.json</code>.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const s = payload.summary;
  const cahShare = ((s.cah_in_cehrt_bundle / s.critical_access_hospitals) * 100).toFixed(0);
  const ruralShare = ((s.rural_in_cehrt_bundle / s.hospitals_in_rural_counties) * 100).toFixed(0);
  const allShare = ((s.in_cehrt_bundle / s.hospitals) * 100).toFixed(0);
  const topVendors = Object.entries(s.ehr_vendors).slice(0, 5);
  const epic = s.vendor_endpoint_linkage?.['Epic'];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-3xl mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 mb-1">
            Pennsylvania · Hospital connectivity · H47
          </p>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Which Pennsylvania hospitals publish a FHIR endpoint, and which do not
          </h1>
          <p className="text-gray-700">
            All {s.hospitals} hospitals CMS lists in Pennsylvania, joined to the
            certified-EHR service-base-URL bundles their vendors publish. That
            join answers two questions at once: whether a hospital is reachable
            by FHIR, and which EHR it runs. Counties carry the standard USDA
            rural classification plus income and age overlays, because the
            hospitals least likely to be reachable are not randomly distributed.
            Every source is public and the{' '}
            <a
              href="/api/v1/states/pa-rural-health.json"
              className="underline text-primary-700"
            >
              full payload
            </a>{' '}
            and{' '}
            <a
              href="/api/v1/states/pa-rural-health.csv"
              className="underline text-primary-700"
            >
              CSV
            </a>{' '}
            are downloadable.
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Stat
            label="Hospitals"
            value={String(s.hospitals)}
            sub={`${s.counties} counties, ${s.rural_counties} nonmetro`}
          />
          <Stat
            label="In a nonmetro county"
            value={String(s.hospitals_in_rural_counties)}
            sub={`${s.critical_access_hospitals} Critical Access`}
          />
          <Stat
            label="In a certified-EHR bundle"
            value={`${s.in_cehrt_bundle}`}
            sub={`${allShare}% of all hospitals`}
          />
          <Stat
            label="Cross-linked to an endpoint"
            value={String(s.org_endpoint_linked)}
            sub="organization points at an Endpoint"
          />
        </div>

        <section className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
          <p className="mb-2">
            <strong>Two numbers, because they answer different questions.</strong>{' '}
            {s.in_cehrt_bundle} of {s.hospitals} hospitals appear in a certified
            EHR vendor&apos;s published bundle, so they are reachable through
            that vendor and we know which EHR they run. Only {s.org_endpoint_linked}{' '}
            have an Organization record that points at a specific Endpoint
            resource.
          </p>
          {epic && (
            <p>
              The gap is almost entirely Epic. Epic publishes{' '}
              {epic.pa_orgs.toLocaleString()} Pennsylvania organizations and
              cross-links {epic.endpoint_linked} of them to an endpoint. Every
              other major vendor links all of theirs. Software that walks
              Organization to Endpoint will therefore find nothing for most
              Pennsylvania hospitals, even though the endpoint exists.
            </p>
          )}
        </section>

        <RuralExplorer payload={payload} />

        <section className="mt-6 bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            What the numbers say
          </h2>
          <ul className="list-disc list-inside space-y-1.5 text-sm text-gray-700">
            <li>
              <strong>Rural hospitals are not the laggards here.</strong>{' '}
              {ruralShare}% of hospitals in nonmetro counties appear in a
              certified-EHR bundle, against {allShare}% statewide, and{' '}
              {cahShare}% of Critical Access hospitals do.
            </li>
            <li>
              <strong>The EHR market is concentrated.</strong>{' '}
              {topVendors.map(([v, n], i) => (
                <span key={v}>
                  {i > 0 ? ', ' : ''}
                  {v} {n}
                </span>
              ))}
              . A conformance change at one vendor moves most of the state.
            </li>
            <li>
              <strong>{s.match_none} hospitals matched no vendor bundle.</strong>{' '}
              That is not proof they lack an endpoint. They may publish under a
              parent system&apos;s name, and federal facilities are published
              differently.
            </li>
          </ul>
        </section>

        <section className="mt-4 bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Health information exchange and TEFCA
          </h2>
          <p className="text-sm text-gray-700">{payload.connectivity_note}</p>
          <p className="text-sm text-gray-700 mt-2">
            If you can point at a machine-readable participant list for any
            Pennsylvania HIO or QHIN, that column becomes measurable and we will
            add it.{' '}
            <a
              href={payload.sources.hio_context}
              className="underline text-primary-700"
              target="_blank"
              rel="noopener"
            >
              PA DHS lists the certified HIOs here
            </a>
            .
          </p>
        </section>

        <section className="mt-4 bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Method and limits
          </h2>
          <ul className="list-disc list-inside space-y-1.5 text-sm text-gray-700">
            {payload.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
            <li>
              Matching tiers: {s.match_exact} exact on name and city,{' '}
              {s.match_token} by token overlap inside the same city, {s.match_none}{' '}
              unmatched. Every row carries its tier.
            </li>
          </ul>
          <p className="text-xs text-gray-500 mt-3">
            Sources: {Object.values(payload.sources).slice(0, 5).join(' · ')}.
            Generated {payload.generated_at}. Methodology{' '}
            <Link href="/methodology" className="underline text-primary-700">
              {payload.methodology_version}
            </Link>
            . Compute script <code>analysis/pa_rural_health.py</code>, which
            costs nothing to run.
          </p>
        </section>
      </main>
    </div>
  );
}
