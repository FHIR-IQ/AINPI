/**
 * scripts/send-2026-06-10-newsletter.ts
 *
 * AINPI findings roundup newsletter — the federal provider directory (NDH
 * 2026-05-08 bulk export) by the numbers. Every figure below is copied from
 * the published /api/v1/findings/*.json outputs; no estimates added here.
 *
 * Same safety design as the other send scripts: dry-run by default, --confirm
 * to send, --email / --limit to narrow targeting, 250ms throttle. Sends to
 * every subscriber in the DB; pass --email you@example.com to target one.
 *
 * Required env:
 *   RESEND_API_KEY
 *   RESEND_FROM_ADDRESS (optional; defaults to onboarding@resend.dev)
 *   POSTGRES_PRISMA_URL
 *
 * Usage from frontend/:
 *   npx tsx scripts/send-2026-06-10-newsletter.ts                                   # dry-run
 *   npx tsx scripts/send-2026-06-10-newsletter.ts --email eugene.vestel@gmail.com --confirm
 *   npx tsx scripts/send-2026-06-10-newsletter.ts --limit 2 --confirm               # smoke test
 *   npx tsx scripts/send-2026-06-10-newsletter.ts --confirm                         # full send
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT = 'AINPI findings roundup — the federal provider directory by the numbers';
const FINDINGS_URL = 'https://ainpi.dev/findings';
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
      console.log('See header comment in scripts/send-2026-06-10-newsletter.ts');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function buildBody(): { text: string; html: string } {
  // Plain prose, no marketing language. Every number is from a published
  // /api/v1/findings/*.json against the 2026-05-08 NDH release.
  const text = [
    'A roundup of what AINPI is measuring in the federal provider directory',
    '(the CMS National Directory of Healthcare bulk export, 2026-05-08',
    'release). Every number here comes from a published finding; each links',
    'to its method notes and a sample you can verify against primary sources.',
    '',
    'Phone reachability (H43) — new',
    'Of 7,196,385 active practitioner records, 7,195,270 (99.98%) carry a',
    'phone number directly on the Practitioner record. The role/location',
    'traversal adds nothing; 1,115 have no phone on any path. On-record',
    'contact is phone and fax only (email and url are empty).',
    '',
    'Federally excluded providers still listed (H24, LEIE)',
    'Of 8,551 actively-excluded OIG LEIE NPIs, the directory contains 9,006',
    'matching appearances — 8,008 as Practitioner records, 998 as',
    'Organization records. Each is a 42 CFR 455.436 revalidation flag.',
    '',
    'SAM.gov exclusions (H25)',
    '4,517 distinct NPIs on SAM.gov\'s active exclusion list appear as NDH',
    'practitioners; 3,765 are still flagged active. The OPM debarment slice',
    'is federal-screening signal beyond LEIE alone.',
    '',
    'High-risk cohort (H23, composite score)',
    '64,156 of 7,441,211 practitioner NPIs (0.86%) score at or above the 1.0',
    'composite threshold; 8,002 hit the critical 1.5 threshold (LEIE- or',
    'SAM-excluded). Built only on 42 CFR 455.436 federal database checks.',
    '',
    'Excluded providers billing Medicare Part B (H40, CY 2023)',
    '194 of 6,840 currently-excluded NPIs billed Medicare Part B in CY 2023',
    '(est. $27.4M paid across 1,686 NPI/HCPCS/place-of-service rows). Four',
    'were billing strictly after their exclusion date; primary-source',
    'verification confirmed one (about $880K, eight years post-exclusion)',
    'and found the other three were SAM-NPI join false positives — which is',
    'why every cohort row carries a verify-yourself link.',
    '',
    'SSNs in the public file (H27)',
    '41 of 50 flagged Practitioner records contain a Social Security Number,',
    'independently confirming the 2026-04-30 Washington Post report. AINPI',
    'publishes counts and locations only, never the SSN values.',
    '',
    'Endpoints you can actually query (H28)',
    'Of 1,360,585 Endpoint resources, only 114,071 (8.4%) are machine-',
    'readable FHIR REST URLs. The other 91.6% are Direct Trust messaging',
    'addresses. 8.4% is the right denominator for any "find this provider\'s',
    'FHIR endpoint" feature.',
    '',
    'All findings, with charts, method notes, and verify-yourself samples:',
    FINDINGS_URL,
    '',
    'Everything is a research/educational measurement against public data;',
    'verify any number against the primary source before acting on it.',
    '',
    '- AINPI / FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const item = (title: string, body: string) => `
  <h2 style="font-size: 15px; font-weight: 600; margin: 22px 0 6px 0; color: #111827;">${title}</h2>
  <p style="margin: 0 0 12px 0;">${body}</p>`;

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; color: #1f2937; line-height: 1.55; padding: 20px;">

  <p style="margin: 0 0 16px 0;">A roundup of what AINPI is measuring in the federal provider directory (the CMS National Directory of Healthcare bulk export, 2026-05-08 release). Every number here comes from a published finding; each links to its method notes and a sample you can verify against primary sources.</p>
${item('Phone reachability (H43) — new', 'Of 7,196,385 active practitioner records, <strong>7,195,270 (99.98%)</strong> carry a phone number directly on the Practitioner record. The role/location traversal adds nothing; 1,115 have no phone on any path. On-record contact is phone and fax only (email and url are empty).')}
${item('Federally excluded providers still listed (H24, LEIE)', 'Of 8,551 actively-excluded OIG LEIE NPIs, the directory contains <strong>9,006 matching appearances</strong> — 8,008 as Practitioner records, 998 as Organization records. Each is a 42 CFR 455.436 revalidation flag.')}
${item('SAM.gov exclusions (H25)', '<strong>4,517</strong> distinct NPIs on SAM.gov&rsquo;s active exclusion list appear as NDH practitioners; 3,765 are still flagged active. The OPM debarment slice is federal-screening signal beyond LEIE alone.')}
${item('High-risk cohort (H23, composite score)', '<strong>64,156 of 7,441,211</strong> practitioner NPIs (0.86%) score at or above the 1.0 composite threshold; <strong>8,002</strong> hit the critical 1.5 threshold (LEIE- or SAM-excluded). Built only on 42 CFR 455.436 federal database checks.')}
${item('Excluded providers billing Medicare Part B (H40, CY 2023)', '194 of 6,840 currently-excluded NPIs billed Medicare Part B in CY 2023 (est. <strong>$27.4M</strong> paid across 1,686 NPI/HCPCS/place-of-service rows). Four were billing strictly after their exclusion date; primary-source verification confirmed one (about $880K, eight years post-exclusion) and found the other three were SAM-NPI join false positives — which is why every cohort row carries a verify-yourself link.')}
${item('SSNs in the public file (H27)', '<strong>41 of 50</strong> flagged Practitioner records contain a Social Security Number, independently confirming the 2026-04-30 Washington Post report. AINPI publishes counts and locations only, never the SSN values.')}
${item('Endpoints you can actually query (H28)', 'Of 1,360,585 Endpoint resources, only <strong>114,071 (8.4%)</strong> are machine-readable FHIR REST URLs. The other 91.6% are Direct Trust messaging addresses. 8.4% is the right denominator for any &ldquo;find this provider&rsquo;s FHIR endpoint&rdquo; feature.')}

  <p style="margin: 16px 0 12px 0;">All findings, with charts, method notes, and verify-yourself samples: <a href="${FINDINGS_URL}" style="color: #1d4ed8;">${FINDINGS_URL}</a></p>

  <p style="margin: 0 0 12px 0; color: #6b7280; font-size: 13px;">Everything is a research/educational measurement against public data; verify any number against the primary source before acting on it.</p>

  <p style="margin: 20px 0 8px 0;">- AINPI / FHIR IQ</p>

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

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set; aborting.');
    process.exit(1);
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

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
    // "include me" — make sure the maintainer address is on the list even if
    // it isn't a subscriber row.
    const ME = 'eugene.vestel@gmail.com';
    if (!recipients.includes(ME)) recipients.push(ME);
  }

  console.log(`Sending to ${recipients.length} recipient(s)...`);
  let ok = 0;
  let fail = 0;
  for (const to of recipients) {
    try {
      await resend.emails.send({
        from: FROM_ADDRESS,
        to,
        subject: SUBJECT,
        text,
        html,
        replyTo: UNSUB_REPLY,
      });
      ok++;
      process.stdout.write(`  + ${to}\n`);
    } catch (e) {
      fail++;
      process.stderr.write(`  ! ${to} ${e instanceof Error ? e.message : String(e)}\n`);
    }
    if (recipients.length > 1) await new Promise((r) => setTimeout(r, SEND_THROTTLE_MS));
  }
  console.log(`Done. ${ok} sent, ${fail} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
