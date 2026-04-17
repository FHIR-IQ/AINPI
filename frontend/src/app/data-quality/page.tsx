'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Navbar from '@/components/Navbar';
import { ChartSelect, ChartHeader } from '@/components/charts/ChartControls';
import { FilterProvider, useFilters } from '@/contexts/FilterContext';

const USChoroplethMap = dynamic(() => import('@/components/charts/USChoroplethMap'), { ssr: false });
const QualityGauge = dynamic(() => import('@/components/charts/QualityGauge'), { ssr: false });
const SpecialtyTreemap = dynamic(() => import('@/components/charts/SpecialtyTreemap'), { ssr: false });
const EndpointSunburst = dynamic(() => import('@/components/charts/EndpointSunburst'), { ssr: false });
const CompletenessHeatmap = dynamic(() => import('@/components/charts/CompletenessHeatmap'), { ssr: false });
const StateBarChart = dynamic(() => import('@/components/charts/StateBarChart'), { ssr: false });
const SankeyGraph = dynamic(() => import('@/components/charts/SankeyGraph'), { ssr: false });
const KnowledgeGraph = dynamic(() => import('@/components/charts/KnowledgeGraph'), { ssr: false });
const FilterBreadcrumb = dynamic(() => import('@/components/charts/FilterBreadcrumb'), { ssr: false });
const StateDetailPanel = dynamic(() => import('@/components/charts/StateDetailPanel'), { ssr: false });
const DataValidationPanel = dynamic(() => import('@/components/charts/DataValidationPanel'), { ssr: false });

interface ResourceQuality { resource_type: string; total_records: number; active_records: number; completeness: { primary_id: number; name: number; address: number }; }
interface StateData { state: string; providers: number; organizations: number; locations: number; active_providers: number; npi_completeness: number; address_completeness: number; }
interface SpecialtyData { code: string; display: string; providers: number; organizations: number; }
interface EndpointData { connection_type: string; status: string; count: number; unique_organizations: number; }
interface SummaryData { release_date: string; overview: { total_records: number; states_covered: number; specialties_covered: number }; resource_quality: ResourceQuality[]; }
interface RelationshipStats { total_practitioners: number; total_organizations: number; total_locations: number; total_endpoints: number; total_roles: number; practitioners_with_roles: number; orgs_with_practitioners: number; orgs_with_endpoints: number; }
interface TopOrg { org_id: string; org_name: string; state: string; city: string; practitioner_count: number; specialty_count: number; endpoint_count: number; }

