/**
 * GET /api/v1/admin/suppression-confirm
 *
 * Daily Vercel cron (frontend/vercel.json). For every removal request the
 * suppression-apply workflow has marked `applied`, checks the live site
 * (page 404, NPI absent from the published cohort CSV) and only then sends
 * the requester the automated completion email and marks the row
 * `confirmed`. See src/lib/suppression-confirm.ts.
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
import { runConfirmations, type ConfirmDb } from '@/lib/suppression-confirm';

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
  if (!apiKey) return NextResponse.json({ ok: true, skipped: 'RESEND_API_KEY unset' });
  const resend = new Resend(apiKey);
  const from = process.env.REMOVAL_FROM_ADDRESS || 'AINPI <no-reply@ainpi.dev>';

  try {
    const summary = await runConfirmations({
      db: prisma as unknown as ConfirmDb,
      fetchFn: (url, init) => fetch(url, init),
      base: process.env.SITE_URL || 'https://ainpi.dev',
      send: async (to, msg) => {
        const sent = await resend.emails.send({ from, to, subject: msg.subject, text: msg.text });
        return sent.error ? { ok: false, error: sent.error.message } : { ok: true };
      },
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    // Most likely the table does not exist yet (prisma/sql/npi_suppressions.sql not run).
    console.error('[suppression-confirm]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'confirmation run failed' }, { status: 500 });
  }
}
