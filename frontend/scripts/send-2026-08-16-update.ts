/**
 * scripts/send-2026-08-16-update.ts
 *
 * 2026-08-16 release blast. Publishes the base-URL-to-NPI crosswalk (19,334
 * endpoints resolved), the endpoint-to-organization linkage finding (16.9%),
 * the payer-endpoint coverage finding, and the new flattened columns for
 * phone, street address and coordinates.
 *
 * Same safety design as prior send scripts: dry-run by default, --confirm to
 * send, --email / --limit narrow targeting, 250ms throttle, in-blast dedup,
 * plain semantic HTML with no marketing chrome.
 *
 * Required env: RESEND_API_KEY, RESEND_FROM_ADDRESS, POSTGRES_PRISMA_URL
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT = 'AINPI 2026-08-16: a crosswalk from FHIR base URL to NPI';
const REPORT_URL = 'https://ainpi.dev/reports/2026-08-16-update';
const CROSSWALK_URL = 'https://ainpi.dev/api/v1/findings/endpoint-org-crosswalk.csv';
const FINDING_URL = 'https://ainpi.dev/findings/endpoint-org-linkage';
const PAYER_FINDING_URL = 'https://ainpi.dev/findings/ndh-payer-endpoint-coverage';
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
      console.log('See header comment in scripts/send-2026-08-16-update.ts');
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
    'New download: a crosswalk resolving 19,334 FHIR base URLs in the CMS',
    'National Provider Directory to the organization that runs them, with the',
    'NPI attached. No login, no key.',
    '',
    `  ${CROSSWALK_URL}`,
    '',
    'That number is also the finding. The directory holds 114,071 FHIR REST',
    'endpoints. Only 19,334 of them can be attributed to anyone.',
    '',
    'Why attribution is the whole problem',
    '',
    '"There is a FHIR server at this URL" answers nothing on its own. The',
    'question an integrator, a payer validating a network, or an auditor',
    'actually has is whose server it is.',
    '',
    '  - FHIR REST:    19,334 of 114,071 resolve to an organization (16.9%)',
    '  - Direct Trust: 110,984 of 1,246,514 (8.9%)',
    '',
    'Two things make that more useful than it first looks.',
    '',
    'Nothing is broken, it is missing. Zero references dangle. We counted',
    'presence and resolvability separately so we could not score a dangling',
    'reference as a success, and the two came out identical. Populating a field',
    'fixes absence; breakage would need referential-integrity repair. The first',
    'is a publishing change, the second is an engineering project.',
    '',
    'Every endpoint that resolves reaches an organization with an NPI. There',
    'were no partial wins to discard. That is why the crosswalk works as a base',
    'URL to NPI lookup across 18,884 organizations.',
    '',
    'The gap is per-vendor, not systemic',
    '',
    'Of the 30 hosts carrying at least 100 endpoints, 16 publish no organization',
    'link on any endpoint at all, covering 49,036 endpoints. Others attribute',
    'most of theirs:',
    '',
    '  - fhir4.healow.com                    6,617 endpoints, 68.4% attributed',
    '  - api.platform.athenahealth.com      35,439 endpoints, 24.5%',
    '  - fhir4.eclinicalworks.com           16,809 endpoints,  0.0%',
    '  - fhirpt.officeally.com              13,090 endpoints,  0.0%',
    '',
    'A host at 0% has never populated the field rather than populated it',
    'patchily, which makes this addressable one vendor at a time.',
    '',
    'One warning: host is not a proxy for organization. EHR vendors run',
    'thousands of tenants on one domain, so api.platform.athenahealth.com',
    'identifies the vendor and never the practice.',
    '',
    'The directory does not yet carry payers',
    '',
    'A separate question came out of the CMS provider-directory community.',
    'People there describe the NDH as the eventual place to discover a payer\'s',
    'public Provider Directory API, instead of hunting developer portals payer',
    'by payer.',
    '',
    'Of 114,071 FHIR REST endpoints, 1 self-labels as a payer provider',
    'directory. No payer organization type exists at all: Organization.type',
    'carries exactly three codings across 1,999,818 typed resources, which are',
    'prov, team and govt. We read the raw FHIR JSON rather than our own',
    'flattened column, so a payer type could not have been hidden by our',
    'extractor.',
    '',
    'The organization-identifier half is weaker. Of the 92 payer-host endpoints',
    'the directory does carry, 7 have a managing organization.',
    '',
    'A low count could simply mean payers have built nothing, which would not be',
    'the directory\'s fault. So we added a control: Capital BlueCross serves a',
    'live, public, unauthenticated FHIR provider directory, mandated under',
    'CMS-9115-F. It is absent from the NDH entirely. That separates "nothing to',
    'index" from "not indexed yet."',
    '',
    'This is coverage of one release, not a compliance claim.',
    '',
    'Phone, street address and coordinates are now queryable',
    '',
    'The BigQuery tables gained flattened columns for telecom, address.line and',
    'Location.position, so these no longer require scanning the raw FHIR JSON.',
    'Practitioner phone lands at 99.98%, which reproduces our earlier H43',
    'finding exactly, and location phone at 0.0% reproduces its separate',
    'observation that Location.telecom is empty. Coordinates cover 93.9% of',
    'locations and are the only geography in the NDH.',
    '',
    'Everything here is public data and costs about three cents to reproduce.',
    '',
    `Crosswalk: ${CROSSWALK_URL}`,
    `Finding: ${FINDING_URL}`,
    `Payer coverage: ${PAYER_FINDING_URL}`,
    `Full update: ${REPORT_URL}`,
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.55; padding: 20px;">

  <p style="margin: 0 0 16px 0;">New download: a <a href="${CROSSWALK_URL}" style="color:#1d4ed8;">crosswalk</a> resolving <strong>19,334 FHIR base URLs</strong> in the CMS National Provider Directory to the organization that runs them, with the NPI attached. No login, no key.</p>

  <p style="margin: 0 0 16px 0;">That number is also the finding. The directory holds 114,071 FHIR REST endpoints. Only 19,334 of them can be attributed to anyone.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">Why attribution is the whole problem</h2>

  <p style="margin: 0 0 12px 0;">"There is a FHIR server at this URL" answers nothing on its own. The question an integrator, a payer validating a network, or an auditor actually has is whose server it is.</p>

  <ul style="margin: 0 0 12px 0; padding-left: 22px;">
    <li><strong>FHIR REST:</strong> 19,334 of 114,071 resolve to an organization (<strong>16.9%</strong>)</li>
    <li><strong>Direct Trust:</strong> 110,984 of 1,246,514 (8.9%)</li>
  </ul>

  <p style="margin: 0 0 12px 0;"><strong>Nothing is broken, it is missing.</strong> Zero references dangle. We counted presence and resolvability separately so we could not score a dangling reference as a success, and the two came out identical. Populating a field fixes absence; breakage would need referential-integrity repair. The first is a publishing change, the second is an engineering project.</p>

  <p style="margin: 0 0 16px 0;"><strong>Every endpoint that resolves reaches an organization with an NPI.</strong> There were no partial wins to discard. That is why the crosswalk works as a base URL to NPI lookup across 18,884 organizations.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">The gap is per-vendor, not systemic</h2>

  <p style="margin: 0 0 12px 0;">Of the 30 hosts carrying at least 100 endpoints, <strong>16 publish no organization link on any endpoint at all</strong>, covering 49,036 endpoints. Others attribute most of theirs:</p>

  <ul style="margin: 0 0 12px 0; padding-left: 22px;">
    <li><code>fhir4.healow.com</code> &mdash; 6,617 endpoints, <strong>68.4%</strong> attributed</li>
    <li><code>api.platform.athenahealth.com</code> &mdash; 35,439 endpoints, 24.5%</li>
    <li><code>fhir4.eclinicalworks.com</code> &mdash; 16,809 endpoints, <strong>0.0%</strong></li>
    <li><code>fhirpt.officeally.com</code> &mdash; 13,090 endpoints, <strong>0.0%</strong></li>
  </ul>

  <p style="margin: 0 0 12px 0;">A host at 0% has never populated the field rather than populated it patchily, which makes this addressable one vendor at a time.</p>

  <p style="margin: 0 0 16px 0;">One warning: host is not a proxy for organization. EHR vendors run thousands of tenants on one domain, so <code>api.platform.athenahealth.com</code> identifies the vendor and never the practice.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">The directory does not yet carry payers</h2>

  <p style="margin: 0 0 12px 0;">A separate question came out of the CMS provider-directory community. People there describe the NDH as the eventual place to discover a payer's public Provider Directory API, instead of hunting developer portals payer by payer.</p>

  <p style="margin: 0 0 12px 0;">Of 114,071 FHIR REST endpoints, <strong>1</strong> self-labels as a payer provider directory. No payer organization type exists at all: <code>Organization.type</code> carries exactly three codings across 1,999,818 typed resources, which are <code>prov</code>, <code>team</code> and <code>govt</code>. We read the raw FHIR JSON rather than our own flattened column, so a payer type could not have been hidden by our extractor.</p>

  <p style="margin: 0 0 12px 0;">The organization-identifier half is weaker. Of the 92 payer-host endpoints the directory does carry, 7 have a managing organization.</p>

  <p style="margin: 0 0 16px 0;">A low count could simply mean payers have built nothing, which would not be the directory's fault. So we added a control: Capital BlueCross serves a live, public, unauthenticated FHIR provider directory, mandated under CMS-9115-F. It is absent from the NDH entirely. That separates "nothing to index" from "not indexed yet." This is coverage of one release, not a compliance claim.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">Phone, street address and coordinates are now queryable</h2>

  <p style="margin: 0 0 16px 0;">The BigQuery tables gained flattened columns for telecom, <code>address.line</code> and <code>Location.position</code>, so these no longer require scanning the raw FHIR JSON. Practitioner phone lands at <strong>99.98%</strong>, which reproduces our earlier H43 finding exactly, and location phone at 0.0% reproduces its separate observation that <code>Location.telecom</code> is empty. Coordinates cover <strong>93.9%</strong> of locations and are the only geography in the NDH.</p>

  <p style="margin: 0 0 16px 0; color: #6b7280; font-size: 13px;">Everything here is public data and costs about three cents to reproduce.</p>

  <p style="margin: 0 0 8px 0;">Crosswalk: <a href="${CROSSWALK_URL}" style="color: #1d4ed8;">endpoint-org-crosswalk.csv</a></p>
  <p style="margin: 0 0 8px 0;">Finding: <a href="${FINDING_URL}" style="color: #1d4ed8;">${FINDING_URL}</a></p>
  <p style="margin: 0 0 8px 0;">Payer coverage: <a href="${PAYER_FINDING_URL}" style="color: #1d4ed8;">${PAYER_FINDING_URL}</a></p>
  <p style="margin: 0 0 16px 0;">Full update: <a href="${REPORT_URL}" style="color: #1d4ed8;">${REPORT_URL}</a></p>

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
  console.log(`URLs:    ${REPORT_URL} | ${CROSSWALK_URL}`);
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