const MAP_METRICS = [
  { value: 'locations', label: 'Locations' },
  { value: 'providers', label: 'Practitioners' },
  { value: 'organizations', label: 'Organizations' },
  { value: 'active_providers', label: 'Active Practitioners' },
];
const MAP_COLORS = [
  { value: 'blues', label: 'Blue' },
  { value: 'greens', label: 'Green' },
  { value: 'purples', label: 'Purple' },
  { value: 'oranges', label: 'Orange' },
  { value: 'reds', label: 'Red' },
];
const BAR_TOPS = [
  { value: '10', label: 'Top 10' },
  { value: '15', label: 'Top 15' },
  { value: '25', label: 'Top 25' },
  { value: '50', label: 'All States' },
];
const SANKEY_LIMITS = [
  { value: '5', label: 'Top 5 Orgs' },
  { value: '10', label: 'Top 10 Orgs' },
  { value: '15', label: 'Top 15 Orgs' },
  { value: '20', label: 'Top 20 Orgs' },
];

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function DashboardContent() {
  const { filters, setState: setFilterState, setSpecialty } = useFilters();

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [states, setStates] = useState<StateData[]>([]);
  const [specialties, setSpecialties] = useState<SpecialtyData[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointData[]>([]);
  const [relStats, setRelStats] = useState<RelationshipStats | null>(null);
  const [topOrgs, setTopOrgs] = useState<TopOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Visualization controls
  const [mapMetric, setMapMetric] = useState('locations');
  const [mapColor, setMapColor] = useState('blues');
  const [barTop, setBarTop] = useState('25');
  const [sankeyLimit, setSankeyLimit] = useState('10');
  const [stateFilter, setStateFilter] = useState('');
  const [specialtyFilter, setSpecialtyFilter] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, statesRes, specialtiesRes, endpointsRes, relRes] = await Promise.all([
        fetch('/api/npd/data-quality?view=summary'),
        fetch('/api/npd/data-quality?view=states'),
        fetch('/api/npd/data-quality?view=specialties&limit=200'),
        fetch('/api/npd/data-quality?view=endpoints'),
        fetch('/api/npd/relationships?view=overview&limit=20'),
      ]);
      if (!summaryRes.ok) throw new Error('Failed to fetch data quality metrics');
      const [summaryData, statesData, specialtiesData, endpointsData, relData] = await Promise.all([
        summaryRes.json(), statesRes.json(), specialtiesRes.json(), endpointsRes.json(),
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

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const mapData = useMemo(() => states.map((s) => ({
    state: s.state,
    value: (s[mapMetric as keyof StateData] as number) || 0,
  })), [states, mapMetric]);

  const heatmapData = useMemo(() => {
    return summary?.resource_quality.flatMap((rq) => [
      { row: rq.resource_type, col: 'Primary ID', value: rq.completeness.primary_id },
      { row: rq.resource_type, col: 'Name', value: rq.completeness.name },
      { row: rq.resource_type, col: 'Address', value: rq.completeness.address },
      { row: rq.resource_type, col: 'Active %', value: rq.total_records > 0 ? (rq.active_records / rq.total_records) * 100 : 0 },
    ]) || [];
  }, [summary]);

  const overallScore = useMemo(() => {
    if (!summary?.resource_quality.length) return 0;
    return summary.resource_quality.reduce((sum, rq) =>
      sum + (rq.completeness.primary_id + rq.completeness.name + rq.completeness.address) / 3, 0
    ) / summary.resource_quality.length;
  }, [summary]);

  // Apply filter to states (for sections that aren't the drill-down)
  const filteredStateData = useMemo(() => {
    return filters.state ? states.filter((s) => s.state === filters.state) : states;
  }, [states, filters.state]);

  const sankeyN = parseInt(sankeyLimit);
  const sankeyOrgs = useMemo(() => {
    const filtered = filters.state ? topOrgs.filter((o) => o.state === filters.state) : topOrgs;
    return filtered.slice(0, sankeyN);
  }, [topOrgs, filters.state, sankeyN]);

  const filteredStates = states.filter((s) => !stateFilter || s.state.includes(stateFilter.toUpperCase()));
  const filteredSpecialties = specialties.filter((s) =>
    !specialtyFilter || s.display.toLowerCase().includes(specialtyFilter.toLowerCase()) || s.code.includes(specialtyFilter)
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-[1400px] mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">CMS National Provider Directory</h1>
          <p className="text-gray-500 mt-1">Cross-filtered, drill-down data quality intelligence — Release 2026-04-09</p>
        </div>

        <FilterBreadcrumb />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-700">{error}</p>
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

            {/* Validation panel at the top — authoritative source-vs-ingested check */}
            <DataValidationPanel />

            {/* Row 1: KPI + Gauge */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                {summary.resource_quality.map((rq) => (
                  <div key={rq.resource_type} className="card">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{rq.resource_type}s</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(rq.total_records)}</p>
                    <div className="flex items-center gap-1 mt-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-green-500" style={{ width: (rq.total_records > 0 ? (rq.active_records / rq.total_records) * 100 : 0) + '%' }} />
                      </div>
                      <span className="text-xs text-gray-500">{rq.total_records > 0 ? ((rq.active_records / rq.total_records) * 100).toFixed(0) : 0}%</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="lg:col-span-2 card flex items-center justify-center">
                <QualityGauge value={overallScore} label="Overall Data Quality" sublabel={summary.overview.states_covered + ' states, ' + fmt(summary.overview.total_records) + ' records'} size={200} />
              </div>
            </div>

            {/* Row 2: Completeness Heatmap */}
            <div className="card">
              <CompletenessHeatmap data={heatmapData} title="Data Completeness by Resource Type" width={800} height={280} />
            </div>

            {/* Row 3: US Map with click-to-filter */}
            <div className="card">
              <ChartHeader title="Geographic Distribution" subtitle="Click any state to drill down to city level. Click again to clear.">
                <ChartSelect label="Metric" value={mapMetric} options={MAP_METRICS} onChange={setMapMetric} />
                <ChartSelect label="Color" value={mapColor} options={MAP_COLORS} onChange={setMapColor} />
              </ChartHeader>
              <USChoroplethMap
                data={mapData}
                title=""
                colorScheme={mapColor as 'blues' | 'greens' | 'oranges' | 'purples' | 'reds'}
                formatValue={(v) => fmt(v) + ' ' + MAP_METRICS.find((m) => m.value === mapMetric)?.label.toLowerCase()}
                width={1300}
                height={600}
                onStateClick={(s) => setFilterState(s || null)}
                selectedState={filters.state}
              />
            </div>

            {/* State Detail Panel — appears when state is selected */}
            {filters.state && <StateDetailPanel />}

            {/* Row 4: Top States Stacked Bar with click-to-filter */}
            <div className="card">
              <ChartHeader title="States — Providers, Organizations & Locations" subtitle="Click a state bar to filter">
                <ChartSelect label="Show" value={barTop} options={BAR_TOPS} onChange={setBarTop} />
              </ChartHeader>
              <StateBarChart
                data={states}
                title=""
                width={1300}
                height={420}
                top={parseInt(barTop)}
                onStateClick={(s) => setFilterState(s || null)}
                selectedState={filters.state}
              />
            </div>

            {/* Row 5: Quality Gauges per Resource */}
            <div className="card">
              <ChartHeader title="Completeness Scores by Resource" subtitle="Average of Primary ID, Name, and Address completeness" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {summary.resource_quality.map((rq) => (
                  <QualityGauge
                    key={rq.resource_type}
                    value={(rq.completeness.primary_id + rq.completeness.name + rq.completeness.address) / 3}
                    label={rq.resource_type.charAt(0).toUpperCase() + rq.resource_type.slice(1)}
                    sublabel={fmt(rq.total_records) + ' records'}
                    size={160}
                  />
                ))}
              </div>
            </div>

            {/* Row 6: Specialty Treemap (click to filter) + Endpoint Sunburst */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="card">
                <ChartHeader title="Provider Specialty Distribution" subtitle="Click a specialty to filter. Sized by provider count.">
                  <input
                    type="text"
                    placeholder="Filter specialties..."
                    className="text-sm border border-gray-200 rounded-md px-2 py-1 w-40 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    value={specialtyFilter}
                    onChange={(e) => setSpecialtyFilter(e.target.value)}
                  />
                </ChartHeader>
                <SpecialtyTreemap
                  data={filteredSpecialties.length > 0 ? filteredSpecialties : specialties}
                  title=""
                  width={640}
                  height={450}
                  onSpecialtyClick={(s) => setSpecialty(s || null)}
                  selectedSpecialty={filters.specialty}
                />
              </div>
              <div className="card">
                <ChartHeader title="FHIR Endpoint Distribution" subtitle="Inner: connection type, Outer: status" />
                <EndpointSunburst data={endpoints} title="" size={400} />
              </div>
            </div>

            {/* Row 7: Relationship Stats */}
            {relStats && (
              <div className="card">
                <ChartHeader title="FHIR Resource Relationships" subtitle="Cross-resource linkage from PractitionerRole, Endpoint, and OrganizationAffiliation" />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-blue-700">{fmt(Number(relStats.practitioners_with_roles))}</p>
                    <p className="text-xs text-blue-500">Practitioners with Roles</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-purple-700">{fmt(Number(relStats.orgs_with_practitioners))}</p>
                    <p className="text-xs text-purple-500">Orgs with Practitioners</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-green-700">{fmt(Number(relStats.orgs_with_endpoints))}</p>
                    <p className="text-xs text-green-500">Orgs with Endpoints</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-amber-700">{fmt(Number(relStats.total_roles))}</p>
                    <p className="text-xs text-amber-500">Total PractitionerRoles</p>
                  </div>
                </div>
              </div>
            )}

            {/* Row 8: Sankey (filtered by selected state) */}
            {sankeyOrgs.length > 0 && (
              <div className="card">
                <ChartHeader
                  title={'Organization Network Flow' + (filters.state ? ' — ' + filters.state : '')}
                  subtitle="Organization → Practitioners → Endpoints"
                >
                  <ChartSelect label="Show" value={sankeyLimit} options={SANKEY_LIMITS} onChange={setSankeyLimit} />
                </ChartHeader>
                <SankeyGraph
                  title=""
                  nodes={[
                    ...sankeyOrgs.map((o) => ({ id: o.org_id, name: o.org_name || 'Unknown', type: 'organization' as const, count: Number(o.practitioner_count) })),
                    ...sankeyOrgs.filter((o) => Number(o.practitioner_count) > 0).map((o) => ({ id: 'p-' + o.org_id, name: fmt(Number(o.practitioner_count)) + ' practitioners', type: 'practitioner' as const, count: Number(o.practitioner_count) })),
                    ...sankeyOrgs.filter((o) => Number(o.endpoint_count) > 0).map((o) => ({ id: 'e-' + o.org_id, name: fmt(Number(o.endpoint_count)) + ' endpoints', type: 'endpoint' as const, count: Number(o.endpoint_count) })),
                  ]}
                  links={[
                    ...sankeyOrgs.filter((o) => Number(o.practitioner_count) > 0).map((o) => ({ source: o.org_id, target: 'p-' + o.org_id, value: Number(o.practitioner_count) })),
                    ...sankeyOrgs.filter((o) => Number(o.endpoint_count) > 0).map((o) => ({ source: o.org_id, target: 'e-' + o.org_id, value: Number(o.endpoint_count) })),
                  ]}
                  width={1300}
                  height={550}
                />
              </div>
            )}

            {/* Row 9: Knowledge Graph */}
            {sankeyOrgs.length > 0 && (
              <div className="card">
                <KnowledgeGraph
                  title="Provider Network Knowledge Graph"
                  nodes={[
                    ...sankeyOrgs.map((o) => ({ id: o.org_id, label: o.org_name || 'Unknown', type: 'organization' as const, size: Number(o.practitioner_count) })),
                    ...sankeyOrgs.filter((o) => Number(o.practitioner_count) > 0).map((o) => ({ id: 'p-' + o.org_id, label: fmt(Number(o.practitioner_count)) + ' practitioners', type: 'practitioner' as const, size: Number(o.practitioner_count) / 5 })),
                    ...sankeyOrgs.filter((o) => Number(o.endpoint_count) > 0).map((o) => ({ id: 'e-' + o.org_id, label: fmt(Number(o.endpoint_count)) + ' endpoints', type: 'endpoint' as const, size: Number(o.endpoint_count) / 2 })),
                  ]}
                  links={[
                    ...sankeyOrgs.filter((o) => Number(o.practitioner_count) > 0).map((o) => ({ source: o.org_id, target: 'p-' + o.org_id, relationship: 'employs' })),
                    ...sankeyOrgs.filter((o) => Number(o.endpoint_count) > 0).map((o) => ({ source: o.org_id, target: 'e-' + o.org_id, relationship: 'manages' })),
                  ]}
                  width={1300}
                  height={700}
                />
              </div>
            )}

            {/* Row 10: State table — respects state filter */}
            <div className="card">
              <ChartHeader title="State-Level Data Quality" subtitle="Filterable table with completeness metrics. Click a state to drill down.">
                <input
                  type="text"
                  placeholder="Filter states..."
                  className="text-sm border border-gray-200 rounded-md px-2 py-1 w-32 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                />
              </ChartHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="pb-3 pr-4">State</th>
                      <th className="pb-3 pr-4 text-right">Practitioners</th>
                      <th className="pb-3 pr-4 text-right">Organizations</th>
                      <th className="pb-3 pr-4 text-right">Locations</th>
                      <th className="pb-3 pr-4 text-right">Active</th>
                      <th className="pb-3 text-right">NPI %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(filters.state ? filteredStateData : filteredStates).map((s) => (
                      <tr
                        key={s.state}
                        className={'border-b border-gray-100 cursor-pointer ' + (s.state === filters.state ? 'bg-primary-50 hover:bg-primary-100' : 'hover:bg-gray-50')}
                        onClick={() => setFilterState(s.state === filters.state ? null : s.state)}
                      >
                        <td className="py-2.5 pr-4 font-semibold">{s.state}</td>
                        <td className="py-2.5 pr-4 text-right">{s.providers.toLocaleString()}</td>
                        <td className="py-2.5 pr-4 text-right">{s.organizations.toLocaleString()}</td>
                        <td className="py-2.5 pr-4 text-right">{s.locations.toLocaleString()}</td>
                        <td className="py-2.5 pr-4 text-right">{s.active_providers.toLocaleString()}</td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-gray-200 rounded-full h-2">
                              <div className={'h-2 rounded-full ' + (s.npi_completeness >= 90 ? 'bg-green-500' : s.npi_completeness >= 70 ? 'bg-yellow-500' : 'bg-red-500')} style={{ width: Math.min(s.npi_completeness, 100) + '%' }} />
                            </div>
                            <span className="text-xs font-medium w-12 text-right">{s.npi_completeness.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-xs text-gray-400 text-center">
              CMS National Provider Directory (directory.cms.gov) — Release 2026-04-09 — Powered by Google BigQuery
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DataQualityDashboard() {
  return (
    <FilterProvider>
      <DashboardContent />
    </FilterProvider>
  );
}
