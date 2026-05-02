'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { REPORTS, DEFAULT_REPORT_ID } from '@/data/reports';

export default function DownloadPage() {
  const router = useRouter();
  const [reportId, setReportId] = useState<string>(DEFAULT_REPORT_ID);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [useCase, setUseCase] = useState('');
  const [alsoSubscribe, setAlsoSubscribe] = useState(true);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'err'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/v1/download-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name,
          organization,
          useCase,
          alsoSubscribe,
          reportId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.redirect) {
        router.push(data.redirect);
      } else {
        setStatus('err');
        setErrorMsg(data?.error || `request failed (${res.status})`);
      }
    } catch (err) {
      setStatus('err');
      setErrorMsg(err instanceof Error ? err.message : 'network error');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          Download an AINPI report
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          Pick a report below, give us a little context about how you&apos;ll use it,
          and we&apos;ll take you straight to the document. Name, organization,
          and use-case are optional — only your email is required.
        </p>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border p-6 space-y-6">
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-gray-900 mb-2">
              Choose a report
            </legend>
            {REPORTS.map((r) => (
              <label
                key={r.id}
                className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                  reportId === r.id
                    ? 'border-primary-500 ring-1 ring-primary-500 bg-primary-50/40'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="reportId"
                  value={r.id}
                  checked={reportId === r.id}
                  onChange={() => setReportId(r.id)}
                  className="mt-1 shrink-0"
                  disabled={status === 'submitting'}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">
                      {r.title}
                    </span>
                    {r.badge && (
                      <span
                        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          r.badge === 'NEW'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {r.badge}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-gray-500 uppercase tracking-wider">
                      {r.format} {r.length ? `· ${r.length}` : ''}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-600 leading-snug">
                    {r.description}
                  </p>
                </div>
              </label>
            ))}
          </fieldset>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="you@example.com"
              autoComplete="email"
              disabled={status === 'submitting'}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoComplete="name"
                disabled={status === 'submitting'}
              />
            </div>
            <div>
              <label htmlFor="organization" className="block text-sm font-medium text-gray-700 mb-1">
                Organization
              </label>
              <input
                id="organization"
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoComplete="organization"
                disabled={status === 'submitting'}
              />
            </div>
          </div>

          <div>
            <label htmlFor="useCase" className="block text-sm font-medium text-gray-700 mb-1">
              How will you use this? (optional)
            </label>
            <textarea
              id="useCase"
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Auditing our payer network · Academic research on provider directory accuracy · Journalism · Regulatory compliance · …"
              disabled={status === 'submitting'}
            />
          </div>

          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={alsoSubscribe}
              onChange={(e) => setAlsoSubscribe(e.target.checked)}
              className="mt-0.5"
              disabled={status === 'submitting'}
            />
            <span>
              Also subscribe me to AINPI release updates. One email per major finding, plus the annual report.
            </span>
          </label>

          <button
            type="submit"
            disabled={status === 'submitting' || !email}
            className="w-full px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-40"
          >
            {status === 'submitting' ? 'Submitting…' : 'Get the report'}
          </button>

          {status === 'err' && (
            <p className="text-sm text-red-600">{errorMsg}</p>
          )}

          <p className="text-xs text-gray-500">
            Submitting this form creates one row in AINPI&apos;s Supabase (encrypted, US-east-2). We use it to understand who&apos;s reading the research and may email you about major updates. See the <a href="/privacy" className="underline">privacy policy</a>. No third-party sharing.
          </p>
        </form>
      </main>
    </div>
  );
}
