'use client';

import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { Search, Loader2, CheckCircle, XCircle, AlertTriangle, Clock, MapPin, Phone, Award, Languages, Globe, Database } from 'lucide-react';

interface SourceMeta {
  id: string;
  name: string;
  category: 'directory' | 'authoritative' | 'payer';
  coverage: string;
  npiSearchable: boolean;
  nameSearchable: boolean;
}

interface NormalizedAddress {
  use?: string;
  type?: string;
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  telecom?: { system: string; value: string }[];
}

interface NormalizedPractitioner {
  npi: string | null;
  sourceId: string | null;
  name: { family: string | null; given: string | null; prefix: string | null; suffix: string | null; full: string };
  gender: string | null;
  active: boolean | null;
  credential: string | null;
  specialties: { code: string; display: string; system?: string; primary?: boolean; license?: string; state?: string }[];
  addresses: NormalizedAddress[];
  languages: string[];
  qualifications: { code?: string; display?: string; issuer?: string; period?: string }[];
  lastUpdated: string | null;
  identifierSystems: string[];
}

interface SourceResult {
  sourceId: string;
  sourceName: string;
  category: SourceMeta['category'];
  coverage: string;
  status: 'matched' | 'not_found' | 'error' | 'skipped';
  responseMs: number;
  matchCount: number;
  practitioners: NormalizedPractitioner[];
  errorMessage?: string;
}

interface SearchResponse {
  ok: boolean;
  query: { type: 'npi' | 'name'; npi?: string; family?: string; given?: string };
  queriedAt: string;
  summary: { sourcesQueried: number; matched: number; notFound: number; errors: number; skipped: number; totalMs: number; avgMs: number };
  results: SourceResult[];
}

type Mode = 'npi' | 'name';
const NPI_RE = /^\d{10}$/;

