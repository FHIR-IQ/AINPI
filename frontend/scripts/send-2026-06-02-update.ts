/**
 * scripts/send-2026-06-02-update.ts
 *
 * 2026-06-02 subscriber update — landscape becomes the front door, REAL
 * Health Providers Act audit framework published. Two coordinated releases
 * positioned as the pair that makes AINPI the audit substrate for the
 * 2028 CMS scoring-methodology RFC.
 *
 * Same safety design as send-2026-05-22-update.ts (dry-run by default,
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
 *   npx tsx scripts/send-2026-06-02-update.ts
 *
 *   # 2. Preview to one address (confirms the actual send path works):
 *   npx tsx scripts/send-2026-06-02-update.ts --email eugene.vestel@gmail.com --confirm
 *
 *   # 3. Smoke test on first 2 real subscribers:
 *   npx tsx scripts/send-2026-06-02-update.ts --limit 2 --confirm
 *
 *   # 4. Full blast to every subscriber:
 *   npx tsx scripts/send-2026-06-02-update.ts --confirm
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT =
  'AINPI 2026-06-02 — landscape becomes the front door, REAL Health audit framework published';
const REPORT_URL = 'https://ainpi.dev/reports/2026-06-02-update';
const HOMEPAGE_URL = 'https://ainpi.dev/';
const POLICY_URL = 'https://ainpi.dev/real-health-providers';
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
      console.log('See header comment in scripts/send-2026-06-02-update.ts');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function buildBody(): { text: string; html: string } {
  // Plain prose, no unicode arrows, no marketing language, no urgency words.
  // The structure reads like a personal note from Eugene rather than a
  // designed campaign — that is the spam-filter optimization.
  const text = [
    'Two coordinated releases tonight. They are intentionally a pair.',
    '',
    '1. The homepage is now a provider data landscape.',
    '',
    'The choropleth that lived at ainpi.dev for the past year answered one',
    'question well: how many federally-excluded NPIs are still listed per',
    'state. That question still matters and the map is still live at',
    `${HOMEPAGE_URL}map.`,
    '',
    'But the choropleth was a single-finding view, and AINPI now produces',
    "dozens of cross-source signals. The new homepage is a hierarchical",
    "treemap inspired by Andrej Karpathy's job-market visualizer at",
    'karpathy.ai/jobs. Every cell is one state-by-specialty tuple. Area',
    'scales with the count of active practitioners. Color is the audit',
    'metric you select.',
    '',
    'Six layers, each measuring a different dimension of accuracy:',
    '  - Completeness',
    '  - Cross-source agreement',
    '  - Currency (median days since lastUpdated)',
    '  - Endpoint reachability',
    '  - Federal integrity (LEIE, SAM, and NPPES deactivation flags)',
    '  - Specialty validity (NUCC against CMS Medicare crosswalk)',
    '',
    'Tile-by toggle on top: group by specialty (default) or by state.',
    'Same data, different organizing dimension. Click any cell to open a',
    'side panel with all six scores side-by-side versus the national',
    'baseline, plus a sample of NPIs with primary-source verify links to',
    'NPPES Registry, OIG LEIE, and SAM.gov.',
    '',
    'Cell-level numbers today are a deterministic synthetic seed, marked',
    'plainly on-page. The aggregation script (analysis/landscape.py) runs',
    'against BigQuery with the 100 GB per-query cap; the weekly-refresh',
    'cron replaces the seed with measured values.',
    '',
    `Live at ${HOMEPAGE_URL}`,
    '',
    '2. The REAL Health Providers Act audit framework.',
    '',
    'HR 7148 section 6220, the Requiring Enhanced and Accurate Lists of',
    'Health Providers Act, was signed into law on February 3. MA plans',
    'must verify every provider record every 90 days, remove departed',
    'providers within 5 business days, and submit an annual accuracy',
    'analysis to HHS. Starting plan year 2029, CMS publishes each plan',
    'accuracy score on cms.gov in machine-readable format.',
    '',
    'The hard part is not the cadence. It is the measurement methodology.',
    'CMS has not yet defined how the 2029 published score is computed.',
    'Three paradigms compete: field-level on plan-owned data (gameable),',
    'phone-audit secret shopper (catches ghost networks but scales',
    'poorly), and cross-source intersection (the only paradigm a plan',
    'cannot grade itself on).',
    '',
    'AINPI implements the cross-source intersection. The landscape view',
    'shows it. The new policy brief at',
    `${POLICY_URL}`,
    'maps every section 6220 obligation to the AINPI signal that measures',
    'it, with copy-paste citation language for any submitter to the 2028',
    'CMS scoring-methodology RFC. The 18 months between now and the 2028',
    'compliance window are when the framework gets set.',
    '',
    'Full update with all the context:',
    REPORT_URL,
    '',
    '- Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  // Plain semantic HTML, no gradients, no badges, no CTA button stacks,
  // no unicode arrows. Single column, single sans-serif font, neutral grey
  // text. Reads like a hand-typed personal email — which it is.
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.55; padding: 20px;">

  <p style="margin: 0 0 16px 0;">Two coordinated releases tonight. They are intentionally a pair.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">1. The homepage is now a provider data landscape.</h2>

  <p style="margin: 0 0 12px 0;">The choropleth that lived at ainpi.dev for the past year answered one question well: how many federally-excluded NPIs are still listed per state. That question still matters and the map is still live at <a href="${HOMEPAGE_URL}map" style="color: #1d4ed8;">ainpi.dev/map</a>.</p>

  <p style="margin: 0 0 12px 0;">But the choropleth was a single-finding view, and AINPI now produces dozens of cross-source signals. The new homepage is a hierarchical treemap inspired by Andrej Karpathy's job-market visualizer at <a href="https://karpathy.ai/jobs/" style="color: #1d4ed8;">karpathy.ai/jobs</a>. Every cell is one state-by-specialty tuple. Area scales with the count of active practitioners. Color is the audit metric you select.</p>

  <p style="margin: 0 0 8px 0;">Six layers, each measuring a different dimension of accuracy:</p>

  <ul style="margin: 0 0 12px 0; padding-left: 22px;">
    <li>Completeness</li>
    <li>Cross-source agreement</li>
    <li>Currency (median days since lastUpdated)</li>
    <li>Endpoint reachability</li>
    <li>Federal integrity (LEIE, SAM, and NPPES deactivation flags)</li>
    <li>Specialty validity (NUCC against CMS Medicare crosswalk)</li>
  </ul>

  <p style="margin: 0 0 12px 0;">Tile-by toggle on top: group by specialty (default) or by state. Same data, different organizing dimension. Click any cell to open a side panel with all six scores side-by-side versus the national baseline, plus a sample of NPIs with primary-source verify links to NPPES Registry, OIG LEIE, and SAM.gov.</p>

  <p style="margin: 0 0 12px 0;">Cell-level numbers today are a deterministic synthetic seed, marked plainly on-page. The weekly-refresh cron replaces with measured BigQuery output on the next pass.</p>

  <p style="margin: 0 0 16px 0;">Live at <a href="${HOMEPAGE_URL}" style="color: #1d4ed8;">${HOMEPAGE_URL}</a>.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">2. The REAL Health Providers Act audit framework.</h2>

  <p style="margin: 0 0 12px 0;">HR 7148 section 6220, the Requiring Enhanced and Accurate Lists of Health Providers Act, was signed into law on February 3. MA plans must verify every provider record every 90 days, remove departed providers within 5 business days, and submit an annual accuracy analysis to HHS. Starting plan year 2029, CMS publishes each plan accuracy score on cms.gov in machine-readable format.</p>

  <p style="margin: 0 0 12px 0;">The hard part is not the cadence. It is the measurement methodology. CMS has not yet defined how the 2029 published score is computed. Three paradigms compete: field-level on plan-owned data (gameable), phone-audit secret shopper (catches ghost networks but scales poorly), and cross-source intersection (the only paradigm a plan cannot grade itself on).</p>

  <p style="margin: 0 0 12px 0;">AINPI implements the cross-source intersection. The landscape view shows it. The new policy brief at <a href="${POLICY_URL}" style="color: #1d4ed8;">${POLICY_URL}</a> maps every section 6220 obligation to the AINPI signal that measures it, with copy-paste citation language for any submitter to the 2028 CMS scoring-methodology RFC. The 18 months between now and the 2028 compliance window are when the framework gets set.</p>

  <p style="margin: 0 0 12px 0;">Full update with all the context: <a href="${REPORT_URL}" style="color: #1d4ed8;">${REPORT_URL}</a></p>

  <p style="margin: 24px 0 8px 0;">- Eugene Vestel, FHIR IQ</p>

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
  console.log(`URLs:    ${HOMEPAGE_URL} | ${POLICY_URL} | ${REPORT_URL}`);
  console.log('---');
  console.log(text);
  console.log('---');

  if (!args.confirm) {
    console.log('[DRY RUN] Pass --confirm to actually send.');
    if (args.email) {
      console.log(`         (Would target only: ${args.email})`);
    } else if (args.limit) {
      console.log(`         (Would target first ${args.limit} subscribers)`);
    }
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set; cannot send. Aborting.');
    process.exit(1);
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const prisma = new PrismaClient();

  try {
    let recipients: { email: string }[] = [];
    if (args.email) {
      recipients = [{ email: args.email }];
    } else {
      const subs = await prisma.subscriber.findMany({
        select: { email: true },
        orderBy: { createdAt: 'asc' },
        ...(args.limit ? { take: args.limit } : {}),
      });
      recipients = subs;
    }

    console.log(`Sending to ${recipients.length} recipient(s)...`);

    let ok = 0;
    let fail = 0;
    for (const r of recipients) {
      try {
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: r.email,
          subject: SUBJECT,
          text,
          html,
          replyTo: UNSUB_REPLY,
        });
        ok++;
        process.stdout.write(`  + ${r.email}\n`);
      } catch (e) {
        fail++;
        process.stderr.write(
          `  ! ${r.email} ${e instanceof Error ? e.message : String(e)}\n`,
        );
      }
      if (recipients.length > 1) {
        await new Promise((res) => setTimeout(res, SEND_THROTTLE_MS));
      }
    }

    console.log(`Done. sent=${ok} failed=${fail}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
