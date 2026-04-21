'use client';

import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import ShareButtons from '@/components/ShareButtons';
import type { ApiV1Stats } from '@/lib/api-v1-types';

const HERO_FINDING_CARDS: {
  slug: string;
  label: string;
  blurb: string;
}[] = [
  {
    slug: 'endpoint-liveness',
    label: 'Endpoint liveness',
    blurb:
      '85.4% of 2,974 FHIR-REST hosts serve a parseable CapabilityStatement. 81.6% publish valid SMART .well-known.',
  },
  {
    slug: 'npi-taxonomy-correctness',
    label: 'NPI & taxonomy',
    blurb:
      '10.86M NPIs checked. 3.49% are deactivated in NPPES but live in NDH. Two specialty code systems, no cross-walk.',
  },
  {
    slug: 'temporal-staleness',
    label: 'Temporal staleness',
    blurb:
      'meta.lastUpdated on the NPD bulk files is a release-day stamp. 30- and 90-day compliance cadence is not measurable from these files.',
  },
];

function fmtBig(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

interface PractitionerResult {
  npi: string;
  family_name: string;
  given_name: string;
  gender: string;
  state: string;
  city: string;
  postal_code: string;
  active: boolean;
  last_updated: string;
  telecom: string;
  address: string;
  qualification: string;
  all_states?: string;
}

interface OrganizationResult {
  npi: string;
  name: string;
  org_type: string;
  state: string;
  city: string;
  active: boolean;
  telecom: string;
  address: string;
  endpoint: string;
}

interface LocationResult {
  name: string;
  status: string;
  state: string;
  city: string;
  postal_code: string;
  managing_org_npi: string;
  telecom: string;
  address: string;
}

interface EndpointResult {
  connection_type: string;
  status: string;
  name: string;
  endpoint_url: string;
  managing_org: string;
  mime_types: string;
}

interface ProviderProfile {
  practitioner: (PractitionerResult & {
    addresses_json?: string;
    telecom_json?: string;
    qualification_json?: string;
  }) | null;
  roles: Array<{
    _specialty_code: string;
    _specialty_display: string;
    _org_id?: string;
    _active?: boolean;
  }>;
  specialties?: Array<{
    code: string;
    display: string;
    role_count: number;
    active_count: number;
    org_ids: string[];
  }>;
  endpoints: EndpointResult[];
}

interface SearchResponse {
  type: 'provider_profile' | 'search';
  data: ProviderProfile | {
    practitioners?: PractitionerResult[];
    organizations?: OrganizationResult[];
    locations?: LocationResult[];
    endpoints?: EndpointResult[];
  };
  total_results?: number;
  source: string;
  release_date: string;
  search_scope_notes?: string[];
  query?: Record<string, string | undefined>;
}

export default function NpdSearchPage() {
  const [searchType, setSearchType] = useState<'npi' | 'name' | 'org'>('npi');
  const [npi, setNpi] = useState('');
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ApiV1Stats | null>(null);

  useEffect(() => {
    fetch('/api/v1/stats.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setStats(j))
      .catch(() => setStats(null));
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResults(null);

    const params = new URLSearchParams();
    if (searchType === 'npi' && npi) params.set('npi', npi);
    if (searchType === 'name' && name) params.set('name', name);
    if (searchType === 'org' && org) params.set('org', org);
    if (state) params.set('state', state);
    if (city) params.set('city', city);

    try {
      const res = await fetch(`/api/npd/search?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Search failed');
      }
      setResults(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  function parseJsonField(field: string | null | undefined): unknown {
    if (!field) return null;
    try {
      return JSON.parse(field);
    } catch {
      return field;
    }
  }

  function formatPhone(telecom: string | null | undefined): string {
    const parsed = parseJsonField(telecom) as Array<{ system?: string; value?: string }> | null;
    if (!parsed || !Array.isArray(parsed)) return '-';
    const phone = parsed.find((t) => t.system === 'phone');
    return phone?.value || '-';
  }

  function formatAddress(addr: string | null | undefined): string {
    const parsed = parseJsonField(addr) as Array<{
      line?: string[];
      city?: string;
      state?: string;
      postalCode?: string;
    }> | null;
    if (!parsed || !Array.isArray(parsed) || parsed.length === 0) return '-';
    const a = parsed[0];
    const parts = [...(a.line || []), a.city, a.state, a.postalCode].filter(Boolean);
    return parts.join(', ') || '-';
  }

  const profile = results?.type === 'provider_profile' ? results.data as ProviderProfile : null;
  const searchData =
    results?.type === 'search'
      ? (results.data as {
          practitioners?: PractitionerResult[];
          organizations?: OrganizationResult[];
          locations?: LocationResult[];
          endpoints?: EndpointResult[];
        })
      : null;

  async function handleNpiHero(e: React.FormEvent) {
    setSearchType('npi');
    await handleSearch(e);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      {/* HERO */}
      <section className="bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <p className="text-xs uppercase tracking-widest text-gray-400 mb-3 font-mono">
            AINPI · CMS National Provider Directory audit
          </p>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">
            Check any NPI against the NPD.
          </h1>
          <p className="text-gray-300 mb-8 max-w-xl mx-auto">
            27.2M FHIR R4 records from the 2026-04-09 bulk public-use release.
            Six pre-registered findings, reproducible from open source.
          </p>
          <form onSubmit={handleNpiHero} className="flex flex-col sm:flex-row gap-3 max-w-xl mx-auto">
            <input
              type="text"
              inputMode="numeric"
              className="flex-1 px-5 py-4 rounded-lg bg-white text-gray-900 placeholder:text-gray-400 text-lg font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-primary-400"
              placeholder="10-digit NPI"
              value={npi}
              onChange={(e) => setNpi(e.target.value.replace(/\D/g, ''))}
              maxLength={10}
              aria-label="NPI number"
            />
            <button
              type="submit"
              disabled={loading || npi.length !== 10}
              className="px-8 py-4 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Checking…' : 'Check NPI'}
            </button>
          </form>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-xs text-gray-400">
            <a href="/subscribe" className="inline-flex items-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 font-medium transition">
              Subscribe for updates
            </a>
            <a href="/download" className="inline-flex items-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 font-medium transition">
              Download the report
            </a>
            <span className="hidden sm:inline text-gray-600">·</span>
            <ShareButtons variant="dark" compact />
          </div>
        </div>
      </section>

      {/* LIVE COUNTERS */}
      {stats && (
        <section className="bg-white border-b">
          <div className="max-w-5xl mx-auto px-4 py-5 flex flex-wrap items-baseline justify-center gap-x-8 gap-y-2 text-sm text-gray-600">
            <div>
              <span className="font-semibold text-gray-900">{fmtBig(stats.counters.resources_processed)}</span> resources
            </div>
            <div>
              <span className="font-semibold text-gray-900">{fmtBig(stats.counters.npis_checked)}</span> NPIs checked
            </div>
            {stats.counters.endpoints_live_pct != null && (
              <div>
                <span className="font-semibold text-gray-900">{stats.counters.endpoints_live_pct.toFixed(1)}%</span> endpoints live
              </div>
            )}
            <div>
              <span className="font-semibold text-gray-900">{stats.counters.findings_published}</span> findings published
            </div>
            <div className="text-xs text-gray-400 font-mono">
              NPD {stats.release_date} · methodology v{stats.methodology_version}
            </div>
          </div>
        </section>
      )}

      <div className="max-w-7xl mx-auto px-4 py-10">

        {/* FINDING CARDS */}
        <div className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Latest findings</h2>
            <a href="/findings" className="text-sm text-primary-600 hover:underline">
              See all →
            </a>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {HERO_FINDING_CARDS.map((card) => (
              <a
                key={card.slug}
                href={`/findings/${card.slug}`}
                className="block bg-white rounded-lg shadow-sm border p-5 hover:border-primary-400 hover:shadow transition"
              >
                <p className="text-xs uppercase tracking-wider text-primary-600 mb-2 font-semibold">
                  {card.label}
                </p>
                <p className="text-sm text-gray-700 leading-snug">{card.blurb}</p>
              </a>
            ))}
          </div>
        </div>

        {/* ADVANCED SEARCH (collapsible) */}
        <details className="card mb-8 group">
          <summary className="cursor-pointer list-none flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">
              or search by name, organization, or location
            </span>
            <span className="text-gray-400 group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <form onSubmit={handleSearch} className="space-y-4 mt-4">
            <div className="flex gap-2">
              {([
                ['npi', 'NPI'],
                ['name', 'Name'],
                ['org', 'Organization'],
              ] as ['npi' | 'name' | 'org', string][]).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSearchType(type)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    searchType === type
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {searchType === 'npi' && (
                <div className="md:col-span-2">
                  <label className="label">NPI Number</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g., 1234567890"
                    value={npi}
                    onChange={(e) => setNpi(e.target.value)}
                    maxLength={10}
                  />
                </div>
              )}
              {searchType === 'name' && (
                <div className="md:col-span-2">
                  <label className="label">Provider Name</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Last name or first name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              )}
              {searchType === 'org' && (
                <div className="md:col-span-2">
                  <label className="label">Organization Name</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g., Mayo Clinic"
                    value={org}
                    onChange={(e) => setOrg(e.target.value)}
                  />
                </div>
              )}
              <div>
                <label className="label">State</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g., CA"
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  maxLength={2}
                />
              </div>
              <div>
                <label className="label">City</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g., San Francisco"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Searching...' : 'Search Directory'}
            </button>
          </form>
        </details>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {/* Provider Profile View (NPI lookup) */}
        {profile && (
          <div className="space-y-6">
            <div className="card">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Provider Profile</h2>
              {profile.practitioner ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Name</p>
                    <p className="font-medium">
                      {profile.practitioner.given_name} {profile.practitioner.family_name}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">NPI</p>
                    <p className="font-mono">{profile.practitioner.npi}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Gender</p>
                    <p className="capitalize">{profile.practitioner.gender || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Status</p>
                    <span
                      className={`px-2 py-0.5 rounded text-sm ${
                        profile.practitioner.active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {profile.practitioner.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Location</p>
                    <p>
                      {profile.practitioner.city}, {profile.practitioner.state}{' '}
                      {profile.practitioner.postal_code}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Phone</p>
                    <p>{formatPhone(profile.practitioner.telecom)}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-gray-500 mb-2">
                      All Addresses{' '}
                      {(() => {
                        const parsed = parseJsonField(profile.practitioner.addresses_json || profile.practitioner.address) as Array<unknown> | null;
                        return parsed && Array.isArray(parsed) ? <span className="text-xs text-gray-400">({parsed.length} on file)</span> : null;
                      })()}
                    </p>
                    {(() => {
                      const parsed = parseJsonField(profile.practitioner.addresses_json || profile.practitioner.address) as Array<{
                        line?: string[]; city?: string; state?: string; postalCode?: string; use?: string; type?: string;
                      }> | null;
                      if (!parsed || !Array.isArray(parsed) || parsed.length === 0) return <p>-</p>;
                      return (
                        <ul className="space-y-1.5">
                          {parsed.map((a, i) => (
                            <li key={i} className="text-sm">
                              <span className="inline-block bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded mr-2 uppercase">
                                {a.use || 'work'}{a.type ? ' · ' + a.type : ''}
                              </span>
                              {[...(a.line || []), a.city, a.state, a.postalCode].filter(Boolean).join(', ')}
                            </li>
                          ))}
                        </ul>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                <p className="text-gray-500">No practitioner found with this NPI</p>
              )}
            </div>

            {/* Specialties grouped view (dedup of raw roles) */}
            {profile.specialties && profile.specialties.length > 0 && (
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  Specialties &amp; Affiliations
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  {profile.specialties.length} distinct {profile.specialties.length === 1 ? 'specialty' : 'specialties'} across{' '}
                  {profile.roles.length} PractitionerRole records. Same specialty at multiple organizations is correct FHIR — each row is one practitioner-at-org relationship.
                </p>
                <div className="space-y-3">
                  {profile.specialties.map((s) => (
                    <div key={s.code} className="border border-gray-100 rounded-lg p-3">
                      <div className="flex justify-between items-start gap-4">
                        <div>
                          <p className="font-medium text-gray-900">{s.display || 'General Practice'}</p>
                          <p className="text-xs text-gray-500 font-mono">{s.code}</p>
                        </div>
                        <div className="text-right text-xs">
                          <p className="font-semibold text-gray-800">{s.role_count} role{s.role_count !== 1 ? 's' : ''}</p>
                          <p className="text-gray-500">{s.active_count} active &middot; {s.org_ids.length} org{s.org_ids.length !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {profile.endpoints.length > 0 && (
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  FHIR Endpoints ({profile.endpoints.length})
                </h3>
                <div className="space-y-3">
                  {profile.endpoints.map((ep, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">{ep.name || 'Unnamed Endpoint'}</p>
                          <p className="text-sm text-primary-600 font-mono break-all">
                            {ep.endpoint_url}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            ep.status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {ep.status}
                        </span>
                      </div>
                      <div className="flex gap-4 mt-2 text-sm text-gray-500">
                        <span>Type: {ep.connection_type}</span>
                        {ep.managing_org && <span>Org: {ep.managing_org}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-gray-400 text-right">
              Source: CMS National Provider Directory &middot; Release: {results?.release_date}
            </p>
          </div>
        )}

        {/* General Search Results */}
        {searchData && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-500">
                <span className="font-semibold text-gray-700">{results?.total_results ?? 0}</span> results found
              </p>
              {results?.search_scope_notes && results.search_scope_notes.length > 0 && (
                <details className="text-xs text-gray-500">
                  <summary className="cursor-pointer hover:text-gray-700">Search scope</summary>
                  <ul className="mt-1 space-y-0.5 list-disc list-inside">
                    {results.search_scope_notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </details>
              )}
            </div>

            {/* Empty-state: zero results across every result type */}
            {results?.total_results === 0 && (
              <div className="card bg-amber-50 border border-amber-200">
                <h3 className="text-base font-semibold text-gray-900 mb-2">No matches in NPD for this query</h3>
                <p className="text-sm text-gray-700 mb-3">
                  The CMS National Provider Directory only contains entities that hold a Type-1 (individual) or Type-2
                  (organization) NPI. Some common reasons a match might be missing:
                </p>
                <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside mb-3">
                  <li>
                    <strong>Parent / holding companies</strong> often have no NPI — the operating subsidiaries do. Try
                    searching for the hospital or medical-group subsidiary by name instead.
                  </li>
                  <li>
                    <strong>Aliases / DBAs</strong> are not populated by CMS in this release (0% of 3.6M organizations
                    have any <code>alias[]</code> entries). Use the legal registered name you see in NPPES.
                  </li>
                  <li>
                    <strong>Name variations</strong> — NPPES is self-attested. Try last name alone, or strip suffixes like
                    &quot;MD&quot; / &quot;PA-C&quot;.
                  </li>
                  <li>
                    <strong>State filter</strong> — we match your state against any address in the record&apos;s{' '}
                    <code>address[]</code> array, but if the practitioner&apos;s address list is empty we can&apos;t filter them in.
                  </li>
                </ul>
                <p className="text-xs text-gray-500">
                  See <a className="underline text-primary-600" href="/insights">/insights</a> for the full
                  provenance analysis — NPD today is structurally a FHIR improvement over NPPES, not yet a provenance
                  improvement.
                </p>
              </div>
            )}

            {searchData.practitioners && searchData.practitioners.length > 0 && (
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Practitioners ({searchData.practitioners.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="pb-2 pr-4">NPI</th>
                        <th className="pb-2 pr-4">Name</th>
                        <th className="pb-2 pr-4">Location</th>
                        <th className="pb-2 pr-4">Status</th>
                        <th className="pb-2">Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchData.practitioners.map((p, i) => (
                        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 pr-4 font-mono text-xs">
                            <button
                              className="text-primary-600 hover:underline"
                              onClick={() => {
                                setSearchType('npi');
                                setNpi(p.npi);
                                handleSearch(new Event('submit') as unknown as React.FormEvent);
                              }}
                            >
                              {p.npi}
                            </button>
                          </td>
                          <td className="py-2 pr-4">
                            {p.given_name} {p.family_name}
                          </td>
                          <td className="py-2 pr-4">
                            <div>{p.city}, {p.state} {p.postal_code}</div>
                            {p.all_states && p.all_states.split(',').filter((s) => s !== p.state).length > 0 && (
                              <div className="text-xs text-gray-400 mt-0.5">
                                also in: {p.all_states.split(',').filter((s) => s !== p.state).join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            <span
                              className={`px-2 py-0.5 rounded text-xs ${
                                p.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {p.active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-2">{formatPhone(p.telecom)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {searchData.organizations && searchData.organizations.length > 0 && (
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Organizations ({searchData.organizations.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="pb-2 pr-4">NPI</th>
                        <th className="pb-2 pr-4">Name</th>
                        <th className="pb-2 pr-4">Type</th>
                        <th className="pb-2 pr-4">Location</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchData.organizations.map((o, i) => (
                        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 pr-4 font-mono text-xs">{o.npi || '-'}</td>
                          <td className="py-2 pr-4 font-medium">{o.name}</td>
                          <td className="py-2 pr-4">{o.org_type || '-'}</td>
                          <td className="py-2 pr-4">
                            {o.city}, {o.state}
                          </td>
                          <td className="py-2">
                            <span
                              className={`px-2 py-0.5 rounded text-xs ${
                                o.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {o.active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {searchData.locations && searchData.locations.length > 0 && (
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Locations ({searchData.locations.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="pb-2 pr-4">Name</th>
                        <th className="pb-2 pr-4">Address</th>
                        <th className="pb-2 pr-4">Status</th>
                        <th className="pb-2">Managing Org NPI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchData.locations.map((l, i) => (
                        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 pr-4 font-medium">{l.name || '-'}</td>
                          <td className="py-2 pr-4">
                            {l.city}, {l.state} {l.postal_code}
                          </td>
                          <td className="py-2 pr-4">
                            <span
                              className={`px-2 py-0.5 rounded text-xs ${
                                l.status === 'active'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {l.status}
                            </span>
                          </td>
                          <td className="py-2 font-mono text-xs">{l.managing_org_npi || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {searchData.endpoints && searchData.endpoints.length > 0 && (
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Endpoints ({searchData.endpoints.length})
                </h3>
                <div className="space-y-3">
                  {searchData.endpoints.map((ep, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-4">
                      <p className="font-medium">{ep.name || 'Unnamed'}</p>
                      <p className="text-sm text-primary-600 font-mono break-all">{ep.endpoint_url}</p>
                      <div className="flex gap-4 mt-1 text-xs text-gray-500">
                        <span>Type: {ep.connection_type}</span>
                        <span>Status: {ep.status}</span>
                        {ep.managing_org && <span>Org: {ep.managing_org}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
