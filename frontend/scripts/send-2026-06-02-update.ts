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
  const text = [
    'AINPI 2026-06-02 — landscape becomes the front door, REAL Health audit framework published',
    '',
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
    'dozens of cross-source signals. The new homepage is a hierarchical',
    "treemap inspired by Andrej Karpathy's job-market visualizer",
    '(karpathy.ai/jobs). Every cell is one (state, specialty) tuple. Area',
    'scales with the count of active practitioners. Color is the audit',
    'metric you select.',
    '',
    'Six layers, each measuring a different dimension of accuracy:',
    '  - Completeness',
    '  - Cross-source agreement',
    '  - Currency (median days since lastUpdated)',
    '  - Endpoint reachability',
    '  - Federal integrity (LEIE / SAM / NPPES-deactivation flags)',
    '  - Specialty validity (NUCC ↔ CMS Medicare crosswalk)',
    '',
    'Tile-by toggle on top: group by Specialty → state (default) or',
    'State → specialty. Same data, different organizing dimension. Click',
    'any cell to open a side panel with all six scores side-by-side vs',
    'the national baseline, plus a sample of NPIs with primary-source',
    'verify links (NPPES Registry, OIG LEIE, SAM.gov) — no API key, no',
    'login.',
    '',
    'Cell-level numbers today are a deterministic synthetic seed, clearly',
    'marked on-page. The aggregation script (analysis/landscape.py) runs',
    'against BigQuery with the 100 GB per-query cap; the weekly-refresh',
    'cron replaces the seed with measured values. UI shipping first',
    'because the visualization design is what makes the audit substrate',
    'legible to regulators and to plans building toward 2028 compliance.',
    '',
    `Live: ${HOMEPAGE_URL}`,
    '',
    '2. The REAL Health Providers Act audit framework.',
    '',
    'HR 7148 § 6220 — the Requiring Enhanced & Accurate Lists of Health',
    'Providers Act — was signed into law on 2026-02-03. MA plans must',
    'verify every provider record every 90 days, remove departed providers',
    'within 5 business days, and submit an annual accuracy analysis to',
    'HHS. Starting plan year 2029, CMS publishes each plan accuracy score',
    'on cms.gov in machine-readable format.',
    '',
    'The hard part is not the cadence. It is the measurement methodology.',
    'CMS has not yet defined how the 2029 published score is computed.',
    'Three paradigms compete: field-level on plan-owned data (easy, easy',
    'to game), phone-audit secret shopper (catches ghost networks, scales',
    'poorly), and cross-source intersection (only paradigm a plan cannot',
    'grade itself on).',
    '',
    'AINPI implements the cross-source intersection. The landscape view',
    'shows it. The new policy brief at',
    `${POLICY_URL}`,
    'maps every § 6220 obligation to the existing AINPI signal that',
    'measures it, and ships copy-paste citation language for any submitter',
    'to the 2028 CMS scoring-methodology RFC. The 18 months between now',
    'and the 2028 compliance window are when the framework gets set.',
    '',
    "What's next:",
    '  - Real BQ run replaces the landscape seed (weekly-refresh cron)',
    '  - Per-MA-plan scoreboard (H26 4-payer probe generalized)',
    '  - MCP server: lookup_npi / cross_source_check / get_real_health_score',
    '  - Per-NPI history view (5-business-day removal audit instrument)',
    '  - Diff-since-last-release feed (quarterly compliance cadence)',
    '',
    `Full update: ${REPORT_URL}`,
    `Policy brief: ${POLICY_URL}`,
    `New homepage: ${HOMEPAGE_URL}`,
    `Map (was the homepage): ${HOMEPAGE_URL}map`,
    '',
    '— Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827; line-height: 1.55; background: #ffffff;">

  <!-- Header -->
  <div style="padding: 24px 28px 16px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #6b7280; text-transform: uppercase;">AINPI · 2026-06-02 update</div>
    <h1 style="font-size: 22px; margin: 6px 0 4px 0; color: #111827; line-height: 1.25;">
      Landscape becomes the front door.<br>
      <span style="color:#1e40af;">REAL Health audit framework published.</span>
    </h1>
    <div style="font-size: 13px; color: #6b7280;">2026-06-02 · methodology v0.7.1-draft · two coordinated releases</div>
  </div>

  <!-- 1. Landscape -->
  <div style="padding: 24px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="display: inline-block; padding: 3px 10px; background: #dbeafe; color: #1e40af; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      1 · The homepage is now a provider data landscape
    </div>
    <h2 style="font-size: 17px; margin: 4px 0 8px 0; color: #111827;">A hierarchical treemap of every state × specialty cell, scored across six audit dimensions</h2>
    <p style="font-size: 14px; color: #374151; margin: 0 0 8px 0;">
      The choropleth that lived at ainpi.dev for the past year answered one question well: how many federally-excluded NPIs are still listed per state. That question still matters and the map is still live at <a href="${HOMEPAGE_URL}map" style="color:#1e40af;">/map</a>.
    </p>
    <p style="font-size: 14px; color: #374151; margin: 0 0 12px 0;">
      But the choropleth was a single-finding view, and AINPI now produces dozens of cross-source signals. The new homepage is a hierarchical treemap inspired by Andrej Karpathy's <a href="https://karpathy.ai/jobs/" style="color:#1e40af;">US job-market visualizer</a>. Every cell is one (state, specialty) tuple; area scales with active practitioner count; color is the audit metric you select.
    </p>
    <ul style="font-size: 13px; color: #374151; margin: 0 0 12px 0; padding-left: 20px; line-height: 1.6;">
      <li><strong>Completeness</strong> — share with every § 6220-required field populated</li>
      <li><strong>Cross-source agreement</strong> — share findable in NPPES <em>and</em> a payer FHIR directory <em>and</em> PECOS</li>
      <li><strong>Currency</strong> — median days since <code>meta.lastUpdated</code> (the § 6220 90-day cadence fails above 90)</li>
      <li><strong>Endpoint reachability</strong> — share with a live FHIR endpoint on the managing org</li>
      <li><strong>Federal integrity</strong> — share NOT flagged by LEIE / SAM / NPPES-deactivation</li>
      <li><strong>Specialty validity</strong> — share whose NUCC taxonomy resolves cleanly against the CMS Medicare crosswalk</li>
    </ul>
    <p style="font-size: 13px; color: #4b5563; margin: 0;">
      Tile-by toggle on top: group by <em>Specialty → state</em> (default) or <em>State → specialty</em>. Click any cell to open a side panel with all six scores side-by-side vs the national baseline, plus a sample of NPIs with primary-source verify links to NPPES, LEIE, SAM. <strong>Cell-level numbers today are a deterministic synthetic seed</strong>, clearly marked on-page. The weekly-refresh cron replaces the seed with measured BigQuery output on the next pass.
    </p>
  </div>

  <!-- 2. REAL Health policy brief -->
  <div style="padding: 24px 28px; background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); border-bottom: 1px solid #bbf7d0;">
    <div style="display: inline-block; padding: 3px 10px; background: #dcfce7; color: #166534; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      2 · REAL Health Providers Act audit framework
    </div>
    <h2 style="font-size: 17px; margin: 4px 0 8px 0; color: #111827;">Mapping every § 6220 obligation to the AINPI signal that measures it</h2>
    <p style="font-size: 14px; color: #374151; margin: 0 0 8px 0;">
      HR 7148 § 6220 was signed 2026-02-03. MA plans must verify every record every 90 days, remove departed providers within 5 business days, and submit an annual accuracy analysis to HHS. <strong>Plan year 2028</strong> is the compliance start; <strong>plan year 2029</strong> is when CMS publishes each plan accuracy score on cms.gov in machine-readable format.
    </p>
    <p style="font-size: 14px; color: #374151; margin: 0 0 10px 0;">
      The hard part is not the cadence. It is the measurement methodology. CMS has not yet defined how the 2029 published score is computed. Three paradigms compete:
    </p>
    <ol style="font-size: 13px; color: #374151; margin: 0 0 10px 0; padding-left: 20px; line-height: 1.6;">
      <li><strong>Field-level on plan-owned data.</strong> Easy, easy to game.</li>
      <li><strong>Phone-audit secret shopper.</strong> Catches ghost networks, scales poorly.</li>
      <li><strong>Cross-source intersection.</strong> The only paradigm a plan cannot grade itself on.</li>
    </ol>
    <p style="font-size: 13px; color: #166534; margin: 0;">
      AINPI implements (3). The new policy brief at <a href="${POLICY_URL}" style="color:#166534;font-weight:600;">/real-health-providers</a> maps each obligation to the AINPI signal that measures it and ships <strong>copy-paste citation language for any submitter to the 2028 CMS scoring-methodology RFC</strong>. The 18 months between now and the 2028 compliance window are when the framework gets set.
    </p>
  </div>

  <!-- CTAs -->
  <div style="padding: 28px; text-align: center; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: #ffffff;">
    <div style="font-size: 16px; margin-bottom: 14px;">Three places to land</div>
    <a href="${HOMEPAGE_URL}" style="display: inline-block; padding: 12px 22px; background: #ffffff; color: #1e40af; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; margin: 4px;">
      Open the landscape →
    </a>
    <a href="${POLICY_URL}" style="display: inline-block; padding: 12px 22px; background: transparent; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; border: 1px solid #ffffff; margin: 4px;">
      Read the policy brief →
    </a>
    <a href="${REPORT_URL}" style="display: inline-block; padding: 12px 22px; background: transparent; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; border: 1px solid #ffffff; margin: 4px;">
      Full update →
    </a>
  </div>

  <!-- What's next -->
  <div style="padding: 24px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: #6b7280; text-transform: uppercase; margin-bottom: 10px;">What's next</div>
    <ul style="font-size: 13px; color: #4b5563; margin: 0; padding-left: 20px; line-height: 1.7;">
      <li>Real BigQuery run replaces the landscape seed (weekly-refresh cron)</li>
      <li>Per-MA-plan scoreboard (H26 4-payer probe generalized)</li>
      <li>MCP server: <code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:11px;">lookup_npi</code>, <code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:11px;">cross_source_check</code>, <code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:11px;">get_real_health_score</code></li>
      <li>Per-NPI history view (5-business-day removal audit instrument)</li>
      <li>Diff-since-last-release feed (quarterly compliance cadence)</li>
    </ul>
  </div>

  <!-- Footer -->
  <div style="padding: 20px 28px; font-size: 12px; color: #6b7280; text-align: center; border-top: 1px solid #e5e7eb;">
    <p style="margin: 0 0 6px 0;">— Eugene Vestel, FHIR IQ</p>
    <p style="margin: 0;">
      Reply to this email to unsubscribe or ask a question
      (<a href="mailto:${UNSUB_REPLY}" style="color:#6b7280;">${UNSUB_REPLY}</a>).
    </p>
    <p style="margin: 8px 0 0 0; font-size: 11px; color: #9ca3af;">
      <a href="https://ainpi.dev" style="color: #9ca3af;">ainpi.dev</a> · methodology v0.7.1-draft
    </p>
  </div>

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
