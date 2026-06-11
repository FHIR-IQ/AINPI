/**
 * scripts/send-fred-heads-up.ts
 *
 * One-off courtesy note to Fred Trotter (CMS NDH team) letting him know
 * he was added to the AINPI subscriber list. Personal, single recipient,
 * lands BEFORE the 2026-06-09 bulk newsletter so the bulk arrival has
 * context.
 *
 * Same safety pattern as the other send-* scripts: dry-run by default,
 * --confirm to actually send. No --limit / no --email override because
 * this script targets exactly one recipient by design.
 *
 * Required env:
 *   RESEND_API_KEY
 *   RESEND_FROM_ADDRESS (optional; defaults to onboarding@resend.dev)
 *
 * Usage:
 *   npx tsx scripts/send-fred-heads-up.ts            # dry-run
 *   npx tsx scripts/send-fred-heads-up.ts --confirm  # actually send
 */
import { Resend } from 'resend';

const TO = 'fred@fredtrotter.com';
const SUBJECT = 'AINPI list: added you, easy to undo';
const REPLY_TO = 'gene@fhiriq.com';
const FROM_ADDRESS =
  process.env.RESEND_FROM_ADDRESS || 'AINPI <onboarding@resend.dev>';

function buildBody(): { text: string; html: string } {
  const text = [
    'Hi Fred,',
    '',
    'Quick note. After our exchange on the NDH manifest thread, I added',
    "you to the AINPI subscriber list. You'll get one technical update per",
    'month at most, usually less. If that is not useful, reply with',
    '"unsubscribe" and I will take you off, no friction.',
    '',
    'PR #118 landed the manifest-driven ingest pattern we talked about.',
    'The next update goes out tonight: H43, practitioner phone-number',
    'reachability across the three FHIR paths. Should be in your inbox',
    'right after this one.',
    '',
    'Thanks for being a great steward of the NDH.',
    '',
    '- Eugene Vestel, FHIR IQ',
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.55; padding: 20px;">

  <p style="margin: 0 0 16px 0;">Hi Fred,</p>

  <p style="margin: 0 0 16px 0;">Quick note. After our exchange on the NDH manifest thread, I added you to the AINPI subscriber list. You will get one technical update per month at most, usually less. If that is not useful, reply with "unsubscribe" and I will take you off, no friction.</p>

  <p style="margin: 0 0 16px 0;">PR #118 landed the manifest-driven ingest pattern we talked about. The next update goes out tonight: H43, practitioner phone-number reachability across the three FHIR paths. Should be in your inbox right after this one.</p>

  <p style="margin: 0 0 16px 0;">Thanks for being a great steward of the NDH.</p>

  <p style="margin: 24px 0 0 0;">- Eugene Vestel, FHIR IQ</p>

</div>
  `.trim();

  return { text, html };
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const { text, html } = buildBody();

  console.log(`To:      ${TO}`);
  console.log(`Subject: ${SUBJECT}`);
  console.log(`From:    ${FROM_ADDRESS}`);
  console.log('---');
  console.log(text);
  console.log('---');

  if (!confirm) {
    console.log('[DRY RUN] Pass --confirm to actually send.');
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set; cannot send. Aborting.');
    process.exit(1);
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: TO,
      subject: SUBJECT,
      text,
      html,
      replyTo: REPLY_TO,
    });
    console.log(`Done. sent=1 failed=0`);
  } catch (e) {
    console.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
