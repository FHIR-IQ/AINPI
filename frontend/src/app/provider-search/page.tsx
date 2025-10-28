'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import {
  Search,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Building2,
  MapPin,
  Phone,
  Globe,
  Award,
} from 'lucide-react';

interface ProviderData {
  npi: string;
  name: {
    first: string;
    last: string;
    middle?: string;
    prefix?: string;
    suffix?: string;
  };
  gender?: string;
  specialties?: Array<{
    code: string;
    display: string;
  }>;
  locations?: Array<{
    name?: string;
    address: {
      line1?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
    phone?: string;
  }>;
  networks?: string[];
  accepting_patients?: boolean;
  languages?: string[];
  last_updated?: string;
}

interface SearchResult {
  payer: string;
  found: boolean;
  status: 'success' | 'error' | 'not_found' | 'auth_required';
  data?: ProviderData;
  response_time_ms: number;
  error_message?: string;
}

interface SearchResponse {
  success: boolean;
  npi: string;
  summary: {
    total_payers_searched: number;
    found_in_payers: number;
    not_found_in_payers: number;
    average_response_time_ms: number;
  };
  results: SearchResult[];
  searched_at: string;
}

export default function ProviderSearchPage() {
  const router = useRouter();
  const [npi, setNpi] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearching(true);
    setError('');
    setSearchResults(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/provider-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ npi }),
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data: SearchResponse = await response.json();
      setSearchResults(data);
    } catch (err: any) {
      console.error('Search error:', err);
      setError(err.message || 'Failed to search provider directories');
    } finally {
      setSearching(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Found
          </span>
        );
      case 'not_found':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            <XCircle className="w-3 h-3 mr-1" />
            Not Found
          </span>
        );
      case 'auth_required':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Auth Required
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <XCircle className="w-3 h-3 mr-1" />
            Error
          </span>
        );
      default:
        return null;
    }
  };

  const formatName = (name: ProviderData['name']) => {
    const parts = [
      name.prefix,
      name.first,
      name.middle,
      name.last,
      name.suffix,
    ].filter(Boolean);
    return parts.join(' ');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center mb-4">
            <Search className="w-8 h-8 text-primary-600 mr-3" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Real-Time Provider Search</h1>
              <p className="mt-2 text-gray-600">
                Search connected payer directories in real-time for fresh provider data
              </p>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start">
              <Building2 className="w-5 h-5 text-blue-600 mr-3 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-1">How it works:</p>
                <ul className="space-y-1 ml-4 list-disc">
                  <li>Searches 6 major payer APIs in real-time (public endpoints)</li>
                  <li>Returns fresh data directly from payer systems</li>
                  <li>No data storage - always current information</li>
                  <li>Compares provider data across multiple payers</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Search Form */}
          <div className="lg:col-span-1">
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Search by NPI</h2>
              <form onSubmit={handleSearch} className="space-y-4">
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
                  <p className="mt-1 text-xs text-gray-500">10-digit National Provider Identifier</p>
                </div>

                <button
                  type="submit"
                  disabled={searching}
                  className="btn-primary w-full flex items-center justify-center"
                >
                  {searching ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Searching...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4 mr-2" />
                      Search Payer Directories
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
            {searching && (
              <div className="card text-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-primary-600 mx-auto mb-4" />
                <p className="text-gray-600">
                  Searching 6 payer directories in real-time...
                </p>
                <p className="text-sm text-gray-500 mt-2">This may take 5-10 seconds</p>
              </div>
            )}

            {searchResults && (
              <>
                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="card text-center">
                    <p className="text-sm text-gray-600">Payers Searched</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {searchResults.summary.total_payers_searched}
                    </p>
                  </div>
                  <div className="card text-center">
                    <p className="text-sm text-gray-600">Found In</p>
                    <p className="text-2xl font-bold text-green-600 mt-1">
                      {searchResults.summary.found_in_payers}
                    </p>
                  </div>
                  <div className="card text-center">
                    <p className="text-sm text-gray-600">Avg Response</p>
                    <p className="text-2xl font-bold text-blue-600 mt-1">
                      {searchResults.summary.average_response_time_ms}ms
                    </p>
                  </div>
                </div>

                {/* Search Results by Payer */}
                <div className="card">
                  <h3 className="text-lg font-semibold mb-4">Results by Payer</h3>
                  <div className="space-y-4">
                    {searchResults.results.map((result, index) => (
                      <div
                        key={index}
                        className={`p-4 rounded-lg border ${
                          result.found
                            ? 'bg-green-50 border-green-200'
                            : 'bg-gray-50 border-gray-200'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <h4 className="font-semibold text-gray-900">{result.payer}</h4>
                              {getStatusBadge(result.status)}
                            </div>
                            <div className="flex items-center text-xs text-gray-500">
                              <Clock className="w-3 h-3 mr-1" />
                              {result.response_time_ms}ms
                            </div>
                          </div>
                        </div>

                        {result.found && result.data && (
                          <div className="mt-3 space-y-2 text-sm">
                            <div>
                              <p className="font-medium text-gray-900">
                                {formatName(result.data.name)}
                              </p>
                              <p className="text-gray-600">NPI: {result.data.npi}</p>
                            </div>

                            {result.data.specialties && result.data.specialties.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-700 mb-1">Specialties:</p>
                                <div className="flex flex-wrap gap-1">
                                  {result.data.specialties.map((spec, i) => (
                                    <span
                                      key={i}
                                      className="inline-block px-2 py-0.5 text-xs bg-white rounded border border-gray-200"
                                    >
                                      {spec.display}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {result.data.languages && result.data.languages.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-700 mb-1">Languages:</p>
                                <p className="text-xs text-gray-600">
                                  {result.data.languages.join(', ')}
                                </p>
                              </div>
                            )}

                            {result.data.last_updated && (
                              <div className="text-xs text-gray-500">
                                Last updated: {new Date(result.data.last_updated).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        )}

                        {result.error_message && (
                          <div className="mt-2 text-xs text-red-600">
                            {result.error_message}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
