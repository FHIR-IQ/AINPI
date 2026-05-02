/**
 * scripts/send-may-update.ts
 *
 * Enriched May 2026 subscriber update — H26, H27, and the VA briefing —
 * with inline visual blocks (HTML+CSS bar charts, hero stat cards).
 *
 * Visuals are HTML+CSS rather than inline SVG because Outlook desktop
 * blocks SVGs while CSS background-color + width-percentage divs render
 * everywhere. Pixel-precise but email-safe.
 *
 * Safety design (same as the earlier send-update-email script):
 *   - DEFAULT: dry-run, prints recipient list + rendered subject.
 *   - --confirm to actually send.
 *   - --email <addr> targets a single address (overrides DB list).
 *   - --limit <N> caps to first N rows (sorted by created_at asc).
 *   - 250ms throttle between sends.
 *
 * Required env:
 *   RESEND_API_KEY                — Resend API key
 *   RESEND_FROM_ADDRESS           — optional, defaults to onboarding@resend.dev
 *   POSTGRES_PRISMA_URL           — Supabase pooler URL
 *
 * Usage from frontend/:
 *
 *   # 1. Dry-run rendered to one address (no DB hit, fastest preview):
 *   npx tsx scripts/send-may-update.ts --email eugene.vestel@gmail.com
 *
 *   # 2. Send a preview to yourself only:
 *   npx tsx scripts/send-may-update.ts --email eugene.vestel@gmail.com --confirm
 *
 *   # 3. Smoke-test on first 2 real subscribers:
 *   npx tsx scripts/send-may-update.ts --limit 2 --confirm
 *
 *   # 4. Full blast (requires fhiriq.com verified on Resend):
 *   npx tsx scripts/send-may-update.ts --confirm
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT =
  'AINPI May 2026 update — 63 SSNs in the federal NDH bulk export + 4 of 125 in Cigna';
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
      console.log('See header comment in scripts/send-may-update.ts');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

// ---- Visual helpers (email-safe HTML) ------------------------------------

interface BarRow {
  label: string;
  value: number;
  /** Optional color override; defaults to brand blue. */
  color?: string;
  /** Optional secondary text shown to the right of the value. */
  context?: string;
}

