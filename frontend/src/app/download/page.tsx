'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';

export default function DownloadPage() {
  const router = useRouter();
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
        body: JSON.stringify({ email, name, organization, useCase, alsoSubscribe }),
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
          Download the AINPI v1.0 report
        </h1>
        <p className="text-gray-600 mb-2">
          <em>The State of the National Provider Directory</em> — all six
          pre-registered findings against the 2026-04-09 CMS NPD release,
          in one printable document.
        </p>
        <p className="text-sm text-gray-500 mb-8">
          Give us a little context about how you&apos;ll use the research
          and we&apos;ll take you straight to the report. Name, organization,
          and use-case are optional — only your email is required.
        </p>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border p-6 space-y-4">
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
          <p className="text-xs text-gray-500">
            Prefer the web version? View the full report at <a href="/report" className="underline">/report</a> (same content, no download required).
          </p>
        </form>
      </main>
    </div>
  );
}
