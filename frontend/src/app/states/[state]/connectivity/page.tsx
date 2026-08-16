import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import Navbar from '@/components/Navbar';
import { DatasetJsonLd } from '@/components/JsonLd';
import {
  allConnectivityStates,
  loadStateConnectivity,
} from '@/lib/load-api-v1';
import type { ConnectivityPayload } from '@/lib/connectivity-types';
import ConnectivityChain from './connectivity-chain';
// Aliased: this file also exports `const dynamic = 'force-static'`, and the
// bare import name collides with it.
import nextDynamic from 'next/dynamic';

// D3 stays out of SSR, matching every other chart in this codebase.
const ConnectivityGraph = nextDynamic(
  () => import('@/components/charts/ConnectivityGraph'),
  { ssr: false, loading: () => <div className="h-[560px] border border-gray-200 bg-white" /> },
);

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return allConnectivityStates().map((state) => ({ state }));
}

export function generateMetadata({
  params,
}: {
  params: { state: string };
}): Metadata {
  const payload = loadStateConnectivity(params.state);
  // The root layout applies a '%s | AINPI' template, so titles here must not
  // append it themselves or it renders twice.
  if (!payload) return { title: 'Connectivity ledger' };
  const { state_name, summary } = payload;
  const title = `${state_name} provider connectivity: ${summary.reaches_endpoint_pct}% reach a FHIR endpoint`;
  const description = `Every one of ${fmt(summary.practitioners)} ${state_name} practitioners in the CMS National Provider Directory, traced through role, organization, location and endpoint to an EHR vendor. ${fmt(summary.with_role)} have a role at all; ${fmt(summary.reaches_endpoint)} reach an endpoint.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://ainpi.dev/states/${params.state}/connectivity`,
      type: 'article',
    },
  };
}

function fmt(n: number | null | undefined) {
  return typeof n === 'number' ? n.toLocaleString('en-US') : '—';
}

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
      {sub ? <div className="mt-1 text-xs text-gray-500">{sub}</div> : null}
    </div>
  );
}

/**
 * Band chips. The colours are deliberately not a red-to-green gradient: the
 * bands are categories of evidence, not degrees of goodness, and a gradient
 * invites readers to average them. They also stay legible in greyscale, which
 * is the same constraint the treemap ramp is under.
 */
const BAND_STYLE: Record<string, { label: string; className: string }> = {
  green: {
    label: 'Deterministic',
    className: 'bg-primary-600 text-white border-primary-600',
  },
  yellow: {
    label: 'Vendor NPI',
    className: 'bg-primary-100 text-primary-900 border-primary-300',
  },
  candidate: {
    label: 'Name candidate',
    className: 'bg-amber-50 text-amber-900 border-amber-300',
  },
  red: {
    label: 'Stops at organization',
    className: 'bg-white text-ink border-gray-300',
  },
  none: {
    label: 'No organization',
    className: 'bg-gray-100 text-gray-600 border-gray-300',
  },
};

export default function StateConnectivityPage({
  params,
}: {
  params: { state: string };
}) {
  const payload = loadStateConnectivity(params.state);
  if (!payload) notFound();
  return <Connectivity payload={payload} state={params.state} />;
}

