'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react';

interface ResourceCount {
  resource: string;
  expected: number;
  actual: number;
  delta: number;
  completeness_pct: number;
  status: 'complete' | 'near_complete' | 'partial' | 'empty';
}

interface ValidationData {
  release_date: string;
  generated_at: string;
  resource_counts: ResourceCount[];
  total_expected: number;
  total_actual: number;
  npi_validity: {
    valid_practitioner_npis: number;
    missing_practitioner_npis: number;
    valid_org_npis: number;
    missing_org_npis: number;
  };
  referential_integrity: {
    practitioner_refs: { total: number; orphans: number; integrity_pct: number };
    org_refs: { total: number; orphans: number; integrity_pct: number };
  };
  endpoint_validity: {
    total: number;
    valid_url_format: number;
    has_connection_type: number;
    has_managing_org: number;
    url_validity_pct: number;
  };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'complete': return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    case 'near_complete': return <CheckCircle2 className="w-4 h-4 text-yellow-600" />;
    case 'partial': return <Clock className="w-4 h-4 text-orange-500" />;
    case 'empty': return <XCircle className="w-4 h-4 text-red-600" />;
    default: return <AlertTriangle className="w-4 h-4 text-gray-400" />;
  }
}

export default function DataValidationPanel() {
  const [data, setData] = useState<ValidationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/npd/validation')
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Validation fetch failed')))
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Data Validity Check</h3>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <p className="text-red-600 text-sm">{error || 'No validation data'}</p>
      </div>
    );
  }

  const overallIngestionPct = (data.total_actual / data.total_expected) * 100;

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Data Validity & Integrity</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Source: CMS NPD release {data.release_date} &middot; Validated {new Date(data.generated_at).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Ingestion:</span>
          <span className={'text-sm font-semibold ' + (overallIngestionPct >= 99 ? 'text-green-700' : overallIngestionPct >= 80 ? 'text-yellow-700' : 'text-orange-700')}>
            {overallIngestionPct.toFixed(2)}%
          </span>
          <span className="text-xs text-gray-400">
            ({fmt(data.total_actual)} / {fmt(data.total_expected)})
          </span>
        </div>
      </div>

      {/* Resource counts table */}
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2 pr-3">Resource</th>
              <th className="pb-2 pr-3 text-right">Expected</th>
              <th className="pb-2 pr-3 text-right">Actual</th>
              <th className="pb-2 pr-3 text-right">Delta</th>
              <th className="pb-2 pr-3">Completeness</th>
              <th className="pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.resource_counts.map((r) => (
              <tr key={r.resource} className="border-b border-gray-100">
                <td className="py-2 pr-3 font-medium capitalize">{r.resource.replace(/_/g, ' ')}</td>
                <td className="py-2 pr-3 text-right text-gray-600">{r.expected.toLocaleString()}</td>
                <td className="py-2 pr-3 text-right font-semibold">{r.actual.toLocaleString()}</td>
                <td className={'py-2 pr-3 text-right ' + (r.delta === 0 ? 'text-gray-400' : r.delta < 0 ? 'text-orange-600' : 'text-gray-800')}>
                  {r.delta > 0 ? '+' : ''}{r.delta.toLocaleString()}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-gray-200 rounded-full h-1.5">
                      <div
                        className={'h-1.5 rounded-full ' + (r.completeness_pct >= 99 ? 'bg-green-500' : r.completeness_pct >= 80 ? 'bg-yellow-500' : 'bg-orange-500')}
                        style={{ width: Math.min(r.completeness_pct, 100) + '%' }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-14 text-right">{r.completeness_pct.toFixed(1)}%</span>
                  </div>
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-1">
                    <StatusIcon status={r.status} />
                    <span className="text-xs text-gray-600 capitalize">{r.status.replace('_', ' ')}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Integrity checks */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">NPI Validity</p>
          <p className="text-2xl font-bold text-gray-900">
            {fmt(data.npi_validity.valid_practitioner_npis + data.npi_validity.valid_org_npis)}
          </p>
          <p className="text-xs text-gray-500 mt-1">10-digit NPIs verified</p>
          {(data.npi_validity.missing_practitioner_npis + data.npi_validity.missing_org_npis) > 0 && (
            <p className="text-xs text-orange-600 mt-1">
              {fmt(data.npi_validity.missing_practitioner_npis + data.npi_validity.missing_org_npis)} missing
            </p>
          )}
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Referential Integrity</p>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-gray-900">
              {data.referential_integrity.practitioner_refs.integrity_pct.toFixed(1)}%
            </p>
            <span className="text-xs text-gray-500">practitioner refs</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {fmt(data.referential_integrity.org_refs.integrity_pct)}% org refs &middot;
            {' '}{fmt(data.referential_integrity.practitioner_refs.orphans)} orphans
          </p>
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Endpoint Validity</p>
          <p className="text-2xl font-bold text-gray-900">
            {data.endpoint_validity.url_validity_pct.toFixed(1)}%
          </p>
          <p className="text-xs text-gray-500 mt-1">
            valid HTTP URLs &middot; {fmt(data.endpoint_validity.valid_url_format)} of {fmt(data.endpoint_validity.total)}
          </p>
        </div>
      </div>
    </div>
  );
}
