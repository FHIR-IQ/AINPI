'use client';

import React from 'react';

export interface InsurancePlan {
  carrier: string;
  planName: string;
  lob: string;
  networkStatus: string;
  acceptingNewPatients: boolean;
}

export interface InsurancePlansSectionProps {
  data: {
    insurancePlans: InsurancePlan[];
  };
  onChange: (updates: Partial<{ insurancePlans: InsurancePlan[] }>) => void;
  errors?: {
    insurancePlans?: string;
  };
}

const CARRIERS = [
  'Aetna',
  'Anthem',
  'Blue Cross Blue Shield',
  'Blue Cross Blue Shield of Massachusetts',
  'Cigna',
  'Humana',
  'Kaiser Permanente',
  'Medicare',
  'Medicaid',
  'UnitedHealthcare',
  'Other',
];

const PLAN_NAMES_BY_CARRIER: Record<string, string[]> = {
  'Aetna': ['Aetna PPO', 'Aetna HMO', 'Aetna EPO', 'Aetna POS'],
  'Blue Cross Blue Shield of Massachusetts': ['BCBS HMO Blue', 'BCBS PPO', 'BCBS Medicare Advantage'],
  'Medicare': ['Traditional Medicare', 'Medicare Advantage'],
  'Medicaid': ['State Medicaid', 'Medicaid Managed Care'],
  'UnitedHealthcare': ['UHC Choice Plus', 'UHC Options PPO', 'UHC Medicare Advantage'],
  'Cigna': ['Cigna PPO', 'Cigna HMO', 'Cigna Open Access Plus'],
};

const LINES_OF_BUSINESS = [
  'Commercial',
  'Medicare',
  'Medicaid',
  'Exchange',
  'Workers Comp',
  'Auto',
  'Other',
];

const NETWORK_STATUSES = [
  'In-Network',
  'Out-of-Network',
  'Pending',
];

export default function InsurancePlansSection({ data, onChange, errors }: InsurancePlansSectionProps) {
  const handleAddPlan = () => {
    const newPlan: InsurancePlan = {
      carrier: '',
      planName: '',
      lob: 'Commercial',
      networkStatus: 'In-Network',
      acceptingNewPatients: true,
    };

    onChange({
      insurancePlans: [...data.insurancePlans, newPlan],
    });
  };

  const handleUpdatePlan = (index: number, field: keyof InsurancePlan, value: string | boolean) => {
    const updated = data.insurancePlans.map((plan, i) => {
      if (i === index) {
        // If carrier changed, reset plan name
        if (field === 'carrier') {
          return { ...plan, carrier: value as string, planName: '' };
        }
        return { ...plan, [field]: value };
      }
      return plan;
    });
    onChange({ insurancePlans: updated });
  };

  const handleRemovePlan = (index: number) => {
    const updated = data.insurancePlans.filter((_, i) => i !== index);
    onChange({ insurancePlans: updated });
  };

  const getAvailablePlans = (carrier: string): string[] => {
    return PLAN_NAMES_BY_CARRIER[carrier] || ['Custom Plan'];
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Insurance Plans</h3>
          <p className="text-sm text-slate-600 mt-1">Accepted insurance carriers and network status</p>
        </div>
        <button
          type="button"
          onClick={handleAddPlan}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          + Add Insurance Plan
        </button>
      </div>

      {errors?.insurancePlans && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-600 text-sm">{errors.insurancePlans}</p>
        </div>
      )}

      {data.insurancePlans.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-lg border-2 border-dashed border-slate-300">
          <p className="text-slate-500">No insurance plans added yet.</p>
          <p className="text-sm text-slate-400 mt-1">Click "Add Insurance Plan" to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.insurancePlans.map((plan, index) => (
            <div
              key={index}
              className="bg-white rounded-lg border border-slate-200 p-4"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-slate-900">Plan #{index + 1}</h4>
                  {plan.acceptingNewPatients ? (
                    <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded">
                      ACCEPTING PATIENTS
                    </span>
                  ) : (
                    <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded">
                      PANEL FULL
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemovePlan(index)}
                  className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded border border-red-300"
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Carrier */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Carrier <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={plan.carrier}
                    onChange={(e) => handleUpdatePlan(index, 'carrier', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select Carrier</option>
                    {CARRIERS.map((carrier) => (
                      <option key={carrier} value={carrier}>
                        {carrier}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Plan Name */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Plan Name <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={plan.planName}
                    onChange={(e) => handleUpdatePlan(index, 'planName', e.target.value)}
                    disabled={!plan.carrier}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
                  >
                    <option value="">Select Plan</option>
                    {plan.carrier && getAvailablePlans(plan.carrier).map((planName) => (
                      <option key={planName} value={planName}>
                        {planName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Line of Business */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Line of Business <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={plan.lob}
                    onChange={(e) => handleUpdatePlan(index, 'lob', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {LINES_OF_BUSINESS.map((lob) => (
                      <option key={lob} value={lob}>
                        {lob}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Network Status */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Network Status <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={plan.networkStatus}
                    onChange={(e) => handleUpdatePlan(index, 'networkStatus', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {NETWORK_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Accepting New Patients */}
                <div className="md:col-span-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={plan.acceptingNewPatients}
                      onChange={(e) => handleUpdatePlan(index, 'acceptingNewPatients', e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-700">
                      Accepting New Patients
                    </span>
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
