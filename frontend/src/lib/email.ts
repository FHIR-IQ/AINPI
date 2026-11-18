/**
 * Transactional email helpers via Resend.
 *
 * Sending is fire-and-forget from API routes, a delivery failure
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
import { NEWSLETTER_NAME, SUBSTACK_SIGNUP_PAGE } from './newsletter';

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

/**
 * Sent when someone ticks "also subscribe" on the download page. That form
 * cannot also submit to Substack, so this note carries the free sign-up link.
 * The /subscribe and inline forms sign up on Substack directly and do not
 * send it.
 */
export async function sendSubscribeWelcome(email: string): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;
  const confirmUrl = SUBSTACK_SIGNUP_PAGE;
  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      replyTo: REPLY_TO,
      subject: 'One step left: the newsletter is on Substack',
      text: [
        `You asked to subscribe when you downloaded an AINPI report.`,
        ``,
        `AINPI findings go out in ${NEWSLETTER_NAME}, Eugene Vestel's newsletter`,
        `on Substack, which also carries the Out of the FHIR podcast and essays`,
        `on FHIR and healthcare data. It is free. Enter this address on`,
        `Substack to start getting it; if you already subscribed, ignore this.`,
        ``,
        `Subscribe: ${confirmUrl}`,
        ``,
        `Every issue has an unsubscribe link. To remove the address saved on`,
        `ainpi.dev as well, reply to this email.`,
        ``,
        `Eugene Vestel, FHIR IQ`,
      ].join('\n'),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.5;">
          <p>You asked to subscribe when you downloaded an AINPI report.</p>
          <p>AINPI findings go out in <em>${NEWSLETTER_NAME}</em>, Eugene Vestel's newsletter on Substack, which also carries the <em>Out of the FHIR</em> podcast and essays on FHIR and healthcare data. It is free. Enter this address on Substack to start getting it; if you already subscribed, ignore this.</p>
          <p><a href="${confirmUrl}" style="color: #2557eb; font-weight: 600;">Subscribe on Substack</a></p>
          <p style="color: #6b7280; font-size: 14px;">Every issue has an unsubscribe link. To remove the address saved on ainpi.dev as well, reply to this email.</p>
          <p style="color: #6b7280; font-size: 14px;">Eugene Vestel, FHIR IQ</p>
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
        `  https://ainpi.dev/report`,
        ``,
        `If you have a question about methodology or a finding disagrees`,
        `with what you're seeing in the source, just reply to this email.`,
        ``,
        `Eugene Vestel, FHIR IQ`,
      ].join('\n'),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.5;">
          <p>${greeting}</p>
          <p>Thanks for downloading the <strong>AINPI v1.0 report</strong>.</p>
          <p><strong>Download:</strong><br/>
            <a href="${pdfUrl}" style="color: #2557eb;">${pdfUrl}</a>
          </p>
          <p>You can also view the web version at <a href="https://ainpi.dev/report" style="color: #2557eb;">ainpi.dev/report</a>.</p>
          <p>If you have a question about methodology or a finding disagrees with what you're seeing in the source, just reply to this email.</p>
          <p style="color: #6b7280; font-size: 14px;">Eugene Vestel, FHIR IQ</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('[email] sendDownloadThanks failed:', err);
    return false;
  }
}
