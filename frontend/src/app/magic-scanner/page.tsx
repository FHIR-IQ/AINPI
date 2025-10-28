'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { getPractitioner, Practitioner } from '@/lib/api';
import {
  Sparkles,
  Search,
  AlertTriangle,
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  Info,
  AlertCircle,
  Shield,
  Building2,
  FileText,
  Calendar,
} from 'lucide-react';

interface ScanResult {
  source: string;
  type: string;
  data_found: string[];
  discrepancies: Array<{
    field: string;
    found_value: string;
    current_value: string;
    severity: 'high' | 'medium' | 'low';
  }>;
  last_updated?: string;
  url?: string;
  api_endpoint?: string;
  api_status?: 'discovered' | 'testing' | 'active' | 'inactive' | 'error';
}

interface NPPESStaleCheck {
  is_stale: boolean;
  last_update_date: string;
  days_since_update: number;
  needs_sync: boolean;
  recommendation: string;
}

interface APIConnectionResult {
  organization_name: string;
  organization_type: 'health_system' | 'insurance_payer' | 'state_board';
  api_endpoint?: string;
  api_type?: 'rest' | 'fhir' | 'soap' | 'web_scrape' | 'unknown';
  connection_status: 'discovered' | 'testing' | 'connected' | 'failed' | 'no_api_found';
  supports_npi_search?: boolean;
  supports_name_search?: boolean;
  response_time_ms?: number;
  error_message?: string;
  tested_at: string;
}

interface ScanResponse {
  success: boolean;
  scan_id: string;
  npi: string;
  last_name: string;
  state?: string;
  scan_results: ScanResult[];
  nppes_stale_check: NPPESStaleCheck;
  api_discovery: {
    total_organizations_found: number;
    organizations_with_apis: number;
    successful_connections: number;
    failed_connections: number;
    no_api_available: number;
  };
  api_connection_results: APIConnectionResult[];
  ai_summary: string;
  citations?: string[]; // Web citations from Perplexity
  scanned_at: string;
  total_sources_checked: number;
  total_discrepancies: number;
}

