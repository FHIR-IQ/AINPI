'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Navigates to /npi/<npi>. Records outside the pre-rendered cohort return
 * the 404 page (by design — no runtime lookups); the index page explains
 * that and points at /npd search for everything else.
 */
export default function NpiLookupForm() {
  const router = useRouter();
  const [npi, setNpi] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = npi.replace(/\D/g, '');
    if (clean.length !== 10) {
      setErr('An NPI is exactly 10 digits.');
      return;
    }
    setErr(null);
    router.push(`/npi/${clean}`);
  }

  return (
    <form onSubmit={submit} className="flex gap-2 flex-wrap">
      <input
        type="text"
        inputMode="numeric"
        value={npi}
        onChange={(e) => setNpi(e.target.value)}
        placeholder="10-digit NPI, e.g. 1003027665"
        aria-label="NPI"
        className="flex-1 min-w-[220px] px-3 py-2 text-sm border border-gray-300 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <button
        type="submit"
        className="px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-md hover:bg-primary-700"
      >
        Look up
      </button>
      {err && <p className="w-full text-xs text-red-600">{err}</p>}
    </form>
  );
}
