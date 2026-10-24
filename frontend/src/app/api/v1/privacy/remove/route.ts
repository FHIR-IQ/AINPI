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
import { checkRemovalLimit, defaultRemovalLimitDeps } from '@/lib/removal-limit';
import { isValidNpi } from '@/lib/suppression';
import { normalizeEmail, recordSuppression } from '@/lib/suppression-intake';

export const dynamic = 'force-dynamic';
// NPPES lookup (8 s) and page check (5 s) run inside the request.
export const maxDuration = 30;

const REMOVAL_ACCEPTED_MESSAGE =
  'Request received. If this NPI has a page or rows on ainpi.dev, they will be removed ' +
  'within 7 days, and we will email you when it is done.';

export async function POST(req: NextRequest) {
  // Its own limiter, apart from the BigQuery quota (src/lib/removal-limit.ts).
  const rl = await checkRemovalLimit(`ip:${clientIp(req)}`, await defaultRemovalLimitDeps());
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many removal requests right now. Please try again later.' },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec), 'cache-control': 'no-store' } },
    );
  }

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
