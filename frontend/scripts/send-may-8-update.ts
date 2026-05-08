/**
 * scripts/send-may-8-update.ts
 *
 * 2026-05-08 subscriber update — first comparable-release deltas.
 *
 * Same safety design as send-may-update.ts (dry-run by default, --confirm
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
 *   npx tsx scripts/send-may-8-update.ts --email eugene.vestel@gmail.com
 *
 *   # 2. Preview to one address:
 *   npx tsx scripts/send-may-8-update.ts --email eugene.vestel@gmail.com --confirm
 *
 *   # 3. Smoke test on first 2 real subscribers:
 *   npx tsx scripts/send-may-8-update.ts --limit 2 --confirm
 *
 *   # 4. Full blast:
 *   npx tsx scripts/send-may-8-update.ts --confirm
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT =
  'AINPI 2026-05-08 update — Endpoint −73%, Location −61%, SSN exposures 46 → 41';
const REPORT_URL = 'https://ainpi.dev/reports/2026-05-08-update';
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
      console.log('See header comment in scripts/send-may-8-update.ts');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

interface DeltaRow {
  label: string;
  apr: number;
  may: number;
  /** Optional formatter for raw value display (default: comma-grouped). */
  fmt?: (n: number) => string;
}

function pctDelta(apr: number, may: number): string {
  if (apr === 0) return may === 0 ? 'flat' : '+∞';
  const d = ((may - apr) / apr) * 100;
  if (Math.abs(d) < 0.5) return 'flat';
  const sign = d > 0 ? '+' : '−';
  return `${sign}${Math.abs(d).toFixed(d > 50 || d < -50 ? 0 : 1)}%`;
}

function deltaColor(apr: number, may: number): string {
  const d = ((may - apr) / Math.max(1, apr)) * 100;
  if (Math.abs(d) < 1) return '#6b7280';
  return d > 0 ? '#2563eb' : '#dc2626';
}

