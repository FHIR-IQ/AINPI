/**
 * resend-webhook: verify a Resend webhook the Svix way without the svix
 * dependency. Secret is "whsec_<base64 key>"; the signed content is
 * "<svix-id>.<svix-timestamp>.<raw body>"; the header carries one or more
 * "v1,<base64 hmac>" entries separated by spaces. Timestamps older than five
 * minutes are rejected so a captured request cannot be replayed later.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

const TOLERANCE_S = 5 * 60;

export function verifyResendWebhook(
  rawBody: string,
  h: SvixHeaders,
  secret: string | undefined,
): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_S) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key)
    .update(`${h.id}.${h.timestamp}.${rawBody}`)
    .digest();

  for (const part of h.signature.split(/\s+/)) {
    const [version, sig] = part.split(',', 2);
    if (version !== 'v1' || !sig) continue;
    let given: Buffer;
    try {
      given = Buffer.from(sig, 'base64');
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}
