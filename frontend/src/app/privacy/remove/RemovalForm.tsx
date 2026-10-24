'use client';

import { useState } from 'react';

/**
 * Removal-request form. Posts to /api/v1/privacy/remove, which answers the
 * same way whether or not the NPI has a page, so this component shows one
 * success message for every accepted request.
 */
export default function RemovalForm() {
  const [npi, setNpi] = useState('');
  const [email, setEmail] = useState('');
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = npi.replace(/\D/g, '');
    if (clean.length !== 10) {
      setErr('An NPI is exactly 10 digits.');
      return;
    }
    if (!attest) {
      setErr('Please confirm the statement above the button.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch('/api/v1/privacy/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ npi: clean, email: email.trim(), attest }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || 'Something went wrong. Please try again later.');
      } else {
        setDone(body?.message || 'Request received.');
      }
    } catch {
      setErr('Something went wrong. Please try again later.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p role="status" className="text-sm text-ink border-l-2 border-primary-600 pl-3">
        {done}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <label className="block text-sm">
        <span className="block mb-1 font-medium">NPI</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          required
          value={npi}
          onChange={(e) => setNpi(e.target.value)}
          className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </label>
      <label className="block text-sm">
        <span className="block mb-1 font-medium">Email for the confirmation</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          required
          checked={attest}
          onChange={(e) => setAttest(e.target.checked)}
          className="mt-1"
        />
        <span>
          I am the provider identified by this NPI, or authorized to act for them.
        </span>
      </label>
      <button
        type="submit"
        disabled={busy}
        className="px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-sm hover:bg-primary-700 disabled:opacity-60"
      >
        {busy ? 'Sending…' : 'Request removal'}
      </button>
      {err && (
        <p role="alert" className="text-sm text-signal">
          {err}
        </p>
      )}
    </form>
  );
}
