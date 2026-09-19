/**
 * POST /api/v1/marketplace-install
 *
 * Resend `email.received` webhook for installs@ainpi.dev. A Gmail filter
 * forwards the Databricks Marketplace install notice there; this route
 * verifies the signature, fetches the received email, parses it, records the
 * install once per address, and sends the welcome from reports@ainpi.dev.
 *
 * Idempotent on email: a second notice for the same address records nothing
 * new and sends nothing. A notice that does not parse sends nothing and
 * alerts the admin, because a welcome to "Hi undefined" is worse than none.
 * Any non-install mail reaching the inbox is acknowledged and ignored.
 *
 * Env: RESEND_API_KEY, RESEND_WEBHOOK_SECRET, RESEND_FROM_ADDRESS.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';
import { verifyResendWebhook } from '@/lib/resend-webhook';
import { buildInstallWelcome, parseInstallNotice } from '@/lib/marketplace-install';
import { sendInstallAlert } from '@/lib/admin-email';

export const dynamic = 'force-dynamic';

const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || 'AINPI <reports@ainpi.dev>';
const REPLY_TO = 'gene@fhiriq.com';

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ok = verifyResendWebhook(
    raw,
    {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
    process.env.RESEND_WEBHOOK_SECRET,
  );
  if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  let evt: { type?: string; data?: { email_id?: string; subject?: string } };
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (evt.type !== 'email.received' || !evt.data?.email_id) {
    return NextResponse.json({ ok: true, ignored: evt.type ?? 'unknown' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'RESEND_API_KEY unset' }, { status: 503 });
  const resend = new Resend(apiKey);

  const got = await resend.emails.receiving.get(evt.data.email_id);
  if (got.error || !got.data) {
    console.error('[marketplace-install] fetch failed:', got.error?.message);
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 });
  }
  const { text, html, subject } = got.data;

  // Only install notices get past here. Everything else in the inbox is
  // acknowledged so Resend stops retrying, and left for a human.
  if (!/installed/i.test(`${subject}\n${text ?? ''}\n${html ?? ''}`)) {
    return NextResponse.json({ ok: true, ignored: 'not an install notice' });
  }

  const notice = parseInstallNotice(text, html);
  if (!notice) {
    void sendInstallAlert({
      email: '', installedBy: '', company: null, sharingIdentifier: null,
      welcomed: false, parseFailureSubject: subject ?? '(no subject)',
    });
    return NextResponse.json({ ok: true, ignored: 'unparseable install notice' });
  }

  const existing = await prisma.marketplaceInstall.findUnique({
    where: { email: notice.email },
    select: { welcomedAt: true },
  });
  if (existing?.welcomedAt) {
    void sendInstallAlert({ ...notice, welcomed: false });
    return NextResponse.json({ ok: true, ignored: 'already welcomed' });
  }

  await prisma.marketplaceInstall.upsert({
    where: { email: notice.email },
    update: { receivedEmailId: evt.data.email_id },
    create: {
      email: notice.email,
      installedBy: notice.installedBy,
      company: notice.company,
      listing: notice.listing,
      sharingIdentifier: notice.sharingIdentifier,
      installedOn: notice.installedOn,
      receivedEmailId: evt.data.email_id,
    },
  });

  const welcome = buildInstallWelcome(notice);
  const sent = await resend.emails.send({
    from: FROM_ADDRESS,
    to: notice.email,
    replyTo: REPLY_TO,
    subject: welcome.subject,
    text: welcome.text,
    html: welcome.html,
  });
  if (sent.error) {
    console.error('[marketplace-install] welcome failed:', sent.error.message);
    void sendInstallAlert({ ...notice, welcomed: false });
    return NextResponse.json({ error: 'welcome failed' }, { status: 502 });
  }

  await prisma.marketplaceInstall.update({
    where: { email: notice.email },
    data: { welcomedAt: new Date() },
  });
  void sendInstallAlert({ ...notice, welcomed: true });
  return NextResponse.json({ ok: true, welcomed: notice.email });
}
