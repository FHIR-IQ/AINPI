/**
 * scripts/send-2026-06-09-update.ts
 *
 * 2026-06-09 release blast. H43 (practitioner phone-number reachability)
 * pre-registered. Same safety design as send-2026-06-04-update.ts
 * (dry-run by default, --confirm to send, --email / --limit narrow
 * targeting, 250ms throttle, plain semantic HTML with no marketing chrome).
 *
 * Required env:
 *   RESEND_API_KEY
 *   RESEND_FROM_ADDRESS (optional; defaults to onboarding@resend.dev)
 *   POSTGRES_PRISMA_URL
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT =
  'AINPI 2026-06-09: can you associate a practitioner with a phone number?';
const REPORT_URL = 'https://ainpi.dev/reports/2026-06-09-update';
const FINDING_URL = 'https://ainpi.dev/findings/practitioner-phone-reachability';
const SCRIPT_URL =
  'https://github.com/FHIR-IQ/AINPI/blob/main/analysis/h43_practitioner_phone.py';
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
  // Plain prose, no em-dashes, no marketing language. Reviewed by the
  // copy-reviewer subagent (.claude/agents/copy-reviewer.md) before send.
  const text = [
    'Short answer for anyone who asked: yes, you can associate a',
    'practitioner in the NDH bulk export with a phone number. But "the',
    'phone number" is not one field, and where it lives is the actual',
    'finding.',
    '',
    'This update pre-registers a new metric, H43, practitioner phone-number',
    'reachability, and ships the compute script. Live cell numbers land on',
    'the next weekly-refresh.',
    '',
    'The question is sharper than it looks',
    '',
    "In FHIR R4 and the NDH IG, a practitioner's phone can sit in three",
    'different resources:',
    '',
    "  1. Practitioner.telecom: on the individual's own record.",
    '  2. PractitionerRole.telecom: on the role that ties the practitioner',
    '     to an organization.',
    '  3. Location.telecom: on the place the practitioner practices,',
    '     reached by following PractitionerRole.location to Location.',
    '',
    'NPPES (the upstream source of roughly 90% of these fields) keeps',
    'practice phone on the location, not the individual. So if you read',
    'Practitioner.telecom and find it empty, that is not usually a data',
    'quality defect. It means the phone is one or two hops away, on the',
    'role or the location.',
    '',
    'If you build a "call this provider" feature against Practitioner.telecom',
    'alone, it will look like the federal directory has almost no phone',
    'numbers. That conclusion would be wrong, and H43 exists to measure',
    'exactly how wrong.',
    '',
    'What H43 measures',
    '',
    '  Denominator: active Practitioner resources in the pinned NDH release',
    '  (about 7.44M at 2026-05-08).',
    '',
    '  Numerator: distinct active practitioners reachable by a phone',
    "  telecom entry (system='phone') via any of the three paths, unioned",
    '  and then intersected back to the active set so the numerator can',
    '  never exceed the denominator and dangling references drop out.',
    '',
    '  The headline split is the actual answer for an integrator: phone on',
    '  the Practitioner record versus phone only reachable by traversing',
    "  PractitionerRole then Location. That split tells you which resource",
    '  to read.',
    '',
    'Why pre-registered and not a number tonight',
    '',
    'The aggregation script (analysis/h43_practitioner_phone.py) is',
    "committed and runs against BigQuery with the project's 100 GB",
    'per-query cap. It is wired into the weekly-refresh cron, which',
    'regenerates the finding JSON and commits it to main. Until that run',
    'lands, the finding page shows the pre-registration record (null',
    'hypothesis, denominator, data source, method) with no fabricated',
    'numbers. Same register-before-numbers discipline every AINPI finding',
    'follows.',
    '',
    'One caveat to hold constant across releases',
    '',
    'The 2026-05-08 release deduped Location resources by 61% versus April.',
    'Because path 3 (phone via the referenced location) depends on the',
    'Location table, that dedup mechanically lowers location-path',
    'reachability across the release boundary. It is a change in how CMS',
    'packaged the data, not a loss of contact information. Any cross-release',
    'comparison of H43 has to hold it constant. The finding notes say so on',
    'the page, and the provenance doc records the method an auditor can',
    'reproduce.',
    '',
    'The takeaway',
    '',
    'Can you associate practitioners with phone numbers in NDH? Yes, by',
    'reading the right resource. The phone is rarely on Practitioner.telecom;',
    'it is overwhelmingly on the role and the location. H43 turns that from',
    'a folk-knowledge gotcha into a measured, reproducible number you can',
    'cite.',
    '',
    `Full update: ${REPORT_URL}`,
    `Finding page: ${FINDING_URL}`,
    `Compute script: ${SCRIPT_URL}`,
    '',
    '- Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.55; padding: 20px;">

  <p style="margin: 0 0 16px 0;">Short answer for anyone who asked: yes, you can associate a practitioner in the NDH bulk export with a phone number. But "the phone number" is not one field, and where it lives is the actual finding.</p>

  <p style="margin: 0 0 16px 0;">This update pre-registers a new metric, H43, practitioner phone-number reachability, and ships the compute script. Live cell numbers land on the next weekly-refresh.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">The question is sharper than it looks</h2>

  <p style="margin: 0 0 12px 0;">In FHIR R4 and the NDH IG, a practitioner's phone can sit in three different resources:</p>

  <ol style="margin: 0 0 12px 0; padding-left: 22px;">
    <li><code>Practitioner.telecom</code>: on the individual's own record.</li>
    <li><code>PractitionerRole.telecom</code>: on the role that ties the practitioner to an organization.</li>
    <li><code>Location.telecom</code>: on the place the practitioner practices, reached by following <code>PractitionerRole.location</code> to <code>Location</code>.</li>
  </ol>

  <p style="margin: 0 0 12px 0;">NPPES (the upstream source of roughly 90% of these fields) keeps practice phone on the location, not the individual. So if you read <code>Practitioner.telecom</code> and find it empty, that is not usually a data quality defect. It means the phone is one or two hops away, on the role or the location.</p>

  <p style="margin: 0 0 16px 0;">If you build a "call this provider" feature against <code>Practitioner.telecom</code> alone, it will look like the federal directory has almost no phone numbers. That conclusion would be wrong, and H43 exists to measure exactly how wrong.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">What H43 measures</h2>

  <ul style="margin: 0 0 12px 0; padding-left: 22px;">
    <li><strong>Denominator:</strong> active <code>Practitioner</code> resources in the pinned NDH release (about 7.44M at 2026-05-08).</li>
    <li><strong>Numerator:</strong> distinct active practitioners reachable by a phone telecom entry (<code>system='phone'</code>) via any of the three paths, unioned and then intersected back to the active set so the numerator can never exceed the denominator and dangling references drop out.</li>
    <li><strong>The headline split</strong> is the actual answer for an integrator: phone on the Practitioner record versus phone only reachable by traversing PractitionerRole then Location. That split tells you which resource to read.</li>
  </ul>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">Why pre-registered and not a number tonight</h2>

  <p style="margin: 0 0 16px 0;">The aggregation script (<a href="${SCRIPT_URL}" style="color: #1d4ed8;"><code>analysis/h43_practitioner_phone.py</code></a>) is committed and runs against BigQuery with the project's 100 GB per-query cap. It is wired into the weekly-refresh cron, which regenerates the finding JSON and commits it to main. Until that run lands, the <a href="${FINDING_URL}" style="color: #1d4ed8;">finding page</a> shows the pre-registration record (null hypothesis, denominator, data source, method) with no fabricated numbers. Same register-before-numbers discipline every AINPI finding follows.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">One caveat to hold constant across releases</h2>

  <p style="margin: 0 0 16px 0;">The 2026-05-08 release deduped <code>Location</code> resources by 61% versus April. Because path 3 (phone via the referenced location) depends on the Location table, that dedup mechanically lowers location-path reachability across the release boundary. It is a change in how CMS packaged the data, not a loss of contact information. Any cross-release comparison of H43 has to hold it constant. The provenance doc records the method an auditor can reproduce.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">The takeaway</h2>

  <p style="margin: 0 0 16px 0;">Can you associate practitioners with phone numbers in NDH? Yes, by reading the right resource. The phone is rarely on <code>Practitioner.telecom</code>; it is overwhelmingly on the role and the location. H43 turns that from a folk-knowledge gotcha into a measured, reproducible number you can cite.</p>

  <p style="margin: 0 0 8px 0;">Full update: <a href="${REPORT_URL}" style="color: #1d4ed8;">${REPORT_URL}</a></p>
  <p style="margin: 0 0 16px 0;">Finding page: <a href="${FINDING_URL}" style="color: #1d4ed8;">${FINDING_URL}</a></p>

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
