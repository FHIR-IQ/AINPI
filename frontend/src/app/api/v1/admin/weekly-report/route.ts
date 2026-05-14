/**
 * GET /api/v1/admin/weekly-report
 *
 * Admin-only weekly digest emailed to gene@fhiriq.com. Triggered by a
 * Vercel cron at Monday 09:00 UTC (configured in vercel.json).
 *
 * What it sends:
 *   - Subscriber totals (count, last 7 days, last 30 days)
 *   - Per-source breakdown (where subscribers came from)
 *   - Full subscriber list with email + source + signup date
 *   - Report-download activity (last 7 days)
 *   - Total report-downloads ever
 *   - Deep link to Vercel Analytics dashboard for pageview metrics
 *     (pageview data isn't programmatically available without a Vercel
 *     Pro/Enterprise Insights API token; we surface the link instead)
 *
 * Auth model:
 *   Vercel Cron sets the `Authorization: Bearer <CRON_SECRET>` header
 *   on every cron-triggered request. We compare against the
 *   `CRON_SECRET` env var. Manual hits without that header 401.
 *
 * Required env:
 *   CRON_SECRET                   — Vercel Cron auth shared secret
 *   RESEND_API_KEY                — Resend API key
 *   POSTGRES_PRISMA_URL           — Supabase pooler URL
 *   ADMIN_EMAIL                   — optional override; defaults to gene@fhiriq.com
 *   VERCEL_DASHBOARD_URL          — optional override for the analytics deep-link
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';
import {
  fetchAllProjectsAnalytics,
  type AllProjectsAnalytics,
} from '@/lib/vercel-analytics';

export const dynamic = 'force-dynamic';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'gene@fhiriq.com';
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || 'AINPI <onboarding@resend.dev>';

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authz = req.headers.get('authorization') || '';
  return authz === `Bearer ${secret}`;
}

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toISOString().slice(0, 10);
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) return unauthorized();

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY not set' },
      { status: 500 },
    );
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Pull all subscriber + activity data in one Prisma round-trip burst.
  let subscribers: Array<{
    email: string;
    source: string | null;
    createdAt: Date;
    confirmedAt: Date | null;
  }>;
  let totalDownloads = 0;
  let recentDownloads: Array<{
    email: string;
    name: string | null;
    organization: string | null;
    useCase: string | null;
    createdAt: Date;
  }> = [];
  try {
    [subscribers, totalDownloads, recentDownloads] = await Promise.all([
      prisma.subscriber.findMany({
        select: { email: true, source: true, createdAt: true, confirmedAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.reportDownload.count(),
      prisma.reportDownload.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { email: true, name: true, organization: true, useCase: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[weekly-report] db fetch failed:', msg);
    return NextResponse.json({ error: 'db unreachable' }, { status: 503 });
  }

  const newLast7 = subscribers.filter((s) => s.createdAt >= sevenDaysAgo).length;
  const newLast30 = subscribers.filter((s) => s.createdAt >= thirtyDaysAgo).length;

  // Enumerate every project + its dashboard deep-link. Vercel doesn't
  // expose a public REST API for Web Analytics data (zero endpoints in
  // the OpenAPI spec), so the email surfaces one-click links per project
  // instead of pretending to fetch counts. Never throws.
  let analytics: AllProjectsAnalytics;
  try {
    analytics = await fetchAllProjectsAnalytics();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[weekly-report] project listing failed:', msg);
    analytics = {
      configured: false, ok: false,
      projectsDiscovered: 0, projectsWithAnalytics: [], projectsWithoutAnalytics: [],
      note: msg,
    };
  }

  const sourceCounts: Record<string, number> = {};
  for (const s of subscribers) {
    const k = s.source || '(unspecified)';
    sourceCounts[k] = (sourceCounts[k] ?? 0) + 1;
  }
  const sourceRows = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);

  const projSuffix = analytics.ok
    ? `, ${analytics.projectsWithAnalytics.length} of ${analytics.projectsDiscovered} projects with analytics`
    : '';
  const subject = `AINPI weekly admin report — ${fmtDate(now)} · ${subscribers.length} subscribers, ${newLast7} new, ${recentDownloads.length} downloads${projSuffix}`;

  // Plain text version.
  const text = [
    `AINPI weekly admin report — ${fmtDate(now)}`,
    ``,
    `SUBSCRIBERS`,
    `  Total:           ${subscribers.length}`,
    `  New last 7 days: ${newLast7}`,
    `  New last 30 days:${newLast30}`,
    ``,
    `SOURCES`,
    ...sourceRows.map(([k, v]) => `  ${k.padEnd(20)} ${v}`),
    ``,
    `REPORT DOWNLOADS`,
    `  Total ever:        ${totalDownloads}`,
    `  Last 7 days:       ${recentDownloads.length}`,
    ``,
    `RECENT DOWNLOADS (last 7 days, up to 50)`,
    ...recentDownloads.map(
      (d) =>
        `  ${fmtDate(d.createdAt)}  ${d.email}  ${d.name || ''}  ${d.organization || ''}`,
    ),
    ``,
    `SUBSCRIBER LIST`,
    ...subscribers.map(
      (s) =>
        `  ${fmtDate(s.createdAt)}  ${s.email.padEnd(40)}  ${s.source || '(unspecified)'}`,
    ),
    ``,
    `PROJECTS + ANALYTICS DASHBOARDS`,
    `  (Vercel has no public Web Analytics REST API — programmatic`,
    `   pageview/visitor numbers aren't reachable from this cron. Below`,
    `   is every project + a one-click dashboard link.)`,
    ``,
    analytics.ok
      ? [
          `  Projects with analytics enabled (${analytics.projectsWithAnalytics.length}):`,
          ...analytics.projectsWithAnalytics.map(
            (p) =>
              `    ${p.projectName.padEnd(28)} ${p.primaryDomain ?? '(no prod domain)'}\n      → ${p.dashboardUrl}`,
          ),
          analytics.projectsWithoutAnalytics.length > 0
            ? `\n  Projects without analytics (${analytics.projectsWithoutAnalytics.length}):\n${analytics.projectsWithoutAnalytics
                .map((p) => `    ${p.projectName}`)
                .join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : analytics.configured
        ? `  Project listing returned 0 rows. Note: ${analytics.note ?? 'unknown'}`
        : `  VERCEL_API_TOKEN not set on production. Set via:\n  vercel env add VERCEL_API_TOKEN production`,
    ``,
    `  Team dashboard: https://vercel.com/${process.env.VERCEL_TEAM_SLUG || process.env.VERCEL_TEAM_ID || 'aks129s-projects'}`,
  ].join('\n');

  // HTML version.
  const sourceTable = sourceRows
    .map(
      ([k, v]) =>
        `<tr><td>${escHtml(k)}</td><td style="text-align:right;font-variant-numeric:tabular-nums;">${v}</td></tr>`,
    )
    .join('');

  const downloadRows = recentDownloads
    .map(
      (d) =>
        `<tr>
          <td style="font-variant-numeric:tabular-nums;">${fmtDate(d.createdAt)}</td>
          <td>${escHtml(d.email)}</td>
          <td>${escHtml(d.name || '')}</td>
          <td>${escHtml(d.organization || '')}</td>
          <td style="font-size:11px;color:#6b7280;">${escHtml((d.useCase || '').slice(0, 80))}</td>
        </tr>`,
    )
    .join('');

  const subscriberRows = subscribers
    .map(
      (s) =>
        `<tr>
          <td style="font-variant-numeric:tabular-nums;">${fmtDate(s.createdAt)}</td>
          <td>${escHtml(s.email)}</td>
          <td>${escHtml(s.source || '(unspecified)')}</td>
          <td style="font-variant-numeric:tabular-nums;color:${s.confirmedAt ? '#10b981' : '#6b7280'};">${s.confirmedAt ? fmtDate(s.confirmedAt) : '—'}</td>
        </tr>`,
    )
    .join('');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; color: #1f2937; line-height: 1.5;">
      <h1 style="font-size: 20px; margin: 0 0 4px 0;">AINPI weekly admin report</h1>
      <p style="margin: 0 0 24px 0; color: #6b7280; font-size: 13px;">${fmtDate(now)} · for your eyes only</p>

      <h2 style="font-size: 14px; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em; color: #374151;">Subscribers</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <tr><td style="padding:6px 0;">Total</td><td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${subscribers.length}</td></tr>
        <tr><td style="padding:6px 0;">New last 7 days</td><td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:${newLast7 > 0 ? '#10b981' : '#6b7280'};">${newLast7}</td></tr>
        <tr><td style="padding:6px 0;">New last 30 days</td><td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${newLast30}</td></tr>
      </table>

      <h2 style="font-size: 14px; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em; color: #374151;">Source mix</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">${sourceTable}</table>

      <h2 style="font-size: 14px; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em; color: #374151;">Report downloads</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:8px;">
        <tr><td style="padding:6px 0;">Total ever</td><td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${totalDownloads}</td></tr>
        <tr><td style="padding:6px 0;">Last 7 days</td><td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:${recentDownloads.length > 0 ? '#10b981' : '#6b7280'};">${recentDownloads.length}</td></tr>
      </table>
      ${
        recentDownloads.length > 0
          ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
              <thead><tr style="border-bottom:1px solid #e5e7eb;color:#6b7280;text-align:left;">
                <th style="padding:6px 6px;">Date</th><th style="padding:6px 6px;">Email</th><th style="padding:6px 6px;">Name</th><th style="padding:6px 6px;">Org</th><th style="padding:6px 6px;">Use case</th>
              </tr></thead>
              <tbody>${downloadRows}</tbody>
            </table>`
          : ''
      }

      <h2 style="font-size: 14px; margin: 24px 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em; color: #374151;">Subscriber list (${subscribers.length})</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
        <thead><tr style="border-bottom:1px solid #e5e7eb;color:#6b7280;text-align:left;">
          <th style="padding:6px 6px;">Date</th><th style="padding:6px 6px;">Email</th><th style="padding:6px 6px;">Source</th><th style="padding:6px 6px;">Confirmed</th>
        </tr></thead>
        <tbody>${subscriberRows}</tbody>
      </table>

      <h2 style="font-size: 14px; margin: 24px 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em; color: #374151;">Projects + analytics dashboards</h2>
      <p style="margin: 0 0 14px 0; font-size: 12px; color: #6b7280;">
        Vercel has no public Web Analytics REST API, so this digest can't pull
        pageview / visitor counts directly. Below is every project the API
        token can see + a one-click link to its Analytics tab.
      </p>
      ${
        analytics.ok
          ? `
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px;">
          <tr>
            <td style="padding:6px 0;">Projects discovered</td>
            <td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;font-size:18px;color:#111827;">${analytics.projectsDiscovered}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;">With analytics enabled</td>
            <td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;font-size:18px;color:#059669;">${analytics.projectsWithAnalytics.length}</td>
          </tr>
        </table>

        ${
          analytics.projectsWithAnalytics.length > 0
            ? `<h3 style="font-size:12px;margin:18px 0 8px 0;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">With analytics</h3>
              <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px;">
                ${analytics.projectsWithAnalytics
                  .map(
                    (p) => `<tr style="border-bottom:1px solid #f3f4f6;">
                      <td style="padding:8px 6px;">
                        <div style="font-weight:600;color:#111827;">${escHtml(p.projectName)}</div>
                        ${p.primaryDomain ? `<div style="font-size:11px;color:#6b7280;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escHtml(p.primaryDomain)}</div>` : ''}
                      </td>
                      <td style="padding:8px 6px;text-align:right;">
                        <a href="${p.dashboardUrl}" style="display:inline-block;padding:6px 12px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:5px;font-size:12px;font-weight:600;">Open analytics →</a>
                      </td>
                    </tr>`,
                  )
                  .join('')}
              </table>`
            : `<p style="font-size:12px;color:#9ca3af;">No projects have analytics enabled yet.</p>`
        }

        ${
          analytics.projectsWithoutAnalytics.length > 0
            ? `<details style="margin:14px 0;">
                <summary style="cursor:pointer;font-size:12px;color:#6b7280;">
                  ${analytics.projectsWithoutAnalytics.length} project${analytics.projectsWithoutAnalytics.length === 1 ? '' : 's'} without analytics enabled
                </summary>
                <ul style="margin:8px 0 0 0;padding-left:18px;font-size:12px;color:#6b7280;">
                  ${analytics.projectsWithoutAnalytics
                    .map((p) => `<li>${escHtml(p.projectName)}${p.primaryDomain ? ` · <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escHtml(p.primaryDomain)}</span>` : ''}</li>`)
                    .join('')}
                </ul>
              </details>`
            : ''
        }
      `
          : `
        <p style="margin:0 0 12px 0;font-size:13px;color:#6b7280;">
          ${
            analytics.configured
              ? `Project listing returned 0 rows. ${analytics.note ? `Note: ${escHtml(analytics.note)}` : ''}`
              : 'VERCEL_API_TOKEN not set on production. Set it via:'
          }
        </p>
        ${
          !analytics.configured
            ? `<pre style="background:#f9fafb;border:1px solid #e5e7eb;padding:10px;font-size:12px;color:#374151;border-radius:6px;margin:0 0 14px 0;">vercel env add VERCEL_API_TOKEN production</pre>`
            : ''
        }
      `
      }
      <p style="margin: 0 0 24px 0; font-size: 13px;">
        <a href="https://vercel.com/${process.env.VERCEL_TEAM_SLUG || process.env.VERCEL_TEAM_ID || 'aks129s-projects'}" style="color:#2563eb;">Open the team dashboard →</a>
      </p>

      <p style="margin: 24px 0 0 0; font-size: 11px; color: #9ca3af;">
        Sent automatically by /api/v1/admin/weekly-report (Vercel Cron, weekly). Admin-only.
      </p>
    </div>
  `;

  const resend = new Resend(apiKey);
  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: ADMIN_EMAIL,
      subject,
      text,
      html,
    });
    if (result.error) {
      console.error('[weekly-report] resend error:', result.error);
      return NextResponse.json({ error: result.error.message }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      sent_to: ADMIN_EMAIL,
      message_id: result.data?.id ?? null,
      subscribers: subscribers.length,
      new_last_7: newLast7,
      downloads_last_7: recentDownloads.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[weekly-report] send failed:', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