function renderDeltaTable(rows: DeltaRow[]): string {
  const num = (r: DeltaRow, side: 'apr' | 'may'): string =>
    r.fmt ? r.fmt(r[side]) : r[side].toLocaleString();
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr>
        <td style="padding:8px 12px 8px 0;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;"></td>
        <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:right;border-bottom:1px solid #e5e7eb;">April</td>
        <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:right;border-bottom:1px solid #e5e7eb;">May</td>
        <td style="padding:8px 0 8px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;text-align:right;border-bottom:1px solid #e5e7eb;">Δ</td>
      </tr>
      ${rows
        .map(
          (r) => `
      <tr>
        <td style="padding:8px 12px 8px 0;color:#374151;border-bottom:1px solid #f3f4f6;">${escHtml(r.label)}</td>
        <td style="padding:8px 12px;text-align:right;color:#6b7280;font-variant-numeric:tabular-nums;border-bottom:1px solid #f3f4f6;">${num(r, 'apr')}</td>
        <td style="padding:8px 12px;text-align:right;color:#111827;font-weight:600;font-variant-numeric:tabular-nums;border-bottom:1px solid #f3f4f6;">${num(r, 'may')}</td>
        <td style="padding:8px 0 8px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:${deltaColor(r.apr, r.may)};border-bottom:1px solid #f3f4f6;">${pctDelta(r.apr, r.may)}</td>
      </tr>`,
        )
        .join('')}
    </table>
  `;
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function buildBody(): { text: string; html: string } {
  const shapeRows: DeltaRow[] = [
    { label: 'Practitioner', apr: 7_441_213, may: 7_441_211 },
    { label: 'Organization', apr: 3_603_262, may: 3_414_375 },
    { label: 'Location', apr: 3_494_239, may: 1_362_869 },
    { label: 'Endpoint', apr: 5_043_524, may: 1_360_585 },
    { label: 'PractitionerRole', apr: 7_178_732, may: 7_028_001 },
    { label: 'OrganizationAffiliation', apr: 439_599, may: 1_086_694 },
    { label: 'Total', apr: 27_200_569, may: 21_693_735 },
  ];

  const findingsRows: DeltaRow[] = [
    { label: 'NPI Luhn (combined)', apr: 3, may: 2 },
    { label: 'NPPES not-enumerated', apr: 95_000, may: 85_711 },
    { label: 'NPPES deactivated', apr: 445_000, may: 379_340 },
    { label: 'Org NPI duplicate excess', apr: 383_000, may: 1_410_754 },
    { label: 'Critical-risk cohort (≥ 1.5)', apr: 8_116, may: 8_115 },
    { label: 'OIG LEIE → NDH', apr: 7_990, may: 8_008 },
    { label: 'SAM → NDH', apr: 6_797, may: 6_829 },
    { label: 'Confirmed SSN exposures', apr: 46, may: 41 },
  ];

  const vaRows: DeltaRow[] = [
    { label: 'VA practitioners in NDH', apr: 141_660, may: 130_127 },
    { label: 'NPPES-deactivated, still listed', apr: 4_657, may: 4_090 },
    { label: 'Federally-excluded VA NPIs', apr: 125, may: 131 },
    {
      label: 'NPPES match rate',
      apr: 9939,
      may: 9950,
      fmt: (n) => `${(n / 100).toFixed(2)}%`,
    },
    {
      label: 'Org-NPI duplicate rate',
      apr: 4250,
      may: 4080,
      fmt: (n) => `${(n / 100).toFixed(2)}%`,
    },
  ];

  const text = [
    'AINPI 2026-05-08 update — first comparable-release deltas',
    '',
    'CMS pushed a new NDH bulk export today. AINPI re-ingested every',
    'resource and re-ran every H-series check. This is the first time',
    'we have two comparable releases under the same methodology, so',
    'the deltas are the news.',
    '',
    'Resource counts (April → May):',
    '  Practitioner              7,441,213 → 7,441,211   flat',
    '  Organization              3,603,262 → 3,414,375   −5.2%',
    '  Location                  3,494,239 → 1,362,869   −61%',
    '  Endpoint                  5,043,524 → 1,360,585   −73%',
    '  PractitionerRole          7,178,732 → 7,028,001   −2.1%',
    '  OrganizationAffiliation     439,599 → 1,086,694   +147%',
    '  TOTAL                    27,200,569 → 21,693,735  −20%',
    '',
    'Two source-side schema breaks AINPI caught:',
    '  1. NPI system URL changed from .../sid/us-npi to',
    '     .../NamingSystem/npi. Consumers string-matching on the old',
    '     URL just lost 7.4M practitioner NPIs without an error.',
    '  2. PractitionerRole.specialty codes shifted from CMS Medicare',
    '     format ("14-50") to NUCC taxonomy ("207R00000X").',
    '',
    'Three results worth pausing on:',
    '',
    '  • CMS partially scrubbed SSNs: 46 → 41 (-11%). Independent',
    '    verification of the 2026-04-30 WaPo finding still holds.',
    '    IL still leads the per-state list.',
    '',
    '  • Organization NPI duplicates jumped 4×: 383K → 1.41M excess.',
    '    The right org-count denominator is distinct NPI (1.999M),',
    '    not resource count (3.41M).',
    '',
    '  • H26 VA payer exposure: 2 of 131 in Cigna (down from 4 of',
    '    125). Movement is right; floor is not zero.',
    '',
    'Virginia briefing rebuilt:',
    '  130,127 VA practitioners (was 141,660).',
    '  99.50% NPPES match rate (was 99.39%).',
    '  4,090 NPPES-deactivated still listed (was 4,657).',
    '  131-NPI federally-excluded cohort (was 125).',
    '',
    `Read the full update: ${REPORT_URL}`,
    '',
    '— Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827; line-height: 1.55; background: #ffffff;">

  <!-- Header -->
  <div style="padding: 24px 28px 16px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #6b7280; text-transform: uppercase;">AINPI · 2026-05-08 update</div>
    <h1 style="font-size: 22px; margin: 6px 0 4px 0; color: #111827; line-height: 1.25;">
      First comparable-release deltas
    </h1>
    <div style="font-size: 13px; color: #6b7280;">2026-05-08 · methodology v0.6.0-draft · NDH release 2026-05-08</div>
  </div>

  <!-- Hero stat -->
  <div style="padding: 20px 28px; background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%); border-bottom: 1px solid #e5e7eb;">
    <div style="font-size: 13px; color: #1e3a8a; margin-bottom: 6px; font-weight: 600;">CMS pushed a new bulk export today.</div>
    <div style="font-size: 14px; color: #374151;">
      AINPI re-ingested every resource and re-ran every H-series check.
      This is the <strong>first time we have two comparable releases</strong>
      under the same methodology, so the release-to-release deltas are the news.
    </div>
  </div>

  <!-- Resource shape -->
  <div style="padding: 24px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="display: inline-block; padding: 3px 10px; background: #dbeafe; color: #1e40af; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      The shape changed
    </div>
    <h2 style="font-size: 18px; margin: 4px 0 8px 0; color: #111827;">Resource counts, April → May</h2>
    <p style="font-size: 14px; color: #4b5563; margin: 0 0 14px 0;">
      CMS appears to have de-duplicated multi-address Endpoints and Locations, and built out the OrganizationAffiliation graph.
    </p>
    ${renderDeltaTable(shapeRows)}
    <div style="font-size: 12px; color: #6b7280; margin-top: 14px;">
      Total resources dropped <strong style="color:#dc2626;">−20%</strong> while practitioners stayed flat.
      Anyone pinned to a specific release date should explicitly re-validate downstream metrics.
    </div>
  </div>

  <!-- Schema breaks -->
  <div style="padding: 24px 28px; background: #fef3c7; border-bottom: 1px solid #fde68a;">
    <div style="display: inline-block; padding: 3px 10px; background: #fde68a; color: #78350f; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      Schema breaks · consumer alert
    </div>
    <h2 style="font-size: 16px; margin: 4px 0 8px 0; color: #78350f;">Two silent breaks consumers should know about</h2>
    <ol style="font-size: 13px; color: #78350f; margin: 0; padding-left: 20px;">
      <li style="margin-bottom: 8px;">
        <strong>NPI identifier system URL changed</strong>
        from <code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">http://hl7.org/fhir/sid/us-npi</code>
        to <code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">http://terminology.hl7.org/NamingSystem/npi</code>.
        Consumers string-matching on the old URL just lost 7.4M practitioner NPIs without throwing an error.
      </li>
      <li>
        <strong><code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">PractitionerRole.specialty</code> codes shifted</strong>
        from CMS Medicare format (<code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">14-50</code>)
        to NUCC taxonomy (<code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">207R00000X</code>).
        Joins to the CMS Medicare crosswalk now look invalid even though the codes are valid NUCC.
      </li>
    </ol>
  </div>

  <!-- Findings deltas -->
  <div style="padding: 24px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="display: inline-block; padding: 3px 10px; background: #dcfce7; color: #166534; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      Findings · all 12 refreshed
    </div>
    <h2 style="font-size: 18px; margin: 4px 0 14px 0; color: #111827;">H-series, April → May</h2>
    ${renderDeltaTable(findingsRows)}

    <div style="margin-top: 22px; padding: 14px; background: #fef2f2; border: 1px solid #fee2e2; border-radius: 6px;">
      <div style="font-size: 13px; font-weight: 700; color: #991b1b; margin-bottom: 4px;">CMS partially scrubbed SSNs</div>
      <div style="font-size: 13px; color: #7f1d1d;">
        Confirmed SSN exposures dropped <strong>46 → 41</strong> (−11%) between releases. IL still leads with 13 (was 18). Independent verification of the 2026-04-30 Washington Post story holds; the leak is real, has been partially addressed, and is not yet remediated.
      </div>
    </div>

    <div style="margin-top: 12px; padding: 14px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px;">
      <div style="font-size: 13px; font-weight: 700; color: #9a3412; margin-bottom: 4px;">Organization NPI duplicates jumped 4×</div>
      <div style="font-size: 13px; color: #7c2d12;">
        From <strong>383K excess in April to 1.41M excess in May</strong>. If you're counting "how many physical organizations are in the network," the right denominator is the <strong>distinct NPI count (1.999M)</strong>, not the resource count (3.41M).
      </div>
    </div>
  </div>

  <!-- VA briefing -->
  <div style="padding: 24px 28px; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
    <div style="display: inline-block; padding: 3px 10px; background: #dcfce7; color: #166534; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      Virginia briefing · refreshed
    </div>
    <h2 style="font-size: 18px; margin: 4px 0 14px 0; color: #111827;">VA state slice, April → May</h2>
    ${renderDeltaTable(vaRows)}
    <div style="margin-top: 18px;">
      <a href="https://ainpi.dev/briefings/va" style="display: inline-block; padding: 10px 18px; background: #059669; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
        Read the Virginia briefing →
      </a>
      &nbsp;
      <a href="https://ainpi.dev/api/v1/states/va-cohort-critical.csv" style="display: inline-block; padding: 10px 18px; background: #ffffff; color: #059669; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; border: 1px solid #059669;">
        Download cohort CSV (131 NPIs)
      </a>
    </div>
  </div>

  <!-- Big CTA -->
  <div style="padding: 32px 28px; text-align: center; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: #ffffff;">
    <div style="font-size: 16px; margin-bottom: 12px;">Read the full subscriber update</div>
    <a href="${REPORT_URL}" style="display: inline-block; padding: 14px 28px; background: #ffffff; color: #1e40af; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 15px;">
      Open the 2026-05-08 update →
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
