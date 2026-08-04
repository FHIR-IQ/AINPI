'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { PaRuralPayload, PaOverlay, PaHospital } from '@/lib/pa-rural-types';
import { PA_OVERLAYS } from '@/lib/pa-rural-types';
import InlineSubscribe from '@/components/InlineSubscribe';

const PaCountyMap = dynamic(() => import('@/components/charts/PaCountyMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] flex items-center justify-center bg-white rounded-lg border border-gray-200 text-gray-500">
      Loading map…
    </div>
  ),
});

type RuralFilter = 'all' | 'rural_county' | 'critical_access' | 'metro';
type EndpointFilter = 'all' | 'in_bundle' | 'no_bundle' | 'endpoint_linked';

export default function RuralExplorer({ payload }: { payload: PaRuralPayload }) {
  const [overlay, setOverlay] = useState<PaOverlay>('rural');
  const [county, setCounty] = useState<string | null>(null);
  const [rural, setRural] = useState<RuralFilter>('all');
  const [endpoint, setEndpoint] = useState<EndpointFilter>('all');
  const [vendor, setVendor] = useState<string>('all');
  const [system, setSystem] = useState<string>('all');

  const systems = useMemo(() => {
    const s = new Set<string>();
    payload.hospitals.forEach((h) => h.health_system && s.add(h.health_system));
    return Array.from(s).sort();
  }, [payload.hospitals]);

  const vendors = useMemo(
    () => Object.keys(payload.summary.ehr_vendors),
    [payload.summary.ehr_vendors],
  );

  const filtered = useMemo(() => {
    return payload.hospitals.filter((h) => {
      if (county && h.county_fips !== county) return false;
      if (rural === 'rural_county' && !h.county_rural) return false;
      if (rural === 'metro' && h.county_rural) return false;
      if (rural === 'critical_access' && !h.critical_access) return false;
      if (endpoint === 'in_bundle' && !h.in_cehrt_bundle) return false;
      if (endpoint === 'no_bundle' && h.in_cehrt_bundle) return false;
      if (endpoint === 'endpoint_linked' && !h.org_endpoint_linked) return false;
      if (vendor !== 'all' && h.ehr_vendor !== vendor) return false;
      if (system !== 'all' && h.health_system !== system) return false;
      return true;
    });
  }, [payload.hospitals, county, rural, endpoint, vendor, system]);

  const countyName = county
    ? payload.counties.find((c) => c.fips === county)?.name
    : null;

  const spec = PA_OVERLAYS.find((o) => o.key === overlay)!;
  const inBundle = filtered.filter((h) => h.in_cehrt_bundle).length;

  const reset = () => {
    setCounty(null);
    setRural('all');
    setEndpoint('all');
    setVendor('all');
    setSystem('all');
  };

  return (
    <div className="space-y-4">
      {/* Overlay picker */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
          County overlay
        </div>
        <div className="flex flex-wrap gap-2">
          {PA_OVERLAYS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setOverlay(o.key)}
              aria-pressed={o.key === overlay ? 'true' : 'false'}
              className={
                'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ' +
                (o.key === overlay
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
              }
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-600 mt-3 leading-relaxed">{spec.description}</p>
      </div>

      <PaCountyMap
        counties={payload.counties}
        hospitals={payload.hospitals}
        overlay={overlay}
        selectedCounty={county}
        onCountyClick={setCounty}
      />
      <p className="text-xs text-gray-500">
        Hospital markers sit at the centroid of their county, spread apart so
        each is clickable. They show which county a hospital is in, not its
        street address. AINPI runs no geocoding service.
      </p>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap gap-4">
          <label className="text-sm">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Rural designation
            </span>
            <select
              value={rural}
              onChange={(e) => setRural(e.target.value as RuralFilter)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm"
            >
              <option value="all">All hospitals</option>
              <option value="rural_county">In a nonmetro county</option>
              <option value="metro">In a metro county</option>
              <option value="critical_access">Critical Access only</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
              FHIR presence
            </span>
            <select
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value as EndpointFilter)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm"
            >
              <option value="all">Any</option>
              <option value="in_bundle">In a certified-EHR bundle</option>
              <option value="no_bundle">No bundle found</option>
              <option value="endpoint_linked">Cross-linked to an endpoint</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
              EHR vendor
            </span>
            <select
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm"
            >
              <option value="all">All vendors</option>
              {vendors.map((v) => (
                <option key={v} value={v}>
                  {v} ({payload.summary.ehr_vendors[v]})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Health system
            </span>
            <select
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm"
            >
              <option value="all">All systems</option>
              {systems.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-gray-100 text-sm">
          <span className="text-gray-700">
            <strong>{filtered.length}</strong> hospital{filtered.length === 1 ? '' : 's'}
            {countyName ? ` in ${countyName} County` : ''}, {inBundle} in a
            certified-EHR bundle
          </span>
          {(county || rural !== 'all' || endpoint !== 'all' || vendor !== 'all' || system !== 'all') && (
            <button
              type="button"
              onClick={reset}
              className="text-primary-700 underline text-sm"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Hospital</th>
                <th className="text-left px-3 py-2 font-semibold">County</th>
                <th className="text-left px-3 py-2 font-semibold">Designation</th>
                <th className="text-left px-3 py-2 font-semibold">System</th>
                <th className="text-left px-3 py-2 font-semibold">EHR</th>
                <th className="text-left px-3 py-2 font-semibold">FHIR bundle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((h) => (
                <HospitalRow key={h.ccn} h={h} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                    No hospitals match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <InlineSubscribe
          source="pa_rural_health"
          prompt="Get new findings by email when they publish."
        />
      </div>
    </div>
  );
}

function HospitalRow({ h }: { h: PaHospital }) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2">
        <div className="font-medium text-gray-900">{h.name}</div>
        <div className="text-xs text-gray-500">
          {h.city} · CCN {h.ccn}
        </div>
      </td>
      <td className="px-3 py-2 text-gray-700">
        {h.county}
        <div className="text-xs text-gray-500">
          {h.county_rural ? `Nonmetro (RUCC ${h.county_rucc})` : `Metro (RUCC ${h.county_rucc})`}
        </div>
      </td>
      <td className="px-3 py-2">
        {h.critical_access ? (
          <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs font-medium">
            Critical Access
          </span>
        ) : (
          <span className="text-xs text-gray-600">{h.hospital_type}</span>
        )}
      </td>
      <td className="px-3 py-2 text-gray-700">
        {h.health_system ?? <span className="text-gray-400">Not in name</span>}
      </td>
      <td className="px-3 py-2 text-gray-700">
        {h.ehr_vendor ?? <span className="text-gray-400">Unknown</span>}
        {h.vendor_record_synthetic && (
          <div className="text-xs text-red-700">vendor record is synthetic</div>
        )}
      </td>
      <td className="px-3 py-2">
        {h.in_cehrt_bundle ? (
          <>
            <span className="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-900 text-xs font-medium">
              Published
            </span>
            <div className="text-xs text-gray-500 mt-0.5">
              {h.org_endpoint_linked ? 'endpoint cross-linked' : 'no endpoint cross-link'}
              {h.match_method === 'name_city_token' && ' · fuzzy match'}
            </div>
          </>
        ) : (
          <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
            None found
          </span>
        )}
      </td>
    </tr>
  );
}
