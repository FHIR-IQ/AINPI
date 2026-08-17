import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { loadPaRuralHealth } from '@/lib/load-api-v1';
import RuralExplorer from './rural-explorer';
import { DatasetJsonLd } from '@/components/JsonLd';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Pennsylvania rural hospitals: who publishes a FHIR endpoint',
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
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
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
      <DatasetJsonLd
        name="Pennsylvania hospital FHIR endpoint and EHR vendor dataset"
        description="All 187 hospitals CMS lists in Pennsylvania, joined to the certified-EHR service-base-URL bundles their vendors publish, with rural designation, health system, EHR vendor, and whether an endpoint resolves. County overlays for income, median age and share aged 65+."
        url="/states/pa/rural-health"
        distributionUrls={[
          { url: '/api/v1/states/pa-rural-health.json', format: 'application/json' },
          { url: '/api/v1/states/pa-rural-health.csv', format: 'text/csv' },
        ]}
        dateModified={payload.generated_at}
        keywords={['FHIR', 'EHR', 'interoperability', 'Pennsylvania', 'rural hospitals', 'HTI-1', 'provider directory']}
        measurementTechnique="Name-and-city matching of CMS-listed hospitals against certified API developer service base URL publications, tiered as exact, token-overlap or unmatched."
        variableMeasured="Per hospital: rural designation, health system, EHR vendor, whether a FHIR service base URL resolves, and county overlays for median household income, median age and share aged 65+."
        version={payload.methodology_version}
        spatialCoverage="Pennsylvania"
        basedOn={{
          name: 'CMS Hospital General Information',
          url: 'https://data.cms.gov/provider-data/dataset/xubh-q36u',
        }}
      />
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-3xl mb-8 rise">
          <p className="eyebrow mb-3">Pennsylvania · Hospital connectivity · H47</p>
          <h1 className="text-4xl sm:text-5xl mb-4 text-balance">
            Which Pennsylvania hospitals publish a FHIR endpoint, and which do not
          </h1>
          <p className="lede measure">
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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-6 mb-8">
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
            label="Endpoint resolvable"
            value={String(s.endpoint_resolvable)}
            sub={`${s.org_endpoint_linked} link directly, the rest via partOf`}
          />
        </div>

        <section className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
          <p className="mb-2">
            <strong>Vendors publish in two different shapes, and both are valid FHIR.</strong>{' '}
            {s.in_cehrt_bundle} of {s.hospitals} hospitals appear in a certified
            EHR vendor&apos;s bundle, and all {s.endpoint_resolvable} of those
            resolve to an endpoint. But only {s.org_endpoint_linked} carry{' '}
            <code>Organization.endpoint</code> on their own record. The rest sit
            under a brand-level organization that holds the endpoint, reached by
            following <code>partOf</code>.
          </p>
          {epic && (
            <p>
              Epic accounts for nearly all of the difference. It publishes{' '}
              {epic.pa_orgs.toLocaleString()} Pennsylvania organizations, which
              are mostly individual facilities, and puts the endpoint on the
              brand record above them. Nationally every one of Epic&apos;s 1,187
              brand records carries an endpoint. Vendors using the flat shape
              put an endpoint on each organization directly. An integration that
              checks only <code>Organization.endpoint</code> on the record it
              matched will report no endpoint for an Epic hospital whose
              endpoint is live, so resolve <code>partOf</code> before concluding
              anything.
            </p>
          )}
        </section>

        <RuralExplorer payload={payload} />

        <section className="mt-6 bg-white border border-gray-200 p-6">
          <h2 className="eyebrow border-b border-gray-300 pb-2 mb-4 block">
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

        <section className="mt-4 bg-white border border-gray-200 p-6">
          <h2 className="eyebrow border-b border-gray-300 pb-2 mb-4 block">
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

        <section className="mt-4 bg-white border border-gray-200 p-6">
          <h2 className="eyebrow border-b border-gray-300 pb-2 mb-4 block">
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
