'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useFilters } from '@/contexts/FilterContext';
import { ChevronRight } from 'lucide-react';

const CityBarChart = dynamic(() => import('./CityBarChart'), { ssr: false });

interface CityRow { city: string; count: number; secondary?: number; }
interface SpecialtyRow { code: string; display: string; provider_count: number; }
interface TopOrgRow { org_id: string; org_name: string; city: string; practitioner_count: number; }

interface StateDetail {
  state: string;
  city: string | null;
  cities: Array<{ city: string; location_count: number }>;
  practitioners_by_city: Array<{ city: string; practitioner_count: number; active_count: number }>;
  organizations_by_city: Array<{ city: string; org_count: number }>;
  top_specialties: SpecialtyRow[];
  top_organizations: TopOrgRow[];
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

export default function StateDetailPanel() {
  const { filters, setCity, setSpecialty } = useFilters();
  const [detail, setDetail] = useState<StateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filters.state) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ state: filters.state });
    if (filters.city) params.set('city', filters.city);

    fetch('/api/npd/state-detail?' + params.toString())
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Failed to load state detail')))
      .then(setDetail)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filters.state, filters.city]);

  if (!filters.state) return null;

  const pracByCity: CityRow[] = (detail?.practitioners_by_city || []).map((r) => ({
    city: r.city,
    count: Number(r.practitioner_count),
    secondary: Number(r.active_count),
  }));
  const orgByCity: CityRow[] = (detail?.organizations_by_city || []).map((r) => ({
    city: r.city,
    count: Number(r.org_count),
  }));

  return (
    <div className="card border-2 border-primary-100 bg-gradient-to-br from-primary-50/30 to-white">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl font-bold text-gray-900">{filters.state}</span>
        {filters.city && (
          <>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <span className="text-xl font-bold text-primary-700">{filters.city}</span>
          </>
        )}
        <span className="text-sm text-gray-500 ml-auto">Drill-down view</span>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      )}

      {detail && !loading && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <div>
              <CityBarChart
                data={pracByCity}
                title={'Practitioners by City' + (filters.city ? ' (' + filters.city + ')' : '')}
                countLabel="practitioners"
                onCityClick={setCity}
                selectedCity={filters.city}
                top={15}
                height={420}
              />
            </div>
            <div>
              <CityBarChart
                data={orgByCity}
                title={'Organizations by City' + (filters.city ? ' (' + filters.city + ')' : '')}
                countLabel="organizations"
                onCityClick={setCity}
                selectedCity={filters.city}
                top={15}
                height={420}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Top specialties */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                Top Specialties in {filters.city || filters.state}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="pb-2 pr-3">Specialty</th>
                      <th className="pb-2 text-right">Providers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.top_specialties.slice(0, 15).map((s) => (
                      <tr
                        key={s.code}
                        className="border-b border-gray-100 hover:bg-primary-50 cursor-pointer"
                        onClick={() => setSpecialty(s.display)}
                      >
                        <td className="py-2 pr-3">
                          <div className="text-gray-800">{s.display || '(no display)'}</div>
                          <div className="text-xs font-mono text-gray-400">{s.code}</div>
                        </td>
                        <td className="py-2 text-right font-medium">{fmt(Number(s.provider_count))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top organizations */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                Top Organizations in {filters.city || filters.state}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="pb-2 pr-3">Organization</th>
                      <th className="pb-2 pr-3">City</th>
                      <th className="pb-2 text-right">Practitioners</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.top_organizations.slice(0, 15).map((o) => (
                      <tr key={o.org_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 pr-3 text-gray-800">{o.org_name || '(unnamed)'}</td>
                        <td className="py-2 pr-3 text-gray-500">{o.city || '-'}</td>
                        <td className="py-2 text-right font-medium">{fmt(Number(o.practitioner_count))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
