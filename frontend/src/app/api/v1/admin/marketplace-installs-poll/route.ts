/**
 * GET /api/v1/admin/marketplace-installs-poll
 *
 * Daily Vercel cron (vercel.json). Reads Databricks Marketplace install
 * events from `system.marketplace.listing_access_events` through the SQL
 * Statement API and sends the one-time welcome (buildInstallWelcome) to every
 * installer not yet welcomed. This replaces the forwarded-email path into
 * /api/v1/marketplace-install, which depends on a mail filter; that webhook
 * stays in place and both paths share the MarketplaceInstall table, so an
 * address welcomed by either is never welcomed again.
 *
 * Not covered: recipients created by hand on the open share
 * (`databricks shares update-permissions`, credential-file consumers) are not
 * Marketplace events and never appear in the table. Their welcome stays
 * manual. See src/lib/marketplace-install-poll.ts for the rest.
 *
 * Behaviour:
 *   - Auth: `Authorization: Bearer ${CRON_SECRET}`, as weekly-report.
 *   - Databricks env missing: 200 {skipped:"not configured"}, nothing sent.
 *   - Databricks call fails or times out: admin alert, nothing sent.
 *   - At most DEFAULT_SEND_CAP welcomes per run (spike guard); overflow is
 *     alerted and picked up the next day.
 *
 * Cost: each run wakes the serverless SQL warehouse, which bills a minimum of
 * roughly its 10-minute auto-stop window. Daily, not hourly, for that reason.
 *
 * Env: CRON_SECRET, DATABRICKS_HOST, DATABRICKS_TOKEN,
 * DATABRICKS_WAREHOUSE_ID, optional DATABRICKS_POLL_LOOKBACK_DAYS (default
 * 30, max 90), RESEND_API_KEY, RESEND_FROM_ADDRESS, POSTGRES_PRISMA_URL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';
import { buildInstallWelcome } from '@/lib/marketplace-install';
import { sendInstallAlert, sendInstallPollAlert } from '@/lib/admin-email';
import {
  DEFAULT_SEND_CAP,
  buildInstallQuery,
  pollMarketplaceInstalls,
  readPollConfig,
  runStatement,
} from '@/lib/marketplace-install-poll';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || 'AINPI <reports@ainpi.dev>';
const REPLY_TO = 'gene@fhiriq.com';

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const cfg = readPollConfig(process.env);
  if (!cfg) return NextResponse.json({ ok: true, skipped: 'not configured' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, skipped: 'RESEND_API_KEY unset' });
  const resend = new Resend(apiKey);

  const result = await pollMarketplaceInstalls({
    cap: DEFAULT_SEND_CAP,
    fetchRows: () => runStatement(cfg, buildInstallQuery(cfg.lookbackDays)),
    findExisting: (emails) =>
      prisma.marketplaceInstall.findMany({
        where: { email: { in: emails } },
        select: { email: true, welcomedAt: true, company: true },
      }),
    upsertInstall: async (n) => {
      await prisma.marketplaceInstall.upsert({
        where: { email: n.email },
        update: { company: n.company },
        create: {
          email: n.email,
          installedBy: n.installedBy,
          company: n.company,
          listing: n.listing,
          sharingIdentifier: n.sharingIdentifier,
          installedOn: n.installedOn,
        },
      });
    },
    markWelcomed: async (email) => {
      await prisma.marketplaceInstall.update({
        where: { email },
        data: { welcomedAt: new Date() },
      });
    },
    sendWelcome: async (n) => {
      const w = buildInstallWelcome(n);
      try {
        const sent = await resend.emails.send({
          from: FROM_ADDRESS,
          to: n.email,
          replyTo: REPLY_TO,
          subject: w.subject,
          text: w.text,
          html: w.html,
        });
        return sent.error ? { ok: false, error: sent.error.message } : { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
    alertInstall: (n) => sendInstallAlert(n),
    alertFailure: (message) => sendInstallPollAlert(message),
  });

  if (!result.ok) {
    console.error('[marketplace-installs-poll]', result.error);
    return NextResponse.json({ ok: false, error: 'databricks query failed' }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    events: result.events,
    welcomed: result.welcomed.length,
    failed: result.failed.length,
    alreadyWelcomed: result.alreadyWelcomed,
    overCap: result.overCap,
  });
}
