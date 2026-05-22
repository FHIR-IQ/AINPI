/**
 * scripts/send-2026-05-22-update.ts
 *
 * 2026-05-22 subscriber update — H40 published, one confirmed strict-post-
 * exclusion case, three SAM-NPI-join false positives caught by primary-
 * source verification.
 *
 * Same safety design as send-2026-05-14-update.ts (dry-run by default,
 * --confirm to send, --email/--limit narrow targeting, 250ms throttle).
 *
 * Required env:
 *   RESEND_API_KEY
 *   RESEND_FROM_ADDRESS (optional; defaults to onboarding@resend.dev)
 *   POSTGRES_PRISMA_URL
 *
 * Usage from frontend/:
 *
 *   # 1. Dry-run (no DB hit, prints body):
 *   npx tsx scripts/send-2026-05-22-update.ts --email eugene.vestel@gmail.com
 *
 *   # 2. Preview to one address:
 *   npx tsx scripts/send-2026-05-22-update.ts --email eugene.vestel@gmail.com --confirm
 *
 *   # 3. Smoke test on first 2 real subscribers:
 *   npx tsx scripts/send-2026-05-22-update.ts --limit 2 --confirm
 *
 *   # 4. Full blast:
 *   npx tsx scripts/send-2026-05-22-update.ts --confirm
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT =
  'AINPI 2026-05-22 update — H40 published, 1 confirmed case, 3 SAM-NPI false positives caught';
const REPORT_URL = 'https://ainpi.dev/reports/2026-05-22-update';
const ARTICLE_URL = 'https://ainpi.dev/articles/eight-years-post-exclusion';
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
      console.log('See header comment in scripts/send-2026-05-22-update.ts');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function buildBody(): { text: string; html: string } {
  const text = [
    'AINPI 2026-05-22 update — H40, the confirmed case, and the QA discipline',
    '',
    'Two weeks ago we shipped the claims-side cross-audit. This week we',
    "sharpened H30a — federally-excluded NPIs billing Medicare Part B —",
    'into the unit of work State Medicaid PI offices actually write',
    'recoupment letters against: per-(NPI, HCPCS, place-of-service).',
    '',
    'Cross-audit surfaced 4 candidate strict-post-exclusion NPIs nationally.',
    'Primary-source verification confirms 1 and reveals 3 SAM-NPI-join false',
    'positives. The methodology is working — the LEIE / SAM / NPPES URLs on',
    'every cohort row are what caught the false positives.',
    '',
    'The confirmed case (NPI 1285673012, MIRANDA, EDUARDO, TX):',
    '  - OIG LEIE Section 1128(a)(1) (mandatory, conviction of program-',
    "    related crimes), excluded 2015-06-18, never reinstated.",
    "  - SAM.gov reciprocal HHS exclusion, indefinite, active.",
    "  - NPPES NPI active, last updated 2025-06-24, MD / Hematology &",
    '    Oncology, Laredo, TX.',
    '  - CY 2023 Medicare Part B: ~$880,000 across 35 HCPCS codes,',
    '    dominated by oncology administration (J9271 pembrolizumab $610K,',
    '    J0897 denosumab $100K, 96413 chemo IV, multiple infusion codes).',
    '  - That is eight years post-exclusion.',
    '',
    'The three false positives:',
    '  - NPI 1982713020 (cohort: CULLEN, EDWARD, RI) — SAM record points',
    '    to 3 unrelated individuals (ORATE / CARLOS / FLORES). Not in LEIE.',
    '  - NPI 1518952506 (cohort: KEARNEY, TIMOTHY, PA) — SAM record points',
    '    to BROWN, TERRI CASS. Not in LEIE.',
    '  - NPI 1376654624 (cohort: DESAI, BAKUL, NJ) — SAM record points to',
    '    FOLTS, JESSICA NICOLE. Not in LEIE.',
    '',
    'Cohort-builder fix path: add a NPPES name-match validation step to',
    "the SAM-NPI join. If the SAM-row name and the NPI's NPPES name don't",
    'share a token, downgrade the row to "needs review" rather than',
    '"critical". Tracked as a separate PR; downstream H29 / H30a / H30b /',
    'H32 / H40 will rerun on the cleaned cohort.',
    '',
    'H42 result — null hypothesis supported.',
    '  Zero federally-excluded NPIs show >=80% of post-exclusion Medicare',
    '  Part B services billed under telehealth-specific HCPCS codes. Two',
    '  honest readings: (a) screening is working, or (b) the post-',
    '  exclusion cohort billing Part B is too small (4 candidates / 1',
    '  confirmed) for the threshold to register.',
    '',
    'H41 (specialty billing drift) deferred. BigQuery NPPES iterator',
    'stalled mid-query on the first run; rerunning after switching to a',
    'precomputed NPPES taxonomy dump. Numbers in the next update.',
    '',
    'For state Medicaid PI offices:',
    '  Per-state CSVs at /api/v1/states/<state>/h40-excluded-partb-by-hcpcs.csv',
    '  Each row is one (NPI, HCPCS, POS) tuple — the unit a recoupment',
    '  letter writes against. Filter to post_exclusion_2023_billing=yes,',
    '  then verify each name against LEIE + SAM + NPPES before referring.',
    '',
    `Full update: ${REPORT_URL}`,
    `Long-form article: ${ARTICLE_URL}`,
    '',
    "What's next:",
    '  - SAM-NPI false-positive fix (cohort-builder PR)',
    '  - H41 retry on NPPES precomputed dump',
    '  - CY 2024 by-Provider-AND-Service file (CMS published 2026-05-21,',
    '    one day after CY 2023 was the methodology baseline)',
    '',
    '— Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827; line-height: 1.55; background: #ffffff;">

  <!-- Header -->
  <div style="padding: 24px 28px 16px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #6b7280; text-transform: uppercase;">AINPI · 2026-05-22 update</div>
    <h1 style="font-size: 22px; margin: 6px 0 4px 0; color: #111827; line-height: 1.25;">
      H40 published.<br>
      <span style="color:#1e40af;">1 confirmed case, 3 SAM-NPI false positives.</span>
    </h1>
    <div style="font-size: 13px; color: #6b7280;">2026-05-22 · methodology v0.7.0-draft · per-claim recoupment unit</div>
  </div>

  <!-- Hero: the confirmed case -->
  <div style="padding: 20px 28px; background: linear-gradient(135deg, #fef2f2 0%, #fff7ed 100%); border-bottom: 1px solid #fde68a;">
    <div style="display: inline-block; padding: 3px 10px; background: #fef2f2; color: #991b1b; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      Primary-source confirmed
    </div>
    <h2 style="font-size: 17px; margin: 4px 0 8px 0; color: #111827;">$880,000 in CY 2023 Medicare Part B, 8 years post-exclusion</h2>
    <p style="font-size: 14px; color: #374151; margin: 0 0 8px 0;">
      <strong>Eduardo Siria Miranda, MD</strong> (NPI 1285673012, Laredo TX). OIG LEIE Section 1128(a)(1) mandatory exclusion since 2015-06-18, never reinstated. SAM.gov reciprocal exclusion, indefinite, active. NPPES NPI active, last updated 2025-06-24. CY 2023 Medicare Part B billing dominated by oncology administration — pembrolizumab (J9271) $610,117, denosumab (J0897) $100,703, chemotherapy administration (96413), multiple infusion codes.
    </p>
    <p style="font-size: 13px; color: #6b7280; margin: 0;">
      Verifiable in three clicks: <a href="https://exclusions.oig.hhs.gov/" style="color:#991b1b;">LEIE</a> · <a href="https://sam.gov/search/?index=ex" style="color:#991b1b;">SAM</a> · <a href="https://npiregistry.cms.hhs.gov/provider-view/1285673012" style="color:#991b1b;">NPPES</a>.
    </p>
  </div>

  <!-- What H40 sharpens -->
  <div style="padding: 24px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="display: inline-block; padding: 3px 10px; background: #dbeafe; color: #1e40af; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      H40 — the per-claim recoupment unit
    </div>
    <h2 style="font-size: 17px; margin: 4px 0 8px 0; color: #111827;">From "billed Part B for $X" → "billed J9271 14,205 times"</h2>
    <p style="font-size: 14px; color: #374151; margin: 0 0 8px 0;">
      Source: CMS Medicare Physician &amp; Other Practitioners by Provider AND Service (RY2025, CY 2023, 3.06 GB, 9.66M rows). One pass, 38 seconds. Per-state CSVs at <code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:11px;">/api/v1/states/&lt;state&gt;/h40-excluded-partb-by-hcpcs.csv</code> — one row per (NPI, HCPCS, place-of-service), the exact shape a recoupment letter writes against.
    </p>
    <p style="font-size: 13px; color: #4b5563; margin: 0;">
      <strong>National numbers:</strong> 194 distinct NPIs matched full-window of 6,840 cohort; 4 candidate strict-post-exclusion (= 1 confirmed + 3 SAM-NPI false positives); $27.4M est. paid full-window across 41 states. H40 ≤ H30a by 12 NPIs / $3.4M because of CMS's &lt;11-beneficiary cell suppression in the granular file (documented).
    </p>
  </div>

  <!-- The 3 false positives -->
  <div style="padding: 24px 28px; background: #fef3c7; border-bottom: 1px solid #fde68a;">
    <div style="display: inline-block; padding: 3px 10px; background: #fde68a; color: #78350f; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      Cohort-builder QA finding
    </div>
    <h2 style="font-size: 17px; margin: 4px 0 8px 0; color: #78350f;">3 of 4 strict-post candidates failed primary-source verification</h2>
    <p style="font-size: 13px; color: #78350f; margin: 0 0 10px 0;">
      The SAM.gov Public Extract sometimes carries an NPI field that doesn't actually belong to the excluded party — clerical errors at SAM data-entry, or NPIs reused across unrelated records. The AINPI cohort builder currently treats any non-empty SAM <code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">npi</code> field as a match without cross-checking NPPES name.
    </p>
    <ul style="font-size: 13px; color: #78350f; margin: 0 0 10px 0; padding-left: 20px;">
      <li><strong>NPI 1982713020</strong> (cohort: CULLEN, EDWARD, RI) → SAM record points to <em>ORATE / CARLOS / FLORES</em> (3 different individuals). Not in LEIE.</li>
      <li><strong>NPI 1518952506</strong> (cohort: KEARNEY, TIMOTHY, PA) → SAM record points to <em>BROWN, TERRI CASS</em>. Not in LEIE.</li>
      <li><strong>NPI 1376654624</strong> (cohort: DESAI, BAKUL, NJ) → SAM record points to <em>FOLTS, JESSICA NICOLE</em>. Not in LEIE.</li>
    </ul>
    <p style="font-size: 13px; color: #78350f; margin: 0;">
      <strong>Fix path:</strong> NPPES-name-match validation in the SAM join, downgrade non-matching rows to <code style="background:#fffbeb;padding:1px 4px;border-radius:3px;font-size:11px;">bucket=needs-review</code>. Tracked as separate PR; H29/H30a/H30b/H32/H40 will rerun on the cleaned cohort. <strong>The methodology is working</strong> — primary-source URLs on every row are what caught these.
    </p>
  </div>

  <!-- H42 null result -->
  <div style="padding: 24px 28px; border-bottom: 1px solid #e5e7eb;">
    <div style="display: inline-block; padding: 3px 10px; background: #dcfce7; color: #166534; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; margin-bottom: 10px;">
      H42 — null hypothesis supported
    </div>
    <h2 style="font-size: 16px; margin: 4px 0 8px 0; color: #111827;">Zero telehealth-dominant excluded billers</h2>
    <p style="font-size: 13px; color: #4b5563; margin: 0;">
      Zero federally-excluded NPIs in CY 2023 show ≥80% of post-exclusion Part B services billed under telehealth-specific HCPCS codes (G2010, G2012, G2061-G2063, 99421-99423, 99441-99443, G0425-G0427, G3002-G3003). Two honest readings: (a) federal exclusion screening for telehealth-specific billing is working, or (b) the post-exclusion cohort is too small (1 confirmed) for the dominant-share threshold to register. H42 is a sharpened sub-test; H40 is the headline.
    </p>
  </div>

  <!-- Big CTAs -->
  <div style="padding: 28px; text-align: center; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: #ffffff;">
    <div style="font-size: 16px; margin-bottom: 14px;">Two reads — pick your appetite</div>
    <a href="${REPORT_URL}" style="display: inline-block; padding: 12px 22px; background: #ffffff; color: #1e40af; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; margin: 4px;">
      Full subscriber update →
    </a>
    <a href="${ARTICLE_URL}" style="display: inline-block; padding: 12px 22px; background: transparent; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; border: 1px solid #ffffff; margin: 4px;">
      Long-form article →
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
      <a href="https://ainpi.dev" style="color: #9ca3af;">ainpi.dev</a> · methodology v0.7.0-draft · provenance: <code style="font-size:10px;">docs/methodology/runs/2026-05-22-h40-h41-h42-baseline.md</code>
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
  console.log(`URL:     ${REPORT_URL}`);
  console.log(`Article: ${ARTICLE_URL}`);
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
