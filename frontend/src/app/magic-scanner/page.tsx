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
}

interface NPPESStaleCheck {
  is_stale: boolean;
  last_update_date: string;
  days_since_update: number;
  needs_sync: boolean;
  recommendation: string;
}

interface ScanResponse {
  success: boolean;
  npi: string;
  last_name: string;
  state?: string;
  scan_results: ScanResult[];
  nppes_stale_check: NPPESStaleCheck;
  ai_summary: string;
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
              <p className="font-semibold mb-1">How it works:</p>
              <ul className="space-y-1 ml-4 list-disc">
                <li>Claude AI searches major insurance directories and provider networks</li>
                <li>Compares found information with your current profile data</li>
                <li>Flags discrepancies and outdated information</li>
                <li>Checks NPPES data staleness and recommends sync if needed</li>
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
                  Claude AI is scanning provider directories...
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
                <div className="grid grid-cols-3 gap-4">
                  <div className="card text-center">
                    <p className="text-sm text-gray-600">Sources Checked</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {scanResults.total_sources_checked}
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

                {/* AI Summary */}
                <div className="card">
                  <h3 className="text-lg font-semibold mb-3 flex items-center">
                    <Sparkles className="w-5 h-5 text-primary-600 mr-2" />
                    AI Analysis Summary
                  </h3>
                  <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">
                    {scanResults.ai_summary}
                  </div>
                </div>
              </>
            )}

            {!scanning && !scanResults && (
              <div className="card text-center py-12">
                <Sparkles className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">Enter your information and click "Start Magic Scan"</p>
                <p className="text-sm text-gray-400 mt-2">
                  Claude AI will search provider directories for you
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
