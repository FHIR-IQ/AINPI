/**
 * POST /api/v1/trial: start a self-serve 14-day API trial (/trial).
 *
 * Order: per-IP limit (3/min, 5/UTC day), body cap (16 KB, 413), honeypot
 * (same 200, nothing stored), validation, global daily ceiling, then
 * startTrial() in src/lib/trial.ts, which emails the key. The response is the
 * same for a new trial and for an address that already had one, so the form
 * cannot be used to learn who has signed up. Touches no paid service.
 */
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { bump, clientIp } from '@/lib/rate-limit';
import { sendTrialAlert, sendTrialCeilingAlert, sendTrialEmail } from '@/lib/admin-email';
import { parseTrial, startTrial, type TrialDb } from '@/lib/trial';

export const dynamic = 'force-dynamic';

const PER_MINUTE = 3;
const PER_DAY = 5;
const MAX_BODY_BYTES = 16_384;
const DAILY_CEILING = Number(process.env.TRIAL_DAILY_CEILING ?? 20);

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; name?: unknown };
    if (typeof e.code === 'string' && e.code) return e.code;
    if (typeof e.name === 'string' && e.name) return e.name;
  }
  return 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const now = new Date();
  const minute = Math.floor(now.getTime() / 60_000);
  const day = Math.floor(now.getTime() / 86_400_000);

  const m = await bump(`trial:ip:${ip}:m:${minute}`, 1, 120_000);
  const d = await bump(`trial:ip:${ip}:d:${day}`, 1, 172_800_000);
  if ((m !== null && m > PER_MINUTE) || (d !== null && d > PER_DAY)) {
    return fail(429, 'Too many requests. Please try again later.');
  }

  const length = Number(req.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return fail(413, 'Please shorten your answers and try again.');
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Please fill in the form and try again.');
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const trap = (body as Record<string, unknown>).website;
    if (typeof trap === 'string' && trap.trim() !== '') return NextResponse.json({ ok: true });
  }
  const parsed = parseTrial(body);
  if (!parsed.ok) return fail(400, parsed.error);

  const gates = {
    // One automated email per address per UTC day, whatever the kind.
    mailOnce: async (emailNorm: string) => {
      const n = await bump(`trial:mailto:${emailNorm}:d:${day}`, 1, 172_800_000);
      return n === null || n <= 1;
    },
    // Charged only for a brand-new address (startTrial calls it after the
    // existing-address check), so repeats cannot pause real sign-ups.
    reserveNew: async () => {
      const today = await bump(`trial:global:d:${day}`, 1, 172_800_000);
      if (today === null || today <= DAILY_CEILING) return true;
      const first = await bump(`trial:ceiling-alert:d:${day}`, 1, 172_800_000);
      if (first === 1) void sendTrialCeilingAlert(DAILY_CEILING).catch(() => {});
      return false;
    },
  };

  try {
    const outcome = await startTrial(
      parsed.value,
      { ip: ip === 'unknown' ? null : ip, userAgent: req.headers.get('user-agent')?.slice(0, 500) || null },
      now,
      prisma as unknown as TrialDb,
      sendTrialEmail,
      gates,
    );
    if (outcome.kind === 'paused') {
      return fail(503, 'New trials are paused for today. Please try again tomorrow, or email gene@fhiriq.com.');
    }
    if (outcome.kind === 'send-failed') {
      return fail(503, 'We could not send the email with your key. Please check the address and try again.');
    }
    if (outcome.kind === 'issued') {
      void sendTrialAlert({
        signupId: outcome.signupId,
        organization: parsed.value.organization,
        contactName: parsed.value.contactName,
        email: parsed.value.email,
        role: parsed.value.role,
        useCase: parsed.value.useCase,
        expiresAt: outcome.expiresAt,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[trial] start failed:', errorCode(err));
    return fail(503, 'Trials are not open yet. Please try again soon.');
  }
}
