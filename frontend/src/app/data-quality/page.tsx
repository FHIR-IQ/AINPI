'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Navbar from '@/components/Navbar';

// Dynamic imports to avoid SSR issues with D3
const USChoroplethMap = dynamic(() => import('@/components/charts/USChoroplethMap'), { ssr: false });
const QualityGauge = dynamic(() => import('@/components/charts/QualityGauge'), { ssr: false });
const SpecialtyTreemap = dynamic(() => import('@/components/charts/SpecialtyTreemap'), { ssr: false });
const EndpointSunburst = dynamic(() => import('@/components/charts/EndpointSunburst'), { ssr: false });
const CompletenessHeatmap = dynamic(() => import('@/components/charts/CompletenessHeatmap'), { ssr: false });
const StateBarChart = dynamic(() => import('@/components/charts/StateBarChart'), { ssr: false });
const SankeyGraph = dynamic(() => import('@/components/charts/SankeyGraph'), { ssr: false });
const KnowledgeGraph = dynamic(() => import('@/components/charts/KnowledgeGraph'), { ssr: false });

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

interface RelationshipStats {
  total_practitioners: number;
  total_organizations: number;
  total_locations: number;
  total_endpoints: number;
  total_roles: number;
  practitioners_with_roles: number;
  orgs_with_practitioners: number;
  orgs_with_endpoints: number;
}

interface TopOrg {
  org_id: string;
  org_name: string;
  state: string;
  city: string;
  practitioner_count: number;
  specialty_count: number;
  endpoint_count: number;
}

