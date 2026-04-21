/**
 * Transactional email helpers via Resend.
 *
 * Sending is fire-and-forget from API routes — a delivery failure
 * should NEVER block the underlying user action (subscribe, download).
 * All helpers catch + log and return a boolean for "best effort"
 * telemetry.
 *
 * Required env: RESEND_API_KEY (never commit this).
 *
 * From-address notes:
 *   - Until fhiriq.com DNS is verified in Resend, use the shared
 *     onboarding domain `onboarding@resend.dev`. Resend lets any account
 *     send from this address in test mode.
 *   - Once fhiriq.com is verified, swap FROM_ADDRESS to
 *     `AINPI <hello@fhiriq.com>` without any other code change.
 */

import { Resend } from 'resend';

const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || 'AINPI <onboarding@resend.dev>';
const REPLY_TO = 'gene@fhiriq.com';

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[email] RESEND_API_KEY not set; emails are disabled');
    return null;
  }
  return new Resend(key);
}

export async function sendSubscribeWelcome(email: string): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;
  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      replyTo: REPLY_TO,
      subject: "You're subscribed to AINPI updates",
      text: [
        `Thanks for subscribing to AINPI — the open-source audit of the`,
        `CMS National Provider Directory.`,
        ``,
        `What to expect:`,
        `  • One email per major finding (typically once a month)`,
        `  • The annual State of the NDH report in June`,
        `  • No marketing. No filler. You can reply to any email to`,
        `    unsubscribe or ask a question.`,
        ``,
        `Current findings: https://ainpi.vercel.app/findings`,
        `Methodology:    https://ainpi.vercel.app/methodology`,
        `Full report:    https://ainpi.vercel.app/download`,
        ``,
        `— Eugene Vestel, FHIR IQ`,
      ].join('\n'),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.5;">
          <p>Thanks for subscribing to <strong>AINPI</strong> — the open-source audit of the CMS National Provider Directory.</p>
          <p><strong>What to expect:</strong></p>
          <ul>
            <li>One email per major finding (typically once a month)</li>
            <li>The annual <em>State of the NDH</em> report in June</li>
            <li>No marketing, no filler. Reply to any email to unsubscribe or ask a question.</li>
          </ul>
          <p>
            <a href="https://ainpi.vercel.app/findings" style="color: #2557eb;">Current findings</a> ·
            <a href="https://ainpi.vercel.app/methodology" style="color: #2557eb;">Methodology</a> ·
            <a href="https://ainpi.vercel.app/download" style="color: #2557eb;">Download the full report</a>
          </p>
          <p style="color: #6b7280; font-size: 14px;">— Eugene Vestel, FHIR IQ</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('[email] sendSubscribeWelcome failed:', err);
    return false;
  }
}

export async function sendDownloadThanks(
  email: string,
  name: string | null,
  pdfUrl: string,
): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;
  const greeting = name ? `Hi ${name.split(' ')[0]},` : 'Hi,';
  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      replyTo: REPLY_TO,
      subject: 'Your AINPI v1.0 report is ready',
      text: [
        greeting,
        ``,
        `Thanks for downloading the AINPI v1.0 report.`,
        ``,
        `Download link (same as what you already have in your browser):`,
        `  ${pdfUrl}`,
        ``,
        `You can also view the web version at:`,
        `  https://ainpi.vercel.app/report`,
        ``,
        `If you have a question about methodology or a finding disagrees`,
        `with what you're seeing in the source, just reply to this email.`,
        ``,
        `— Eugene Vestel, FHIR IQ`,
      ].join('\n'),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.5;">
          <p>${greeting}</p>
          <p>Thanks for downloading the <strong>AINPI v1.0 report</strong>.</p>
          <p><strong>Download:</strong><br/>
            <a href="${pdfUrl}" style="color: #2557eb;">${pdfUrl}</a>
          </p>
          <p>You can also view the web version at <a href="https://ainpi.vercel.app/report" style="color: #2557eb;">ainpi.vercel.app/report</a>.</p>
          <p>If you have a question about methodology or a finding disagrees with what you're seeing in the source, just reply to this email.</p>
          <p style="color: #6b7280; font-size: 14px;">— Eugene Vestel, FHIR IQ</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('[email] sendDownloadThanks failed:', err);
    return false;
  }
}
