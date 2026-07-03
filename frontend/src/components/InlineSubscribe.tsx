'use client';

import { useState } from 'react';

interface InlineSubscribeProps {
  /**
   * Persisted to Subscriber.source so per-surface conversion is measurable
   * in the admin report. Use a distinct value per placement, e.g.
   * 'finding_page', 'landscape_panel'.
   */
  source: string;
  /** One-line pitch above the input. Keep it plain. */
  prompt?: string;
}

/**
 * Compact email-capture strip for content pages. Posts to the same
 * /api/v1/subscribe endpoint as the /subscribe page; the only difference
 * is the source tag. Success and error states render inline, no redirect.
 */
export default function InlineSubscribe({
  source,
  prompt = 'Get the next finding in your inbox. One email per release, no filler.',
}: InlineSubscribeProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'ok' | 'err'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    try {
      const res = await fetch('/api/v1/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source }),
      });
      setStatus(res.ok ? 'ok' : 'err');
    } catch {
      setStatus('err');
    }
  }

  if (status === 'ok') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
        Subscribed. The next release update will land in your inbox.
      </div>
    );
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
      <p className="text-sm text-gray-700 mb-2">{prompt}</p>
      <form onSubmit={submit} className="flex gap-2 flex-wrap">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="px-4 py-1.5 text-sm font-medium bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {status === 'submitting' ? 'Subscribing…' : 'Subscribe'}
        </button>
      </form>
      {status === 'err' && (
        <p className="text-xs text-red-600 mt-2">
          That did not go through. Try again, or email gene@fhiriq.com.
        </p>
      )}
    </div>
  );
}
