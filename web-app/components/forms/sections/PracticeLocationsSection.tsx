'use client';

import React from 'react';

export interface PracticeLocation {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  isPrimary: boolean;
}

export interface PracticeLocationsSectionProps {
  data: {
    practiceLocations: PracticeLocation[];
  };
  onChange: (updates: Partial<{ practiceLocations: PracticeLocation[] }>) => void;
  errors?: {
    practiceLocations?: string;
  };
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

export default function PracticeLocationsSection({ data, onChange, errors }: PracticeLocationsSectionProps) {
  const handleAddLocation = () => {
    const newLocation: PracticeLocation = {
      name: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      zipCode: '',
      phone: '',
      isPrimary: data.practiceLocations.length === 0, // First one is primary by default
    };

    onChange({
      practiceLocations: [...data.practiceLocations, newLocation],
    });
  };

  const handleUpdateLocation = (index: number, field: keyof PracticeLocation, value: string | boolean) => {
    const updated = data.practiceLocations.map((location, i) => {
      if (i === index) {
        return { ...location, [field]: value };
      }
      // If setting this as primary, unset others
      if (field === 'isPrimary' && value === true) {
        return { ...location, isPrimary: false };
      }
      return location;
    });
    onChange({ practiceLocations: updated });
  };

  const handleRemoveLocation = (index: number) => {
    const updated = data.practiceLocations.filter((_, i) => i !== index);

    // If we removed the primary, make the first one primary
    if (data.practiceLocations[index].isPrimary && updated.length > 0) {
      updated[0].isPrimary = true;
    }

    onChange({ practiceLocations: updated });
  };

  const handleSetPrimary = (index: number) => {
    const updated = data.practiceLocations.map((location, i) => ({
      ...location,
      isPrimary: i === index,
    }));
    onChange({ practiceLocations: updated });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Practice Locations</h3>
          <p className="text-sm text-slate-600 mt-1">Add addresses where provider sees patients</p>
        </div>
        <button
          type="button"
          onClick={handleAddLocation}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          + Add Location
        </button>
      </div>

      {errors?.practiceLocations && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-600 text-sm">{errors.practiceLocations}</p>
        </div>
      )}

      {data.practiceLocations.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-lg border-2 border-dashed border-slate-300">
          <p className="text-slate-500">No practice locations added yet.</p>
          <p className="text-sm text-slate-400 mt-1">Click "Add Location" to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.practiceLocations.map((location, index) => (
            <div
              key={index}
              className={`bg-white rounded-lg border-2 p-4 ${
                location.isPrimary ? 'border-blue-500 bg-blue-50/30' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-slate-900">
                    {location.isPrimary && '⭐ '}Location #{index + 1}
                  </h4>
                  {location.isPrimary && (
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
                      PRIMARY
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!location.isPrimary && (
                    <button
                      type="button"
                      onClick={() => handleSetPrimary(index)}
                      className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded border border-blue-300"
                    >
                      Set as Primary
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveLocation(index)}
                    className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded border border-red-300"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Location Name */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Location Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={location.name}
                    onChange={(e) => handleUpdateLocation(index, 'name', e.target.value)}
                    placeholder="e.g., Boston Medical Plaza"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Address Line 1 */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Address Line 1 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={location.addressLine1}
                    onChange={(e) => handleUpdateLocation(index, 'addressLine1', e.target.value)}
                    placeholder="e.g., 123 Medical Plaza"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Address Line 2 */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Address Line 2 (Optional)
                  </label>
                  <input
                    type="text"
                    value={location.addressLine2 || ''}
                    onChange={(e) => handleUpdateLocation(index, 'addressLine2', e.target.value)}
                    placeholder="e.g., Suite 200"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* City */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    City <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={location.city}
                    onChange={(e) => handleUpdateLocation(index, 'city', e.target.value)}
                    placeholder="e.g., Boston"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* State */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    State <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={location.state}
                    onChange={(e) => handleUpdateLocation(index, 'state', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select State</option>
                    {US_STATES.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </div>

                {/* ZIP Code */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    ZIP Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={location.zipCode}
                    onChange={(e) => handleUpdateLocation(index, 'zipCode', e.target.value)}
                    placeholder="e.g., 02101"
                    maxLength={10}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Phone <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={location.phone}
                    onChange={(e) => handleUpdateLocation(index, 'phone', e.target.value)}
                    placeholder="e.g., 617-555-0100"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
