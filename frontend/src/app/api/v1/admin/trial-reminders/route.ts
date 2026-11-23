/**
 * GET /api/v1/admin/trial-reminders: daily cron (frontend/vercel.json).
 * Auth: `Authorization: Bearer ${CRON_SECRET}`, as the other admin crons.
 *
 * Sends each unconverted trialist two emails at most: a reminder once fewer
 * than REMINDER_DAYS_BEFORE days remain, and a notice once the key has
 * expired. Each send is claimed first with a conditional update (the column
 * is still null), and released if the send fails, so overlapping runs cannot
 * double-send and a failed send is retried on the next run. At most
 * MAX_SENDS emails a run.
 */
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { sendTrialEmail } from '@/lib/admin-email';
import { REMINDER_DAYS_BEFORE, endedEmail, reminderEmail } from '@/lib/trial';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_SENDS = 50;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const now = new Date();
  const soon = new Date(now.getTime() + REMINDER_DAYS_BEFORE * 86_400_000);
  let reminded = 0;
  let ended = 0;
  let failed = 0;

  try {
    const due = await prisma.trialSignup.findMany({
      where: { convertedAt: null, reminderSentAt: null, expiresAt: { gt: now, lte: soon } },
      orderBy: { expiresAt: 'asc' },
      take: MAX_SENDS,
    });
    for (const t of due) {
      const claim = await prisma.trialSignup.updateMany({
        where: { id: t.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claim.count !== 1) continue;
      if (await sendTrialEmail(reminderEmail(t.contactName, t.organization, t.email, t.expiresAt))) reminded++;
      else {
        failed++;
        await prisma.trialSignup.update({ where: { id: t.id }, data: { reminderSentAt: null } });
      }
    }

    const over = await prisma.trialSignup.findMany({
      where: { convertedAt: null, endedSentAt: null, expiresAt: { lte: now } },
      orderBy: { expiresAt: 'asc' },
      take: Math.max(0, MAX_SENDS - due.length),
    });
    for (const t of over) {
      const claim = await prisma.trialSignup.updateMany({
        where: { id: t.id, endedSentAt: null },
        data: { endedSentAt: now },
      });
      if (claim.count !== 1) continue;
      if (await sendTrialEmail(endedEmail(t.contactName, t.organization, t.email))) ended++;
      else {
        failed++;
        await prisma.trialSignup.update({ where: { id: t.id }, data: { endedSentAt: null } });
      }
    }
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'error';
    console.error('[trial-reminders] failed:', code);
    return NextResponse.json({ ok: false, reminded, ended, failed, error: code }, { status: 500 });
  }
  return NextResponse.json({ ok: true, reminded, ended, failed });
}
