/**
 * scripts/send-2026-08-01-update.ts
 *
 * 2026-08-01 release blast. H46 published (state Medicaid provider-directory
 * coverage and liveness), federated payer registry baseline, the measured
 * answer to the workgroup Location.telecom question, and the continuing
 * release gap (85 days).
 *
 * Same safety design as the prior send scripts (dry-run by default,
 * --confirm to send, --email / --limit narrow targeting, 250ms throttle,
 * in-blast dedup, plain semantic HTML with no marketing chrome).
 *
 * Reviewed by the copy-reviewer subagent before send.
 *
 * Required env:
 *   RESEND_API_KEY
 *   RESEND_FROM_ADDRESS (optional; defaults to onboarding@resend.dev)
 *   POSTGRES_PRISMA_URL
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT =
  'AINPI 2026-08-01: half the states have a Medicaid directory you can actually open';
const REPORT_URL = 'https://ainpi.dev/reports/2026-08-01-update';
const FINDING_URL = 'https://ainpi.dev/findings/state-medicaid-directory-coverage';
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
      console.log('See header comment in scripts/send-2026-08-01-update.ts');
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
    'No NDH release for 85 days. But the public repositories around the',
    'directory have been busy, and two of them turned out to be measurable.',
    '',
    'H46: state Medicaid provider directories, listed and live',
    '',
    'CMS maintains a directory-of-directories: one row per state and territory,',
    "each either a link to that state's public Medicaid provider directory or",
    'the literal string "Not available". Section 5006 of the 21st Century Cures',
    'Act, codified at 42 U.S.C. 1396a(a)(83), requires each state providing',
    'medical assistance on a fee-for-service basis or through a primary care',
    'case-management system to publish a directory of physicians on the state',
    "agency's public website.",
    '',
    'Two layers, both measured:',
    '',
    'Layer 1, coverage. 32 of the 51 jurisdictions (50 states plus DC) carry a',
    'directory URL. 19 states do not. None of the 5 territories do.',
    '',
    'Layer 2, liveness. Of those 32 listed URLs, 27 answered an ordinary',
    'unauthenticated request. Five did not:',
    '',
    '  - Arizona: connection times out',
    '  - Delaware: redirect loop, never resolves',
    '  - Kansas: redirect loop, never resolves',
    '  - Maine: returns 404',
    '  - Ohio: returns 500',
    '',
    'So 27 of 51, 52.9%, have a federally-catalogued Medicaid provider',
    'directory that a member of the public can actually open.',
    '',
    'Both failure modes are cheap to fix and both are publicly visible. A',
    'missing row needs a URL sent to CMS; a broken row needs the link updated.',
    'Every jurisdiction, URL and outcome ships as CSV next to the finding.',
    '',
    'A measurement mistake worth reporting',
    '',
    'The first version of this probe reported eight failures, not five. Three',
    'of those (Iowa, Rhode Island, West Virginia) were our own TLS stack',
    'rejecting certificate chains a normal client accepts without complaint.',
    'Publishing that run would have named three states as broken when they are',
    'fine. The probe now runs through curl, follows redirects, and treats a 403',
    'or 429 as "refused an identified crawler" rather than "down".',
    '',
    'The federated payer registry, before payers arrive',
    '',
    'The Federated Payer Identifier proposal now has real contents. At commit',
    'aca76142 (2026-07-24):',
    '',
    '  - 174 well-known payer index files, all Medicare Advantage. The',
    '    commercial, ERISA, marketplace and Medicaid managed-care buckets hold',
    '    only placeholder READMEs.',
    '  - 140 distinct payer legal names, 174 contracts, and 2,557 distinct',
    '    contract-and-plan pairs enumerated.',
    '  - 0 files published by a payer. Every file has a null copied_from_url.',
    '  - 0 endpoints. Not one file carries an endpoint entry yet.',
    '',
    'A scaffold with 2,557 plans enumerated and zero endpoints behind them. It',
    'is a useful baseline precisely because it is empty: when payers begin',
    'publishing, the delta is measurable from the same repository.',
    '',
    'The location-phone path returns nothing, and that is deliberate',
    '',
    'A question in the public workgroup asked why phone numbers cannot be',
    'connected to locations in the NDH files. We measured exactly this in H43:',
    'across all 7,196,385 active practitioners, zero are reachable by phone',
    'through the PractitionerRole to Location traversal. Not sparse. Zero.',
    'Meanwhile 99.98% carry a phone directly on the Practitioner record.',
    '',
    'CMS gave the reason in the same channel: Location.telecom is 0..* in FHIR,',
    'so it is optional, and the upstream NPPES address-to-phone associations',
    'are unreliable enough that publishing them would propagate bad data.',
    '',
    'That is a defensible call. For anyone building against these files: read',
    'Practitioner.telecom. The traversal adds nothing.',
    '',
    'Still no release',
    '',
    'The manifest still points at the 2026-05-07 file set. CMS said in the',
    'public NDH workgroup channel, in a notice covering the week of June 29 to',
    'July 3, that directory.cms.gov had entered a maintenance period while an',
    'enhanced version is prepared. That reads as a planned pause rather than a',
    'stalled pipeline.',
    '',
    'One limit worth stating: "not listed" measures the CMS catalog, not the',
    'state. A state may publish a directory this list has not captured. H46 is',
    'a completeness measure of the federal directory-of-directories, not a',
    'compliance judgement about any state.',
    '',
    `Full update: ${REPORT_URL}`,
    `Finding, with the per-jurisdiction CSV: ${FINDING_URL}`,
    '',
    '- Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.55; padding: 20px;">

  <p style="margin: 0 0 16px 0;">No NDH release for 85 days. But the public repositories around the directory have been busy, and two of them turned out to be measurable.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">H46: state Medicaid provider directories, listed and live</h2>

  <p style="margin: 0 0 12px 0;">CMS maintains a directory-of-directories: one row per state and territory, each either a link to that state's public Medicaid provider directory or the literal string "Not available". Section 5006 of the 21st Century Cures Act, codified at 42 U.S.C. 1396a(a)(83), requires each state providing medical assistance on a fee-for-service basis or through a primary care case-management system to publish a directory of physicians on the state agency's public website.</p>

  <p style="margin: 0 0 12px 0;"><strong>Layer 1, coverage.</strong> 32 of the 51 jurisdictions (50 states plus DC) carry a directory URL. 19 states do not. None of the 5 territories do.</p>

  <p style="margin: 0 0 12px 0;"><strong>Layer 2, liveness.</strong> Of those 32 listed URLs, 27 answered an ordinary unauthenticated request. Five did not:</p>

  <ul style="margin: 0 0 12px 0; padding-left: 22px;">
    <li>Arizona: connection times out</li>
    <li>Delaware: redirect loop, never resolves</li>
    <li>Kansas: redirect loop, never resolves</li>
    <li>Maine: returns 404</li>
    <li>Ohio: returns 500</li>
  </ul>

  <p style="margin: 0 0 12px 0;">So <strong>27 of 51, 52.9%, have a federally-catalogued Medicaid provider directory that a member of the public can actually open.</strong></p>

  <p style="margin: 0 0 16px 0;">Both failure modes are cheap to fix and both are publicly visible. A missing row needs a URL sent to CMS; a broken row needs the link updated. Every jurisdiction, URL and outcome ships as CSV next to the finding.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">A measurement mistake worth reporting</h2>

  <p style="margin: 0 0 16px 0;">The first version of this probe reported eight failures, not five. Three of those (Iowa, Rhode Island, West Virginia) were our own TLS stack rejecting certificate chains a normal client accepts without complaint. Publishing that run would have named three states as broken when they are fine. The probe now runs through curl, follows redirects, and treats a 403 or 429 as "refused an identified crawler" rather than "down".</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">The federated payer registry, before payers arrive</h2>

  <p style="margin: 0 0 12px 0;">The Federated Payer Identifier proposal now has real contents. At commit <code>aca76142</code> (2026-07-24):</p>

  <ul style="margin: 0 0 12px 0; padding-left: 22px;">
    <li><strong>174</strong> well-known payer index files, all Medicare Advantage. The commercial, ERISA, marketplace and Medicaid managed-care buckets hold only placeholder READMEs.</li>
    <li><strong>140</strong> distinct payer legal names, <strong>174</strong> contracts, and <strong>2,557</strong> distinct contract-and-plan pairs enumerated.</li>
    <li><strong>0</strong> files published by a payer. Every file has a null <code>copied_from_url</code>.</li>
    <li><strong>0</strong> endpoints. Not one file carries an endpoint entry yet.</li>
  </ul>

  <p style="margin: 0 0 16px 0;">A scaffold with 2,557 plans enumerated and zero endpoints behind them. It is a useful baseline precisely because it is empty: when payers begin publishing, the delta is measurable from the same repository.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">The location-phone path returns nothing, and that is deliberate</h2>

  <p style="margin: 0 0 12px 0;">A question in the public workgroup asked why phone numbers cannot be connected to locations in the NDH files. We measured exactly this in H43: across all 7,196,385 active practitioners, <strong>zero</strong> are reachable by phone through the <code>PractitionerRole</code> to <code>Location</code> traversal. Not sparse. Zero. Meanwhile 99.98% carry a phone directly on the Practitioner record.</p>

  <p style="margin: 0 0 12px 0;">CMS gave the reason in the same channel: <code>Location.telecom</code> is 0..* in FHIR, so it is optional, and the upstream NPPES address-to-phone associations are unreliable enough that publishing them would propagate bad data.</p>

  <p style="margin: 0 0 16px 0;">That is a defensible call. For anyone building against these files: read <code>Practitioner.telecom</code>. The traversal adds nothing.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">Still no release</h2>

  <p style="margin: 0 0 16px 0;">The manifest still points at the 2026-05-07 file set. CMS said in the public NDH workgroup channel, in a notice covering the week of June 29 to July 3, that directory.cms.gov had entered a maintenance period while an enhanced version is prepared. That reads as a planned pause rather than a stalled pipeline.</p>

  <p style="margin: 0 0 16px 0; color: #6b7280; font-size: 13px;">One limit worth stating: "not listed" measures the CMS catalog, not the state. A state may publish a directory this list has not captured. H46 is a completeness measure of the federal directory-of-directories, not a compliance judgement about any state.</p>

  <p style="margin: 0 0 8px 0;">Full update: <a href="${REPORT_URL}" style="color: #1d4ed8;">${REPORT_URL}</a></p>
  <p style="margin: 0 0 16px 0;">Finding, with the per-jurisdiction CSV: <a href="${FINDING_URL}" style="color: #1d4ed8;">${FINDING_URL}</a></p>

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
  console.log(`URLs:    ${REPORT_URL} | ${FINDING_URL}`);
  console.log('---');
  console.log(text);
  console.log('---');

  if (!args.confirm) {
    console.log('[DRY RUN] Pass --confirm to actually send.');
    if (args.email) console.log(`         (Would target only: ${args.email})`);
    else if (args.limit) console.log(`         (Would target first ${args.limit} subscribers)`);
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

    // Hard guard against duplicate sends: collapse case/whitespace variants
    // so the same mailbox can never receive two copies in one blast, even if
    // the subscriber table somehow holds `Gene@x` and `gene@x`. Keeps the
    // first occurrence (preserves createdAt ordering).
    const seenNorm = new Set<string>();
    const before = recipients.length;
    recipients = recipients.filter((r) => {
      const key = r.email.trim().toLowerCase();
      if (seenNorm.has(key)) return false;
      seenNorm.add(key);
      return true;
    });
    if (recipients.length < before) {
      console.log(
        `Deduped ${before - recipients.length} duplicate recipient(s) (case/whitespace variants).`,
      );
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
