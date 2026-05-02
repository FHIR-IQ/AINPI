/**
 * scripts/send-update-email.ts
 *
 * One-shot subscriber email blast for the 2026-05-02 AINPI update
 * (H26 + H27 + Virginia briefing). Reads Subscriber rows from
 * Supabase via Prisma, sends a per-recipient email through Resend.
 *
 * Safety design:
 *   - DEFAULT: dry-run. Prints the recipient list and the rendered
 *     subject + body, sends nothing.
 *   - `--confirm` to actually send.
 *   - `--email <addr>` to target one address (overrides Subscriber
 *     table; useful for sending a final review-copy to yourself
 *     before the real blast).
 *   - `--limit <N>` to only send to the first N rows (sorted by
 *     created_at asc, deterministic).
 *   - 250ms throttle between sends — Resend's paid tier is 10 req/s.
 *   - Skips rows where `confirmedAt IS NULL` is left untouched —
 *     the current Subscriber model doesn't enforce double-opt-in,
 *     so all created rows are eligible. Filter logic is a one-line
 *     change if/when double-opt-in lands.
 *
 * Required env:
 *   RESEND_API_KEY                — Resend API key
 *   RESEND_FROM_ADDRESS           — optional override; defaults to
 *                                   "AINPI <onboarding@resend.dev>"
 *   POSTGRES_PRISMA_URL           — Supabase pooler URL
 *   POSTGRES_URL_NON_POOLING      — Supabase direct URL
 *
 * Run from `frontend/`:
 *
 *   # dry-run, full subscriber list:
 *   npx tsx scripts/send-update-email.ts
 *
 *   # dry-run, but render to one address only:
 *   npx tsx scripts/send-update-email.ts --email gene@fhiriq.com
 *
 *   # send to one address only:
 *   npx tsx scripts/send-update-email.ts --email gene@fhiriq.com --confirm
 *
 *   # limit to first 5 rows + send (smoke test before full blast):
 *   npx tsx scripts/send-update-email.ts --limit 5 --confirm
 *
 *   # full blast:
 *   npx tsx scripts/send-update-email.ts --confirm
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT = 'AINPI May 2026 update — SSN exposure in NDH bulk export + VA briefing';
const REPORT_URL = 'https://ainpi.dev/reports/2026-05-update';
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
      console.log('See header comment in scripts/send-update-email.ts');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function buildBody(): { text: string; html: string } {
  const lines = [
    'AINPI May 2026 update',
    '',
    'Two new findings + the Virginia State Medicaid briefing landed',
    'this week. Highlights:',
    '',
    'H27 — Social Security Numbers exposed in the NDH bulk export.',
    'AINPI independently verified the 2026-04-30 Washington Post',
    'finding and extended it: 63 confirmed SSN exposures in the',
    'public 2026-04-09 NDH bulk file (42 in the state-license slot,',
    '4 entered as a name token, 17 undashed-9-digit name tokens).',
    'Plus 21 NPI-as-name data-integrity violations.',
    'Top states: IL 20, OH 7, NJ/TX/WA/AZ/FL/GA/MI/PA/TN at 2 each.',
    '',
    'H26 — VA payer-directory exposure (4-MCO sweep). Cross-referenced',
    'the 125-NPI federally-excluded VA cohort against Humana, Cigna,',
    'UnitedHealthcare (Optum FLEX, covers UHC Community Plan), and',
    'Molina Complete Care. Result: 4 of 125 in Cigna; 0 in the others.',
    '2 of the 6 VA Medicaid MCOs are now wired directly.',
    '',
    'Virginia State Medicaid briefing — prepared for the 2026-05-04',
    'DMAS review meeting. § 455.436 framework + VA-specific data',
    'quality numbers + the federally-excluded cohort + H26 results.',
    '',
    'High-risk cohort v0.4.0 — now 5 signals, closes 3 of 4 § 455.436',
    'federal database checks (NPPES, OIG LEIE, SAM.gov; SSA-DMF',
    'remains restricted-access).',
    '',
    `Read the full update: ${REPORT_URL}`,
    '',
    '— Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ];
  const text = lines.join('\n');
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937; line-height: 1.55;">
      <h1 style="font-size: 20px; margin: 0 0 12px 0;">AINPI May 2026 update</h1>
      <p style="margin: 0 0 16px 0;">
        Two new findings + the Virginia State Medicaid briefing landed
        this week.
      </p>

      <h2 style="font-size: 16px; margin: 20px 0 6px 0;">H27 — SSNs exposed in the NDH bulk export</h2>
      <p style="margin: 0 0 12px 0;">
        AINPI independently verified the
        <a href="https://www.washingtonpost.com/health/2026/04/30/medicare-portal-social-security-numbers-exposed/">2026-04-30 Washington Post finding</a>
        and extended it: <strong>63 confirmed SSN exposures</strong> in the public
        2026-04-09 NDH bulk file (42 in the state-license slot, 4 as a name
        token, 17 undashed-9-digit name tokens). Plus 21 NPI-as-name
        data-integrity violations. Top states: IL 20, OH 7,
        NJ/TX/WA/AZ/FL/GA/MI/PA/TN at 2 each.
      </p>

      <h2 style="font-size: 16px; margin: 20px 0 6px 0;">H26 — VA payer-directory exposure (4-MCO sweep)</h2>
      <p style="margin: 0 0 12px 0;">
        Cross-referenced the 125-NPI federally-excluded VA cohort against
        Humana, Cigna, UnitedHealthcare (Optum FLEX, covers UHC Community
        Plan), and Molina Complete Care. Result: <strong>4 of 125 in Cigna</strong>;
        0 in the others. 2 of the 6 VA Medicaid MCOs are now wired directly.
      </p>

      <h2 style="font-size: 16px; margin: 20px 0 6px 0;">Virginia State Medicaid briefing</h2>
      <p style="margin: 0 0 12px 0;">
        Prepared for the 2026-05-04 DMAS review meeting. § 455.436 framework
        + VA-specific data quality numbers + the federally-excluded cohort +
        H26 results. <a href="https://ainpi.dev/briefings/va">https://ainpi.dev/briefings/va</a>
      </p>

      <h2 style="font-size: 16px; margin: 20px 0 6px 0;">High-risk cohort v0.4.0</h2>
      <p style="margin: 0 0 16px 0;">
        Now 5 signals, closes 3 of 4 § 455.436 federal database checks
        (NPPES, OIG LEIE, SAM.gov; SSA-DMF remains restricted-access).
      </p>

      <p style="margin: 20px 0 12px 0;">
        <a href="${REPORT_URL}" style="display: inline-block; padding: 10px 18px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">
          Read the full update →
        </a>
      </p>

      <p style="margin: 28px 0 0 0; font-size: 12px; color: #6b7280;">
        — Eugene Vestel, FHIR IQ<br>
        Reply to this email to unsubscribe or ask a question
        (<a href="mailto:${UNSUB_REPLY}">${UNSUB_REPLY}</a>).
      </p>
    </div>
  `;
  return { text, html };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { text, html } = buildBody();

  console.log(`Subject: ${SUBJECT}`);
  console.log(`From:    ${FROM_ADDRESS}`);
  console.log(`Mode:    ${args.confirm ? 'SEND' : 'DRY-RUN'}`);
  console.log('');

  let recipients: string[];
  if (args.email) {
    recipients = [args.email.trim().toLowerCase()];
  } else {
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.subscriber.findMany({
        select: { email: true },
        orderBy: { createdAt: 'asc' },
        take: args.limit ?? undefined,
      });
      recipients = rows.map((r) => r.email);
    } finally {
      await prisma.$disconnect();
    }
  }

  console.log(`Recipients: ${recipients.length}`);
  for (const email of recipients) console.log(`  ${email}`);
  console.log('');

  if (!args.confirm) {
    console.log('--- DRY-RUN body (text) ---');
    console.log(text);
    console.log('--- end DRY-RUN. Add --confirm to send for real. ---');
    return;
  }

  if (recipients.length === 0) {
    console.log('No recipients. Nothing to send.');
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY not set; cannot send.');
    process.exit(1);
  }
  const resend = new Resend(apiKey);

  let ok = 0;
  let err = 0;
  for (let i = 0; i < recipients.length; i++) {
    const to = recipients[i];
    try {
      const result = await resend.emails.send({
        from: FROM_ADDRESS,
        to,
        replyTo: UNSUB_REPLY,
        subject: SUBJECT,
        text,
        html,
      });
      if (result.error) {
        err++;
        console.error(`  [${i + 1}/${recipients.length}] ${to} ERROR ${result.error.name}: ${result.error.message}`);
      } else {
        ok++;
        console.log(`  [${i + 1}/${recipients.length}] ${to} sent (id=${result.data?.id ?? '?'})`);
      }
    } catch (e) {
      err++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  [${i + 1}/${recipients.length}] ${to} EXCEPTION ${msg}`);
    }
    if (i < recipients.length - 1) {
      await new Promise((r) => setTimeout(r, SEND_THROTTLE_MS));
    }
  }

  console.log('');
  console.log(`Done. Sent: ${ok}, errors: ${err}.`);
  if (err > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
