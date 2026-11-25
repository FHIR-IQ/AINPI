/**
 * POST /api/v1/roster/verify   body: { "npis": ["1234567893", ...] }
 *
 * Roster verification over the public federal sources (see src/lib/roster.ts
 * and src/lib/roster-run.ts). Needs an AINPI API key; batch size depends on
 * the key's tier, and each NPI is charged against its quota.
 */
import { NextRequest, NextResponse } from 'next/server';

import { identify } from '@/lib/rate-limit';
import { runRoster } from '@/lib/roster-run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BODY_BYTES = 65_536;

export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Body too large. Send at most 500 NPIs per call.' }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON: {"npis": ["..."]}.' }, { status: 400 });
  }
  const npis = body && typeof body === 'object' && !Array.isArray(body) ? (body as { npis?: unknown }).npis : undefined;
  const out = await runRoster(await identify(req), npis, 'api');
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if ('retryAfter' in out && out.retryAfter) headers['retry-after'] = String(out.retryAfter);
  return NextResponse.json(out.body, { status: out.status, headers });
}
