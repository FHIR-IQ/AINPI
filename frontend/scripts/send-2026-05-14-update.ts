/**
 * scripts/send-2026-05-14-update.ts
 *
 * 2026-05-14 subscriber update — claims-side cross-audit shipped.
 *
 * Same safety design as send-may-8-update.ts (dry-run by default, --confirm
 * to send, --email/--limit narrow targeting, 250ms throttle).
 *
 * Required env:
 *   RESEND_API_KEY
 *   RESEND_FROM_ADDRESS (optional; defaults to onboarding@resend.dev)
 *   POSTGRES_PRISMA_URL
 *
 * Usage from frontend/:
 *
 *   # 1. Dry-run (no DB hit, prints body):
 *   npx tsx scripts/send-2026-05-14-update.ts --email eugene.vestel@gmail.com
 *
 *   # 2. Preview to one address:
 *   npx tsx scripts/send-2026-05-14-update.ts --email eugene.vestel@gmail.com --confirm
 *
 *   # 3. Smoke test on first 2 real subscribers:
 *   npx tsx scripts/send-2026-05-14-update.ts --limit 2 --confirm
 *
 *   # 4. Full blast:
 *   npx tsx scripts/send-2026-05-14-update.ts --confirm
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT =
  'AINPI 2026-05-14 update — claims-side cross-audit shipped (8 new findings)';
const REPORT_URL = 'https://ainpi.dev/reports/2026-05-14-update';
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
      console.log('See header comment in scripts/send-2026-05-14-update.ts');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

interface FindingRow {
  hyp: string;
  slug: string;
  headline: string;
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function renderFindingsTable(rows: FindingRow[]): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr>
        <td style="padding:8px 10px 8px 0;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">H</td>
        <td style="padding:8px 10px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Slug</td>
        <td style="padding:8px 0 8px 10px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Headline</td>
      </tr>
      ${rows
        .map(
          (r) => `
      <tr>
        <td style="padding:8px 10px 8px 0;color:#111827;font-weight:700;font-variant-numeric:tabular-nums;vertical-align:top;border-bottom:1px solid #f3f4f6;">${escHtml(r.hyp)}</td>
        <td style="padding:8px 10px;color:#1e40af;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;vertical-align:top;border-bottom:1px solid #f3f4f6;"><a href="https://ainpi.dev${escHtml(r.slug)}" style="color:#1e40af;text-decoration:none;">${escHtml(r.slug)}</a></td>
        <td style="padding:8px 0 8px 10px;color:#374151;vertical-align:top;border-bottom:1px solid #f3f4f6;">${escHtml(r.headline)}</td>
      </tr>`,
        )
        .join('')}
    </table>
  `;
}

function buildBody(): { text: string; html: string } {
  const findings: FindingRow[] = [
    {
      hyp: 'H29',
      slug: '/findings/excluded-paid-by-medicaid',
      headline:
        '0 of 28 VA-cohort NPIs paid by Medicaid strictly post-exclusion (full-window: $8.5M to 28 of 125)',
    },
    {
      hyp: 'H30a',
      slug: '/findings/excluded-billing-medicare-partb',
      headline:
        '0 of 8 VA-cohort NPIs billing Part B strictly post-exclusion in CY 2023',
    },
    {
      hyp: 'H30b',
      slug: '/findings/excluded-prescribing-medicare-partd',
      headline:
        '0 of 10 VA-cohort NPIs prescribing Part D strictly post-exclusion (6 were opioid prescribers full-window)',
    },
    {
      hyp: 'H31',
      slug: '/findings/deactivated-still-billing',
      headline:
        '3 of 1,495 VA-state NPPES-deactivated NPIs billed Medicaid/Medicare after their deactivation date',
    },
    {
      hyp: 'H32',
      slug: '/findings/excluded-receiving-industry-payments',
      headline:
        '198 of 8,619 LEIE/SAM-active NPIs received industry payments strictly post-exclusion ($167K; full-window: 350, $3.8M)',
    },
    {
      hyp: 'H33',
      slug: '/findings/dmepos-excluded',
      headline:
        '0 of 63,988 DMEPOS suppliers (DY 2023) are on LEIE ∪ SAM active',
    },
    {
      hyp: 'H35',
      slug: '/findings/nh-hospice-hh-ownership-flags',
      headline:
        '0 confirmed-NPI / 1,779 candidate-demographic matches across SNF + hospice + HHA + hospital owners (17 candidate for VA)',
    },
    {
      hyp: 'H36',
      slug: '/findings/ndh-completeness-gap',
      headline:
        '99.99984% NDH completeness against material Medicare Part B billers (only 2 of 1,259,343 individual NPIs absent)',
    },
  ];

  const text = [
    'AINPI 2026-05-14 update — claims-side cross-audit shipped',
    '',
    'Last week was the directory. This week is the money.',
    '',
    'In one week AINPI shipped 8 new findings (H29-H36) that join the',
    'directory-side cohort to Medicaid spending, Medicare Part B/D billing,',
    'NPPES-deactivated-still-billing, Open Payments, DMEPOS, nursing-home',
    'ownership disclosures, and NDH completeness against the Medicare Part B',
    'universe.',
    '',
    'The pattern is consistent: when federal exclusion takes effect, federal-',
    "program payment stops in the data. Strict-post-exclusion reads '0'",
    'across H29, H30a, H30b, and the strict subset of H32 dominates the',
    'dollar volume. The payment gate is mostly holding for the active cohort.',
    'What persists is the directory-side problem — NPPES-deactivated NPIs',
    'still listed in NDH, federally-excluded NPIs still appearing in NDH bulk',
    'export, ownership candidates needing verification.',
    '',
    'The 8 new findings:',
    '',
    '  H29   Medicaid spending             — 0/28 strict (full: $8.5M to 28/125)',
    '  H30a  Medicare Part B               — 0/8 strict (CY 2023)',
    '  H30b  Medicare Part D               — 0/10 strict (6 opioid full-window)',
    '  H31   NPPES-deactivated × billing   — 3 of 1,495 VA-state',
    '  H32   Open Payments × exclusions    — 198/350 strict ($167K vs $3.8M)',
    '  H33   DMEPOS × exclusions           — 0 of 63,988',
    '  H35   SNF/Hospice/HHA/Hospital      — 0 confirmed / 1,779 candidate (17 VA)',
    '  H36   NDH completeness gap          — 99.99984% (2 of 1.26M absent)',
    '',
    'Two methodology corrections shipped this week:',
    '',
    '  #1: Strict post-exclusion attribution.',
    '      H23 cohort exporter now carries per-NPI exclusion dates. Earlier',
    "      headlines framed H29's $8.5M as a § 455.436 signal — most was",
    '      pre-exclusion legitimate billing. The strict-post-exclusion column',
    '      is the regulatory headline; full-window is sidecar.',
    '',
    '  #2: H35 Stage B via PPEF cross-walk.',
    '      The first H35 release reported 0 demographic matches. That zero',
    '      was a STRUCTURAL NULL — owner STATE is 100% empty for individual',
    "      owners in CMS's All Owners files, and the v1 match joined on this",
    '      empty column. Stage B introduces the CMS Medicare Fee-For-Service',
    '      Public Provider Enrollment File (PPEF, 2.47M individual NPIs) as a',
    '      cross-walk: PECOS_ASCT_CNTL_ID → NPI for Tier 1, ENRLMT_ID → STATE',
    '      for Tier 2. Tier 1 returns 0 (exclusion forces revocation, so most',
    '      excluded NPIs are not in PPEF). Tier 2 returns 1,779 nationally.',
    '',
    'The compounding signal:',
    '  BREWER, STEVEN (NPI 1801070313) appears in 5 independent public-data',
    '  joins now: H23 + H24 + H26 + H29 + H30a + H30b. Single-source flags',
    '  are noise; multi-source flags converge on real cases.',
    '',
    'For state Medicaid offices (SMD-response deadline 2026-05-23):',
    '  AINPI now closes 3 of 4 § 455.436 federal database checks (NPPES +',
    "  LEIE + SAM; SSA-DMF stays out of scope). Virginia's MMIS-ready",
    '  deliverables are at /api/v1/states/va/h{29..35}-*.csv with verification',
    '  URLs on every row.',
    '',
    `Read the full update: ${REPORT_URL}`,
    '',
    "What's next:",
    '  - H34 (POS-deactivated × NPPES-active) still blocked on CCN ↔ NPI',
    '    cross-walk. If anyone has a line on an authorized CMS source, reply.',
    '  - Second-state pilot: SC remains a candidate.',
    '',
    '— Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827; line-height: 1.55; background: #ffffff;">

  <!-- Header -->
  <div style="padding: 24px 28px 16px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #6b7280; text-transform: uppercase;">AINPI · 2026-05-14 update</div>
    <h1 style="font-size: 22px; margin: 6px 0 4px 0; color: #111827; line-height: 1.25;">
      Last week, the directory.<br>
      <span style="color:#1e40af;">This week, the money.</span>
    </h1>
    <div style="font-size: 13px; color: #6b7280;">2026-05-14 · methodology v0.6.1-draft · 8 new findings shipped</div>
  </div>

  <!-- Hero -->
  <div style="padding: 20px 28px; background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%); border-bottom: 1px solid #e5e7eb;">
    <div style="font-size: 13px; color: #1e3a8a; margin-bottom: 6px; font-weight: 600;">Claims-side cross-audit shipped (H29–H36).</div>
    <div style="font-size: 14px; color: #374151;">
      8 new findings join AINPI's directory-side cohort to Medicaid spending, Medicare Part&nbsp;B&nbsp;/&nbsp;Part&nbsp;D billing, NPPES-deactivated billers, Open Payments, DMEPOS, nursing-home ownership disclosures, and NDH completeness against the Medicare Part&nbsp;B universe.
      <strong>Pattern:</strong> when federal exclusion takes effect, federal-program payment stops in the data — the directory still lists them.
    </div>
  </div>

  <!-- 8 findings table -->
  <div style="padding: 24px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="display: inline-block; padding: 3px 10px; background: #dbeafe; color: #1e40af; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      8 findings · all pre-registered, all published
    </div>
    <h2 style="font-size: 18px; margin: 4px 0 14px 0; color: #111827;">The new findings</h2>
    ${renderFindingsTable(findings)}
  </div>

  <!-- Methodology corrections -->
  <div style="padding: 24px 28px; background: #fef3c7; border-bottom: 1px solid #fde68a;">
    <div style="display: inline-block; padding: 3px 10px; background: #fde68a; color: #78350f; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      Two methodology corrections shipped
    </div>
    <ol style="font-size: 13px; color: #78350f; margin: 0; padding-left: 20px;">
      <li style="margin-bottom: 10px;">
        <strong>Strict post-exclusion attribution.</strong>
        H23 cohort exporter now carries per-NPI <code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">leie_excldate</code>, <code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">sam_active_date</code>, <code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">nppes_deactivation_date</code>. Earlier framings of "$8.5M paid 2018-2024 somewhere" were capturing pre-exclusion legitimate billing, not § 455.436 violations. The strict-post-exclusion column became the regulatory headline; full-window is sidecar.
      </li>
      <li>
        <strong>H35 Stage B via PPEF cross-walk.</strong>
        v1 reported "0 demographic matches" — that was a <em>structural null</em>. Owner STATE is 100% empty for individuals in the All Owners files; the v1 join collided on the empty key. Stage B introduces the CMS Medicare Fee-For-Service Public Provider Enrollment File (2.47M individual NPIs) as a cross-walk: <code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">PECOS_ASCT_CNTL_ID</code> → <code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">NPI</code> for Tier 1, <code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">ENRLMT_ID</code> → <code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">STATE_CD</code> for Tier 2. Result: 0 confirmed-NPI (exclusion forces Medicare revocation), 1,779 candidate-demographic.
      </li>
    </ol>
  </div>

  <!-- Compounding signal -->
  <div style="padding: 24px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="display: inline-block; padding: 3px 10px; background: #fef2f2; color: #991b1b; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      Compounding-signal pattern
    </div>
    <h2 style="font-size: 16px; margin: 4px 0 8px 0; color: #111827;">One name in 5 independent public-data joins</h2>
    <p style="font-size: 14px; color: #374151; margin: 0 0 8px 0;">
      <strong>BREWER, STEVEN</strong> (NPI 1801070313) — H23 (federally excluded) + H24 (active on OIG LEIE) + H26 (Cigna payer directory) + H29 (Medicaid full-window) + H30a + H30b (Medicare full-window). Each individual signal is a low-priority flag; the cross-product is the high-priority triage target.
    </p>
    <p style="font-size: 13px; color: #6b7280; margin: 0;">
      Single-source flags are noise. Multi-source flags converge on real cases. The cross-audit roadmap is how that converging happens at scale.
    </p>
  </div>

  <!-- SMD-response value -->
  <div style="padding: 24px 28px; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
    <div style="display: inline-block; padding: 3px 10px; background: #dcfce7; color: #166534; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      State SMD-response deadline · 2026-05-23
    </div>
    <h2 style="font-size: 16px; margin: 4px 0 8px 0; color: #111827;">3 of 4 § 455.436 federal database checks closed</h2>
    <p style="font-size: 14px; color: #374151; margin: 0 0 14px 0;">
      NPPES (H10–H13) + OIG LEIE (H24 + H29 / H30a / H30b / H32 / H35) + SAM.gov (H25 + the same cross-audit). SSA-DMF stays out of scope due to restricted access. The cross-audit findings are the public-facing metrics for Element 2 of the strategy submission.
    </p>
    <p style="font-size: 13px; color: #4b5563; margin: 0 0 16px 0;">
      Virginia's MMIS-ready deliverables (per-cohort CSVs at <code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:11px;">/api/v1/states/va/h{29..35}-*.csv</code>) carry LEIE / SAM / NPPES portal verification URLs on every row. Cohort dates travel with claim dates so strict-post-exclusion attribution is the regulatory frame, not the noisy full-window number.
    </p>
    <a href="https://ainpi.dev/briefings/va" style="display: inline-block; padding: 10px 18px; background: #059669; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
      Read the Virginia briefing →
    </a>
  </div>

  <!-- Big CTA -->
  <div style="padding: 32px 28px; text-align: center; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: #ffffff;">
    <div style="font-size: 16px; margin-bottom: 12px;">Read the full subscriber update</div>
    <a href="${REPORT_URL}" style="display: inline-block; padding: 14px 28px; background: #ffffff; color: #1e40af; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 15px;">
      Open the 2026-05-14 update →
    </a>
  </div>

  <!-- Footer -->
  <div style="padding: 20px 28px; font-size: 12px; color: #6b7280; text-align: center; border-top: 1px solid #e5e7eb;">
    <p style="margin: 0 0 6px 0;">— Eugene Vestel, FHIR IQ</p>
    <p style="margin: 0;">
      Reply to this email to unsubscribe or ask a question
      (<a href="mailto:${UNSUB_REPLY}" style="color:#6b7280;">${UNSUB_REPLY}</a>).
    </p>
    <p style="margin: 8px 0 0 0; font-size: 11px; color: #9ca3af;">
      <a href="https://ainpi.dev" style="color: #9ca3af;">ainpi.dev</a>
      ·
      <a href="https://github.com/FHIR-IQ/AINPI" style="color: #9ca3af;">github.com/FHIR-IQ/AINPI</a>
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
    console.log('');
    console.log(`HTML body length: ${html.length} chars`);
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
        console.error(
          `  [${i + 1}/${recipients.length}] ${to} ERROR ${result.error.name}: ${result.error.message}`,
        );
      } else {
        ok++;
        console.log(
          `  [${i + 1}/${recipients.length}] ${to} sent (id=${result.data?.id ?? '?'})`,
        );
      }
    } catch (e) {
      err++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `  [${i + 1}/${recipients.length}] ${to} EXCEPTION ${msg}`,
      );
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