function renderBarChart(
  rows: BarRow[],
  opts?: { max?: number; barColor?: string; widthPx?: number },
): string {
  const max = opts?.max ?? Math.max(1, ...rows.map((r) => r.value));
  const defaultColor = opts?.barColor ?? '#2563eb';
  const widthPx = opts?.widthPx ?? 320;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
      ${rows
        .map((r) => {
          const pct = Math.max(2, Math.round((r.value / max) * 100));
          const color = r.color || defaultColor;
          return `
        <tr>
          <td style="padding:4px 12px 4px 0;font-size:13px;color:#374151;white-space:nowrap;width:140px;vertical-align:middle;">${escHtml(r.label)}</td>
          <td style="padding:4px 0;vertical-align:middle;">
            <div style="background:#f3f4f6;border-radius:3px;height:18px;width:${widthPx}px;max-width:100%;position:relative;">
              <div style="background:${color};height:18px;border-radius:3px;width:${pct}%;"></div>
            </div>
          </td>
          <td style="padding:4px 0 4px 12px;font-size:13px;color:#111827;font-variant-numeric:tabular-nums;font-weight:600;text-align:right;width:60px;vertical-align:middle;">${r.value.toLocaleString()}</td>
          ${
            r.context
              ? `<td style="padding:4px 0 4px 8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:middle;">${escHtml(r.context)}</td>`
              : ''
          }
        </tr>`;
        })
        .join('')}
    </table>
  `;
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// ---- Body builder --------------------------------------------------------

function buildBody(): { text: string; html: string } {
  // H26 per-payer match data (4 of 125 in Cigna).
  const h26Rows: BarRow[] = [
    { label: 'Cigna', value: 4, color: '#dc2626', context: 'of 125' },
    { label: 'Humana', value: 0, color: '#9ca3af', context: 'of 125' },
    { label: 'UnitedHealthcare', value: 0, color: '#9ca3af', context: 'of 125' },
    { label: 'Molina Complete Care', value: 0, color: '#9ca3af', context: 'of 125' },
  ];

  // H27 top-10 state SSN exposures.
  const h27Rows: BarRow[] = [
    { label: 'IL', value: 20 },
    { label: 'OH', value: 7 },
    { label: '(unknown)', value: 5 },
    { label: 'NJ', value: 2 },
    { label: 'TX', value: 2 },
    { label: 'WA', value: 2 },
    { label: 'AZ', value: 2 },
    { label: 'FL', value: 2 },
    { label: 'GA', value: 2 },
    { label: 'MI', value: 2 },
  ];

  // SSN exposure JSON-location breakdown.
  const ssnLocRows: BarRow[] = [
    { label: 'qualification.identifier.value', value: 42, color: '#dc2626', context: 'state-license slot (dashed)' },
    { label: 'name.given (undashed 9-digit)', value: 17, color: '#dc2626', context: 'literal name token' },
    { label: 'name.given (dashed)', value: 4, color: '#dc2626', context: 'literal name token' },
    { label: 'NPI-as-name (data integrity)', value: 21, color: '#f59e0b', context: '10-digit NPI as name' },
  ];

  // Plain-text version (always shipped alongside HTML).
  const text = [
    'AINPI May 2026 update',
    '',
    'Two new findings + the Virginia State Medicaid briefing landed',
    'this week. Top-line numbers:',
    '',
    'H27 — Social Security Numbers exposed in the NDH bulk export',
    '   AINPI independently verified and extended the 2026-04-30',
    '   Washington Post finding.',
    '   • 63 confirmed SSN exposures in the public 2026-04-09 NDH bulk',
    '     - 42 in qualification.identifier.value (state-license slot)',
    '     - 17 undashed-9-digit name tokens',
    '     - 4  dashed in name.given',
    '   • 21 NPI-as-name data-integrity violations',
    '   • Top states: IL 20, OH 7, NJ/TX/WA/AZ/FL/GA/MI/PA/TN at 2 each',
    '',
    'H26 — VA payer-directory exposure (4-MCO sweep)',
    '   125 federally-excluded VA NPIs queried against:',
    '     - Humana                       0 of 125',
    '     - Cigna                        4 of 125 ← only matches',
    '     - UnitedHealthcare (UHC + UHC Community Plan + OptumRx)',
    '                                    0 of 125',
    '     - Molina Complete Care         0 of 125',
    '   2 of 6 VA Medicaid MCOs are now wired directly.',
    '',
    'Virginia State Medicaid briefing',
    '   Prepared for the 2026-05-04 DMAS review meeting.',
    '   141,660 VA practitioners; 99.39% NPPES match rate;',
    '   4,657 NPPES-deactivated still listed; 42.5% organization',
    '   duplicate rate.',
    '',
    'High-risk cohort v0.4.0',
    '   5 signals; closes 3 of 4 § 455.436 federal database checks',
    '   (NPPES, OIG LEIE, SAM.gov; SSA-DMF remains restricted-access).',
    '',
    `Read the full update: ${REPORT_URL}`,
    '',
    '— Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  // HTML version — visual cards + bar charts.
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827; line-height: 1.55; background: #ffffff;">

  <!-- Header -->
  <div style="padding: 24px 28px 16px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #6b7280; text-transform: uppercase;">AINPI · May 2026 update</div>
    <h1 style="font-size: 22px; margin: 6px 0 4px 0; color: #111827; line-height: 1.25;">
      Two new findings, one state briefing, and a stronger cohort
    </h1>
    <div style="font-size: 13px; color: #6b7280;">2026-05-02 · methodology v0.6.0-draft · NDH release 2026-04-09</div>
  </div>

  <!-- Hero stat block -->
  <div style="padding: 20px 28px; background: linear-gradient(135deg, #fef2f2 0%, #fff7ed 100%); border-bottom: 1px solid #e5e7eb;">
    <div style="display: block; margin-bottom: 14px;">
      <div style="font-size: 44px; font-weight: 800; color: #dc2626; line-height: 1; letter-spacing: -0.02em;">63</div>
      <div style="font-size: 13px; color: #7f1d1d; margin-top: 4px;">confirmed Social Security Numbers in the public 2026-04-09 NDH bulk export</div>
    </div>
    <div style="font-size: 12px; color: #92400e; padding-top: 12px; border-top: 1px solid #fde68a;">
      AINPI replicates and extends the
      <a href="https://www.washingtonpost.com/health/2026/04/30/medicare-portal-social-security-numbers-exposed/" style="color: #92400e; text-decoration: underline;">2026-04-30 Washington Post finding</a>
      with a precise count + JSON-location breakdown.
    </div>
  </div>

  <!-- H27 — SSN exposure detail -->
  <div style="padding: 24px 28px;">
    <div style="display: inline-block; padding: 3px 10px; background: #fee2e2; color: #991b1b; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      H27 · Critical
    </div>
    <h2 style="font-size: 18px; margin: 4px 0 4px 0; color: #111827;">Social Security Numbers exposed in the NDH bulk export</h2>
    <p style="font-size: 14px; color: #4b5563; margin: 0 0 18px 0;">
      Two-pass BigQuery scan over <code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:12px;">cms_npd.practitioner</code> for the dashed SSN format and 9-digit-only name tokens. False-positive guard against international phone formats.
    </p>

    <div style="font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px;">By JSON location</div>
    ${renderBarChart(ssnLocRows, { max: 50, barColor: '#dc2626', widthPx: 280 })}

    <div style="font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; margin: 22px 0 8px 0;">Top 10 states (confirmed exposures)</div>
    ${renderBarChart(h27Rows, { max: 22, barColor: '#dc2626', widthPx: 280 })}

    <div style="font-size: 12px; color: #6b7280; margin-top: 14px;">
      Privacy posture: AINPI publishes counts, JSON locations, NPIs (professional IDs), and state breakdowns — never the SSN values themselves, even though they remain in the public NDH bulk file.
    </div>

    <div style="margin-top: 18px;">
      <a href="https://ainpi.dev/findings/pii-exposure-ndh" style="display: inline-block; padding: 10px 18px; background: #dc2626; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
        See the H27 finding →
      </a>
    </div>
  </div>

  <!-- H26 — VA payer-directory exposure -->
  <div style="padding: 24px 28px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
    <div style="display: inline-block; padding: 3px 10px; background: #dbeafe; color: #1e40af; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      H26 · Methodology demo
    </div>
    <h2 style="font-size: 18px; margin: 4px 0 4px 0; color: #111827;">VA payer-directory exposure (4-MCO sweep)</h2>
    <p style="font-size: 14px; color: #4b5563; margin: 0 0 14px 0;">
      125-NPI federally-excluded VA cohort cross-referenced against 4 publicly-queryable payer FHIR provider directories. Cigna is the only carrier with hits.
    </p>

    <div style="font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px;">Per-payer matches</div>
    ${renderBarChart(h26Rows, { max: 6, widthPx: 280 })}

    <div style="font-size: 12px; color: #6b7280; margin-top: 14px;">
      <strong style="color:#374151;">2 of the 6 VA Medicaid MCOs</strong> are now wired directly: UHC Community Plan (via Optum FLEX) and Molina Complete Care (via Azure APIM → Sapphire360). Anthem HealthKeepers Plus, Aetna BH of VA, Sentara, and Virginia Premier are Stage B fast-follow.
    </div>

    <div style="margin-top: 18px;">
      <a href="https://ainpi.dev/findings/mco-exposure-va" style="display: inline-block; padding: 10px 18px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
        See the H26 finding →
      </a>
    </div>
  </div>

  <!-- VA briefing -->
  <div style="padding: 24px 28px; border-top: 1px solid #e5e7eb;">
    <div style="display: inline-block; padding: 3px 10px; background: #dcfce7; color: #166534; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      Virginia briefing
    </div>
    <h2 style="font-size: 18px; margin: 4px 0 12px 0; color: #111827;">Prepared for the 2026-05-04 DMAS review meeting</h2>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin-bottom: 14px;">
      <tr>
        <td style="padding: 10px 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-right: none; border-radius: 6px 0 0 6px; width: 50%; vertical-align: top;">
          <div style="font-size: 22px; font-weight: 800; color: #111827; line-height: 1;">141,660</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">VA practitioners in NDH</div>
        </td>
        <td style="padding: 10px 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0 6px 6px 0; width: 50%; vertical-align: top;">
          <div style="font-size: 22px; font-weight: 800; color: #111827; line-height: 1;">99.39%</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">match active NPPES record</div>
        </td>
      </tr>
      <tr><td style="height: 8px;"></td><td></td></tr>
      <tr>
        <td style="padding: 10px 12px; background: #fef3c7; border: 1px solid #fde68a; border-right: none; border-radius: 6px 0 0 6px; vertical-align: top;">
          <div style="font-size: 22px; font-weight: 800; color: #92400e; line-height: 1;">4,657</div>
          <div style="font-size: 12px; color: #92400e; margin-top: 4px;">NPPES-deactivated, still listed in NDH</div>
        </td>
        <td style="padding: 10px 12px; background: #fef3c7; border: 1px solid #fde68a; border-radius: 0 6px 6px 0; vertical-align: top;">
          <div style="font-size: 22px; font-weight: 800; color: #92400e; line-height: 1;">42.50%</div>
          <div style="font-size: 12px; color: #92400e; margin-top: 4px;">organization NPI-duplicate rate (35,348 excess of 83,163)</div>
        </td>
      </tr>
    </table>

    <div style="margin-top: 14px;">
      <a href="https://ainpi.dev/briefings/va" style="display: inline-block; padding: 10px 18px; background: #059669; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
        Read the Virginia briefing →
      </a>
    </div>
  </div>

  <!-- High-risk cohort -->
  <div style="padding: 24px 28px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
    <h2 style="font-size: 16px; margin: 0 0 8px 0; color: #111827;">High-risk cohort v0.4.0</h2>
    <p style="font-size: 14px; color: #4b5563; margin: 0 0 12px 0;">
      Composite score now combines <strong>5 signals</strong> (LEIE, SAM, NPPES match, NPPES deactivation, Luhn) and closes
      <strong>3 of 4</strong> federal database checks under 42 CFR § 455.436. SSA-DMF remains restricted-access.
    </p>
    <p style="font-size: 13px; color: #6b7280; margin: 0;">
      <a href="https://ainpi.dev/findings/high-risk-cohort" style="color: #2563eb; text-decoration: underline;">High-risk cohort finding →</a>
    </p>
  </div>

  <!-- Big CTA -->
  <div style="padding: 32px 28px; text-align: center; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: #ffffff;">
    <div style="font-size: 16px; margin-bottom: 12px;">Read the full subscriber update</div>
    <a href="${REPORT_URL}" style="display: inline-block; padding: 14px 28px; background: #ffffff; color: #1e40af; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 15px;">
      Open the May 2026 update →
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

// ---- Main ----------------------------------------------------------------

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
