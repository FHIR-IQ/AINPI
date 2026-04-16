'use client';

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/Navbar';

interface ResourceQuality {
  resource_type: string;
  total_records: number;
  active_records: number;
  completeness: {
    primary_id: number;
    name: number;
    address: number;
  };
}

interface StateData {
  state: string;
  providers: number;
  organizations: number;
  locations: number;
  active_providers: number;
  npi_completeness: number;
  address_completeness: number;
}

interface SpecialtyData {
  code: string;
  display: string;
  providers: number;
  organizations: number;
}

interface EndpointData {
  connection_type: string;
  status: string;
  count: number;
  unique_organizations: number;
}

interface SummaryData {
  release_date: string;
  overview: {
    total_records: number;
    states_covered: number;
    specialties_covered: number;
  };
  resource_quality: ResourceQuality[];
}

type Tab = 'overview' | 'states' | 'specialties' | 'endpoints';

export default function DataQualityDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [states, setStates] = useState<StateData[]>([]);
  const [specialties, setSpecialties] = useState<SpecialtyData[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState('');
  const [specialtyFilter, setSpecialtyFilter] = useState('');

  const fetchData = useCallback(async (tab: Tab) => {
    setLoading(true);
    setError(null);
    try {
      switch (tab) {
        case 'overview': {
          const res = await fetch('/api/npd/data-quality?view=summary');
          if (!res.ok) throw new Error('Failed to fetch summary');
          setSummary(await res.json());
          break;
        }
        case 'states': {
          const res = await fetch('/api/npd/data-quality?view=states');
          if (!res.ok) throw new Error('Failed to fetch states');
          const data = await res.json();
          setStates(data.states || []);
          break;
        }
        case 'specialties': {
          const res = await fetch('/api/npd/data-quality?view=specialties&limit=100');
          if (!res.ok) throw new Error('Failed to fetch specialties');
          const data = await res.json();
          setSpecialties(data.specialties || []);
          break;
        }
        case 'endpoints': {
          const res = await fetch('/api/npd/data-quality?view=endpoints');
          if (!res.ok) throw new Error('Failed to fetch endpoints');
          const data = await res.json();
          setEndpoints(data.by_type || []);
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(activeTab);
  }, [activeTab, fetchData]);

  const filteredStates = states.filter(
    (s) => !stateFilter || s.state.toLowerCase().includes(stateFilter.toLowerCase())
  );

  const filteredSpecialties = specialties.filter(
    (s) =>
      !specialtyFilter ||
      s.display.toLowerCase().includes(specialtyFilter.toLowerCase()) ||
      s.code.includes(specialtyFilter)
  );

  function formatNumber(n: number): string {
    return n.toLocaleString();
  }

  function getCompletenessColor(pct: number): string {
    if (pct >= 90) return 'text-green-600 bg-green-50';
    if (pct >= 70) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  }

  function CompletenessBar({ value, label }: { value: number; label: string }) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500 w-20">{label}</span>
        <div className="flex-1 bg-gray-200 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${
              value >= 90 ? 'bg-green-500' : value >= 70 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${Math.min(value, 100)}%` }}
          />
        </div>
        <span className={`text-sm font-medium px-2 py-0.5 rounded ${getCompletenessColor(value)}`}>
          {value.toFixed(1)}%
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            CMS National Provider Directory
          </h1>
          <p className="text-gray-600 mt-2">
            Data Quality Dashboard &mdash; Release: 2026-04-09 &mdash; Source: directory.cms.gov
          </p>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-1">
            {([
              ['overview', 'Overview'],
              ['states', 'By State'],
              ['specialties', 'By Specialty'],
              ['endpoints', 'Endpoints'],
            ] as [Tab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-700">{error}</p>
            <p className="text-red-500 text-sm mt-1">
              Make sure BigQuery data has been ingested and synced to Supabase.
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
          </div>
        ) : (
          <>
            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && summary && (
              <div className="space-y-6">
                {/* Top-level stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="card">
                    <p className="text-sm text-gray-500">Total Records</p>
                    <p className="text-3xl font-bold text-gray-900">
                      {formatNumber(summary.overview.total_records)}
                    </p>
                  </div>
                  <div className="card">
                    <p className="text-sm text-gray-500">States Covered</p>
                    <p className="text-3xl font-bold text-gray-900">
                      {summary.overview.states_covered}
                    </p>
                  </div>
                  <div className="card">
                    <p className="text-sm text-gray-500">Specialties</p>
                    <p className="text-3xl font-bold text-gray-900">
                      {formatNumber(summary.overview.specialties_covered)}
                    </p>
                  </div>
                </div>

                {/* Resource quality cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {summary.resource_quality.map((rq) => (
                    <div key={rq.resource_type} className="card">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 capitalize">
                            {rq.resource_type}
                          </h3>
                          <p className="text-sm text-gray-500">
                            {formatNumber(rq.total_records)} records &middot;{' '}
                            {formatNumber(rq.active_records)} active
                          </p>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-medium ${
                            rq.active_records / rq.total_records > 0.8
                              ? 'bg-green-100 text-green-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {((rq.active_records / rq.total_records) * 100).toFixed(1)}% active
                        </span>
                      </div>
                      <div className="space-y-3">
                        <CompletenessBar value={rq.completeness.primary_id} label="ID" />
                        <CompletenessBar value={rq.completeness.name} label="Name" />
                        <CompletenessBar value={rq.completeness.address} label="Address" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STATES TAB */}
            {activeTab === 'states' && (
              <div>
                <div className="mb-4">
                  <input
                    type="text"
                    placeholder="Filter states..."
                    className="input-field max-w-xs"
                    value={stateFilter}
                    onChange={(e) => setStateFilter(e.target.value)}
                  />
                </div>
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="pb-3 pr-4">State</th>
                        <th className="pb-3 pr-4 text-right">Providers</th>
                        <th className="pb-3 pr-4 text-right">Organizations</th>
                        <th className="pb-3 pr-4 text-right">Locations</th>
                        <th className="pb-3 pr-4 text-right">Active</th>
                        <th className="pb-3 pr-4 text-right">NPI %</th>
                        <th className="pb-3 text-right">Address %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStates.map((s) => (
                        <tr key={s.state} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 pr-4 font-medium">{s.state}</td>
                          <td className="py-3 pr-4 text-right">{formatNumber(s.providers)}</td>
                          <td className="py-3 pr-4 text-right">{formatNumber(s.organizations)}</td>
                          <td className="py-3 pr-4 text-right">{formatNumber(s.locations)}</td>
                          <td className="py-3 pr-4 text-right">{formatNumber(s.active_providers)}</td>
                          <td className="py-3 pr-4 text-right">
                            <span className={`px-2 py-0.5 rounded ${getCompletenessColor(s.npi_completeness)}`}>
                              {s.npi_completeness.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <span className={`px-2 py-0.5 rounded ${getCompletenessColor(s.address_completeness)}`}>
                              {s.address_completeness.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredStates.length === 0 && (
                    <p className="text-gray-500 text-center py-8">No states match your filter</p>
                  )}
                </div>
              </div>
            )}

            {/* SPECIALTIES TAB */}
            {activeTab === 'specialties' && (
              <div>
                <div className="mb-4">
                  <input
                    type="text"
                    placeholder="Filter specialties..."
                    className="input-field max-w-xs"
                    value={specialtyFilter}
                    onChange={(e) => setSpecialtyFilter(e.target.value)}
                  />
                </div>
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="pb-3 pr-4">Code</th>
                        <th className="pb-3 pr-4">Specialty</th>
                        <th className="pb-3 pr-4 text-right">Providers</th>
                        <th className="pb-3 text-right">Organizations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSpecialties.map((s) => (
                        <tr key={s.code} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 pr-4 font-mono text-xs text-gray-500">{s.code}</td>
                          <td className="py-3 pr-4">{s.display}</td>
                          <td className="py-3 pr-4 text-right">{formatNumber(s.providers)}</td>
                          <td className="py-3 text-right">{formatNumber(s.organizations)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredSpecialties.length === 0 && (
                    <p className="text-gray-500 text-center py-8">No specialties match your filter</p>
                  )}
                </div>
              </div>
            )}

            {/* ENDPOINTS TAB */}
            {activeTab === 'endpoints' && (
              <div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="card">
                    <p className="text-sm text-gray-500">Total Endpoints</p>
                    <p className="text-3xl font-bold text-gray-900">
                      {formatNumber(endpoints.reduce((sum, e) => sum + e.count, 0))}
                    </p>
                  </div>
                  <div className="card">
                    <p className="text-sm text-gray-500">Connection Types</p>
                    <p className="text-3xl font-bold text-gray-900">
                      {new Set(endpoints.map((e) => e.connection_type)).size}
                    </p>
                  </div>
                  <div className="card">
                    <p className="text-sm text-gray-500">Unique Organizations</p>
                    <p className="text-3xl font-bold text-gray-900">
                      {formatNumber(endpoints.reduce((sum, e) => sum + e.unique_organizations, 0))}
                    </p>
                  </div>
                </div>

                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="pb-3 pr-4">Connection Type</th>
                        <th className="pb-3 pr-4">Status</th>
                        <th className="pb-3 pr-4 text-right">Count</th>
                        <th className="pb-3 text-right">Organizations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {endpoints.map((e, i) => (
                        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 pr-4 font-mono text-xs">{e.connection_type}</td>
                          <td className="py-3 pr-4">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                e.status === 'active'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {e.status}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-right">{formatNumber(e.count)}</td>
                          <td className="py-3 text-right">{formatNumber(e.unique_organizations)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
