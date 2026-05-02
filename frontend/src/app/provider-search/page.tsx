'use client';

import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { Search, Loader2, CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react';

interface PayerListItem {
  id: string;
  name: string;
  coverage: string;
  supportsIdentifierSearch: boolean;
}

interface ProviderSummary {
  npi: string | null;
  family: string | null;
  given: string | null;
  prefix: string | null;
  suffix: string | null;
  gender: string | null;
  active: boolean | null;
  fhirId: string;
  identifierSystems: string[];
}

interface PayerResult {
  payerId: string;
  payerName: string;
  coverage: string;
  status: 'matched' | 'not_found' | 'error';
  responseMs: number;
  matchCount: number;
  providers: ProviderSummary[];
  errorMessage?: string;
}

interface SearchResponse {
  ok: boolean;
  query: { type: 'npi' | 'name'; npi?: string; family?: string; given?: string };
  queriedAt: string;
  summary: {
    payersQueried: number;
    matched: number;
    notFound: number;
    errors: number;
    totalMs: number;
    avgMs: number;
  };
  results: PayerResult[];
}

type Mode = 'npi' | 'name';

const NPI_RE = /^\d{10}$/;

export default function ProviderSearchPage() {
  const [payers, setPayers] = useState<PayerListItem[]>([]);
  const [selectedPayerIds, setSelectedPayerIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>('npi');
  const [npi, setNpi] = useState('');
  const [family, setFamily] = useState('');
  const [given, setGiven] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResponse | null>(null);

  // Load payer registry from the API on mount
  useEffect(() => {
    fetch('/api/provider-search')
      .then((r) => r.json())
      .then((data) => {
        const list: PayerListItem[] = data?.payers ?? [];
        setPayers(list);
        setSelectedPayerIds(new Set(list.map((p) => p.id))); // default: all selected
      })
      .catch(() => {
        setPayers([]);
      });
  }, []);

  function togglePayer(id: string) {
    setSelectedPayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllPayers() {
    setSelectedPayerIds(new Set(payers.map((p) => p.id)));
  }

  function deselectAllPayers() {
    setSelectedPayerIds(new Set());
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResults(null);

    if (mode === 'npi' && !NPI_RE.test(npi.trim())) {
      setError('NPI must be exactly 10 digits.');
      return;
    }
    if (mode === 'name' && !family.trim() && !given.trim()) {
      setError('Enter a family name and/or a given name.');
      return;
    }
    if (selectedPayerIds.size === 0) {
      setError('Select at least one payer to query.');
      return;
    }

    setSearching(true);
    try {
      const payload: Record<string, unknown> = {
        type: mode,
        payerIds: Array.from(selectedPayerIds),
      };
      if (mode === 'npi') payload.npi = npi.trim();
      else {
        payload.family = family.trim();
        payload.given = given.trim();
      }

      const res = await fetch('/api/provider-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `request failed (${res.status})`);
      } else {
        setResults(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Search className="w-7 h-7 text-blue-600" />
            Real-time payer directory search
          </h1>
          <p className="mt-2 text-gray-600 text-sm max-w-3xl">
            Live cross-payer query against publicly-published FHIR provider directories
            (CMS-9115-F). Search by NPI, or by name when you don&apos;t have one. Pick
            which payers to query, or hit them all.
          </p>
        </div>

        {/* Search form */}
        <form
          onSubmit={handleSearch}
          className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5"
        >
          {/* Mode toggle */}
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            {(['npi', 'name'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                  mode === m
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {m === 'npi' ? 'Search by NPI' : 'Search by name'}
              </button>
            ))}
          </div>

          {/* Search input(s) */}
          {mode === 'npi' ? (
            <div>
              <label htmlFor="npi" className="block text-sm font-medium text-gray-700 mb-1.5">
                NPI <span className="text-red-500">*</span>
              </label>
              <input
                id="npi"
                inputMode="numeric"
                pattern="\d{10}"
                value={npi}
                onChange={(e) => setNpi(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit NPI (e.g. 1417006842)"
                className="w-full px-4 py-3 text-lg font-mono tracking-wide border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="family" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Family (last) name
                </label>
                <input
                  id="family"
                  value={family}
                  onChange={(e) => setFamily(e.target.value)}
                  placeholder="Smith"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="given" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Given (first) name
                </label>
                <input
                  id="given"
                  value={given}
                  onChange={(e) => setGiven(e.target.value)}
                  placeholder="Jane"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Payer chips */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                Payers ({selectedPayerIds.size}/{payers.length} selected)
              </span>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={selectAllPayers}
                  className="text-blue-600 hover:text-blue-800"
                >
                  All
                </button>
                <span className="text-gray-300">·</span>
                <button
                  type="button"
                  onClick={deselectAllPayers}
                  className="text-gray-500 hover:text-gray-700"
                >
                  None
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {payers.map((p) => {
                const selected = selectedPayerIds.has(p.id);
                const incompatible = mode === 'npi' && !p.supportsIdentifierSearch;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePayer(p.id)}
                    title={p.coverage + (incompatible ? ' · does not support NPI search' : '')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                      selected
                        ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    } ${incompatible && selected ? 'opacity-60' : ''}`}
                  >
                    {selected ? '✓ ' : ''}
                    {p.name}
                    {incompatible && (
                      <span
                        className={`ml-1 text-[10px] uppercase tracking-wider ${
                          selected ? 'text-blue-100' : 'text-gray-400'
                        }`}
                      >
                        name only
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={searching}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-40"
            >
              {searching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching {selectedPayerIds.size} payer{selectedPayerIds.size === 1 ? '' : 's'}…
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Search
                </>
              )}
            </button>
            {error && (
              <span className="text-sm text-red-600 inline-flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                {error}
              </span>
            )}
          </div>
        </form>

        {/* Results */}
        {results && (
          <div className="mt-8 space-y-4">
            {/* Summary strip */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span>
                  <span className="font-semibold text-gray-900">{results.summary.matched}</span>
                  <span className="text-gray-500"> matched</span>
                </span>
                <span>
                  <span className="font-semibold text-gray-900">{results.summary.notFound}</span>
                  <span className="text-gray-500"> not found</span>
                </span>
                {results.summary.errors > 0 && (
                  <span>
                    <span className="font-semibold text-amber-700">{results.summary.errors}</span>
                    <span className="text-amber-700"> error{results.summary.errors === 1 ? '' : 's'}</span>
                  </span>
                )}
                <span className="text-gray-500 inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {results.summary.avgMs} ms avg
                </span>
              </div>
              <div className="text-xs text-gray-500 font-mono">
                {results.query.type === 'npi'
                  ? `NPI ${results.query.npi}`
                  : `${results.query.family || ''} ${results.query.given || ''}`.trim()}
              </div>
            </div>

            {/* Per-payer cards */}
            {results.results.map((r) => (
              <PayerCard key={r.payerId} result={r} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function PayerCard({ result }: { result: PayerResult }) {
  const accent =
    result.status === 'matched'
      ? 'border-emerald-300 bg-emerald-50/40'
      : result.status === 'not_found'
      ? 'border-gray-200 bg-white'
      : 'border-amber-300 bg-amber-50/40';

  return (
    <div className={`rounded-xl border ${accent} p-5`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-semibold text-gray-900">{result.payerName}</h3>
            <StatusBadge status={result.status} />
            {result.status === 'matched' && result.matchCount > 1 && (
              <span className="text-xs text-emerald-700 font-medium">
                {result.matchCount} match{result.matchCount === 1 ? '' : 'es'}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">{result.coverage}</p>
        </div>
        <span className="text-xs text-gray-500 inline-flex items-center gap-1 shrink-0">
          <Clock className="w-3 h-3" />
          {result.responseMs} ms
        </span>
      </div>

      {result.status === 'error' && result.errorMessage && (
        <p className="mt-3 text-sm text-amber-800 bg-amber-100/60 border border-amber-200 rounded-md px-3 py-2">
          {result.errorMessage}
        </p>
      )}

      {result.status === 'matched' && result.providers.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {result.providers.map((p, i) => (
            <li
              key={`${result.payerId}-${i}`}
              className="bg-white border border-gray-200 rounded-md px-4 py-3"
            >
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-semibold text-gray-900">
                  {[p.prefix, p.given, p.family, p.suffix].filter(Boolean).join(' ') || '(name not in record)'}
                </span>
                {p.active === false && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">
                    inactive
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1 font-mono">
                {p.npi && (
                  <a
                    href={`https://npiregistry.cms.hhs.gov/provider-view/${p.npi}`}
                    target="_blank"
                    rel="noopener"
                    className="hover:text-blue-600 underline-offset-2 hover:underline"
                  >
                    NPI {p.npi}
                  </a>
                )}
                {p.gender && <span>· {p.gender}</span>}
                <span>· FHIR id {p.fhirId}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PayerResult['status'] }) {
  if (status === 'matched') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
        <CheckCircle className="w-3 h-3" /> Matched
      </span>
    );
  }
  if (status === 'not_found') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
        <XCircle className="w-3 h-3" /> Not in directory
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
      <AlertTriangle className="w-3 h-3" /> Error
    </span>
  );
}
