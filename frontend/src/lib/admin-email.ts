/**
 * admin-email — realtime admin notifications for subscriber + download events.
 *
 * Two top-level helpers:
 *   - sendSubscriptionAlert  fires on POST /api/v1/subscribe (and on
 *                            alsoSubscribe=true from /api/v1/download-report).
 *   - sendDownloadAlert      fires on POST /api/v1/download-report success.
 *
 * Both are fire-and-forget — the API handler should `void` the promise so
 * the request doesn't block on SMTP. Errors are logged, not thrown.
 *
 * Auth model: no auth needed; this is server-only code calling Resend
 * directly via RESEND_API_KEY. The user-facing API handlers are the
 * gatekeepers.
 *
 * Env:
 *   RESEND_API_KEY                   required
 *   RESEND_FROM_ADDRESS              optional; defaults to 'AINPI <onboarding@resend.dev>'
 *   ADMIN_EMAIL                      optional; defaults to gene@fhiriq.com
 */
import { Resend } from 'resend';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'gene@fhiriq.com';
const FROM_ADDRESS =
  process.env.RESEND_FROM_ADDRESS || 'AINPI <onboarding@resend.dev>';
const SITE_URL = process.env.SITE_URL || 'https://ainpi.dev';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[admin-email] RESEND_API_KEY not set; skipping alert.');
    return null;
  }
  return new Resend(key);
}

async function sendOnce(args: {
  subject: string;
  text: string;
  html: string;
  tag: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) return;
  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: ADMIN_EMAIL,
      subject: args.subject,
      text: args.text,
      html: args.html,
    });
    if (result.error) {
      console.error(
        `[admin-email:${args.tag}] resend error:`,
        result.error.name,
        result.error.message,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin-email:${args.tag}] send failed:`, msg);
  }
}

export interface SubscriptionAlertArgs {
  email: string;
  source: string;
  /**
   * Total subscriber count *after* this row was inserted. Optional —
   * we'll show it in the email if the caller passes it (saves an extra
   * Prisma round trip for callers that already counted).
   */
  totalAfter?: number;
}

export async function sendSubscriptionAlert(
  args: SubscriptionAlertArgs,
): Promise<void> {
  const { email, source, totalAfter } = args;
  const subject = `[AINPI admin] New subscriber · ${email}`;

  const text = [
    `New subscriber on AINPI.`,
    ``,
    `Email:     ${email}`,
    `Source:    ${source}`,
    totalAfter != null ? `Total now: ${totalAfter} subscribers` : '',
    ``,
    `Manage list:  ${SITE_URL}/api/v1/admin/weekly-report (cron-only)`,
    `Subscribers:  https://app.supabase.com/project/_/sql (Subscriber table)`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;line-height:1.5;">
      <div style="border-left:4px solid #10b981;padding:14px 18px;background:#f0fdf4;margin-bottom:20px;">
        <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#065f46;">AINPI Admin · Subscriber event</p>
        <h1 style="margin:6px 0 0 0;font-size:18px;color:#064e3b;">New subscriber</h1>
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${esc(email)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Source</td><td style="padding:6px 0;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${esc(source)}</td></tr>
        ${totalAfter != null ? `<tr><td style="padding:6px 0;color:#6b7280;">Total now</td><td style="padding:6px 0;text-align:right;font-weight:600;tabular-nums:1;">${totalAfter} subscribers</td></tr>` : ''}
      </table>
      <p style="margin:0;font-size:11px;color:#9ca3af;">
        Sent by /api/v1/subscribe on ${esc(new Date().toISOString())}. Admin alerts only.
      </p>
    </div>
  `.trim();

  await sendOnce({ subject, text, html, tag: 'subscription' });
}

export interface DownloadAlertArgs {
  email: string;
  name: string | null;
  organization: string | null;
  useCase: string | null;
  reportId: string;
  reportTitle: string;
  reportVersion: string;
  alsoSubscribed: boolean;
  /** Total downloads *after* this insert. Optional. */
  totalAfter?: number;
}

export async function sendDownloadAlert(
  args: DownloadAlertArgs,
): Promise<void> {
  const {
    email,
    name,
    organization,
    useCase,
    reportId,
    reportTitle,
    reportVersion,
    alsoSubscribed,
    totalAfter,
  } = args;

  const subject = `[AINPI admin] Report downloaded · ${reportId} · ${email}`;

  const text = [
    `Report download on AINPI.`,
    ``,
    `Report:       ${reportTitle}`,
    `ID:           ${reportId}`,
    `Version:      ${reportVersion}`,
    ``,
    `Email:        ${email}`,
    `Name:         ${name || '(none)'}`,
    `Organization: ${organization || '(none)'}`,
    `Use case:     ${useCase ? useCase.slice(0, 200) : '(none)'}`,
    `Also sub'd:   ${alsoSubscribed ? 'yes' : 'no'}`,
    totalAfter != null ? `Total downloads: ${totalAfter}` : '',
    ``,
    `Report URL:   ${SITE_URL}/reports/${reportId}`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;line-height:1.5;">
      <div style="border-left:4px solid #2563eb;padding:14px 18px;background:#eff6ff;margin-bottom:20px;">
        <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#1e40af;">AINPI Admin · Download event</p>
        <h1 style="margin:6px 0 0 0;font-size:18px;color:#1e3a8a;">Report downloaded</h1>
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Report</td><td style="padding:6px 0;text-align:right;font-weight:600;">${esc(reportTitle)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">ID · version</td><td style="padding:6px 0;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;">${esc(reportId)} · ${esc(reportVersion)}</td></tr>
        <tr><td colspan="2" style="padding:12px 0 4px 0;border-top:1px solid #e5e7eb;"></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${esc(email)}</td></tr>
        ${name ? `<tr><td style="padding:6px 0;color:#6b7280;">Name</td><td style="padding:6px 0;text-align:right;">${esc(name)}</td></tr>` : ''}
        ${organization ? `<tr><td style="padding:6px 0;color:#6b7280;">Organization</td><td style="padding:6px 0;text-align:right;">${esc(organization)}</td></tr>` : ''}
        <tr><td style="padding:6px 0;color:#6b7280;">Also subscribed</td><td style="padding:6px 0;text-align:right;color:${alsoSubscribed ? '#059669' : '#9ca3af'};font-weight:${alsoSubscribed ? 600 : 400};">${alsoSubscribed ? 'yes' : 'no'}</td></tr>
        ${totalAfter != null ? `<tr><td style="padding:6px 0;color:#6b7280;">Total downloads</td><td style="padding:6px 0;text-align:right;font-weight:600;tabular-nums:1;">${totalAfter}</td></tr>` : ''}
      </table>
      ${
        useCase
          ? `
        <div style="margin-bottom:18px;">
          <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;">Use case</p>
          <blockquote style="margin:0;padding:10px 14px;background:#f9fafb;border-left:3px solid #d1d5db;font-size:13px;color:#374151;white-space:pre-wrap;">${esc(useCase.slice(0, 600))}${useCase.length > 600 ? '…' : ''}</blockquote>
        </div>
      `
          : ''
      }
      <p style="margin:0;font-size:11px;color:#9ca3af;">
        Sent by /api/v1/download-report on ${esc(new Date().toISOString())}. Admin alerts only.
      </p>
    </div>
  `.trim();

  await sendOnce({ subject, text, html, tag: 'download' });
}