export default function ProviderSearchPage() {
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>('npi');
  const [npi, setNpi] = useState('');
  const [family, setFamily] = useState('');
  const [given, setGiven] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResponse | null>(null);

  useEffect(() => {
    fetch('/api/provider-search')
      .then((r) => r.json())
      .then((data) => {
        const list: SourceMeta[] = data?.sources ?? [];
        setSources(list);
        setSelectedSourceIds(new Set(list.map((s) => s.id)));
      })
      .catch(() => setSources([]));
  }, []);

  function toggleSource(id: string) {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    if (selectedSourceIds.size === 0) {
      setError('Select at least one source.');
      return;
    }

    setSearching(true);
    try {
      const payload: Record<string, unknown> = {
        type: mode,
        sourceIds: Array.from(selectedSourceIds),
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
      if (!res.ok) setError(data?.error || `request failed (${res.status})`);
      else setResults(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setSearching(false);
    }
  }

  // Group sources by category for chip display.
  const sourcesByCategory: Record<string, SourceMeta[]> = sources.reduce((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s);
    return acc;
  }, {} as Record<string, SourceMeta[]>);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Search className="w-7 h-7 text-blue-600" />
            Cross-source provider search
          </h1>
          <p className="mt-2 text-gray-600 text-sm max-w-3xl">
            Live query across the CMS National Provider Directory, the NPPES NPI
            Registry, and 4 payer FHIR directories. Each source returns whatever
            fields it carries — see them side by side. Search by NPI, or by name.
          </p>
        </div>

        <form onSubmit={handleSearch} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            {(['npi', 'name'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                  mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {m === 'npi' ? 'Search by NPI' : 'Search by name'}
              </button>
            ))}
          </div>

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
                <label htmlFor="family" className="block text-sm font-medium text-gray-700 mb-1.5">Family (last) name</label>
                <input
                  id="family"
                  value={family}
                  onChange={(e) => setFamily(e.target.value)}
                  placeholder="Smith"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="given" className="block text-sm font-medium text-gray-700 mb-1.5">Given (first) name</label>
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

          {/* Source chips, grouped */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                Sources ({selectedSourceIds.size}/{sources.length} selected)
              </span>
              <div className="flex items-center gap-3 text-xs">
                <button type="button" onClick={() => setSelectedSourceIds(new Set(sources.map((s) => s.id)))} className="text-blue-600 hover:text-blue-800">
                  All
                </button>
                <span className="text-gray-300">·</span>
                <button type="button" onClick={() => setSelectedSourceIds(new Set())} className="text-gray-500 hover:text-gray-700">
                  None
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {Object.entries(sourcesByCategory).map(([category, list]) => (
                <div key={category} className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 w-20 shrink-0">
                    {category}
                  </span>
                  {list.map((s) => {
                    const selected = selectedSourceIds.has(s.id);
                    const incompatible = mode === 'npi' && !s.npiSearchable;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSource(s.id)}
                        title={s.coverage + (incompatible ? ' · NPI search unavailable' : '')}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                          selected
                            ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        } ${incompatible && selected ? 'opacity-60' : ''}`}
                      >
                        {selected ? '✓ ' : ''}
                        {s.name}
                        {incompatible && (
                          <span className={`ml-1 text-[10px] uppercase tracking-wider ${selected ? 'text-blue-100' : 'text-gray-400'}`}>
                            name only
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={searching}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-40"
            >
              {searching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching {selectedSourceIds.size} source{selectedSourceIds.size === 1 ? '' : 's'}…
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

        {results && (
          <div className="mt-8 space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span><span className="font-semibold text-gray-900">{results.summary.matched}</span><span className="text-gray-500"> matched</span></span>
                <span><span className="font-semibold text-gray-900">{results.summary.notFound}</span><span className="text-gray-500"> not found</span></span>
                {results.summary.skipped > 0 && (
                  <span><span className="font-semibold text-gray-700">{results.summary.skipped}</span><span className="text-gray-500"> skipped</span></span>
                )}
                {results.summary.errors > 0 && (
                  <span><span className="font-semibold text-amber-700">{results.summary.errors}</span><span className="text-amber-700"> error{results.summary.errors === 1 ? '' : 's'}</span></span>
                )}
                <span className="text-gray-500 inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {results.summary.avgMs} ms avg
                </span>
              </div>
              <div className="text-xs text-gray-500 font-mono">
                {results.query.type === 'npi'
                  ? `NPI ${results.query.npi}`
                  : `${results.query.family || ''} ${results.query.given || ''}`.trim()}
              </div>
            </div>

            {results.results.map((r) => (
              <SourceCard key={r.sourceId} result={r} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// --- Source card --------------------------------------------------------

function SourceCard({ result }: { result: SourceResult }) {
  const accent =
    result.status === 'matched'
      ? 'border-emerald-300 bg-emerald-50/40'
      : result.status === 'not_found'
      ? 'border-gray-200 bg-white'
      : result.status === 'skipped'
      ? 'border-gray-200 bg-gray-50/60'
      : 'border-amber-300 bg-amber-50/40';

  const categoryIcon =
    result.category === 'directory' ? (
      <Database className="w-4 h-4 text-blue-600" />
    ) : result.category === 'authoritative' ? (
      <Award className="w-4 h-4 text-purple-600" />
    ) : (
      <Globe className="w-4 h-4 text-emerald-600" />
    );

  return (
    <div className={`rounded-xl border ${accent} p-5`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
              {categoryIcon}
              {result.category}
            </span>
            <h3 className="text-lg font-semibold text-gray-900">{result.sourceName}</h3>
            <StatusBadge status={result.status} />
            {result.status === 'matched' && result.matchCount > 1 && (
              <span className="text-xs text-emerald-700 font-medium">{result.matchCount} matches</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">{result.coverage}</p>
        </div>
        <span className="text-xs text-gray-500 inline-flex items-center gap-1 shrink-0">
          <Clock className="w-3 h-3" />
          {result.responseMs} ms
        </span>
      </div>

      {(result.status === 'error' || result.status === 'skipped') && result.errorMessage && (
        <p className={`mt-3 text-sm rounded-md px-3 py-2 ${
          result.status === 'skipped'
            ? 'text-gray-600 bg-gray-100 border border-gray-200'
            : 'text-amber-800 bg-amber-100/60 border border-amber-200'
        }`}>
          {result.errorMessage}
        </p>
      )}

      {result.status === 'matched' && result.practitioners.map((p, i) => (
        <PractitionerBlock key={`${result.sourceId}-${i}`} p={p} />
      ))}
    </div>
  );
}

function PractitionerBlock({ p }: { p: NormalizedPractitioner }) {
  const fieldClass = 'text-xs uppercase tracking-wider font-bold text-gray-500';

  return (
    <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4 space-y-3">
      {/* Header line */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-base font-semibold text-gray-900">
          {p.name.full || '(name not in record)'}
          {p.credential && <span className="ml-1 text-sm font-normal text-gray-500">{p.credential}</span>}
        </span>
        {p.active === true && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">active</span>
        )}
        {p.active === false && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-bold">inactive</span>
        )}
        {p.gender && (
          <span className="text-[10px] uppercase tracking-wider text-gray-500">· {p.gender}</span>
        )}
      </div>

      {/* NPI line */}
      {p.npi && (
        <div className="text-xs font-mono">
          <a
            href={`https://npiregistry.cms.hhs.gov/provider-view/${p.npi}`}
            target="_blank"
            rel="noopener"
            className="text-blue-600 hover:underline"
          >
            NPI {p.npi}
          </a>
          {p.sourceId && p.sourceId !== p.npi && (
            <span className="text-gray-400"> · source id {p.sourceId}</span>
          )}
        </div>
      )}

      {/* Specialties */}
      {p.specialties.length > 0 && (
        <div>
          <div className={fieldClass}>Specialties / taxonomies</div>
          <ul className="mt-1 text-sm text-gray-800 space-y-0.5">
            {p.specialties.map((s, i) => (
              <li key={i}>
                {s.primary && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-bold mr-1">primary</span>}
                <span className="font-medium">{s.display}</span>
                {s.code && <span className="text-gray-500 font-mono text-xs ml-1.5">({s.code})</span>}
                {(s.license || s.state) && (
                  <span className="text-gray-500 text-xs ml-1.5">
                    · license {s.license || '?'}{s.state ? ` (${s.state})` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Addresses */}
      {p.addresses.length > 0 && (
        <div>
          <div className={fieldClass}>Locations</div>
          <ul className="mt-1 text-sm text-gray-800 space-y-2">
            {p.addresses.map((a, i) => (
              <li key={i} className="leading-snug">
                <span className="inline-flex items-start gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                  <span>
                    {a.use && (
                      <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1.5">{a.use}</span>
                    )}
                    {a.line && a.line.length > 0 && <span>{a.line.join(', ')}</span>}
                    {(a.city || a.state || a.postalCode) && (
                      <span className={a.line?.length ? ' · ' : ''}>
                        {[a.city, a.state, a.postalCode].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </span>
                </span>
                {a.telecom && a.telecom.length > 0 && (
                  <span className="ml-5 text-xs text-gray-500 inline-flex items-center gap-2 flex-wrap">
                    {a.telecom.map((t, j) => (
                      <span key={j} className="inline-flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {t.system}: {t.value}
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Languages */}
      {p.languages.length > 0 && (
        <div>
          <div className={fieldClass}>Languages</div>
          <div className="mt-1 text-sm text-gray-800 inline-flex items-center gap-1.5">
            <Languages className="w-3.5 h-3.5 text-gray-400" />
            {p.languages.join(', ')}
          </div>
        </div>
      )}

      {/* Qualifications */}
      {p.qualifications.length > 0 && (
        <div>
          <div className={fieldClass}>Qualifications</div>
          <ul className="mt-1 text-sm text-gray-800 space-y-0.5">
            {p.qualifications.map((q, i) => (
              <li key={i}>
                <Award className="w-3 h-3 inline-block text-gray-400 mr-1" />
                {q.display || q.code || '(unspecified)'}
                {q.issuer && <span className="text-gray-500"> — {q.issuer}</span>}
                {q.period && <span className="text-gray-500 text-xs ml-1.5">{q.period}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Last updated + identifier systems footer */}
      {(p.lastUpdated || p.identifierSystems.length > 0) && (
        <div className="text-[10px] text-gray-400 font-mono pt-2 border-t border-gray-100">
          {p.lastUpdated && <span>updated {p.lastUpdated.slice(0, 10)}</span>}
          {p.lastUpdated && p.identifierSystems.length > 0 && <span> · </span>}
          {p.identifierSystems.length > 0 && (
            <span>identifiers: {p.identifierSystems.length} system{p.identifierSystems.length === 1 ? '' : 's'}</span>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: SourceResult['status'] }) {
  if (status === 'matched') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800"><CheckCircle className="w-3 h-3" /> Matched</span>;
  }
  if (status === 'not_found') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700"><XCircle className="w-3 h-3" /> Not in directory</span>;
  }
  if (status === 'skipped') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">Skipped</span>;
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800"><AlertTriangle className="w-3 h-3" /> Error</span>;
}