export default function DataQualityDashboard() {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [states, setStates] = useState<StateData[]>([]);
  const [specialties, setSpecialties] = useState<SpecialtyData[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointData[]>([]);
  const [relStats, setRelStats] = useState<RelationshipStats | null>(null);
  const [topOrgs, setTopOrgs] = useState<TopOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, statesRes, specialtiesRes, endpointsRes, relRes] = await Promise.all([
        fetch('/api/npd/data-quality?view=summary'),
        fetch('/api/npd/data-quality?view=states'),
        fetch('/api/npd/data-quality?view=specialties&limit=100'),
        fetch('/api/npd/data-quality?view=endpoints'),
        fetch('/api/npd/relationships?view=overview&limit=15'),
      ]);

      if (!summaryRes.ok) throw new Error('Failed to fetch data quality metrics');

      const [summaryData, statesData, specialtiesData, endpointsData, relData] = await Promise.all([
        summaryRes.json(),
        statesRes.json(),
        specialtiesRes.json(),
        endpointsRes.json(),
        relRes.ok ? relRes.json() : { stats: null, top_organizations: [] },
      ]);

      setSummary(summaryData);
      setStates(statesData.states || []);
      setSpecialties(specialtiesData.specialties || []);
      setEndpoints(endpointsData.by_type || []);
      if (relData.stats) setRelStats(relData.stats);
      setTopOrgs(relData.top_organizations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  function formatNumber(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  }

  // Build heatmap data from resource quality
  const heatmapData = summary?.resource_quality.map((rq) => [
    { row: rq.resource_type, col: 'Primary ID', value: rq.completeness.primary_id },
    { row: rq.resource_type, col: 'Name', value: rq.completeness.name },
    { row: rq.resource_type, col: 'Address', value: rq.completeness.address },
    { row: rq.resource_type, col: 'Active %', value: rq.total_records > 0 ? (rq.active_records / rq.total_records) * 100 : 0 },
  ]).flat() || [];

  // Compute overall quality score
  const overallScore = summary?.resource_quality.length
    ? summary.resource_quality.reduce((sum, rq) => {
        const avg = (rq.completeness.primary_id + rq.completeness.name + rq.completeness.address) / 3;
        return sum + avg;
      }, 0) / summary.resource_quality.length
    : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-[1400px] mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            CMS National Provider Directory
          </h1>
          <p className="text-gray-500 mt-1">
            Data Quality Intelligence &mdash; Release: 2026-04-09 &mdash; 27.2M records from directory.cms.gov
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-700">{error}</p>
            <p className="text-red-500 text-sm mt-1">
              Ensure BigQuery data has been ingested and synced to Supabase.
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto" />
              <p className="text-gray-500 mt-4">Loading data quality metrics...</p>
            </div>
          </div>
        ) : summary && (
          <div className="space-y-8">

            {/* Row 1: KPI Cards + Overall Quality Gauge */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                {summary.resource_quality.map((rq) => (
                  <div key={rq.resource_type} className="card">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                      {rq.resource_type}s
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {formatNumber(rq.total_records)}
                    </p>
                    <div className="flex items-center gap-1 mt-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full bg-green-500 transition-all"
                          style={{ width: `${rq.total_records > 0 ? (rq.active_records / rq.total_records) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">
                        {rq.total_records > 0 ? ((rq.active_records / rq.total_records) * 100).toFixed(0) : 0}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="lg:col-span-2 card flex items-center justify-center">
                <QualityGauge
                  value={overallScore}
                  label="Overall Data Quality"
                  sublabel={`${summary.overview.states_covered} states, ${formatNumber(summary.overview.total_records)} records`}
                  size={200}
                />
              </div>
            </div>

            {/* Row 2: Completeness Heatmap */}
            <div className="card">
              <CompletenessHeatmap
                data={heatmapData}
                title="Data Completeness by Resource Type"
                width={800}
                height={280}
              />
            </div>

            {/* Row 3: US Map + State Bar Chart */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="card">
                <USChoroplethMap
                  data={states.map((s) => ({ state: s.state, value: s.locations }))}
                  title="Healthcare Locations by State"
                  colorScheme="blues"
                  formatValue={(v) => `${v.toLocaleString()} locations`}
                  width={660}
                  height={440}
                />
              </div>
              <div className="card">
                <USChoroplethMap
                  data={states.map((s) => ({ state: s.state, value: s.providers }))}
                  title="Practitioners by State"
                  colorScheme="purples"
                  formatValue={(v) => `${v.toLocaleString()} practitioners`}
                  width={660}
                  height={440}
                />
              </div>
            </div>

            {/* Row 4: Top States Stacked Bar */}
            <div className="card">
              <StateBarChart
                data={states}
                title="Top 25 States — Providers, Organizations & Locations"
                width={1300}
                height={400}
                top={25}
              />
            </div>

            {/* Row 5: Quality Gauges per Resource */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Completeness Scores by Resource</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {summary.resource_quality.map((rq) => {
                  const avg = (rq.completeness.primary_id + rq.completeness.name + rq.completeness.address) / 3;
                  return (
                    <QualityGauge
                      key={rq.resource_type}
                      value={avg}
                      label={rq.resource_type.charAt(0).toUpperCase() + rq.resource_type.slice(1)}
                      sublabel={`${formatNumber(rq.total_records)} records`}
                      size={160}
                    />
                  );
                })}
              </div>
            </div>

            {/* Row 6: Specialty Treemap + Endpoint Sunburst */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="card">
                <SpecialtyTreemap
                  data={specialties}
                  title="Provider Specialty Distribution"
                  width={640}
                  height={450}
                />
              </div>
              <div className="card">
                <EndpointSunburst
                  data={endpoints}
                  title="FHIR Endpoint Distribution"
                  size={400}
                />
              </div>
            </div>

            {/* Row 7: State detail table */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">State-Level Data Quality</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="pb-3 pr-4">State</th>
                      <th className="pb-3 pr-4 text-right">Practitioners</th>
                      <th className="pb-3 pr-4 text-right">Organizations</th>
                      <th className="pb-3 pr-4 text-right">Locations</th>
                      <th className="pb-3 pr-4 text-right">Active</th>
                      <th className="pb-3 text-right">NPI Completeness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {states.slice(0, 20).map((s) => (
                      <tr key={s.state} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2.5 pr-4 font-semibold">{s.state}</td>
                        <td className="py-2.5 pr-4 text-right">{s.providers.toLocaleString()}</td>
                        <td className="py-2.5 pr-4 text-right">{s.organizations.toLocaleString()}</td>
                        <td className="py-2.5 pr-4 text-right">{s.locations.toLocaleString()}</td>
                        <td className="py-2.5 pr-4 text-right">{s.active_providers.toLocaleString()}</td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${
                                  s.npi_completeness >= 90 ? 'bg-green-500' :
                                  s.npi_completeness >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                                }`}
                                style={{ width: `${Math.min(s.npi_completeness, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium w-12 text-right">
                              {s.npi_completeness.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Row 8: Relationship Stats */}
            {relStats && (
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">FHIR Resource Relationships</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-blue-700">{formatNumber(Number(relStats.practitioners_with_roles))}</p>
                    <p className="text-xs text-blue-500">Practitioners with Roles</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-purple-700">{formatNumber(Number(relStats.orgs_with_practitioners))}</p>
                    <p className="text-xs text-purple-500">Orgs with Practitioners</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-green-700">{formatNumber(Number(relStats.orgs_with_endpoints))}</p>
                    <p className="text-xs text-green-500">Orgs with Endpoints</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-amber-700">{formatNumber(Number(relStats.total_roles))}</p>
                    <p className="text-xs text-amber-500">Total PractitionerRoles</p>
                  </div>
                </div>
              </div>
            )}

            {/* Row 9: Sankey — Organization -> Practitioner -> Endpoint flow */}
            {topOrgs.length > 0 && (
              <div className="card">
                <SankeyGraph
                  title="Organization Network — Practitioners & Endpoints"
                  nodes={[
                    ...topOrgs.map((o) => ({ id: o.org_id, name: o.org_name || 'Unknown', type: 'organization' as const, count: Number(o.practitioner_count) })),
                    ...topOrgs.filter((o) => Number(o.practitioner_count) > 0).map((o) => ({
                      id: 'practitioners-' + o.org_id, name: Number(o.practitioner_count).toLocaleString() + ' practitioners',
                      type: 'practitioner' as const, count: Number(o.practitioner_count),
                    })),
                    ...topOrgs.filter((o) => Number(o.endpoint_count) > 0).map((o) => ({
                      id: 'endpoints-' + o.org_id, name: Number(o.endpoint_count).toLocaleString() + ' endpoints',
                      type: 'endpoint' as const, count: Number(o.endpoint_count),
                    })),
                  ]}
                  links={[
                    ...topOrgs.filter((o) => Number(o.practitioner_count) > 0).map((o) => ({
                      source: o.org_id, target: 'practitioners-' + o.org_id, value: Number(o.practitioner_count),
                    })),
                    ...topOrgs.filter((o) => Number(o.endpoint_count) > 0).map((o) => ({
                      source: o.org_id, target: 'endpoints-' + o.org_id, value: Number(o.endpoint_count),
                    })),
                  ]}
                  width={1300}
                  height={600}
                />
              </div>
            )}

            {/* Row 10: Knowledge Graph */}
            {topOrgs.length > 0 && (
              <div className="card">
                <KnowledgeGraph
                  title="Provider Network Knowledge Graph"
                  nodes={[
                    ...topOrgs.map((o) => ({
                      id: o.org_id, label: o.org_name || 'Unknown', type: 'organization' as const,
                      size: Number(o.practitioner_count),
                    })),
                    ...topOrgs.filter((o) => Number(o.practitioner_count) > 0).map((o) => ({
                      id: 'p-' + o.org_id,
                      label: Number(o.practitioner_count).toLocaleString() + ' practitioners',
                      type: 'practitioner' as const, size: Number(o.practitioner_count) / 5,
                    })),
                    ...topOrgs.filter((o) => Number(o.endpoint_count) > 0).map((o) => ({
                      id: 'e-' + o.org_id,
                      label: Number(o.endpoint_count).toLocaleString() + ' endpoints',
                      type: 'endpoint' as const, size: Number(o.endpoint_count) / 2,
                    })),
                  ]}
                  links={[
                    ...topOrgs.filter((o) => Number(o.practitioner_count) > 0).map((o) => ({
                      source: o.org_id, target: 'p-' + o.org_id, relationship: 'employs',
                    })),
                    ...topOrgs.filter((o) => Number(o.endpoint_count) > 0).map((o) => ({
                      source: o.org_id, target: 'e-' + o.org_id, relationship: 'manages',
                    })),
                  ]}
                  width={1300}
                  height={700}
                />
              </div>
            )}

            {/* Footer */}
            <p className="text-xs text-gray-400 text-center">
              Data sourced from CMS National Provider Directory (directory.cms.gov) &mdash; Release 2026-04-09 &mdash;
              Powered by Google BigQuery &middot; 27,204,567 records across 6 FHIR resource types
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
