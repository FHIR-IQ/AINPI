'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ORG_TYPES, PARTICIPATION, type Participation } from '@/data/npd-mcp';

/**
 * Sign-up form for the NPD MCP working group. Posts JSON to
 * /api/v1/npd-mcp/participate. The server answers the same way for a repeat
 * submission, so the form shows one success message for every accepted post.
 */
const FIELD =
  'w-full px-3 py-2 bg-white border border-gray-300 rounded-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary-600';

export default function SignupForm() {
  const [organization, setOrganization] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [orgType, setOrgType] = useState('');
  const [participation, setParticipation] = useState<Participation[]>([]);
  const [useCase, setUseCase] = useState('');
  const [listPublicly, setListPublicly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // State updates land after a re-render; the ref stops a second click that
  // arrives before it from sending a second request.
  const inFlight = useRef(false);

  function toggle(code: Participation, on: boolean) {
    setParticipation((prev) => (on ? [...prev.filter((c) => c !== code), code] : prev.filter((c) => c !== code)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current || done) return;
    inFlight.current = true;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/v1/npd-mcp/participate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organization, contactName, email, orgType, participation, useCase, listPublicly }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok) {
        setDone(true);
      } else {
        setErr(body?.error || 'Something went wrong. Please try again later.');
      }
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
          <span className="mb-1 block font-medium text-ink">Organization name</span>
          <input
            type="text"
            name="organization"
            required
            maxLength={200}
            autoComplete="organization"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-ink">Organization type</span>
          <select
            name="orgType"
            required
            value={orgType}
            onChange={(e) => setOrgType(e.target.value)}
            className={FIELD}
          >
            <option value="">Choose one</option>
            {ORG_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-ink">Your name</span>
          <input
            type="text"
            name="contactName"
            required
            maxLength={200}
            autoComplete="name"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-ink">Email</span>
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD}
          />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 font-medium text-ink">
          How you want to take part <span className="font-normal text-gray-500">(optional)</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PARTICIPATION.map((p) => (
            <label key={p.code} className="flex items-start gap-2">
              <input
                type="checkbox"
                name="participation"
                value={p.code}
                checked={participation.includes(p.code)}
                onChange={(e) => toggle(p.code, e.target.checked)}
                className="mt-1"
              />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1 block font-medium text-ink">
          The use case you care about <span className="font-normal text-gray-500">(optional)</span>
        </span>
        <textarea
          name="useCase"
          rows={3}
          maxLength={2000}
          value={useCase}
          onChange={(e) => setUseCase(e.target.value)}
          className={FIELD}
        />
      </label>

      <div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="listPublicly"
            checked={listPublicly}
            onChange={(e) => setListPublicly(e.target.checked)}
            className="mt-1"
          />
          <span>List our organization&apos;s name on this page</span>
        </label>
        <p className="mt-2 text-xs text-gray-600">
          We use your contact details only to coordinate this group. See our{' '}
          <Link href="/privacy" className="text-primary-600 underline underline-offset-2">
            privacy policy
          </Link>
          .
        </p>
      </div>

      <button
        type="submit"
        disabled={busy || done}
        className="rounded-sm bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-60"
      >
        {busy ? 'Sending…' : 'Sign up'}
      </button>

      {done && (
        <p role="status" className="border-l-2 border-primary-600 pl-3 font-medium text-ink">
          Thanks. You&apos;re on the list.
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
