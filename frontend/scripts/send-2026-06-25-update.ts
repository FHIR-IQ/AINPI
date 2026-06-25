/**
 * scripts/send-2026-06-25-update.ts
 *
 * 2026-06-25 release blast. H44 (endpoint metadata coverage vs the HTE
 * submission spec) published. Same safety design as the prior send scripts
 * (dry-run by default, --confirm to send, --email / --limit narrow
 * targeting, 250ms throttle, plain semantic HTML with no marketing chrome).
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
  'AINPI 2026-06-25: what is actually in an NDH endpoint record?';
const REPORT_URL = 'https://ainpi.dev/reports/2026-06-25-update';
const FINDING_URL = 'https://ainpi.dev/findings/endpoint-metadata-coverage';
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
      console.log('See header comment in scripts/send-2026-06-25-update.ts');
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
    'The provider-directory community is working through how endpoint data',
    "should be submitted and structured. Fred Trotter's HTE data-release spec",
    'asks submitters for nine endpoint-metadata fields. Before that design',
    'hardens, one question is worth measuring: of those nine fields, how many',
    'does the current NDH FHIR Endpoint model even have a place to store, and',
    'how many are populated today?',
    '',
    'H44 answers it in two layers.',
    '',
    'Layer 1: where do the nine fields live in the FHIR model?',
    '',
    'Mapping each submission-spec field against the published NDH Endpoint',
    'profile (STU1 v1.0.0):',
    '',
    '  - fhir_endpoint_url: Endpoint.address (core element)',
    '  - fhir_endpoint_type: connectionType plus the endpoint use-case extension',
    '  - smart_capabilities_url: partial. The dynamic-registration extension',
    '    declares SMART/UDAP support, not the .well-known URL.',
    '  - general_sandbox_url: partial. The environment-type extension is a code',
    '    (production/test), not a URL.',
    '  - developer_documentation_url: no home in STU1',
    '  - developer_signup_url: no home in STU1',
    '  - swagger_url: no home in STU1',
    '  - openapi_url: no home in STU1',
    '  - specific_sandbox_endpoint_url: no home in STU1',
    '',
    'Five of the nine have no element or extension in STU1. Collecting them',
    'through the CSV spec produces data with nowhere to land in the FHIR',
    'representation until a future version of the IG adds extensions.',
    '',
    'Layer 2: how populated are the fields that do have a home?',
    '',
    'Across the 114,071 FHIR-REST Endpoint records in the 2026-05-08 release',
    '(Direct Trust messaging addresses, 91.6% of the Endpoint table, are out',
    'of scope because they are not queryable APIs):',
    '',
    '  - Endpoint.address: 100%. Every FHIR-REST endpoint has a URL.',
    '  - payloadType: 100%. Every record declares its content type.',
    '  - endpoint use-case extension: 0%',
    '  - SMART/UDAP dynamic-registration extension: 0%',
    '  - environment-type extension: 0%',
    '  - FHIR-version, secure-exchange-artifacts, trust-framework,',
    '    usage-restriction extensions: 0% each',
    '',
    'The records carry the two required core fields and nothing else. Every',
    'optional NDH extension that could describe an endpoint is unused.',
    '',
    'What this means for the endpoint discussion:',
    '',
    '1. The submission spec is filling a real void, not duplicating existing',
    '   data. There is no endpoint metadata to migrate or remap. Today the NDH',
    "   knows an endpoint's address and payload type, and that is the whole",
    '   record.',
    '',
    '2. SMART capability is mostly discoverable without a declared field. A',
    '   separate AINPI crawl (H1-H5) found 81.6% of distinct FHIR-REST hosts',
    '   already serve a valid SMART .well-known document. So the',
    '   smart_capabilities_url field matters most for the minority of hosts a',
    '   crawler cannot reach, not the majority that already advertise it.',
    '',
    'Method note: extension presence is a scan of each serialized resource for',
    "the extension's canonical URL, an upper bound on real usage, so a 0%",
    'result means it genuinely does not appear. The 81.6% SMART figure is over',
    'distinct hosts (2,974), not all 114,071 endpoint records.',
    '',
    `Full update: ${REPORT_URL}`,
    `Finding page: ${FINDING_URL}`,
    '',
    '- Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.55; padding: 20px;">

  <p style="margin: 0 0 16px 0;">The provider-directory community is working through how endpoint data should be submitted and structured. Fred Trotter's HTE data-release spec asks submitters for nine endpoint-metadata fields. Before that design hardens, one question is worth measuring: of those nine fields, how many does the current NDH FHIR Endpoint model even have a place to store, and how many are populated today?</p>

  <p style="margin: 0 0 16px 0;">H44 answers it in two layers.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">Layer 1: where do the nine fields live in the FHIR model?</h2>

  <p style="margin: 0 0 12px 0;">Mapping each submission-spec field against the published NDH Endpoint profile (STU1 v1.0.0):</p>

  <ul style="margin: 0 0 12px 0; padding-left: 22px;">
    <li><code>fhir_endpoint_url</code>: <code>Endpoint.address</code> (core element)</li>
    <li><code>fhir_endpoint_type</code>: <code>connectionType</code> plus the endpoint use-case extension</li>
    <li><code>smart_capabilities_url</code>: partial. The dynamic-registration extension declares SMART/UDAP support, not the <code>.well-known</code> URL.</li>
    <li><code>general_sandbox_url</code>: partial. The environment-type extension is a code (production/test), not a URL.</li>
    <li><code>developer_documentation_url</code>: no home in STU1</li>
    <li><code>developer_signup_url</code>: no home in STU1</li>
    <li><code>swagger_url</code>: no home in STU1</li>
    <li><code>openapi_url</code>: no home in STU1</li>
    <li><code>specific_sandbox_endpoint_url</code>: no home in STU1</li>
  </ul>

  <p style="margin: 0 0 16px 0;">Five of the nine have no element or extension in STU1. Collecting them through the CSV spec produces data with nowhere to land in the FHIR representation until a future version of the IG adds extensions.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">Layer 2: how populated are the fields that do have a home?</h2>

  <p style="margin: 0 0 12px 0;">Across the 114,071 FHIR-REST Endpoint records in the 2026-05-08 release (Direct Trust messaging addresses, 91.6% of the Endpoint table, are out of scope because they are not queryable APIs):</p>

  <ul style="margin: 0 0 12px 0; padding-left: 22px;">
    <li><code>Endpoint.address</code>: <strong>100%</strong>. Every FHIR-REST endpoint has a URL.</li>
    <li><code>payloadType</code>: <strong>100%</strong>. Every record declares its content type.</li>
    <li>endpoint use-case extension: <strong>0%</strong></li>
    <li>SMART/UDAP dynamic-registration extension: <strong>0%</strong></li>
    <li>environment-type extension: <strong>0%</strong></li>
    <li>FHIR-version, secure-exchange-artifacts, trust-framework, usage-restriction extensions: <strong>0%</strong> each</li>
  </ul>

  <p style="margin: 0 0 16px 0;">The records carry the two required core fields and nothing else. Every optional NDH extension that could describe an endpoint is unused.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">What this means for the endpoint discussion</h2>

  <p style="margin: 0 0 12px 0;"><strong>1. The submission spec is filling a real void, not duplicating existing data.</strong> There is no endpoint metadata to migrate or remap. Today the NDH knows an endpoint's address and payload type, and that is the whole record.</p>

  <p style="margin: 0 0 16px 0;"><strong>2. SMART capability is mostly discoverable without a declared field.</strong> A separate AINPI crawl (H1-H5) found 81.6% of distinct FHIR-REST hosts already serve a valid SMART <code>.well-known</code> document. So the <code>smart_capabilities_url</code> field matters most for the minority of hosts a crawler cannot reach, not the majority that already advertise it.</p>

  <p style="margin: 0 0 16px 0; color: #6b7280; font-size: 13px;">Method note: extension presence is a scan of each serialized resource for the extension's canonical URL, an upper bound on real usage, so a 0% result means it genuinely does not appear. The 81.6% SMART figure is over distinct hosts (2,974), not all 114,071 endpoint records.</p>

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
