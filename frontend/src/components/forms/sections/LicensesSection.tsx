'use client';

import React from 'react';

export interface License {
  state: string;
  licenseNumber: string;
  type: string;
  status: string;
  expirationDate: string;
}

export interface LicensesSectionProps {
  data: {
    licenses: License[];
  };
  onChange: (updates: Partial<{ licenses: License[] }>) => void;
  errors?: {
    licenses?: string;
  };
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

const LICENSE_TYPES = ['MD', 'DO', 'NP', 'PA', 'RN', 'LPN', 'DDS', 'DPM', 'PharmD', 'PT', 'OT'];
const LICENSE_STATUSES = ['Active', 'Inactive', 'Expired', 'Pending', 'Suspended'];

export default function LicensesSection({ data, onChange, errors }: LicensesSectionProps) {
  const handleAddLicense = () => {
    const newLicense: License = {
      state: '',
      licenseNumber: '',
      type: 'MD',
      status: 'Active',
      expirationDate: '',
    };

    onChange({
      licenses: [...data.licenses, newLicense],
    });
  };

  const handleUpdateLicense = (index: number, field: keyof License, value: string) => {
    const updated = data.licenses.map((license, i) =>
      i === index ? { ...license, [field]: value } : license
    );
    onChange({ licenses: updated });
  };

  const handleRemoveLicense = (index: number) => {
    const updated = data.licenses.filter((_, i) => i !== index);
    onChange({ licenses: updated });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Medical Licenses</h3>
          <p className="text-sm text-slate-600 mt-1">Add state licenses for multi-state practice</p>
        </div>
        <button
          type="button"
          onClick={handleAddLicense}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          + Add License
        </button>
      </div>

      {errors?.licenses && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-600 text-sm">{errors.licenses}</p>
        </div>
      )}

      {data.licenses.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-lg border-2 border-dashed border-slate-300">
          <p className="text-slate-500">No licenses added yet.</p>
          <p className="text-sm text-slate-400 mt-1">Click "Add License" to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.licenses.map((license, index) => (
            <div
              key={index}
              className="bg-white rounded-lg border border-slate-200 p-4"
            >
              <div className="flex items-start justify-between mb-4">
                <h4 className="font-medium text-slate-900">License #{index + 1}</h4>
                <button
                  type="button"
                  onClick={() => handleRemoveLicense(index)}
                  className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded border border-red-300"
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* State */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    State <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={license.state}
                    onChange={(e) => handleUpdateLicense(index, 'state', e.target.value)}
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

                {/* License Number */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    License Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={license.licenseNumber}
                    onChange={(e) => handleUpdateLicense(index, 'licenseNumber', e.target.value)}
                    placeholder="e.g., MD123456"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* License Type */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    License Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={license.type}
                    onChange={(e) => handleUpdateLicense(index, 'type', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {LICENSE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Status <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={license.status}
                    onChange={(e) => handleUpdateLicense(index, 'status', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {LICENSE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Expiration Date */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Expiration Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={license.expirationDate}
                    onChange={(e) => handleUpdateLicense(index, 'expirationDate', e.target.value)}
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
