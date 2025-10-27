'use client';

import React, { useState } from 'react';
import { searchTaxonomy, type NUCCTaxonomy } from '@/lib/nucc-taxonomy';

export interface Specialty {
  code: string;
  display: string;
  isPrimary: boolean;
}

export interface SpecialtiesSectionProps {
  data: {
    specialties: Specialty[];
  };
  onChange: (updates: Partial<{ specialties: Specialty[] }>) => void;
  errors?: {
    specialties?: string;
  };
}

export default function SpecialtiesSection({ data, onChange, errors }: SpecialtiesSectionProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchResults, setSearchResults] = useState<NUCCTaxonomy[]>([]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);

    if (query.trim().length >= 2) {
      const results = searchTaxonomy(query);
      setSearchResults(results);
      setShowDropdown(results.length > 0);
    } else {
      setSearchResults([]);
      setShowDropdown(false);
    }
  };

  const handleSelectSpecialty = (taxonomy: NUCCTaxonomy) => {
    // Check if already added
    const alreadyExists = data.specialties.some(s => s.code === taxonomy.code);
    if (alreadyExists) {
      setSearchQuery('');
      setShowDropdown(false);
      return;
    }

    const newSpecialty: Specialty = {
      code: taxonomy.code,
      display: taxonomy.display,
      isPrimary: data.specialties.length === 0, // First one is primary by default
    };

    onChange({
      specialties: [...data.specialties, newSpecialty],
    });

    setSearchQuery('');
    setShowDropdown(false);
  };

  const handleTogglePrimary = (index: number) => {
    const updated = data.specialties.map((spec, i) => ({
      ...spec,
      isPrimary: i === index,
    }));
    onChange({ specialties: updated });
  };

  const handleRemove = (index: number) => {
    const updated = data.specialties.filter((_, i) => i !== index);

    // If we removed the primary, make the first one primary
    if (data.specialties[index].isPrimary && updated.length > 0) {
      updated[0].isPrimary = true;
    }

    onChange({ specialties: updated });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Search Specialties</h3>

        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            onFocus={() => {
              if (searchResults.length > 0) setShowDropdown(true);
            }}
            placeholder="Type to search NUCC specialties (e.g., 'cardio', 'internal')..."
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />

          {showDropdown && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {searchResults.map((result) => (
                <button
                  key={result.code}
                  type="button"
                  onClick={() => handleSelectSpecialty(result)}
                  className="w-full px-4 py-3 text-left hover:bg-blue-50 border-b border-slate-100 last:border-b-0 focus:bg-blue-50 focus:outline-none"
                >
                  <div className="font-medium text-slate-900">{result.display}</div>
                  <div className="text-sm text-slate-600">
                    {result.code}
                    {result.classification && ` • ${result.classification}`}
                    {result.specialization && ` • ${result.specialization}`}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {errors?.specialties && (
          <p className="mt-2 text-red-500 text-sm">{errors.specialties}</p>
        )}
      </div>

      {data.specialties.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Added Specialties</h3>

          <div className="space-y-3">
            {data.specialties.map((specialty, index) => (
              <div
                key={specialty.code}
                className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">
                      {specialty.display}
                    </span>
                    {specialty.isPrimary && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
                        PRIMARY
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-600 mt-1">
                    Code: {specialty.code}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!specialty.isPrimary && (
                    <button
                      type="button"
                      onClick={() => handleTogglePrimary(index)}
                      className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded border border-blue-300"
                    >
                      Set as Primary
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemove(index)}
                    className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded border border-red-300"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.specialties.length === 0 && (
        <div className="text-center py-8 text-slate-500">
          No specialties added yet. Use the search box above to add NUCC specialties.
        </div>
      )}
    </div>
  );
}
