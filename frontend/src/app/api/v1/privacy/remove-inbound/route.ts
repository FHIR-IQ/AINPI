/**
 * POST /api/v1/privacy/remove-inbound
 *
 * Resend `email.received` webhook for the removal inbox (REMOVAL_INBOX,
 * default remove@ainpi.dev). Verifies the Svix signature, fetches the email,
 * and records every check-digit-valid NPI it names (at most
 * MAX_NPIS_PER_EMAIL) with the sender as the requester, through the same
 * recordSuppression() the form uses. Mail to any other address is
 * acknowledged and ignored, because one Resend account delivers all inbound
 * mail to every webhook. Mail naming no NPI alerts the admin.
 *
 * Limits: the shared rate limiter (shape `privacy/remove`; every webhook
 * call comes from Resend, so this is a global ceiling on the inbox), and at
 * most EMAIL_SENDER_DAILY_CAP requests per sender per UTC day. Past either,
 * the mail is acknowledged and nothing is recorded. recordSuppression()
 * applies the Type 1 check and the global daily cap.
 *
 * A missing signing secret alerts the admin (once per warm instance) and
 * answers 503 so Resend retries, rather than failing silently with 401.
 *
 * Env: RESEND_API_KEY, RESEND_REMOVAL_WEBHOOK_SECRET (falls back to
 * RESEND_WEBHOOK_SECRET), optional REMOVAL_INBOX.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { verifyResendWebhook } from '@/lib/resend-webhook';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  DEFAULT_REMOVAL_INBOX,
  EMAIL_SENDER_DAILY_CAP,
  defaultIntakeDeps,
  parseRemovalEmail,
  recordSuppression,
  senderRequestsToday,
} from '@/lib/suppression-intake';
import {
  sendSuppressionUnparsedAlert,
  sendSuppressionWebhookUnconfiguredAlert,
} from '@/lib/admin-email';

let unconfiguredAlerted = false;

export const dynamic = 'force-dynamic';
// NPPES lookup (8 s) and page check (5 s) run inside the request.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_REMOVAL_WEBHOOK_SECRET || process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    if (!unconfiguredAlerted) {
      unconfiguredAlerted = true;
      void sendSuppressionWebhookUnconfiguredAlert();
    }
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 });
  }

  const raw = await req.text();
  const ok = verifyResendWebhook(
    raw,
    {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
    secret,
  );
  if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  let evt: { type?: string; data?: { email_id?: string; to?: string[] } };
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (evt.type !== 'email.received' || !evt.data?.email_id) {
    return NextResponse.json({ ok: true, ignored: evt.type ?? 'unknown' });
  }

  const inbox = process.env.REMOVAL_INBOX || DEFAULT_REMOVAL_INBOX;
  // Cheap pre-check on the event's own recipients before fetching the body.
  if (evt.data.to && !parseRemovalEmail({ to: evt.data.to, from: null, subject: null, text: null, html: null }, inbox).forUs) {
    return NextResponse.json({ ok: true, ignored: 'not addressed to the removal inbox' });
  }

  // Charged only for mail that is signed and addressed to the removal inbox,
  // so other inbound mail on the account cannot use up the budget.
  const rl = await enforceRateLimit(req, { shape: 'privacy/remove' });
  if (!rl.ok) return rl.response!;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'RESEND_API_KEY unset' }, { status: 503 });
  const got = await new Resend(apiKey).emails.receiving.get(evt.data.email_id);
  if (got.error || !got.data) {
    console.error('[privacy/remove-inbound] fetch failed:', got.error?.message);
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 });
  }

  const parsed = parseRemovalEmail(got.data, inbox);
  if (!parsed.forUs) {
    return NextResponse.json({ ok: true, ignored: 'not addressed to the removal inbox' });
  }
  if (parsed.npis.length === 0) {
    void sendSuppressionUnparsedAlert({
      sender: parsed.sender,
      subject: got.data.subject ?? '(no subject)',
    });
    return NextResponse.json({ ok: true, ignored: 'no NPI found' });
  }

  try {
    const deps = await defaultIntakeDeps();
    let npis = parsed.npis;
    if (parsed.sender) {
      const already = await senderRequestsToday(deps.db, parsed.sender);
      npis = npis.slice(0, Math.max(0, EMAIL_SENDER_DAILY_CAP - already));
      if (npis.length === 0) {
        return NextResponse.json({ ok: true, ignored: 'sender daily cap reached' });
      }
    }
    for (const npi of npis) await recordSuppression(npi, parsed.sender, 'email', deps);
  } catch (err) {
    console.error('[privacy/remove-inbound] record failed:', err instanceof Error ? err.message : err);
    // 5xx so Resend retries; recordSuppression is idempotent per NPI.
    return NextResponse.json({ error: 'record failed' }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
