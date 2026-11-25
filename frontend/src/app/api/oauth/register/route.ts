/**
 * POST /api/oauth/register: RFC 7591 dynamic client registration, public
 * clients only (no client secret; PKCE is required at authorization).
 * Per-IP limit: 10 an hour, 50 a UTC day.
 */
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { bump, clientIp } from '@/lib/rate-limit';
import { oauthError, parseRegistration } from '@/lib/oauth';
import { json, preflight } from '@/lib/oauth-http';

export const dynamic = 'force-dynamic';

/** All registrations together, a UTC day: bounds table growth whatever the IP. */
const GLOBAL_DAILY = 1000;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const now = Date.now();
  const h = await bump(`oauth:reg:${ip}:h:${Math.floor(now / 3_600_000)}`, 1, 7_200_000);
  const d = await bump(`oauth:reg:${ip}:d:${Math.floor(now / 86_400_000)}`, 1, 172_800_000);
  const g = await bump(`oauth:reg:global:d:${Math.floor(now / 86_400_000)}`, 1, 172_800_000);
  if ((h !== null && h > 10) || (d !== null && d > 50) || (g !== null && g > GLOBAL_DAILY)) {
    return json(oauthError('temporarily_unavailable', 'Too many registrations. Try again later.'), 429, { 'retry-after': '3600' });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(oauthError('invalid_client_metadata', 'The body must be JSON.'), 400);
  }
  const r = parseRegistration(body);
  if (!r.ok) return json(oauthError(r.error, r.description), 400);
  // Clients that never completed a sign-in within a day are dropped.
  void prisma.$executeRaw`
    DELETE FROM oauth_clients c
    WHERE c.created_at < NOW() - INTERVAL '1 day'
      AND NOT EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.client_id = c.id)`.catch(() => {});
  try {
    const row = await prisma.oAuthClient.create({
      data: { clientName: r.value.clientName, redirectUris: r.value.redirectUris, ipAddress: ip === 'unknown' ? null : ip },
    });
    return json(
      {
        client_id: row.id,
        client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
        client_name: r.value.clientName ?? undefined,
        redirect_uris: r.value.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      201,
    );
  } catch {
    return json(oauthError('temporarily_unavailable', 'Registration is not available right now.'), 503);
  }
}
export function OPTIONS() {
  return preflight();
}
