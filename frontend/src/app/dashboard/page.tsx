'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import {
  getPractitioner,
  updatePractitioner,
  getPractitionerRoles,
  createPractitionerRole,
  updatePractitionerRole,
  triggerSync,
  Practitioner,
  PractitionerRole,
  AcceptedInsurance,
} from '@/lib/api';
import { Save, RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const [practitioner, setPractitioner] = useState<Practitioner | null>(null);
  const [role, setRole] = useState<PractitionerRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form states
  const [practitionerForm, setPractitionerForm] = useState({
    first_name: '',
    middle_name: '',
    last_name: '',
    suffix: '',
    phone: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    postal_code: '',
    npi: '',
  });

  const [roleForm, setRoleForm] = useState({
    specialty_code: '',
    specialty_display: '',
    practice_name: '',
    practice_address_line1: '',
    practice_address_line2: '',
    practice_city: '',
    practice_state: '',
    practice_postal_code: '',
    license_state: '',
    license_number: '',
    license_expiration: '',
  });

  const [insurances, setInsurances] = useState<AcceptedInsurance[]>([]);
  const [newInsurance, setNewInsurance] = useState({ name: '', plan_type: '' });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      const pracData = await getPractitioner();
      setPractitioner(pracData);

      // Populate practitioner form
      setPractitionerForm({
        first_name: pracData.first_name || '',
        middle_name: pracData.middle_name || '',
        last_name: pracData.last_name || '',
        suffix: pracData.suffix || '',
        phone: pracData.phone || '',
        address_line1: pracData.address_line1 || '',
        address_line2: pracData.address_line2 || '',
        city: pracData.city || '',
        state: pracData.state || '',
        postal_code: pracData.postal_code || '',
        npi: pracData.npi || '',
      });

      // Load roles
      const roles = await getPractitionerRoles();
      if (roles.length > 0) {
        const firstRole = roles[0];
        setRole(firstRole);
        setRoleForm({
          specialty_code: firstRole.specialty_code || '',
          specialty_display: firstRole.specialty_display || '',
          practice_name: firstRole.practice_name || '',
          practice_address_line1: firstRole.practice_address_line1 || '',
          practice_address_line2: firstRole.practice_address_line2 || '',
          practice_city: firstRole.practice_city || '',
          practice_state: firstRole.practice_state || '',
          practice_postal_code: firstRole.practice_postal_code || '',
          license_state: firstRole.license_state || '',
          license_number: firstRole.license_number || '',
          license_expiration: firstRole.license_expiration || '',
        });
        setInsurances(firstRole.accepted_insurances || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      setMessage({ type: 'error', text: 'Failed to load profile data' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      // Update practitioner
      await updatePractitioner(practitionerForm);

      // Update or create role
      const roleData = {
        ...roleForm,
        accepted_insurances: insurances,
      };

      if (role) {
        await updatePractitionerRole(role.id, roleData);
      } else {
        await createPractitionerRole(roleData);
      }

      setMessage({ type: 'success', text: 'Profile updated successfully!' });
      await loadData(); // Reload to get updated data
    } catch (error: any) {
      setMessage({ type: 'error', text: error.response?.data?.detail || 'Failed to save profile' });
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setMessage(null);

    try {
      const syncLogs = await triggerSync(['payer', 'state_board']);
      const successCount = syncLogs.filter(log => log.status === 'success').length;
      setMessage({
        type: 'success',
        text: `Sync completed! ${successCount}/${syncLogs.length} systems updated successfully.`
      });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.response?.data?.detail || 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  const addInsurance = () => {
    if (newInsurance.name) {
      setInsurances([...insurances, newInsurance]);
      setNewInsurance({ name: '', plan_type: '' });
    }
  };

  const removeInsurance = (index: number) => {
    setInsurances(insurances.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Provider Profile</h1>
          <p className="mt-2 text-gray-600">
            Manage your provider information and sync with external systems
          </p>
          {practitioner && (
            <div className="mt-4 flex items-center space-x-4">
              <div className="flex items-center">
                <span className="text-sm text-gray-500 mr-2">Profile Completeness:</span>
                <div className="w-48 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-primary-600 h-2 rounded-full transition-all"
                    style={{ width: `${practitioner.completeness}%` }}
                  ></div>
                </div>
                <span className="ml-2 text-sm font-medium text-gray-700">
                  {practitioner.completeness}%
                </span>
              </div>
              {practitioner.verified && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Verified
                </span>
              )}
            </div>
          )}
        </div>

        {/* Message */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-md ${
              message.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            <div className="flex items-center">
              {message.type === 'success' ? (
                <CheckCircle className="w-5 h-5 mr-2" />
              ) : (
                <AlertCircle className="w-5 h-5 mr-2" />
              )}
              {message.text}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Personal Information */}
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Personal Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">First Name *</label>
                  <input
                    type="text"
                    className="input-field"
                    value={practitionerForm.first_name}
                    onChange={(e) =>
                      setPractitionerForm({ ...practitionerForm, first_name: e.target.value })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="label">Last Name *</label>
                  <input
                    type="text"
                    className="input-field"
                    value={practitionerForm.last_name}
                    onChange={(e) =>
                      setPractitionerForm({ ...practitionerForm, last_name: e.target.value })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="label">Middle Name</label>
                  <input
                    type="text"
                    className="input-field"
                    value={practitionerForm.middle_name}
                    onChange={(e) =>
                      setPractitionerForm({ ...practitionerForm, middle_name: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="label">Suffix</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="MD, DO, PhD"
                    value={practitionerForm.suffix}
                    onChange={(e) =>
                      setPractitionerForm({ ...practitionerForm, suffix: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="label">NPI *</label>
                  <input
                    type="text"
                    className="input-field"
                    maxLength={10}
                    value={practitionerForm.npi}
                    onChange={(e) =>
                      setPractitionerForm({ ...practitionerForm, npi: e.target.value.replace(/\D/g, '') })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input
                    type="tel"
                    className="input-field"
                    value={practitionerForm.phone}
                    onChange={(e) =>
                      setPractitionerForm({ ...practitionerForm, phone: e.target.value })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Address */}
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Address</h2>
              <div className="space-y-4">
                <div>
                  <label className="label">Address Line 1</label>
                  <input
                    type="text"
                    className="input-field"
                    value={practitionerForm.address_line1}
                    onChange={(e) =>
                      setPractitionerForm({ ...practitionerForm, address_line1: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="label">Address Line 2</label>
                  <input
                    type="text"
                    className="input-field"
                    value={practitionerForm.address_line2}
                    onChange={(e) =>
                      setPractitionerForm({ ...practitionerForm, address_line2: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="label">City</label>
                    <input
                      type="text"
                      className="input-field"
                      value={practitionerForm.city}
                      onChange={(e) =>
                        setPractitionerForm({ ...practitionerForm, city: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">State</label>
                    <input
                      type="text"
                      className="input-field"
                      maxLength={2}
                      placeholder="MA"
                      value={practitionerForm.state}
                      onChange={(e) =>
                        setPractitionerForm({ ...practitionerForm, state: e.target.value.toUpperCase() })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">ZIP Code</label>
                    <input
                      type="text"
                      className="input-field"
                      value={practitionerForm.postal_code}
                      onChange={(e) =>
                        setPractitionerForm({ ...practitionerForm, postal_code: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Specialty & Practice */}
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Specialty & Practice Information</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Specialty Code</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="207R00000X"
                      value={roleForm.specialty_code}
                      onChange={(e) => setRoleForm({ ...roleForm, specialty_code: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Specialty Name</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="Internal Medicine"
                      value={roleForm.specialty_display}
                      onChange={(e) =>
                        setRoleForm({ ...roleForm, specialty_display: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Practice Name</label>
                  <input
                    type="text"
                    className="input-field"
                    value={roleForm.practice_name}
                    onChange={(e) => setRoleForm({ ...roleForm, practice_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Practice Address</label>
                  <input
                    type="text"
                    className="input-field mb-2"
                    placeholder="Address Line 1"
                    value={roleForm.practice_address_line1}
                    onChange={(e) =>
                      setRoleForm({ ...roleForm, practice_address_line1: e.target.value })
                    }
                  />
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Address Line 2"
                    value={roleForm.practice_address_line2}
                    onChange={(e) =>
                      setRoleForm({ ...roleForm, practice_address_line2: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="label">City</label>
                    <input
                      type="text"
                      className="input-field"
                      value={roleForm.practice_city}
                      onChange={(e) => setRoleForm({ ...roleForm, practice_city: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">State</label>
                    <input
                      type="text"
                      className="input-field"
                      maxLength={2}
                      value={roleForm.practice_state}
                      onChange={(e) =>
                        setRoleForm({ ...roleForm, practice_state: e.target.value.toUpperCase() })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">ZIP Code</label>
                    <input
                      type="text"
                      className="input-field"
                      value={roleForm.practice_postal_code}
                      onChange={(e) =>
                        setRoleForm({ ...roleForm, practice_postal_code: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* License Information */}
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">License Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="label">State</label>
                  <input
                    type="text"
                    className="input-field"
                    maxLength={2}
                    placeholder="MA"
                    value={roleForm.license_state}
                    onChange={(e) =>
                      setRoleForm({ ...roleForm, license_state: e.target.value.toUpperCase() })
                    }
                  />
                </div>
                <div>
                  <label className="label">License Number</label>
                  <input
                    type="text"
                    className="input-field"
                    value={roleForm.license_number}
                    onChange={(e) => setRoleForm({ ...roleForm, license_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Expiration Date</label>
                  <input
                    type="date"
                    className="input-field"
                    value={roleForm.license_expiration ? roleForm.license_expiration.split('T')[0] : ''}
                    onChange={(e) =>
                      setRoleForm({ ...roleForm, license_expiration: e.target.value })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Accepted Insurances */}
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Accepted Insurances</h2>
              <div className="space-y-4">
                {insurances.map((insurance, index) => (
                  <div key={index} className="flex items-center space-x-2 bg-gray-50 p-3 rounded">
                    <div className="flex-1">
                      <span className="font-medium">{insurance.name}</span>
                      {insurance.plan_type && (
                        <span className="text-sm text-gray-600 ml-2">({insurance.plan_type})</span>
                      )}
                    </div>
                    <button
                      onClick={() => removeInsurance(index)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div className="flex space-x-2">
                  <input
                    type="text"
                    className="input-field flex-1"
                    placeholder="Insurance name"
                    value={newInsurance.name}
                    onChange={(e) => setNewInsurance({ ...newInsurance, name: e.target.value })}
                  />
                  <input
                    type="text"
                    className="input-field flex-1"
                    placeholder="Plan type (optional)"
                    value={newInsurance.plan_type}
                    onChange={(e) =>
                      setNewInsurance({ ...newInsurance, plan_type: e.target.value })
                    }
                  />
                  <button onClick={addInsurance} className="btn-secondary whitespace-nowrap">
                    Add Insurance
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Actions Sidebar */}
          <div className="space-y-6">
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Actions</h3>
              <div className="space-y-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-primary w-full flex items-center justify-center"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Profile
                    </>
                  )}
                </button>
                <button
                  onClick={handleSync}
                  disabled={syncing || !practitioner}
                  className="btn-secondary w-full flex items-center justify-center"
                >
                  {syncing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Sync to External Systems
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Sync Targets</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-start">
                  <CheckCircle className="w-4 h-4 text-green-600 mr-2 mt-0.5" />
                  <div>
                    <div className="font-medium">Payer Directory</div>
                    <div className="text-gray-600">Blue Cross Blue Shield MA</div>
                  </div>
                </div>
                <div className="flex items-start">
                  <CheckCircle className="w-4 h-4 text-green-600 mr-2 mt-0.5" />
                  <div>
                    <div className="font-medium">State Board</div>
                    <div className="text-gray-600">MA Board of Registration</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
