'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import {
  getPractitioner,
  getIntegrations,
  compareWithNPPES,
  exportFHIRBundle,
  Practitioner,
  Integration,
  NPPESComparison,
  Discrepancy,
} from '@/lib/api';
import {
  Download,
  Search,
  CheckCircle,
  AlertTriangle,
  Clock,
  Building2,
  Shield,
  Loader2,
  ChevronRight,
  X,
  Zap,
  Target,
  TrendingUp,
} from 'lucide-react';

export default function DemoPage() {
  const router = useRouter();
  const [practitioner, setPractitioner] = useState<Practitioner | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [comparison, setComparison] = useState<NPPESComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparingData, setComparingData] = useState(false);
  const [exportingBundle, setExportingBundle] = useState(false);

  // Guided flow state
  const [showGuidedFlow, setShowGuidedFlow] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

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

      const [pracData, integrationsData] = await Promise.all([
        getPractitioner(),
        getIntegrations(),
      ]);

      setPractitioner(pracData);
      setIntegrations(integrationsData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDetectDiscrepancies = async () => {
    setComparingData(true);
    try {
      const result = await compareWithNPPES();
      setComparison(result);
    } catch (error: any) {
      console.error('Error comparing data:', error);
      alert(error.response?.data?.detail || 'Failed to compare with NPPES');
    } finally {
      setComparingData(false);
    }
  };

  const handleExportBundle = async () => {
    setExportingBundle(true);
    try {
      const bundle = await exportFHIRBundle();

      // Download as JSON file
      const dataStr = JSON.stringify(bundle, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `fhir-bundle-${practitioner?.npi || 'export'}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Error exporting bundle:', error);
      alert(error.response?.data?.detail || 'Failed to export FHIR bundle');
    } finally {
      setExportingBundle(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'text-red-700 bg-red-50 border-red-200';
      case 'medium':
        return 'text-yellow-700 bg-yellow-50 border-yellow-200';
      case 'low':
        return 'text-blue-700 bg-blue-50 border-blue-200';
      default:
        return 'text-gray-700 bg-gray-50 border-gray-200';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'high':
        return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case 'medium':
        return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
      case 'low':
        return <AlertTriangle className="w-4 h-4 text-blue-600" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'connected':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Connected
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            {status}
          </span>
        );
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'payer':
        return <Shield className="w-5 h-5 text-blue-600" />;
      case 'state_board':
        return <Building2 className="w-5 h-5 text-purple-600" />;
      case 'health_system':
        return <Building2 className="w-5 h-5 text-green-600" />;
      default:
        return <Building2 className="w-5 h-5 text-gray-600" />;
    }
  };

  // Guided flow steps
  const guidedFlowSteps = [
    {
      title: 'Traditional Approach',
      subtitle: 'Manual data entry across multiple systems',
      icon: Clock,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      time: '~4 hours per week',
      tasks: [
        'Login to each payer portal separately',
        'Manually update demographics in 5+ systems',
        'Re-enter practice information for each',
        'Submit license updates to state board',
        'Track submission status manually',
        'Respond to data mismatch requests',
      ],
      painPoints: [
        'High risk of data entry errors',
        'Time away from patient care',
        'Inconsistent information across systems',
      ],
    },
    {
      title: 'ProviderCard Approach',
      subtitle: 'Single source of truth with automated sync',
      icon: Zap,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      time: '~15 minutes per week',
      tasks: [
        'Update profile once in ProviderCard',
        'Click "Sync" to push to all systems',
        'Review automated discrepancy report',
        'Accept or resolve flagged differences',
        'Export FHIR bundle for new integrations',
      ],
      benefits: [
        'Consistent data across all systems',
        'Automated validation and error checking',
        'Real-time sync status monitoring',
      ],
    },
    {
      title: 'Time Savings Realized',
      subtitle: 'Focus on what matters most',
      icon: TrendingUp,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      time: '3.75 hours saved weekly',
      stats: [
        { label: 'Annual time saved', value: '195 hours', description: 'Nearly 5 full work weeks' },
        { label: 'Data accuracy', value: '99.9%', description: 'vs ~85% with manual entry' },
        { label: 'Systems connected', value: '5+', description: 'All synced automatically' },
        { label: 'Updates per year', value: '~50', description: 'Each takes 15 min vs 4 hours' },
      ],
      impact: [
        'More time for patient care',
        'Reduced administrative burden',
        'Improved provider satisfaction',
        'Faster credentialing and network updates',
      ],
    },
  ];

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
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Demo Dashboard</h1>
              <p className="mt-2 text-gray-600">
                See how ProviderCard streamlines your data management workflow
              </p>
            </div>
            <button
              onClick={() => setShowGuidedFlow(true)}
              className="btn-primary flex items-center"
            >
              <Target className="w-4 h-4 mr-2" />
              See Time Savings Story
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Provider Info Card */}
          <div className="lg:col-span-2 space-y-6">
            {practitioner && (
              <div className="card">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">
                      {practitioner.first_name} {practitioner.middle_name} {practitioner.last_name}
                      {practitioner.suffix && `, ${practitioner.suffix}`}
                    </h2>
                    <p className="text-gray-600 mt-1">NPI: {practitioner.npi || 'Not set'}</p>
                  </div>
                  {practitioner.verified && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Verified
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Email</p>
                    <p className="font-medium">{practitioner.email}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Phone</p>
                    <p className="font-medium">{practitioner.phone || 'Not set'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-gray-500">Address</p>
                    <p className="font-medium">
                      {practitioner.address_line1 && (
                        <>
                          {practitioner.address_line1}
                          {practitioner.address_line2 && `, ${practitioner.address_line2}`}
                          <br />
                          {practitioner.city}, {practitioner.state} {practitioner.postal_code}
                        </>
                      )}
                      {!practitioner.address_line1 && 'Not set'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Profile Completeness</span>
                    <span className="text-sm font-semibold text-gray-900">
                      {practitioner.completeness}%
                    </span>
                  </div>
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-primary-600 h-2 rounded-full transition-all"
                      style={{ width: `${practitioner.completeness}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            )}

            {/* Connected Organizations */}
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Connected Organizations</h3>
              <div className="space-y-3">
                {integrations.map((integration) => (
                  <div
                    key={integration.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0">{getTypeIcon(integration.type)}</div>
                      <div>
                        <p className="font-medium text-gray-900">{integration.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {integration.last_sync
                            ? `Last synced: ${new Date(integration.last_sync).toLocaleDateString()}`
                            : 'Never synced'}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {integration.data_shared.map((data, idx) => (
                            <span
                              key={idx}
                              className="inline-block px-2 py-0.5 text-xs bg-white rounded border border-gray-200 text-gray-600"
                            >
                              {data}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {getStatusBadge(integration.status)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* NPPES Comparison Results */}
            {comparison && (
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">NPPES Data Comparison</h3>
                  <button
                    onClick={() => setComparison(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Match Score */}
                <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Data Match Score</p>
                      <p className="text-3xl font-bold text-gray-900 mt-1">
                        {comparison.match_score}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-600">Total Discrepancies</p>
                      <p className="text-3xl font-bold text-gray-900 mt-1">
                        {comparison.total_discrepancies}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex space-x-4 text-sm">
                    <div className="flex items-center">
                      <div className="w-3 h-3 rounded-full bg-red-500 mr-2"></div>
                      <span>
                        {comparison.high_severity_count} High
                      </span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-3 h-3 rounded-full bg-yellow-500 mr-2"></div>
                      <span>
                        {comparison.medium_severity_count} Medium
                      </span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-3 h-3 rounded-full bg-blue-500 mr-2"></div>
                      <span>
                        {comparison.low_severity_count} Low
                      </span>
                    </div>
                  </div>
                </div>

                {/* Discrepancies List */}
                {comparison.discrepancies.length > 0 ? (
                  <div className="space-y-3">
                    {comparison.discrepancies.map((discrepancy, index) => (
                      <div
                        key={index}
                        className={`p-4 rounded-lg border ${getSeverityColor(discrepancy.severity)}`}
                      >
                        <div className="flex items-start">
                          <div className="flex-shrink-0 mt-0.5">
                            {getSeverityIcon(discrepancy.severity)}
                          </div>
                          <div className="ml-3 flex-1">
                            <div className="flex items-center justify-between">
                              <p className="font-semibold">{discrepancy.field}</p>
                              <span className="text-xs uppercase font-medium">
                                {discrepancy.severity}
                              </span>
                            </div>
                            <div className="mt-2 text-sm space-y-1">
                              <p>
                                <span className="font-medium">NPPES:</span>{' '}
                                {discrepancy.nppes_value}
                              </p>
                              <p>
                                <span className="font-medium">ProviderCard:</span>{' '}
                                {discrepancy.providercard_value}
                              </p>
                            </div>
                            <p className="mt-2 text-sm italic">{discrepancy.recommendation}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-2" />
                    <p>All data matches perfectly with NPPES!</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions Sidebar */}
          <div className="space-y-6">
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <button
                  onClick={handleDetectDiscrepancies}
                  disabled={comparingData || !practitioner?.npi}
                  className="btn-primary w-full flex items-center justify-center"
                >
                  {comparingData ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Comparing...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4 mr-2" />
                      Detect Discrepancies
                    </>
                  )}
                </button>

                <button
                  onClick={handleExportBundle}
                  disabled={exportingBundle}
                  className="btn-secondary w-full flex items-center justify-center"
                >
                  {exportingBundle ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Export FHIR Bundle
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Integration Stats</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Connected</span>
                  <span className="text-lg font-bold text-green-600">
                    {integrations.filter((i) => i.status === 'connected').length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Pending</span>
                  <span className="text-lg font-bold text-yellow-600">
                    {integrations.filter((i) => i.status === 'pending').length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Total</span>
                  <span className="text-lg font-bold text-gray-900">
                    {integrations.length}
                  </span>
                </div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-primary-50 to-indigo-50 border-primary-200">
              <h3 className="text-lg font-semibold mb-2 text-primary-900">
                About This Demo
              </h3>
              <p className="text-sm text-primary-800">
                This dashboard demonstrates how ProviderCard consolidates your provider
                information and automates synchronization across multiple healthcare systems.
              </p>
              <ul className="mt-3 text-sm text-primary-800 space-y-1">
                <li>• Card view of your provider info</li>
                <li>• Connected organization tracking</li>
                <li>• NPPES discrepancy detection</li>
                <li>• FHIR bundle export capability</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Guided Flow Modal */}
      {showGuidedFlow && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Time Savings Story</h2>
              <button
                onClick={() => {
                  setShowGuidedFlow(false);
                  setCurrentStep(0);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Progress Bar */}
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between mb-2">
                {guidedFlowSteps.map((step, index) => (
                  <div
                    key={index}
                    className={`flex items-center ${
                      index < guidedFlowSteps.length - 1 ? 'flex-1' : ''
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        index <= currentStep
                          ? 'bg-primary-600 text-white'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {index + 1}
                    </div>
                    {index < guidedFlowSteps.length - 1 && (
                      <div
                        className={`flex-1 h-1 mx-2 ${
                          index < currentStep ? 'bg-primary-600' : 'bg-gray-200'
                        }`}
                      ></div>
                    )}
                  </div>
                ))}
              </div>
              <div className="text-sm text-gray-600 text-center mt-2">
                Step {currentStep + 1} of {guidedFlowSteps.length}
              </div>
            </div>

            {/* Step Content */}
            <div className="p-6">
              {(() => {
                const step = guidedFlowSteps[currentStep];
                const StepIcon = step.icon;

                return (
                  <div>
                    <div className={`${step.bgColor} rounded-lg p-6 mb-6`}>
                      <div className="flex items-center mb-4">
                        <StepIcon className={`w-10 h-10 ${step.color} mr-3`} />
                        <div>
                          <h3 className="text-2xl font-bold text-gray-900">{step.title}</h3>
                          <p className="text-gray-600 mt-1">{step.subtitle}</p>
                        </div>
                      </div>
                      <div className={`inline-block px-4 py-2 rounded-full ${step.color} bg-white font-bold text-lg`}>
                        {step.time}
                      </div>
                    </div>

                    {step.tasks && (
                      <div className="mb-6">
                        <h4 className="font-semibold text-gray-900 mb-3">
                          {currentStep === 0 ? 'Typical Tasks' : 'Your Tasks'}
                        </h4>
                        <ul className="space-y-2">
                          {step.tasks.map((task, index) => (
                            <li key={index} className="flex items-start">
                              <ChevronRight className="w-5 h-5 text-gray-400 mr-2 flex-shrink-0 mt-0.5" />
                              <span className="text-gray-700">{task}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {step.stats && (
                      <div className="grid grid-cols-2 gap-4 mb-6">
                        {step.stats.map((stat, index) => (
                          <div key={index} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                            <p className="text-sm text-gray-600">{stat.label}</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
                            <p className="text-xs text-gray-500 mt-1">{stat.description}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {step.painPoints && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                        <h4 className="font-semibold text-red-900 mb-2">Pain Points</h4>
                        <ul className="space-y-1">
                          {step.painPoints.map((point, index) => (
                            <li key={index} className="text-sm text-red-700 flex items-start">
                              <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5" />
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {step.benefits && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                        <h4 className="font-semibold text-green-900 mb-2">Benefits</h4>
                        <ul className="space-y-1">
                          {step.benefits.map((benefit, index) => (
                            <li key={index} className="text-sm text-green-700 flex items-start">
                              <CheckCircle className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5" />
                              {benefit}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {step.impact && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <h4 className="font-semibold text-blue-900 mb-2">Impact on Your Practice</h4>
                        <ul className="space-y-1">
                          {step.impact.map((item, index) => (
                            <li key={index} className="text-sm text-blue-700 flex items-start">
                              <CheckCircle className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Navigation */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button
                onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                disabled={currentStep === 0}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              {currentStep < guidedFlowSteps.length - 1 ? (
                <button
                  onClick={() => setCurrentStep(currentStep + 1)}
                  className="btn-primary"
                >
                  Next Step
                  <ChevronRight className="w-4 h-4 ml-1" />
                </button>
              ) : (
                <button
                  onClick={() => {
                    setShowGuidedFlow(false);
                    setCurrentStep(0);
                  }}
                  className="btn-primary"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Get Started
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
