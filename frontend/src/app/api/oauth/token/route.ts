/**
 * POST /api/oauth/token: authorization_code (PKCE S256) and refresh_token
 * (rotating) grants. Accepts application/x-www-form-urlencoded, as RFC 6749
 * requires, and JSON. A client secret, if a client sends one, is ignored:
 * every client is public.
 */
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { bump, clientIp } from '@/lib/rate-limit';
import { oauthError } from '@/lib/oauth';
import { redeemCode, refreshTokens, type OAuthDb } from '@/lib/oauth-store';
import { json, preflight } from '@/lib/oauth-http';

export const dynamic = 'force-dynamic';

async function readForm(req: NextRequest): Promise<Record<string, string>> {
  const type = req.headers.get('content-type') ?? '';
  const out: Record<string, string> = {};
  if (type.includes('application/json')) {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(b)) if (typeof v === 'string') out[k] = v;
    return out;
  }
  const params = new URLSearchParams(await req.text());
  params.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const m = await bump(`oauth:token:${ip}:m:${Math.floor(Date.now() / 60_000)}`, 1, 120_000);
  if (m !== null && m > 60) return json(oauthError('temporarily_unavailable', 'Too many requests.'), 429, { 'retry-after': '60' });

  // Expired codes and tokens are swept a day after expiry (indexed deletes).
  const cutoff = new Date(Date.now() - 86_400_000);
  void prisma.oAuthCode.deleteMany({ where: { expiresAt: { lt: cutoff } } }).catch(() => {});
  void prisma.oAuthToken.deleteMany({ where: { expiresAt: { lt: cutoff } } }).catch(() => {});

  const f = await readForm(req);
  const db = prisma as unknown as OAuthDb;
  const now = Date.now();
  try {
    const r =
      f.grant_type === 'authorization_code'
        ? await redeemCode(f, db, now)
        : f.grant_type === 'refresh_token'
          ? await refreshTokens(f, db, now)
          : { ok: false as const, error: 'unsupported_grant_type', description: 'Use authorization_code or refresh_token.' };
    if (!r.ok) return json(oauthError(r.error, r.description), 400);
    return json(r.tokens, 200, { pragma: 'no-cache' });
  } catch {
    return json(oauthError('temporarily_unavailable', 'Sign-in is not available right now.'), 503);
  }
}
export function OPTIONS() {
  return preflight();
}