function Connectivity({
  payload,
  state,
}: {
  payload: ConnectivityPayload;
  state: string;
}) {
  const {
    state_name,
    summary,
    funnel,
    confidence,
    vendors,
    organizations_top,
    organizations_unlinked,
    systems,
    graph,
    hospitals,
    limits,
    release_date,
    generated_at,
    methodology_version,
  } = payload;

  const bands = (['green', 'yellow', 'candidate', 'red', 'none'] as const).map(
    (key) => ({ key, count: confidence[key] }),
  );
  const bandTotal = bands.reduce((a, b) => a + b.count, 0) || 1;
  const vendorRows = Object.entries(vendors).sort((a, b) => b[1] - a[1]);

  return (
    <div className="min-h-screen bg-paper">
      <DatasetJsonLd
        name={`${state_name} provider connectivity ledger`}
        description={`Every active practitioner the CMS National Provider Directory lists in ${state_name}, traced through PractitionerRole, Organization, Location and Endpoint to an EHR vendor, with each link banded by the method that established it.`}
        url={`/states/${state}/connectivity`}
        distributionUrls={[
          {
            url: `/api/v1/states/${state}-connectivity.json`,
            format: 'application/json',
          },
        ]}
        dateModified={generated_at}
        temporalCoverage={release_date}
        version={methodology_version}
        spatialCoverage={state_name}
        keywords={[
          'provider directory',
          'FHIR',
          'endpoint',
          'interoperability',
          state_name,
        ]}
        measurementTechnique="Join of NDH practitioner, practitioner_role and organization resources to the published AINPI endpoint and vendor attribution crosswalks, banded by whether each link is deterministic or inferred."
        variableMeasured={`Practitioners with a role, with a resolvable organization, with a named location, reaching a FHIR endpoint, and with a known EHR vendor, out of ${fmt(summary.practitioners)} active ${state_name} practitioners.`}
      />
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <nav className="mb-6 text-sm text-gray-500">
          <Link href="/states" className="hover:text-signal">
            States
          </Link>
          <span className="mx-2">/</span>
          <Link href={`/states/${state}`} className="hover:text-signal">
            {state.toUpperCase()}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-ink">Connectivity</span>
        </nav>

        <header className="measure rise mb-10">
          <p className="eyebrow">Connectivity ledger</p>
          <h1 className="mb-4 font-serif text-4xl tracking-tight text-ink">
            Can software reach the system holding your record?
          </h1>
          <p className="lede">
            Start with every one of the {fmt(summary.practitioners)}{' '}
            practitioners the National Provider Directory lists as active in{' '}
            {state_name}. Follow each one through the chain a patient app has to
            walk: role, organization, location, endpoint, EHR vendor. Only{' '}
            <strong>{fmt(summary.reaches_endpoint)}</strong> get to the end.
          </p>
          <p className="mt-4 text-sm text-gray-600">
            NDH release {release_date}. Methodology {methodology_version}. Every
            number here is recomputed from the same published crosswalks the
            individual findings use, so this page and those findings cannot
            disagree.
          </p>
        </header>

        <section className="mb-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            label="Active practitioners"
            value={fmt(summary.practitioners)}
            sub="the honest denominator"
          />
          <Stat
            label="Have any role"
            value={`${summary.with_role_pct}%`}
            sub={`${fmt(summary.with_role)} practitioners`}
          />
          <Stat
            label="Reach an endpoint"
            value={`${summary.reaches_endpoint_pct}%`}
            sub={`${fmt(summary.reaches_endpoint_ndh_only)} from the NDH alone`}
          />
          <Stat
            label="Organizations"
            value={fmt(summary.organizations)}
            sub={`${fmt(summary.organizations_with_endpoint)} reach an endpoint`}
          />
        </section>

        <section className="mb-14">
          <h2 className="mb-1 font-serif text-2xl text-ink">Where the chain breaks</h2>
          <p className="measure mb-6 text-sm text-gray-600">
            Each step is a subset of the one above it. The candidate row sits
            outside the chain on purpose and is never added into coverage.
          </p>
          <ConnectivityChain steps={funnel} total={summary.practitioners} />
        </section>

        <section className="mb-14">
          <h2 className="mb-1 font-serif text-2xl text-ink">
            What established each link
          </h2>
          <p className="measure mb-6 text-sm text-gray-600">{confidence.note}</p>
          <div className="mb-4 flex h-6 w-full overflow-hidden rounded-sm border border-gray-300">
            {bands.map(({ key, count }) =>
              count === 0 ? null : (
                <div
                  key={key}
                  className={`${BAND_STYLE[key].className} border-r last:border-r-0`}
                  style={{ width: `${(count / bandTotal) * 100}%` }}
                  title={`${BAND_STYLE[key].label}: ${fmt(count)}`}
                />
              ),
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {bands.map(({ key, count }) => (
              <div key={key} className="border border-gray-200 bg-white p-3">
                <dt className="flex items-center gap-2 text-xs text-gray-600">
                  <span
                    className={`inline-block h-3 w-3 rounded-sm border ${BAND_STYLE[key].className}`}
                  />
                  {BAND_STYLE[key].label}
                </dt>
                <dd className="mt-1 font-mono text-lg text-ink">{fmt(count)}</dd>
              </div>
            ))}
          </dl>
        </section>

        {vendorRows.length > 0 && (
          <section className="mb-14">
            <h2 className="mb-1 font-serif text-2xl text-ink">
              Which EHR the reachable practitioners sit behind
            </h2>
            <p className="measure mb-6 text-sm text-gray-600">
              Vendor is derived from the endpoint host and cross-checked against
              the file that published the URL. It covers only the{' '}
              {fmt(summary.vendor_known)} practitioners who reach an endpoint at
              all, so it describes the connected minority, not{' '}
              {state_name}&rsquo;s EHR market.
            </p>
            <div className="overflow-x-auto border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium text-gray-700">Vendor</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-700">
                      Practitioners
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-700">
                      Share of reachable
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vendorRows.map(([vendor, count]) => (
                    <tr key={vendor} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2 text-ink">{vendor}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmt(count)}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-600">
                        {((count / (summary.vendor_known || 1)) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="mb-14">
          <h2 className="mb-1 font-serif text-2xl text-ink">
            The web, and the holes in it
          </h2>
          <p className="measure mb-6 text-sm text-gray-600">{graph.note}</p>
          <ConnectivityGraph graph={graph} />
        </section>

        <section className="mb-14">
          <h2 className="mb-1 font-serif text-2xl text-ink">
            Health systems, and how we know
          </h2>
          <p className="measure mb-3 text-sm text-gray-600">{systems.note}</p>
          <p className="measure mb-6 text-sm text-gray-600">
            {systems.routing_caveat}
          </p>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              label="Orgs with a CMS-attested owner"
              value={fmt(systems.organizations_with_cms_attested_owner)}
              sub="hospitals only; states ownership"
            />
            <Stat
              label="Orgs with an NPPES parent"
              value={fmt(systems.organizations_with_nppes_parent)}
              sub="subparts only; can be stale"
            />
            <Stat
              label="Systems found"
              value={fmt(systems.systems_found)}
              sub={Object.entries(systems.systems_by_basis)
                .map(([k, v]) => `${v} ${k}`)
                .join(', ')}
            />
          </div>

          <div className="mb-6 border border-gray-300 bg-white p-4 text-sm">
            <p className="mb-2 font-medium text-ink">
              Why the directory&rsquo;s own affiliation resource is not used
            </p>
            <p className="measure mb-3 text-gray-700">
              {systems.affiliation_graph.note}
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="border-b border-gray-200 text-left">
                  <tr>
                    <th className="py-1 pr-4 font-medium text-gray-700">
                      Largest hubs in the affiliation graph
                    </th>
                    <th className="py-1 text-right font-medium text-gray-700">
                      Linked organizations
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {systems.affiliation_graph.top_hubs.slice(0, 8).map((hub) => (
                    <tr key={`${hub.name}-${hub.children}`}>
                      <td className="py-1 pr-4 text-gray-700">{hub.name ?? '—'}</td>
                      <td className="py-1 text-right font-mono">{fmt(hub.children)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-x-auto border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium text-gray-700">System</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-700">
                    Orgs
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-gray-700">
                    Practitioners
                  </th>
                  <th className="px-4 py-2 font-medium text-gray-700">Grouped by</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-700">
                    Endpoints
                  </th>
                  <th className="px-4 py-2 font-medium text-gray-700">Vendors</th>
                </tr>
              </thead>
              <tbody>
                {systems.rows.slice(0, 30).map((row) => (
                  <tr
                    key={row.system_key}
                    className="border-b border-gray-100 last:border-0"
                  >
                    <td className="px-4 py-2 text-ink">{row.label}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {fmt(row.organizations)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {fmt(row.practitioners)}
                    </td>
                    <td className="px-4 py-2">
                      <span className="border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700">
                        {row.basis}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {row.endpoint_count === 0 ? (
                        <span className="text-signal">0</span>
                      ) : (
                        fmt(row.endpoint_count)
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-700">
                      {row.vendors.join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-14">
          <h2 className="mb-1 font-serif text-2xl text-ink">
            The work queue: who to fix first
          </h2>
          <p className="measure mb-2 text-sm text-gray-600">
            {organizations_unlinked.note}
          </p>
          <p className="measure mb-6 text-sm text-gray-600">
            These{' '}
            <strong>{fmt(organizations_unlinked.rows.length)} organizations</strong>{' '}
            hold{' '}
            <strong>
              {fmt(organizations_unlinked.practitioners_affected)} practitioners
            </strong>{' '}
            between them. For several of them a FHIR endpoint is already
            published by their EHR vendor, under the brand name rather than the
            legal entity name the directory carries. Nothing public connects the
            two.
          </p>
          <div className="overflow-x-auto border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium text-gray-700">Organization</th>
                  <th className="px-4 py-2 font-medium text-gray-700">City</th>
                  <th className="px-4 py-2 font-medium text-gray-700">NPI</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-700">
                    Practitioners
                  </th>
                </tr>
              </thead>
              <tbody>
                {organizations_unlinked.rows.slice(0, 40).map((org) => (
                  <tr
                    key={`${org.org_id}`}
                    className="border-b border-gray-100 last:border-0"
                  >
                    <td className="px-4 py-2 text-ink">{org.name ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{org.city ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {org.nppes_verify_url ? (
                        <a
                          href={org.nppes_verify_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-600 hover:text-signal"
                        >
                          {org.npi}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {fmt(org.practitioners)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-14">
          <h2 className="mb-1 font-serif text-2xl text-ink">
            Largest organizations, and what reaches them
          </h2>
          <p className="measure mb-6 text-sm text-gray-600">
            Ranked by how many {state_name} practitioners name them. A candidate
            endpoint is shown in its own column so it cannot be read as a
            resolved one.
          </p>
          <div className="overflow-x-auto border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium text-gray-700">Organization</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-700">
                    Practitioners
                  </th>
                  <th className="px-4 py-2 font-medium text-gray-700">Basis</th>
                  <th className="px-4 py-2 font-medium text-gray-700">Vendor</th>
                  <th className="px-4 py-2 font-medium text-gray-700">Endpoint</th>
                </tr>
              </thead>
              <tbody>
                {organizations_top.slice(0, 40).map((org) => (
                  <tr key={org.org_id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2 text-ink">{org.name ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {fmt(org.practitioners)}
                    </td>
                    <td className="px-4 py-2">
                      {org.endpoint_basis ? (
                        <span className="border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700">
                          {org.endpoint_basis}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">none</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{org.vendor ?? '—'}</td>
                    <td className="max-w-xs truncate px-4 py-2 font-mono text-xs text-gray-600">
                      {org.endpoint ?? org.endpoint_candidate ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {hospitals && (
          <section className="mb-14">
            <h2 className="mb-1 font-serif text-2xl text-ink">Hospitals</h2>
            <p className="measure mb-6 text-sm text-gray-600">
              Facility-level connectivity comes from the separate hospital
              audit, which starts from the CMS hospital list rather than from
              the directory.{' '}
              <Link
                href={`/states/${state}/rural-health`}
                className="text-primary-600 underline hover:text-signal"
              >
                See the full hospital view
              </Link>
              .
            </p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Hospitals" value={fmt(hospitals.hospitals)} />
              <Stat
                label="In a vendor bundle"
                value={fmt(hospitals.in_vendor_bundle)}
              />
              <Stat
                label="Critical access"
                value={fmt(hospitals.critical_access)}
              />
              <Stat
                label="In rural counties"
                value={fmt(hospitals.in_rural_counties)}
              />
            </div>
          </section>
        )}

        <section className="measure mb-14">
          <h2 className="mb-4 font-serif text-2xl text-ink">What this does not say</h2>
          <ul className="space-y-3 text-sm text-gray-700">
            {limits.map((limit) => (
              <li key={limit} className="border-l-2 border-gray-300 pl-4">
                {limit}
              </li>
            ))}
          </ul>
        </section>

        <section className="measure">
          <h2 className="mb-4 font-serif text-2xl text-ink">Check it yourself</h2>
          <p className="mb-4 text-sm text-gray-700">
            The payload behind this page is public and versioned. Every link in
            the chain has its own pre-registered finding with a stated null
            hypothesis and denominator.
          </p>
          <ul className="space-y-2 text-sm">
            <li>
              <a
                href={`/api/v1/states/${state}-connectivity.json`}
                className="text-primary-600 underline hover:text-signal"
              >
                /api/v1/states/{state}-connectivity.json
              </a>{' '}
              <span className="text-gray-500">this page, as JSON</span>
            </li>
            <li>
              <Link
                href="/findings/endpoint-org-linkage"
                className="text-primary-600 underline hover:text-signal"
              >
                Endpoint-to-organization linkage
              </Link>{' '}
              <span className="text-gray-500">the endpoint step</span>
            </li>
            <li>
              <Link
                href="/findings/vendor-endpoint-attribution"
                className="text-primary-600 underline hover:text-signal"
              >
                Vendor-published endpoint files
              </Link>{' '}
              <span className="text-gray-500">the vendor step</span>
            </li>
            <li>
              <Link
                href="/findings/payer-affiliation-gap"
                className="text-primary-600 underline hover:text-signal"
              >
                Payer directories and the affiliation gap
              </Link>{' '}
              <span className="text-gray-500">the role step</span>
            </li>
            <li>
              <Link
                href="/methodology"
                className="text-primary-600 underline hover:text-signal"
              >
                Methodology
              </Link>{' '}
              <span className="text-gray-500">how every number is produced</span>
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