export default function MagicScannerPage() {
  const router = useRouter();
  const [practitioner, setPractitioner] = useState<Practitioner | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResponse | null>(null);
  const [error, setError] = useState('');

  // Form state
  const [npi, setNpi] = useState('');
  const [lastName, setLastName] = useState('');
  const [state, setState] = useState('');

  useEffect(() => {
    loadPractitioner();
  }, []);

  const loadPractitioner = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      const pracData = await getPractitioner();
      setPractitioner(pracData);

      // Pre-fill form with practitioner data
      setNpi(pracData.npi || '');
      setLastName(pracData.last_name || '');
      setState(pracData.state || '');
    } catch (error) {
      console.error('Error loading practitioner:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setScanning(true);
    setError('');
    setScanResults(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/magic-scanner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          npi,
          last_name: lastName,
          state,
          current_data: practitioner,
        }),
      });

      if (!response.ok) {
        throw new Error('Scan failed');
      }

      const data: ScanResponse = await response.json();
      setScanResults(data);
    } catch (err: any) {
      console.error('Scan error:', err);
      setError(err.message || 'Failed to complete scan');
    } finally {
      setScanning(false);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'insurance_directory':
        return <Shield className="w-5 h-5 text-blue-600" />;
      case 'state_board':
        return <Building2 className="w-5 h-5 text-purple-600" />;
      case 'hospital_network':
        return <Building2 className="w-5 h-5 text-green-600" />;
      case 'nppes':
        return <FileText className="w-5 h-5 text-orange-600" />;
      default:
        return <Search className="w-5 h-5 text-gray-600" />;
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

  const getConnectionStatusBadge = (status: string) => {
    switch (status) {
      case 'connected':
        return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Connected</span>;
      case 'testing':
        return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Testing</span>;
      case 'failed':
        return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800"><AlertTriangle className="w-3 h-3 mr-1" />Failed</span>;
      case 'no_api_found':
        return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800"><Info className="w-3 h-3 mr-1" />No API</span>;
      default:
        return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"><Clock className="w-3 h-3 mr-1" />Discovered</span>;
    }
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
          <div className="flex items-center mb-4">
            <Sparkles className="w-8 h-8 text-primary-600 mr-3" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Magic Scanner</h1>
              <p className="mt-2 text-gray-600">
                AI-powered scan of provider directories and insurance networks
              </p>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start">
            <Info className="w-5 h-5 text-blue-600 mr-3 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-1">How it works (3-Step Process):</p>
              <ul className="space-y-1 ml-4 list-disc">
                <li><strong>Step 1:</strong> Searches NPPES database directly for provider information</li>
                <li><strong>Step 2:</strong> Uses Perplexity AI to discover provider directories and their APIs</li>
                <li><strong>Step 3:</strong> Tests each discovered API endpoint and records connection status</li>
                <li>Builds a registry of working APIs for future automated data sync</li>
                <li>Compares found information and flags discrepancies</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Scan Form */}
          <div className="lg:col-span-1">
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Scan Parameters</h2>
              <form onSubmit={handleScan} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    NPI Number
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    pattern="\d{10}"
                    value={npi}
                    onChange={(e) => setNpi(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="1234567890"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Smith"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    State (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={2}
                    value={state}
                    onChange={(e) => setState(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="NY"
                  />
                </div>

                <button
                  type="submit"
                  disabled={scanning}
                  className="btn-primary w-full flex items-center justify-center"
                >
                  {scanning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Start Magic Scan
                    </>
                  )}
                </button>
              </form>

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Results */}
          <div className="lg:col-span-2 space-y-6">
            {scanning && (
              <div className="card text-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-primary-600 mx-auto mb-4" />
                <p className="text-gray-600">
                  Perplexity AI is searching provider directories across the web...
                </p>
                <p className="text-sm text-gray-500 mt-2">This may take 10-30 seconds</p>
              </div>
            )}

            {scanResults && (
              <>
                {/* NPPES Staleness Check */}
                {scanResults.nppes_stale_check && (
                  <div
                    className={`card border-2 ${
                      scanResults.nppes_stale_check.needs_sync
                        ? 'border-red-300 bg-red-50'
                        : scanResults.nppes_stale_check.is_stale
                        ? 'border-yellow-300 bg-yellow-50'
                        : 'border-green-300 bg-green-50'
                    }`}
                  >
                    <div className="flex items-start">
                      <div className="flex-shrink-0">
                        {scanResults.nppes_stale_check.needs_sync ? (
                          <AlertCircle className="w-6 h-6 text-red-600" />
                        ) : scanResults.nppes_stale_check.is_stale ? (
                          <AlertTriangle className="w-6 h-6 text-yellow-600" />
                        ) : (
                          <CheckCircle className="w-6 h-6 text-green-600" />
                        )}
                      </div>
                      <div className="ml-3 flex-1">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                          NPPES Data Freshness Check
                        </h3>
                        <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                          <div>
                            <p className="text-gray-600">Last Updated</p>
                            <p className="font-semibold flex items-center">
                              <Calendar className="w-4 h-4 mr-1" />
                              {scanResults.nppes_stale_check.last_update_date}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-600">Days Since Update</p>
                            <p className="font-semibold flex items-center">
                              <Clock className="w-4 h-4 mr-1" />
                              {scanResults.nppes_stale_check.days_since_update} days
                            </p>
                          </div>
                        </div>
                        <p className="text-sm text-gray-700">
                          {scanResults.nppes_stale_check.recommendation}
                        </p>
                        {scanResults.nppes_stale_check.needs_sync && (
                          <button className="mt-3 btn-primary text-sm">
                            Sync NPPES Data Now
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="card text-center">
                    <p className="text-sm text-gray-600">Organizations Found</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {scanResults.api_discovery.total_organizations_found}
                    </p>
                  </div>
                  <div className="card text-center">
                    <p className="text-sm text-gray-600">APIs Connected</p>
                    <p className="text-2xl font-bold text-green-600 mt-1">
                      {scanResults.api_discovery.successful_connections}
                    </p>
                  </div>
                  <div className="card text-center">
                    <p className="text-sm text-gray-600">APIs Failed</p>
                    <p className="text-2xl font-bold text-red-600 mt-1">
                      {scanResults.api_discovery.failed_connections}
                    </p>
                  </div>
                  <div className="card text-center">
                    <p className="text-sm text-gray-600">Discrepancies</p>
                    <p className="text-2xl font-bold text-yellow-600 mt-1">
                      {scanResults.total_discrepancies}
                    </p>
                  </div>
                  <div className="card text-center">
                    <p className="text-sm text-gray-600">Scanned At</p>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {new Date(scanResults.scanned_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>

                {/* Scan Results */}
                <div className="card">
                  <h3 className="text-lg font-semibold mb-4">Directory Findings</h3>
                  <div className="space-y-4">
                    {scanResults.scan_results.map((result, index) => (
                      <div
                        key={index}
                        className="p-4 bg-gray-50 rounded-lg border border-gray-200"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center">
                            {getTypeIcon(result.type)}
                            <div className="ml-3">
                              <h4 className="font-semibold text-gray-900">{result.source}</h4>
                              <p className="text-xs text-gray-500 capitalize">
                                {result.type.replace('_', ' ')}
                              </p>
                            </div>
                          </div>
                          {result.url && (
                            <a
                              href={result.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary-600 hover:text-primary-700"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                        </div>

                        <div className="mb-2">
                          <p className="text-sm text-gray-600 mb-1">Data Found:</p>
                          <div className="flex flex-wrap gap-1">
                            {result.data_found.map((field, i) => (
                              <span
                                key={i}
                                className="inline-block px-2 py-0.5 text-xs bg-white rounded border border-gray-200 text-gray-700"
                              >
                                {field}
                              </span>
                            ))}
                          </div>
                        </div>

                        {result.last_updated && (
                          <p className="text-xs text-gray-500 mb-2">
                            Last Updated: {result.last_updated}
                          </p>
                        )}

                        {result.discrepancies.length > 0 && (
                          <div className="mt-3 space-y-2">
                            <p className="text-sm font-medium text-gray-700">
                              Discrepancies Found:
                            </p>
                            {result.discrepancies.map((disc, i) => (
                              <div
                                key={i}
                                className={`p-2 rounded border text-sm ${getSeverityColor(
                                  disc.severity
                                )}`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <p className="font-semibold">{disc.field}</p>
                                  <span className="text-xs uppercase">{disc.severity}</span>
                                </div>
                                <p className="text-xs">
                                  <span className="font-medium">Found:</span> {disc.found_value}
                                </p>
                                <p className="text-xs">
                                  <span className="font-medium">Current:</span>{' '}
                                  {disc.current_value}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* API Connection Results */}
                {scanResults.api_connection_results && scanResults.api_connection_results.length > 0 && (
                  <div className="card">
                    <h3 className="text-lg font-semibold mb-4 flex items-center">
                      <Shield className="w-5 h-5 text-primary-600 mr-2" />
                      API Discovery & Connection Tests
                      <span className="ml-auto text-sm font-normal text-gray-600">
                        {scanResults.api_discovery.successful_connections} of {scanResults.api_connection_results.length} connected
                      </span>
                    </h3>
                    <div className="space-y-3">
                      {scanResults.api_connection_results.map((apiResult, index) => (
                        <div
                          key={index}
                          className="p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-1">
                                <h4 className="font-semibold text-gray-900">{apiResult.organization_name}</h4>
                                {getConnectionStatusBadge(apiResult.connection_status)}
                              </div>
                              <p className="text-xs text-gray-500 capitalize">
                                {apiResult.organization_type.replace('_', ' ')} • {apiResult.api_type || 'unknown'}
                              </p>
                            </div>
                          </div>

                          {apiResult.api_endpoint && (
                            <div className="mb-2">
                              <p className="text-xs text-gray-600 mb-1">API Endpoint:</p>
                              <code className="block px-2 py-1 text-xs bg-white rounded border border-gray-200 text-gray-700 font-mono truncate">
                                {apiResult.api_endpoint}
                              </code>
                            </div>
                          )}

                          <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                            {apiResult.supports_npi_search && (
                              <span className="flex items-center">
                                <CheckCircle className="w-3 h-3 mr-1 text-green-600" />
                                NPI Search
                              </span>
                            )}
                            {apiResult.supports_name_search && (
                              <span className="flex items-center">
                                <CheckCircle className="w-3 h-3 mr-1 text-green-600" />
                                Name Search
                              </span>
                            )}
                            {apiResult.response_time_ms && (
                              <span className="flex items-center">
                                <Clock className="w-3 h-3 mr-1" />
                                {apiResult.response_time_ms}ms
                              </span>
                            )}
                          </div>

                          {apiResult.error_message && (
                            <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                              <AlertTriangle className="w-3 h-3 inline mr-1" />
                              {apiResult.error_message}
                            </div>
                          )}

                          {apiResult.connection_status === 'connected' && (
                            <div className="mt-2 text-xs text-green-700 bg-green-50 px-2 py-1 rounded">
                              ✓ API endpoint saved to registry for future automated sync
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Summary */}
                <div className="card">
                  <h3 className="text-lg font-semibold mb-3 flex items-center">
                    <Sparkles className="w-5 h-5 text-primary-600 mr-2" />
                    AI Web Search Analysis
                  </h3>
                  <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap max-h-96 overflow-y-auto">
                    {scanResults.ai_summary}
                  </div>

                  {/* Citations */}
                  {scanResults.citations && scanResults.citations.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center">
                        <ExternalLink className="w-4 h-4 mr-1" />
                        Web Sources ({scanResults.citations.length})
                      </h4>
                      <div className="space-y-1">
                        {scanResults.citations.map((citation, i) => (
                          <a
                            key={i}
                            href={citation}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary-600 hover:text-primary-700 block truncate"
                          >
                            [{i + 1}] {citation}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {!scanning && !scanResults && (
              <div className="card text-center py-12">
                <Sparkles className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">Enter your information and click "Start Magic Scan"</p>
                <p className="text-sm text-gray-400 mt-2">
                  Perplexity AI will search provider directories across the web for you
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
