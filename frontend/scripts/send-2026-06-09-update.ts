/**
 * scripts/send-2026-06-09-update.ts
 *
 * 2026-06-09 subscriber update — H43 practitioner phone-number reachability
 * published. Short, single-finding update.
 *
 * Same safety design as send-2026-06-02-update.ts (dry-run by default,
 * --confirm to send, --email / --limit narrow targeting, 250ms throttle).
 *
 * Required env:
 *   RESEND_API_KEY
 *   RESEND_FROM_ADDRESS (optional; defaults to onboarding@resend.dev)
 *   POSTGRES_PRISMA_URL
 *
 * Usage from frontend/:
 *
 *   # 1. Dry-run (no DB hit, prints body):
 *   npx tsx scripts/send-2026-06-09-update.ts
 *
 *   # 2. Preview to one address (confirms the actual send path works):
 *   npx tsx scripts/send-2026-06-09-update.ts --email you@example.com --confirm
 *
 *   # 3. Smoke test on first 2 real subscribers:
 *   npx tsx scripts/send-2026-06-09-update.ts --limit 2 --confirm
 *
 *   # 4. Full blast to every subscriber:
 *   npx tsx scripts/send-2026-06-09-update.ts --confirm
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT =
  'AINPI 2026-06-09 — practitioner phone numbers are on the record, not the location';
const REPORT_URL = 'https://ainpi.dev/reports/2026-06-09-update';
const FINDING_URL = 'https://ainpi.dev/findings/practitioner-phone-reachability';
const UNSUB_REPLY = 'gene@fhiriq.com';
const SEND_THROTTLE_MS = 250;
const FROM_ADDRESS =
  process.env.RESEND_FROM_ADDRESS || 'AINPI <onboarding@resend.dev>';

interface CliArgs {
  confirm: boolean;
  email: string | null;
  limit: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { confirm: false, email: null, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--email') out.email = argv[++i] ?? null;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      out.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } else if (a === '-h' || a === '--help') {
      console.log('See header comment in scripts/send-2026-06-09-update.ts');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function buildBody(): { text: string; html: string } {
  // Plain prose, no marketing language. Short single-finding update.
  const text = [
    'One new finding this week.',
    '',
    'H43 — practitioner phone-number reachability.',
    '',
    'The question: can you associate a practitioner in the federal',
    'provider directory (NDH bulk export) with a phone number, and which',
    'FHIR resource do you read to get it? A phone can live in three',
    'places: on the Practitioner record, on the PractitionerRole, or on',
    'the Location the role points at.',
    '',
    'We pre-registered the expectation that the Practitioner record would',
    'be sparse, because NPPES keeps practice phone on the location. The',
    'measured data rejected that.',
    '',
    'Result, 2026-05-08 release:',
    '  - 7,196,385 active Practitioner resources',
    '  - 7,195,270 (99.98%) carry a phone directly on the record',
    '  - the role-to-location traversal adds nothing',
    '  - 1,115 (0.015%) have no phone on any of the three resources',
    '',
    'Practical takeaway: a "call this provider" feature can read',
    'Practitioner.telecom straight off the record. Two caveats: on-record',
    'contact is phone and fax only (email and url came back empty), and',
    'the location layer shrank 61% in the May release, so location-path',
    'numbers are release-sensitive.',
    '',
    'Full write-up:',
    REPORT_URL,
    '',
    'Finding page with the chart and method notes:',
    FINDING_URL,
    '',
    '- AINPI / FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.55; padding: 20px;">

  <p style="margin: 0 0 16px 0;">One new finding this week.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">H43 — practitioner phone-number reachability.</h2>

  <p style="margin: 0 0 12px 0;">The question: can you associate a practitioner in the federal provider directory (NDH bulk export) with a phone number, and which FHIR resource do you read to get it? A phone can live in three places: on the Practitioner record, on the PractitionerRole, or on the Location the role points at.</p>

  <p style="margin: 0 0 12px 0;">We pre-registered the expectation that the Practitioner record would be sparse, because NPPES keeps practice phone on the location. The measured data rejected that.</p>

  <p style="margin: 0 0 8px 0;">Result, 2026-05-08 release:</p>

  <ul style="margin: 0 0 12px 0; padding-left: 22px;">
    <li>7,196,385 active Practitioner resources</li>
    <li>7,195,270 (99.98%) carry a phone directly on the record</li>
    <li>the role-to-location traversal adds nothing</li>
    <li>1,115 (0.015%) have no phone on any of the three resources</li>
  </ul>

  <p style="margin: 0 0 12px 0;">Practical takeaway: a "call this provider" feature can read Practitioner.telecom straight off the record. Two caveats: on-record contact is phone and fax only (email and url came back empty), and the location layer shrank 61% in the May release, so location-path numbers are release-sensitive.</p>

  <p style="margin: 0 0 12px 0;">Full write-up: <a href="${REPORT_URL}" style="color: #1d4ed8;">${REPORT_URL}</a></p>

  <p style="margin: 0 0 12px 0;">Finding page with the chart and method notes: <a href="${FINDING_URL}" style="color: #1d4ed8;">${FINDING_URL}</a></p>

  <p style="margin: 24px 0 8px 0;">- AINPI / FHIR IQ</p>

  <p style="margin: 0; color: #6b7280; font-size: 13px;">Reply to this email to unsubscribe or ask a question (<a href="mailto:${UNSUB_REPLY}" style="color: #6b7280;">${UNSUB_REPLY}</a>).</p>

</div>
  `.trim();

  return { text, html };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { text, html } = buildBody();

  console.log(`Subject: ${SUBJECT}`);
  console.log(`From:    ${FROM_ADDRESS}`);

  if (!args.confirm) {
    console.log('\n--- DRY RUN (pass --confirm to send) ---\n');
    console.log(text);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set; aborting.');
    process.exit(1);
  }
  const resend = new Resend(apiKey);

  let recipients: string[];
  if (args.email) {
    recipients = [args.email];
  } else {
    const prisma = new PrismaClient();
    const subs = await prisma.subscriber.findMany({
      select: { email: true },
      orderBy: { createdAt: 'asc' },
      ...(args.limit ? { take: args.limit } : {}),
    });
    await prisma.$disconnect();
    recipients = subs.map((s: { email: string }) => s.email);
  }

  console.log(`Recipients: ${recipients.length}`);
  for (const to of recipients) {
    try {
      const res = await resend.emails.send({
        from: FROM_ADDRESS,
        to,
        subject: SUBJECT,
        text,
        html,
        replyTo: UNSUB_REPLY,
      });
      console.log(`sent  ${to}  id=${res.data?.id ?? '?'}${res.error ? `  ERROR=${res.error.message}` : ''}`);
    } catch (err) {
      console.error(`FAIL  ${to}  ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, SEND_THROTTLE_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
