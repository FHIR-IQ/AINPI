/**
 * GET /api/v1/admin/suppression-confirm
 *
 * Daily Vercel cron (frontend/vercel.json). For every removal request the
 * suppression-apply workflow has marked `applied`, checks the live site
 * (page 404, NPI absent from the published cohort CSV) and only then sends
 * the requester the automated completion email and marks the row
 * `confirmed`. See src/lib/suppression-confirm.ts.
 *
 * Order: the overdue backstop, then confirmations, then (last, under a 20 s
 * deadline, 10 rows least-recently-checked first) the NPPES re-check of
 * requests whose NPI type was unknown at intake (basis 'unverified'): NPI-1
 * moves to full force, NPI-2 is declined with the organization reply,
 * still-unknown waits for tomorrow.
 *
 * The overdue step sends one admin alert for any request more than 5 days old and not
 * yet confirmed (once per request), two days ahead of the 7-day promise.
 *
 * Sent from REMOVAL_FROM_ADDRESS (default "AINPI <no-reply@ainpi.dev>") with
 * no Reply-To; the body says replies are not read. At most
 * DEFAULT_CONFIRM_CAP per run; the rest wait for the next day.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`, as the other admin crons.
 * Env: CRON_SECRET, RESEND_API_KEY, POSTGRES_PRISMA_URL, optional
 * REMOVAL_FROM_ADDRESS, SITE_URL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';
import {
  runConfirmCron,
  runConfirmations,
  runOverdueCheck,
  runReclassify,
  type ConfirmDb,
  type OverdueDb,
  type ReclassifyDb,
} from '@/lib/suppression-confirm';
import {
  mailtoAllowed,
  nppesEnumerationType,
  sendDeclinedReply,
} from '@/lib/suppression-intake';
import { invalidateSuppressionCache } from '@/lib/suppression';
import { sendSuppressionOverdueAlert } from '@/lib/admin-email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const apiKey = process.env.RESEND_API_KEY;
  const resend = apiKey ? new Resend(apiKey) : null;
  const from = process.env.REMOVAL_FROM_ADDRESS || 'AINPI <no-reply@ainpi.dev>';

  // Order matters: the overdue backstop first (it does not depend on Resend),
  // then confirmations, then the NPPES re-check last and under its own 20 s
  // deadline, so a slow NPPES can never starve a confirmation.
  const result = await runConfirmCron({
    overdue: () =>
      runOverdueCheck({ db: prisma as unknown as OverdueDb, alert: sendSuppressionOverdueAlert }),
    confirm: resend
      ? () =>
          runConfirmations({
            db: prisma as unknown as ConfirmDb,
            fetchFn: (url, init) => fetch(url, init),
            base: process.env.SITE_URL || 'https://ainpi.dev',
            mailAllowed: (to) => mailtoAllowed(to),
            send: async (to, msg) => {
              const sent = await resend.emails.send({ from, to, subject: msg.subject, text: msg.text });
              return sent.error ? { ok: false, error: sent.error.message } : { ok: true };
            },
          })
      : null,
    reclassify: async () => {
      const r = await runReclassify({
        db: prisma as unknown as ReclassifyDb,
        lookupType: (npi) => nppesEnumerationType(npi),
        sendDeclined: sendDeclinedReply,
        mailAllowed: (to) => mailtoAllowed(to),
      });
      if (r.confirmedIndividual > 0) invalidateSuppressionCache();
      return r;
    },
  });

  return NextResponse.json(
    {
      ok: result.errors.length === 0,
      ...result,
      ...(resend ? {} : { skipped: 'RESEND_API_KEY unset: confirmations not sent' }),
    },
    // A failing step (most likely the table not created yet) is a 500 so the
    // cron dashboard shows it; the other steps still ran.
    { status: result.errors.length === 0 ? 200 : 500 },
  );
}
