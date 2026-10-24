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
 * Limits, applied only to signed mail addressed to the removal inbox: the
 * removal limiter keyed on the sender (`remove:mail:<sender>`, its own
 * buckets plus the global removal ceiling, never the search quota or the
 * warehouse breaker; src/lib/removal-limit.ts), and at most
 * EMAIL_SENDER_DAILY_CAP recorded requests per sender per UTC day. Past
 * either, the route answers 200 so Resend stops retrying, records nothing,
 * and alerts the admin once per sender per UTC day. recordSuppression()
 * then applies the Type 1 check and the daily processing cap.
 *
 * A missing RESEND_REMOVAL_WEBHOOK_SECRET alerts the admin (once per warm
 * instance) and answers 503. There is deliberately no fallback to the
 * Marketplace webhook's secret.
 *
 * Env: RESEND_API_KEY, RESEND_REMOVAL_WEBHOOK_SECRET, optional REMOVAL_INBOX.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { verifyResendWebhook } from '@/lib/resend-webhook';
import { bump } from '@/lib/rate-limit';
import { checkRemovalLimit, defaultRemovalLimitDeps } from '@/lib/removal-limit';
import {
  DEFAULT_REMOVAL_INBOX,
  EMAIL_SENDER_DAILY_CAP,
  defaultIntakeDeps,
  parseRemovalEmail,
  recordSuppression,
  senderRequestsToday,
} from '@/lib/suppression-intake';
import {
  sendRemovalSenderOverflowAlert,
  sendSuppressionUnparsedAlert,
  sendSuppressionWebhookUnconfiguredAlert,
} from '@/lib/admin-email';

/** 200, nothing recorded, one admin alert per sender per UTC day. */
async function overflow(sender: string, reason: string) {
  const day = Math.floor(Date.now() / 86_400_000);
  const n = await bump(`remove:mail-alert:${sender}:d:${day}`, 1, 172_800_000);
  if (n === null || n === 1) void sendRemovalSenderOverflowAlert(sender, reason);
  return NextResponse.json({ ok: true, ignored: 'over limit' });
}

let unconfiguredAlerted = false;

export const dynamic = 'force-dynamic';
// NPPES lookup (8 s) and page check (5 s) run inside the request.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_REMOVAL_WEBHOOK_SECRET;
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

  const sender = parsed.sender ?? 'unknown-sender';
  // Charged only for signed mail addressed to the removal inbox, so other
  // inbound mail on the account cannot use up the budget.
  const rl = await checkRemovalLimit(`mail:${sender}`, await defaultRemovalLimitDeps());
  if (!rl.ok) return overflow(sender, `removal limiter (${rl.reason})`);

  try {
    const deps = await defaultIntakeDeps();
    let npis = parsed.npis;
    if (parsed.sender) {
      const already = await senderRequestsToday(deps.db, parsed.sender);
      npis = npis.slice(0, Math.max(0, EMAIL_SENDER_DAILY_CAP - already));
      if (npis.length === 0) return overflow(sender, `more than ${EMAIL_SENDER_DAILY_CAP} requests today`);
    }
    for (const npi of npis) await recordSuppression(npi, parsed.sender, 'email', deps);
  } catch (err) {
    console.error('[privacy/remove-inbound] record failed:', err instanceof Error ? err.message : err);
    // 5xx so Resend retries; recordSuppression is idempotent per NPI.
    return NextResponse.json({ error: 'record failed' }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
