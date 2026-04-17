'use client';

import { useFilters } from '@/contexts/FilterContext';
import { X, Filter } from 'lucide-react';

export default function FilterBreadcrumb() {
  const { filters, setState, setCity, setSpecialty, setOrg, clearAll, isFiltered } = useFilters();

  if (!isFiltered) return null;

  const pills: Array<{ label: string; value: string; onClear: () => void; color: string }> = [];

  if (filters.state) {
    pills.push({ label: 'State', value: filters.state, onClear: () => setState(null), color: 'bg-blue-100 text-blue-800' });
  }
  if (filters.city) {
    pills.push({ label: 'City', value: filters.city, onClear: () => setCity(null), color: 'bg-cyan-100 text-cyan-800' });
  }
  if (filters.specialty) {
    pills.push({ label: 'Specialty', value: filters.specialty, onClear: () => setSpecialty(null), color: 'bg-purple-100 text-purple-800' });
  }
  if (filters.orgId) {
    pills.push({ label: 'Organization', value: filters.orgId, onClear: () => setOrg(null), color: 'bg-amber-100 text-amber-800' });
  }

  return (
    <div className="sticky top-0 z-20 bg-white border border-primary-200 rounded-lg p-3 shadow-sm mb-6 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Filter className="w-4 h-4 text-primary-600" />
        <span className="font-medium">Active filters:</span>
      </div>
      {pills.map((p) => (
        <span
          key={p.label + p.value}
          className={'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ' + p.color}
        >
          <span className="text-gray-500">{p.label}:</span>
          <span>{p.value.length > 30 ? p.value.substring(0, 28) + '...' : p.value}</span>
          <button
            onClick={p.onClear}
            className="hover:bg-black/10 rounded-full p-0.5 -mr-1"
            aria-label={'Remove ' + p.label + ' filter'}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <button
        onClick={clearAll}
        className="ml-auto text-xs text-gray-500 hover:text-red-600 underline"
      >
        Clear all
      </button>
    </div>
  );
}
