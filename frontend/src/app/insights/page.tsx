'use client';

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/Navbar';
import { AlertTriangle, ExternalLink, Database, HelpCircle, ChevronDown, ChevronRight } from 'lucide-react';

interface OrgAnalysis {
  query: string;
  totals: {
    organizations: number;
    active_organizations: number;
    inactive_organizations: number;
    unique_practitioners: number;
    total_practitioner_roles: number;
    endpoints: number;
    locations: number;
  };
  state_distribution: Array<{ state: string; count: number }>;
  endpoint_breakdown: Array<{ connection_type: string; status: string; count: number }>;
  endpoint_sample: Array<{ name: string | null; connection_type: string | null; address: string | null; status: string | null; managing_org: string | null }>;
  top_specialties: Array<{ display: string; unique_practitioners: number }>;
  sample_organizations: Array<{ name: string; npi: string | null; state: string | null; city: string | null; active: boolean | null }>;
}

interface BenchmarkMetric {
  label: string;
  npdValue: number;
  publishedValue: number;
  note?: string;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function VarianceBar({ metric }: { metric: BenchmarkMetric }) {
  const max = Math.max(metric.npdValue, metric.publishedValue, 1);
  const npdPct = (metric.npdValue / max) * 100;
  const pubPct = (metric.publishedValue / max) * 100;
  const delta = metric.npdValue - metric.publishedValue;
  const deltaPct = metric.publishedValue > 0 ? (delta / metric.publishedValue) * 100 : 0;

  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-gray-700">{metric.label}</span>
        <span className={'text-xs font-semibold ' + (Math.abs(deltaPct) < 10 ? 'text-green-600' : Math.abs(deltaPct) < 30 ? 'text-yellow-600' : 'text-red-600')}>
          {delta >= 0 ? '+' : ''}{delta.toLocaleString()} ({deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%)
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs w-20 text-blue-700">NPD</span>
          <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-blue-500 rounded-full transition-all" style={{ width: npdPct + '%' }} />
            <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-white mix-blend-difference">
              {metric.npdValue.toLocaleString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs w-20 text-gray-600">Published</span>
          <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-gray-500 rounded-full transition-all" style={{ width: pubPct + '%' }} />
            <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-white mix-blend-difference">
              {metric.publishedValue.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
      {metric.note && <p className="text-xs text-gray-400 mt-1">{metric.note}</p>}
    </div>
  );
}

function Collapsible({ title, icon, defaultOpen = false, children }: { title: string; icon?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 text-left">
        {open ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
        {icon}
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      </button>
      {open && <div className="mt-4 pt-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

// Known UPMC benchmarks from published sources
const UPMC_BENCHMARKS = {
  employed_physicians: { label: 'Employed physicians', value: 5000, source: 'upmc.com/about/facts/numbers' },
  affiliated_physicians: { label: 'Affiliated physicians', value: 6600, source: 'upmc.com/about/facts/numbers' },
  network_physicians: { label: 'Health Plan network physicians', value: 29000, source: 'upmchealthplan.com' },
  outpatient_sites: { label: 'Outpatient sites', value: 800, source: 'upmc.com/about/facts/numbers' },
  hospitals: { label: 'Hospitals (owned)', value: 40, source: 'upmc.com/about/facts/numbers' },
  network_hospitals: { label: 'Network hospitals', value: 140, source: 'upmchealthplan.com' },
};

export default function InsightsPage() {
  const [orgInput, setOrgInput] = useState('UPMC');
  const [data, setData] = useState<OrgAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom benchmark values (editable by user)
  const [benchPhysicians, setBenchPhysicians] = useState(UPMC_BENCHMARKS.affiliated_physicians.value);
  const [benchLocations, setBenchLocations] = useState(UPMC_BENCHMARKS.outpatient_sites.value);
  const [benchHospitals, setBenchHospitals] = useState(UPMC_BENCHMARKS.hospitals.value);

  const fetchAnalysis = useCallback(async (org: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/npd/org-analysis?org=' + encodeURIComponent(org));
      if (!res.ok) throw new Error('Analysis failed');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAnalysis(orgInput); }, [fetchAnalysis, orgInput]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchAnalysis(orgInput);
  };

  // Compute variance metrics
  const variance: BenchmarkMetric[] = data ? [
    { label: 'Unique practitioners (via PractitionerRole)', npdValue: data.totals.unique_practitioners, publishedValue: benchPhysicians,
      note: 'NPD captures PECOS reassignments + EHR vendor submissions, not CAQH network participation' },
    { label: 'Locations managed', npdValue: data.totals.locations, publishedValue: benchLocations },
    { label: 'Organizations matched', npdValue: data.totals.organizations, publishedValue: benchHospitals,
      note: 'NPD counts every Type-2 NPI with this name (incl. dissolved entities NPPES never closed)' },
  ] : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-[1200px] mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">NPD Provenance & Variance Insights</h1>
          <p className="text-gray-500 mt-1">
            What does the CMS National Provider Directory actually tell you — and where does it fall short?
          </p>
        </div>

        {/* Core thesis card */}
        <div className="card bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 mb-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">The shape is new. The provenance is the open question.</h2>
              <p className="text-gray-700 mt-2">
                NPD today is an NPPES pass-through enriched with PECOS reassignment data and CEHRT vendor submissions.
                CAQH is not in the pipeline. That means the same stale, self-attested data that plagued NPPES is
                inherited intact — in a cleaner FHIR wrapper. Here&apos;s what we can verify by looking at 27.2M
                ingested records.
              </p>
            </div>
          </div>
        </div>

        {/* Interactive Org Variance Tool */}
        <div className="card mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Compare Any Organization: NPD vs Published</h2>
          <p className="text-sm text-gray-500 mb-4">
            Enter an org name to search NPD. Supply your own reference numbers to see the variance.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 mb-4">
            <div className="flex-1 min-w-[200px]">
              <label className="label">Organization name (partial match)</label>
              <input type="text" value={orgInput} onChange={(e) => setOrgInput(e.target.value)}
                className="input-field" placeholder="e.g. UPMC, Mayo Clinic, Kaiser" />
            </div>
            <div className="w-32">
              <label className="label">Physicians</label>
              <input type="number" value={benchPhysicians} onChange={(e) => setBenchPhysicians(Number(e.target.value))}
                className="input-field" placeholder="6600" />
            </div>
            <div className="w-32">
              <label className="label">Locations</label>
              <input type="number" value={benchLocations} onChange={(e) => setBenchLocations(Number(e.target.value))}
                className="input-field" placeholder="800" />
            </div>
            <div className="w-32">
              <label className="label">Hospitals</label>
              <input type="number" value={benchHospitals} onChange={(e) => setBenchHospitals(Number(e.target.value))}
                className="input-field" placeholder="40" />
            </div>
            <div className="flex items-end">
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Analyzing...' : 'Analyze'}
              </button>
            </div>
          </form>

          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

          {data && (
            <>
              {/* Stat grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-600 uppercase tracking-wide">Organizations</p>
                  <p className="text-2xl font-bold text-blue-900">{fmt(data.totals.organizations)}</p>
                  <p className="text-xs text-gray-500">
                    {data.totals.active_organizations} active &middot; {data.totals.inactive_organizations} inactive
                  </p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3">
                  <p className="text-xs text-purple-600 uppercase tracking-wide">Practitioners</p>
                  <p className="text-2xl font-bold text-purple-900">{fmt(data.totals.unique_practitioners)}</p>
                  <p className="text-xs text-gray-500">{fmt(data.totals.total_practitioner_roles)} total roles</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3">
                  <p className="text-xs text-amber-600 uppercase tracking-wide">Locations</p>
                  <p className="text-2xl font-bold text-amber-900">{fmt(data.totals.locations)}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <p className="text-xs text-green-600 uppercase tracking-wide">Endpoints</p>
                  <p className="text-2xl font-bold text-green-900">{fmt(data.totals.endpoints)}</p>
                </div>
              </div>

              {/* Variance bars */}
              <div className="mb-6">
                <h3 className="text-base font-semibold text-gray-900 mb-3">Variance vs Published</h3>
                {variance.map((m) => <VarianceBar key={m.label} metric={m} />)}
              </div>

              {/* Active flag callout */}
              {data.totals.organizations > 0 && (
                <div className={'rounded-lg p-4 mb-4 border ' +
                  (data.totals.inactive_organizations === 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200')}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={'w-5 h-5 flex-shrink-0 mt-0.5 ' + (data.totals.inactive_organizations === 0 ? 'text-red-600' : 'text-green-600')} />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        Active-flag signal: {data.totals.inactive_organizations} of {data.totals.organizations} orgs flagged inactive
                        ({((data.totals.inactive_organizations / Math.max(data.totals.organizations, 1)) * 100).toFixed(1)}%)
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        {data.totals.inactive_organizations === 0
                          ? 'The active=true flag passes through from NPPES unchanged. NPPES self-attestation means dissolved or merged entities rarely get flagged inactive. This count is almost certainly implausibly clean.'
                          : 'Some orgs are flagged inactive — better than zero, but the overall NPPES self-attestation problem still applies to active records.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top specialties */}
                {data.top_specialties.length > 0 && (
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 mb-2">Top Specialties (unique practitioners)</h3>
                    <table className="w-full text-sm">
                      <tbody>
                        {data.top_specialties.slice(0, 10).map((s) => (
                          <tr key={s.display} className="border-b border-gray-100">
                            <td className="py-1.5 pr-2 text-gray-800">{s.display}</td>
                            <td className="py-1.5 text-right font-medium">{s.unique_practitioners.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Endpoint breakdown */}
                {data.endpoint_breakdown.length > 0 && (
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 mb-2">Endpoints by Type</h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 border-b">
                          <th className="pb-1 pr-2">Connection</th>
                          <th className="pb-1 pr-2">Status</th>
                          <th className="pb-1 text-right">Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.endpoint_breakdown.slice(0, 8).map((e, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="py-1.5 pr-2 font-mono text-xs">{e.connection_type}</td>
                            <td className="py-1.5 pr-2 text-xs">{e.status}</td>
                            <td className="py-1.5 text-right font-medium">{e.count.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* State distribution */}
              {data.state_distribution.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-base font-semibold text-gray-900 mb-2">Geographic Spread</h3>
                  <div className="flex flex-wrap gap-2">
                    {data.state_distribution.map((s) => (
                      <span key={s.state} className="inline-flex items-center gap-1.5 text-xs bg-gray-100 rounded-full px-2 py-1">
                        <span className="font-semibold">{s.state}</span>
                        <span className="text-gray-500">{s.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Narrative analysis sections */}
        <div className="space-y-4 mb-8">
          <Collapsible
            title="Q1: What is the actual source of truth behind each Practitioner / Organization field?"
            icon={<Database className="w-5 h-5 text-blue-600" />}
            defaultOpen
          >
            <p className="text-sm text-gray-600 mb-4">
              Working through the NDH release specs against what&apos;s actually visible in the 2026-04-09 NPD release:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="pb-2 pr-3">FHIR field</th>
                    <th className="pb-2 pr-3">Primary source</th>
                    <th className="pb-2 pr-3">Update cadence</th>
                    <th className="pb-2">Enforcement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    ['Practitioner.identifier[NPI]', 'NPPES', 'Daily feed', 'CMS-issued, never changes'],
                    ['Practitioner.name', 'NPPES', 'Self-attestation', 'None'],
                    ['Practitioner.address[]', 'NPPES + PECOS (Medicare subset)', 'On self-update / enrollment', 'PECOS validates for Medicare only'],
                    ['Practitioner.telecom', 'NPPES', 'Self-attested', 'None'],
                    ['Practitioner.qualification (taxonomy)', 'NPPES + state licensure (where wired)', 'Uneven', 'State boards vary'],
                    ['Practitioner.active', 'NPPES', 'Effectively never flips to false', 'None'],
                    ['Organization.identifier[NPI]', 'NPPES Type 2', 'Daily', 'CMS-issued'],
                    ['Organization.address', 'NPPES + PECOS', 'Uneven', 'PECOS only for Medicare'],
                    ['PractitionerRole.organization + .practitioner', 'CEHRT vendor bulk submissions (HTI-1) + PECOS reassignment', 'Vendor-dependent', 'HTI-1 publication mandate, not accuracy'],
                    ['PractitionerRole.specialty', 'PECOS Physician Specialty codes', 'Medicare enrollment events', 'PECOS validates'],
                    ['Endpoint.address + .connectionType', 'CEHRT vendor reporting (HTI-1) + payer submissions (CMS-9115-F)', 'Vendor self-report', 'HTI-1 publication'],
                    ['Endpoint.managingOrganization', 'CEHRT vendor assertion', '—', 'None verified'],
                  ].map(([field, source, cadence, enforce]) => (
                    <tr key={field}>
                      <td className="py-2 pr-3 font-mono text-xs text-gray-800">{field}</td>
                      <td className="py-2 pr-3 text-gray-700">{source}</td>
                      <td className="py-2 pr-3 text-gray-700">{cadence}</td>
                      <td className="py-2 text-gray-700">{enforce}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-gray-600 mt-4">
              <strong className="text-gray-900">Bottom line:</strong> NPD Practitioner + Organization is ~90% NPPES with
              PECOS enrichment for the Medicare subset. CAQH is not in the pipeline. Each field inherits the accuracy
              guarantees of its upstream — for NPPES fields that means self-attestation with no enforcement.
            </p>
          </Collapsible>

          <Collapsible
            title="Q2: Can you tell an active provider from one who retired or moved?"
            icon={<HelpCircle className="w-5 h-5 text-orange-600" />}
            defaultOpen
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase">active flag</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">96.7%</p>
                <p className="text-xs text-gray-600 mt-1">marked active nationally. Reality is closer to 85-90% actively practicing. The flag almost never flips.</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase">meta.lastUpdated</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">100%</p>
                <p className="text-xs text-gray-600 mt-1">of practitioners carry the same 2026-04-09 release timestamp. There is no per-provider attestation date.</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase">qualification.period</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">Mostly empty</p>
                <p className="text-xs text-gray-600 mt-1">License entries typically have no start/end dates — you cannot distinguish a current license from one that lapsed.</p>
              </div>
            </div>
            <p className="text-sm text-gray-600">
              <strong className="text-gray-900">Best available proxy:</strong> a Practitioner being referenced by a
              recent <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">PractitionerRole</code> that came from a
              payer directory submission (CMS-9115-F) implies current network participation. This channel is thin in
              2026 and scheduled to ramp through CY2027 for Medicare Advantage. Absent CAQH-style 120-day re-attestation
              pressure, there is no mechanism in the current NPD pipeline to flip a provider from active to retired.
            </p>
          </Collapsible>

          <Collapsible
            title="Q3: Is there a path for CAQH-equivalent credentialing data to feed NPD?"
            icon={<ExternalLink className="w-5 h-5 text-purple-600" />}
            defaultOpen
          >
            <p className="text-sm text-gray-600 mb-3">
              From the HTE release specifications repo (<a className="text-primary-600 underline" href="https://github.com/ftrotter-gov/HTE_data_release_specifications" target="_blank" rel="noreferrer">ftrotter-gov/HTE_data_release_specifications</a>),
              published specs cover:
            </p>
            <ul className="text-sm text-gray-700 space-y-1 mb-3 ml-5 list-disc">
              <li>GeneralProviderEndpointAndAffiliationData</li>
              <li>PayerEndpoints</li>
              <li>Payer_ProviderDataWithoutEndpoints</li>
              <li>CEHRT_Vendor_Reporting</li>
              <li>HowDidTheConnectionGo</li>
            </ul>
            <p className="text-sm text-gray-600 mb-3">
              <strong className="text-gray-900">None mention credentialing, re-attestation, or CAQH ingestion.</strong>{' '}
              Scope is endpoints, affiliations, and connectivity health metrics. The NDH profile library defines
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded mx-1">VerificationResult</code> with
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded mx-1">attestation-who</code> and
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded mx-1">primarysource-who</code> extensions, but
              these are aspirational — no one is populating them in the 2026-04-09 release.
            </p>
            <p className="text-sm text-gray-600">
              A CAQH-derived feed could theoretically enter NPD indirectly via the payer submission channel: a payer
              who credentials through CAQH and then submits its provider directory API. But:
              <strong className="text-gray-900"> (1)</strong> you lose CAQH field provenance once reshaped into FHIR
              Provider Directory format, <strong className="text-gray-900">(2)</strong> nothing in NPD will say
              &quot;this came from CAQH re-attestation on date X,&quot; and <strong className="text-gray-900">(3)</strong>
              it&apos;s scoped to network participants only — not a general credentialing layer. For a single source of
              truth that tells you who&apos;s actively practicing right now, the current NPD architecture does not
              deliver it.
            </p>
          </Collapsible>
        </div>

        {/* Sources */}
        <div className="card mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Sources</h2>
          <ul className="text-sm space-y-1">
            <li><a className="text-primary-600 hover:underline" href="https://directory.cms.gov/" target="_blank" rel="noreferrer">CMS NPD Public Use Files (2026-04-09 release)</a></li>
            <li><a className="text-primary-600 hover:underline" href="https://github.com/ftrotter-gov/HTE_data_release_specifications" target="_blank" rel="noreferrer">HTE Data Release Specifications (GitHub)</a></li>
            <li><a className="text-primary-600 hover:underline" href="https://build.fhir.org/ig/HL7/fhir-us-ndh/" target="_blank" rel="noreferrer">NDH FHIR IG v2.0.0</a></li>
            <li><a className="text-primary-600 hover:underline" href="https://www.upmc.com/about/facts/numbers" target="_blank" rel="noreferrer">UPMC Facts & Figures</a></li>
            <li><a className="text-primary-600 hover:underline" href="https://www.upmchealthplan.com/individuals/health-care-benefits/network-and-access" target="_blank" rel="noreferrer">UPMC Health Plan Network & Access</a></li>
            <li><a className="text-primary-600 hover:underline" href="https://www.mimilabs.ai/report/69e26d7d9697d7ef606ff123" target="_blank" rel="noreferrer">mimilabs &mdash; NPPES vs CMS NPD</a></li>
            <li><a className="text-primary-600 hover:underline" href="https://mimilabs.github.io/hccinfhir/" target="_blank" rel="noreferrer">mimilabs &mdash; hccinfhir (CMS encounter/837 claims)</a></li>
          </ul>
        </div>

        {/* Disclaimer */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Disclaimer &mdash; Use At Your Own Volition</h3>
              <p className="text-sm text-gray-700">
                Every NPD number here is subject to (a) a measured 0.015% ingestion error rate against the CMS source
                manifest (see <a className="underline" href="/data-quality">Data Quality</a>), (b) deduplication choices
                (ROW_NUMBER by <code className="text-xs bg-white px-1 rounded">_id</code>), and (c) FHIR reference
                parsing. Name-pattern matching (e.g., &quot;UPMC&quot;) may catch unrelated orgs like
                &quot;Arthritis and Internal Medicine Associates-UPMC in San Diego&quot; which is unlikely to be UPMC
                Pittsburgh. Published organizational numbers (UPMC marketing pages, Health Plan network pages) are
                themselves marketing-curated and may not reflect current credentialed counts. CAQH counts are not
                publicly available at the org level.
              </p>
              <p className="text-sm text-gray-700 mt-2">
                <strong>Anyone making a business or clinical decision off these numbers should verify against primary
                sources.</strong> The core finding stands regardless: NPD today is a structural improvement over
                searching NPPES by hand — not yet a provenance improvement.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
