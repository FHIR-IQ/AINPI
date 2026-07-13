/**
 * scripts/send-2026-07-13-update.ts
 *
 * 2026-07-13 release blast. No June NDH release (manifest still serves the
 * 2026-05-07 files); CMS directory-team public repo roundup (CEHRT endpoint
 * scrape, payer slurp, Federated Payer Identifier, HTE affiliation spec);
 * H45 pre-registered (per-state CEHRT endpoint coverage gap); early-July
 * shipping notes (per-NPI report cards, MCP server, parquet release archive).
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
  'AINPI 2026-07-13: no June release, and the missing endpoints are already public';
const REPORT_URL = 'https://ainpi.dev/reports/2026-07-13-update';
const FINDING_URL = 'https://ainpi.dev/findings/cehrt-endpoint-coverage-gap';
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
      console.log('See header comment in scripts/send-2026-07-13-update.ts');
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
    'Three things this update: the release cadence broke, the CMS directory',
    "team's public repos show where the directory is heading next, and we",
    'pre-registered a finding that measures the gap they are about to close,',
    'state by state, before the ingest lands.',
    '',
    'No June release',
    '',
    'The NDH bulk-export manifest still points at the 2026-05-07 file set.',
    'April came on the 9th, May on the 8th, then nothing: the May release has',
    'now been current for 66 days. Every AINPI number stays pinned to the',
    '2026-05-08 release until a new one drops.',
    '',
    'What the CMS directory team shipped instead',
    '',
    'The directory is built in the open, and the last two weeks were busy:',
    '',
    '  - A scrape of certified-EHR FHIR endpoints. Under HTI-1, certified EHR',
    '    vendors must publish service-base-URL bundles: org name, address,',
    '    often an NPI, and the FHIR endpoint URL. The CMS team now flattens',
    '    them into joinable records. The public cache holds 7,999 Organization',
    '    entries and 31,255 Endpoint entries across 17 vendor hosts',
    '    (2026-07-10 snapshot).',
    '  - A second-generation payer-data downloader for public payer',
    '    directories.',
    '  - A Federated Payer Identifier proposal: payers self-enumerate and',
    '    publish a well-known index mapping plans to endpoints, with',
    '    corrections arriving as git pull requests. An early prototype, but',
    '    the first concrete mechanism we have seen for the payer half of a',
    '    National Provider and Payer Directory.',
    '  - An updated submission spec for provider affiliations: a',
    '    PractitionerRole-level CSV with a 10-year lookback, included when a',
    '    clinician billed more than 10 patients under the organizational NPI.',
    '',
    'New pre-registration: H45, the endpoint coverage gap by state',
    '',
    "The scrape makes a question measurable that we couldn't measure before.",
    'The NDH\'s weakest layer is endpoints: 98.7% of its organizations carried',
    'zero Endpoint references in the April release, and the endpoint records',
    'that exist carry an address and payload type while every optional',
    'metadata field measures 0%. Meanwhile, thousands of',
    'provider organizations already publish a FHIR endpoint through their EHR',
    "vendor's HTI-1 bundle, with an NPI and a state attached.",
    '',
    'H45 joins the two: for each state, how many organizations with a',
    'publicly-published EHR FHIR endpoint either have no matching NDH',
    'Organization, or match one that carries zero endpoints? Both sides of',
    'the join are public data, so every per-state count will be independently',
    'checkable. Results feed the per-state audit pages at ainpi.dev/states.',
    '',
    'Also shipped since the last update',
    '',
    '  - Per-NPI report cards at https://ainpi.dev/npi - one page per record',
    '    in the 10,000-record high-risk cohort export, each with',
    '    primary-source verify links (LEIE, SAM, NPPES).',
    '  - An MCP server at https://ainpi.dev/api/mcp - five tools over the',
    '    public contract, so AI agents can query the audit directly.',
    '  - The NDH release archive as parquet: both ingested releases,',
    '    flattened, with DuckDB examples that reproduce published findings.',
    '  - A data snack: five software products serve half of the directory\'s',
    '    live FHIR hosts. https://ainpi.dev/articles/fhir-server-census',
    '',
    `Full update: ${REPORT_URL}`,
    `H45 pre-registration: ${FINDING_URL}`,
    '',
    '- Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.55; padding: 20px;">

  <p style="margin: 0 0 16px 0;">Three things this update: the release cadence broke, the CMS directory team's public repos show where the directory is heading next, and we pre-registered a finding that measures the gap they are about to close, state by state, before the ingest lands.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">No June release</h2>

  <p style="margin: 0 0 16px 0;">The NDH bulk-export manifest still points at the 2026-05-07 file set. April came on the 9th, May on the 8th, then nothing: the May release has now been current for 66 days. Every AINPI number stays pinned to the 2026-05-08 release until a new one drops.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">What the CMS directory team shipped instead</h2>

  <p style="margin: 0 0 12px 0;">The directory is built in the open, and the last two weeks were busy:</p>

  <ul style="margin: 0 0 16px 0; padding-left: 22px;">
    <li style="margin-bottom: 8px;"><strong>A scrape of certified-EHR FHIR endpoints.</strong> Under HTI-1, certified EHR vendors must publish service-base-URL bundles: org name, address, often an NPI, and the FHIR endpoint URL. The CMS team now flattens them into joinable records. The public cache holds 7,999 Organization entries and 31,255 Endpoint entries across 17 vendor hosts (2026-07-10 snapshot).</li>
    <li style="margin-bottom: 8px;"><strong>A second-generation payer-data downloader</strong> for public payer directories.</li>
    <li style="margin-bottom: 8px;"><strong>A Federated Payer Identifier proposal:</strong> payers self-enumerate and publish a well-known index mapping plans to endpoints, with corrections arriving as git pull requests. An early prototype, but the first concrete mechanism we have seen for the payer half of a National Provider and Payer Directory.</li>
    <li><strong>An updated submission spec for provider affiliations:</strong> a PractitionerRole-level CSV with a 10-year lookback, included when a clinician billed more than 10 patients under the organizational NPI.</li>
  </ul>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">New pre-registration: H45, the endpoint coverage gap by state</h2>

  <p style="margin: 0 0 12px 0;">The scrape makes a question measurable that we couldn't measure before. The NDH's weakest layer is endpoints: 98.7% of its organizations carried zero Endpoint references in the April release, and the endpoint records that exist carry an address and payload type while every optional metadata field measures 0%. Meanwhile, thousands of provider organizations already publish a FHIR endpoint through their EHR vendor's HTI-1 bundle, with an NPI and a state attached.</p>

  <p style="margin: 0 0 16px 0;">H45 joins the two: for each state, how many organizations with a publicly-published EHR FHIR endpoint either have no matching NDH Organization, or match one that carries zero endpoints? Both sides of the join are public data, so every per-state count will be independently checkable. Results feed the per-state audit pages at <a href="https://ainpi.dev/states" style="color: #1d4ed8;">ainpi.dev/states</a>.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">Also shipped since the last update</h2>

  <ul style="margin: 0 0 16px 0; padding-left: 22px;">
    <li style="margin-bottom: 8px;"><strong>Per-NPI report cards</strong> at <a href="https://ainpi.dev/npi" style="color: #1d4ed8;">ainpi.dev/npi</a>: one page per record in the 10,000-record high-risk cohort export, each with primary-source verify links (LEIE, SAM, NPPES).</li>
    <li style="margin-bottom: 8px;"><strong>An MCP server</strong> at <code>ainpi.dev/api/mcp</code>: five tools over the public contract, so AI agents can query the audit directly.</li>
    <li style="margin-bottom: 8px;"><strong>The NDH release archive as parquet:</strong> both ingested releases, flattened, with DuckDB examples that reproduce published findings.</li>
    <li><strong>A data snack:</strong> five software products serve half of the directory's live FHIR hosts. <a href="https://ainpi.dev/articles/fhir-server-census" style="color: #1d4ed8;">ainpi.dev/articles/fhir-server-census</a></li>
  </ul>

  <p style="margin: 0 0 8px 0;">Full update: <a href="${REPORT_URL}" style="color: #1d4ed8;">${REPORT_URL}</a></p>
  <p style="margin: 0 0 16px 0;">H45 pre-registration: <a href="${FINDING_URL}" style="color: #1d4ed8;">${FINDING_URL}</a></p>

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
