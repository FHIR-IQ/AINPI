'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';

/**
 * Self-serve API trial form. Posts JSON to /api/v1/trial. The server answers
 * the same way whether or not the address already had a trial (the email says
 * which), so the form shows one success message for every accepted post.
 */
const FIELD =
  'w-full px-3 py-2 bg-white border border-gray-300 rounded-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary-600';

export default function TrialForm() {
  const [organization, setOrganization] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [useCase, setUseCase] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current || done) return;
    inFlight.current = true;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/v1/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organization, contactName, email, role, useCase, acceptTerms, website }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok) setDone(true);
      else setErr(body?.error || 'Something went wrong. Please try again later.');
    } catch {
      setErr('Something went wrong. Please try again later.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 text-sm">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-medium text-ink">Organization</span>
          <input type="text" name="organization" required maxLength={200} autoComplete="organization"
            value={organization} onChange={(e) => setOrganization(e.target.value)} className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-ink">Your name</span>
          <input type="text" name="contactName" required maxLength={200} autoComplete="name"
            value={contactName} onChange={(e) => setContactName(e.target.value)} className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-ink">Work email</span>
          <input type="email" name="email" required maxLength={254} autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-ink">
            Role <span className="font-normal text-gray-500">(optional)</span>
          </span>
          <input type="text" name="role" maxLength={120} autoComplete="organization-title"
            value={role} onChange={(e) => setRole(e.target.value)} className={FIELD} />
        </label>
      </div>

      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Leave this field empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off"
            value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block font-medium text-ink">
          What you want to build or answer <span className="font-normal text-gray-500">(optional)</span>
        </span>
        <textarea name="useCase" rows={3} maxLength={2000}
          value={useCase} onChange={(e) => setUseCase(e.target.value)} className={FIELD} />
      </label>

      <label className="flex items-start gap-2">
        <input type="checkbox" name="acceptTerms" required checked={acceptTerms}
          onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-1" />
        <span>
          I have read the <a href="#terms" className="text-primary-600 underline underline-offset-2">trial terms</a>.
        </span>
      </label>
      <p className="text-xs text-gray-600">
        We email you the key, one reminder before the trial ends, and one note when it ends. See our{' '}
        <Link href="/privacy" className="text-primary-600 underline underline-offset-2">privacy policy</Link>.
      </p>

      <button type="submit" disabled={busy || done}
        className="rounded-sm bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-60">
        {busy ? 'Sending…' : 'Start the trial'}
      </button>

      {done && (
        <p role="status" className="border-l-2 border-primary-600 pl-3 font-medium text-ink">
          Check your inbox. Your key is on its way to {email}.
        </p>
      )}
      {err && (
        <p role="alert" className="text-signal">
          {err}
        </p>
      )}
    </form>
  );
}
