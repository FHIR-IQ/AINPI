/**
 * POST /api/oauth/authorize: the form on /oauth/authorize. Re-validates the
 * whole request (nothing from the page is trusted), checks the pasted API
 * key, and redirects to the client's registered redirect URI only.
 * Per-IP limit on sign-in attempts: 10 a minute, 50 a UTC day.
 */
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { bump, clientIp } from '@/lib/rate-limit';
import { ISSUER, checkAuthorize, redirectWith } from '@/lib/oauth';
import { issueCode, keyForSignIn, type OAuthDb } from '@/lib/oauth-store';
import { loadClient } from '@/lib/oauth-client';

export const dynamic = 'force-dynamic';

const PASSED = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope'];

function see(url: string): Response {
  return new Response(null, { status: 303, headers: { location: url, 'cache-control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return new Response('Bad request', { status: 400 });
  const q: Record<string, string | undefined> = {};
  for (const k of PASSED) {
    const v = form.get(k);
    if (typeof v === 'string') q[k] = v;
  }
  const client = await loadClient(q.client_id);
  const check = checkAuthorize(q, client);
  if (!check.ok) {
    if (check.redirect) {
      return see(redirectWith(check.redirectUri, { error: check.error, error_description: check.description, state: check.state, iss: ISSUER }));
    }
    return new Response(check.description, { status: 400 });
  }
  const p = check.params;
  if (form.get('action') !== 'allow') {
    return see(redirectWith(p.redirectUri, { error: 'access_denied', error_description: 'The user declined.', state: p.state, iss: ISSUER }));
  }

  const ip = clientIp(req);
  const now = Date.now();
  const m = await bump(`oauth:signin:${ip}:m:${Math.floor(now / 60_000)}`, 1, 120_000);
  const d = await bump(`oauth:signin:${ip}:d:${Math.floor(now / 86_400_000)}`, 1, 172_800_000);
  const back = () => {
    const u = new URL('/oauth/authorize', ISSUER);
    for (const k of PASSED) if (q[k] !== undefined) u.searchParams.set(k, q[k]!);
    u.searchParams.set('error', 'bad_key');
    return see(u.pathname + u.search);
  };
  if ((m !== null && m > 10) || (d !== null && d > 50)) return back();

  const pasted = form.get('api_key');
  try {
    const key = typeof pasted === 'string' ? await keyForSignIn(pasted, prisma as unknown as OAuthDb, now) : null;
    if (!key) return back();
    const code = await issueCode(p, key.id, prisma as unknown as OAuthDb, now);
    return see(redirectWith(p.redirectUri, { code, state: p.state, iss: ISSUER }));
  } catch {
    return see(redirectWith(p.redirectUri, { error: 'temporarily_unavailable', state: p.state, iss: ISSUER }));
  }
}
