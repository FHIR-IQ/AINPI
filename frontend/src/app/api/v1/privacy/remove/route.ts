/**
 * POST /api/v1/privacy/remove
 *
 * The /privacy/remove form. Body: { npi, email, attest: true }.
 *
 * Validates shape and check digit, applies the removal limiter (its own
 * buckets, never the search quota or the warehouse breaker), records
 * the request through recordSuppression(), and returns one fixed response
 * whether or not the NPI has a page, is already listed, or is anywhere in
 * AINPI at all, so the form cannot be used to probe the list.
 */
import { NextRequest, NextResponse } from 'next/server';
import { clientIp } from '@/lib/rate-limit';
import {
  checkRemovalCeiling,
  checkRemovalSubject,
  defaultRemovalLimitDeps,
  type RemovalLimitResult,
} from '@/lib/removal-limit';
import { isValidNpi } from '@/lib/suppression';
import { normalizeEmail, recordSuppression } from '@/lib/suppression-intake';

export const dynamic = 'force-dynamic';
// NPPES lookup (8 s) and page check (5 s) run inside the request.
export const maxDuration = 30;

const REMOVAL_ACCEPTED_MESSAGE = 'Request received.';

export async function POST(req: NextRequest) {
  // Its own limiter, apart from the BigQuery quota (src/lib/removal-limit.ts).
  // The per-IP bucket is charged for every post; the global ceiling only
  // after validation, so malformed posts cannot use it up.
  const limitDeps = await defaultRemovalLimitDeps();
  const tooMany = (rl: Extract<RemovalLimitResult, { ok: false }>) =>
    NextResponse.json(
      { error: 'Too many removal requests right now. Please try again later.' },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec), 'cache-control': 'no-store' } },
    );
  const perIp = await checkRemovalSubject(`ip:${clientIp(req)}`, limitDeps);
  if (!perIp.ok) return tooMany(perIp);

  let body: { npi?: unknown; email?: unknown; attest?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const npi = typeof body.npi === 'string' ? body.npi.trim() : '';
  if (!isValidNpi(npi)) {
    return NextResponse.json(
      { error: 'Enter a valid 10-digit NPI.' },
      { status: 400 },
    );
  }
  const email = normalizeEmail(typeof body.email === 'string' ? body.email : null);
  if (!email) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (body.attest !== true) {
    return NextResponse.json(
      { error: 'Confirm that you are the provider, or authorized to act for them.' },
      { status: 400 },
    );
  }

  const ceiling = await checkRemovalCeiling(limitDeps);
  if (!ceiling.ok) return tooMany(ceiling);

  try {
    await recordSuppression(npi, email, 'form');
  } catch (err) {
    console.error('[privacy/remove] record failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'The removal service is unavailable. Please try again later.' },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { ok: true, message: REMOVAL_ACCEPTED_MESSAGE },
    { headers: { 'cache-control': 'no-store' } },
  );
}
