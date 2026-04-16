'use client';

import { useState } from 'react';
import Navbar from '@/components/Navbar';

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
  practitioner: PractitionerResult | null;
  roles: Array<{
    _specialty_code: string;
    _specialty_display: string;
    _org_npi: string;
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            National Provider Directory Search
          </h1>
          <p className="text-gray-600 mt-2">
            Search the CMS National Provider Directory for providers, organizations, locations, and FHIR endpoints
          </p>
        </div>

        {/* Search Form */}
        <div className="card mb-8">
          <form onSubmit={handleSearch} className="space-y-4">
            {/* Search type selector */}
            <div className="flex gap-2">
              {([
                ['npi', 'Search by NPI'],
                ['name', 'Search by Name'],
                ['org', 'Search by Organization'],
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
        </div>

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
                    <p className="text-sm text-gray-500">Address</p>
                    <p>{formatAddress(profile.practitioner.address)}</p>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500">No practitioner found with this NPI</p>
              )}
            </div>

            {profile.roles.length > 0 && (
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Roles & Affiliations ({profile.roles.length})
                </h3>
                <div className="space-y-2">
                  {profile.roles.map((role, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-gray-100">
                      <div>
                        <p className="font-medium">
                          {role._specialty_display || 'General Practice'}
                        </p>
                        <p className="text-sm text-gray-500 font-mono">{role._specialty_code}</p>
                      </div>
                      {role._org_npi && (
                        <span className="text-sm text-gray-500">Org NPI: {role._org_npi}</span>
                      )}
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
            <p className="text-sm text-gray-500">
              {results?.total_results} results found
            </p>

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
                            {p.city}, {p.state} {p.postal_code}
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
