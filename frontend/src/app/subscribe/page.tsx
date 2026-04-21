'use client';

import { useState } from 'react';
import Navbar from '@/components/Navbar';

export default function SubscribePage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'ok' | 'err'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/v1/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'subscribe_page' }),
      });
      if (res.ok) {
        setStatus('ok');
        setEmail('');
      } else {
        const data = await res.json().catch(() => ({}));
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
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Subscribe for updates</h1>
        <p className="text-gray-600 mb-8">
          Periodic updates on new AINPI findings and methodology changes. One email per major
          release, plus the annual <em>State of the NDH</em> report. No marketing, no spam.
        </p>

        {status === 'ok' ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-5 text-green-900">
            <p className="font-semibold">You&apos;re on the list.</p>
            <p className="text-sm mt-1">
              We&apos;ll send the first update when the next material finding lands.
              Your email sits in Supabase until then — see <a href="/privacy" className="underline">privacy policy</a> for how it&apos;s handled.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border p-6">
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="you@example.com"
              autoComplete="email"
              disabled={status === 'submitting'}
            />
            <button
              type="submit"
              disabled={status === 'submitting' || !email}
              className="mt-4 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-40"
            >
              {status === 'submitting' ? 'Subscribing…' : 'Subscribe'}
            </button>
            {status === 'err' && (
              <p className="mt-3 text-sm text-red-600">{errorMsg}</p>
            )}
            <p className="mt-4 text-xs text-gray-500">
              By subscribing you agree to AINPI emailing you release updates. Unsubscribe any time by replying with &quot;remove&quot; or emailing{' '}
              <a href="mailto:gene@fhiriq.com" className="underline">gene@fhiriq.com</a>.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
