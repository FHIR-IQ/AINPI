'use client';

import { useState } from 'react';
import GeneralInfoSection from './sections/GeneralInfoSection';
import SpecialtiesSection from './sections/SpecialtiesSection';
import LicensesSection from './sections/LicensesSection';
import PracticeLocationsSection from './sections/PracticeLocationsSection';
import InsurancePlansSection from './sections/InsurancePlansSection';

export interface License {
  state: string;
  licenseNumber: string;
  type: string;
  status: string;
  expirationDate: string;
}

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

export interface InsurancePlan {
  carrier: string;
  planName: string;
  lob: string;
  networkStatus: string;
  acceptingNewPatients: boolean;
}

export interface ProviderFormData {
  // General Info
  npi: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  email: string;
  phone: string;

  // Specialties
  specialties: Array<{ code: string; display: string; isPrimary: boolean }>;

  // Licenses
  licenses: License[];

  // Practice Locations
  practiceLocations: PracticeLocation[];

  // Insurance Plans
  insurancePlans: InsurancePlan[];
}

interface ProviderFormProps {
  onSave: (data: ProviderFormData) => Promise<void>;
  isSaving?: boolean;
  initialData?: Partial<ProviderFormData>;
}

export default function ProviderForm({ onSave, isSaving, initialData }: ProviderFormProps) {
  const [formData, setFormData] = useState<ProviderFormData>({
    npi: initialData?.npi || '',
    firstName: initialData?.firstName || '',
    lastName: initialData?.lastName || '',
    middleName: initialData?.middleName || '',
    email: initialData?.email || '',
    phone: initialData?.phone || '',
    specialties: initialData?.specialties || [],
    licenses: initialData?.licenses || [],
    practiceLocations: initialData?.practiceLocations || [],
    insurancePlans: initialData?.insurancePlans || [],
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeSection, setActiveSection] = useState<string>('general');

  const sections = [
    { id: 'general', label: 'General Info', icon: '👤' },
    { id: 'specialties', label: 'Specialties', icon: '⚕️' },
    { id: 'licenses', label: 'Licenses', icon: '📜' },
    { id: 'locations', label: 'Practice Locations', icon: '🏥' },
    { id: 'insurance', label: 'Insurance Plans', icon: '💳' },
  ];

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // General Info validation
    if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
    if (!formData.npi.trim()) newErrors.npi = 'NPI is required';
    if (formData.npi && !/^\d{10}$/.test(formData.npi)) {
      newErrors.npi = 'NPI must be 10 digits';
    }
    if (!formData.email.trim()) newErrors.email = 'Email is required';
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    // Specialties validation
    if (formData.specialties.length === 0) {
      newErrors.specialties = 'At least one specialty is required';
    }

    // Licenses validation
    if (formData.licenses.length === 0) {
      newErrors.licenses = 'At least one license is required';
    }

    // Practice Locations validation
    if (formData.practiceLocations.length === 0) {
      newErrors.practiceLocations = 'At least one practice location is required';
    }
    const primaryLocations = formData.practiceLocations.filter(loc => loc.isPrimary);
    if (primaryLocations.length === 0 && formData.practiceLocations.length > 0) {
      newErrors.practiceLocations = 'One location must be marked as primary';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      // Scroll to first error
      const firstErrorSection = sections.find(section =>
        Object.keys(errors).some(key => key.includes(section.id))
      );
      if (firstErrorSection) {
        setActiveSection(firstErrorSection.id);
      }
      return;
    }

    await onSave(formData);
  };

  const updateFormData = (updates: Partial<ProviderFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Section Tabs */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={`flex-1 px-4 py-3 font-medium transition-colors whitespace-nowrap ${
                activeSection === section.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span className="mr-2">{section.icon}</span>
              {section.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeSection === 'general' && (
            <GeneralInfoSection
              data={formData}
              onChange={updateFormData}
              errors={errors}
            />
          )}

          {activeSection === 'specialties' && (
            <SpecialtiesSection
              data={{ specialties: formData.specialties }}
              onChange={updateFormData}
              errors={{ specialties: errors.specialties }}
            />
          )}

          {activeSection === 'licenses' && (
            <LicensesSection
              data={{ licenses: formData.licenses }}
              onChange={updateFormData}
              errors={{ licenses: errors.licenses }}
            />
          )}

          {activeSection === 'locations' && (
            <PracticeLocationsSection
              data={{ practiceLocations: formData.practiceLocations }}
              onChange={updateFormData}
              errors={{ practiceLocations: errors.practiceLocations }}
            />
          )}

          {activeSection === 'insurance' && (
            <InsurancePlansSection
              data={{ insurancePlans: formData.insurancePlans }}
              onChange={updateFormData}
              errors={{ insurancePlans: errors.insurancePlans }}
            />
          )}
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex justify-end gap-4">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="px-6 py-3 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors font-medium"
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isSaving ? (
            <>
              <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
              Saving...
            </>
          ) : (
            'Save Provider'
          )}
        </button>
      </div>

      {/* Validation Summary */}
      {Object.keys(errors).length > 0 && (
        <div className="p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg">
          <h3 className="font-semibold text-red-900 dark:text-red-200 mb-2">
            Please fix the following errors:
          </h3>
          <ul className="list-disc list-inside text-sm text-red-800 dark:text-red-300">
            {Object.values(errors).map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
