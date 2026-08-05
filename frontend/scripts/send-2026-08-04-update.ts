/**
 * scripts/send-2026-08-04-update.ts
 *
 * 2026-08-04 release blast. Launches the rural health section: national
 * baseline (34.4% of hospitals in nonmetro counties serving 13.8% of
 * residents), the Pennsylvania connectivity breakdown, the Epic traversal
 * correction, and the county-join bug.
 *
 * Same safety design as prior send scripts: dry-run by default, --confirm to
 * send, --email / --limit narrow targeting, 250ms throttle, in-blast dedup,
 * plain semantic HTML with no marketing chrome.
 *
 * Required env: RESEND_API_KEY, RESEND_FROM_ADDRESS, POSTGRES_PRISMA_URL
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT =
  'AINPI 2026-08-04: a third of American hospitals serve a seventh of the people';
const REPORT_URL = 'https://ainpi.dev/reports/2026-08-04-update';
const FINDING_URL = 'https://ainpi.dev/rural-health';
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
      console.log('See header comment in scripts/send-2026-08-04-update.ts');
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
    'New section on the site: rural health, with a state-level map, a national',
    'baseline, and a Pennsylvania breakdown on which hospitals software can',
    'actually find.',
    '',
    'The national number',
    '',
    'Joining every hospital CMS lists to the USDA county rural classification:',
    '',
    '  - 5,366 hospitals CMS lists',
    '  - 1,847 in nonmetro counties (34.4%); 239 more could not be matched',
    '    to a county code and are counted in neither group',
    '  - 1,338 Critical Access',
    '  - 45.8M US residents in nonmetro counties (13.8%, 2020 Census)',
    '',
    'A third of the hospitals serve a seventh of the people. Rural facilities',
    'are about 2.5 times as numerous as population alone would imply, because',
    'distance rather than density decides where a hospital has to be.',
    '',
    'That ratio sits under every rural health program and is rarely stated in',
    'one sentence. A funding formula weighted by population under-serves the',
    'facilities. One weighted by facility count over-serves them relative to',
    'residents. Both numbers are now in the same payload, per state.',
    '',
    'Pennsylvania: counting hospitals is not the same as reaching them',
    '',
    'Knowing where hospitals are does not tell you whether the software that',
    'routes patients, records and payment can find them. We measured that for',
    "Pennsylvania's 187 hospitals against the endpoint directories certified",
    'EHR vendors publish. One join answers two questions: whether a facility is',
    'digitally reachable, and which EHR it runs.',
    '',
    'The result inverts the usual assumption. Among acute care hospitals we',
    'located 26 of 27 rural facilities (96%) against 84 of 105 metro ones (80%).',
    'The rural denominator is small, so read the fractions rather than the',
    'percentages. Rural runs ahead of metro on every rural/metro split we ran:',
    'by hospital type, by ownership, and on the endpoint-linked measure.',
    '',
    'The apparent Critical Access gap turned out to be a publishing pattern',
    'rather than missing technology. Six of the 17 Critical Access hospitals in',
    'Pennsylvania produce no match under their own name. Four of the six carry a',
    'system brand: three Penn Highlands, one LECOM Health. Penn Highlands',
    'published 1 of its 7 Pennsylvania facilities, and that one runs MEDITECH,',
    'so the system plainly has a certified EHR. Geisinger published all nine of',
    'its facilities.',
    '',
    'A correction',
    '',
    'An earlier version of the Pennsylvania analysis said Epic "cross-links 49',
    'of 4,445 organizations" and that endpoint traversal would "find nothing."',
    'That was wrong, and the error was ours.',
    '',
    'Epic publishes a hierarchy. All 1,187 of its national brand-level organizations',
    'carry an endpoint, and the 83,678 facility records beneath them reach it',
    'through partOf. Other vendors publish flat. Both are valid FHIR. We had',
    'measured only the matched record and drew a conclusion the data did not',
    'support. The corrected finding is more useful: an integration that checks',
    'only the record it matched gets a false negative for all 86 Epic-published Pennsylvania hospitals in this set.',
    '',
    'A bug worth naming',
    '',
    'Fact-checking turned up a county-name join failure. CMS writes',
    'MC KEAN, USDA and Census write McKean, so an uppercase compare failed and',
    'one hospital resolved to no county. It dropped out of every county rollup:',
    'McKean read as a county with no hospital while the hospital table listed a',
    'hospital in McKean. One space, three wrong published counts, and a contradiction',
    'between two pages. Both pipelines now normalize county names and warn if',
    'any hospital fails to resolve.',
    '',
    'Everything here is public data and costs nothing to reproduce.',
    '',
    `Rural health section: ${FINDING_URL}`,
    `Full update: ${REPORT_URL}`,
    'Pennsylvania dashboard: https://ainpi.dev/states/pa/rural-health',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.55; padding: 20px;">

  <p style="margin: 0 0 16px 0;">New section on the site: <a href="${FINDING_URL}" style="color:#1d4ed8;">rural health</a>, with a state-level map, a national baseline, and a hospital-by-hospital Pennsylvania breakdown of which ones software can actually find.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">The national number</h2>

  <p style="margin: 0 0 12px 0;">Joining every hospital CMS lists to the USDA county rural classification:</p>

  <ul style="margin: 0 0 12px 0; padding-left: 22px;">
    <li><strong>5,366</strong> hospitals CMS lists</li>
    <li><strong>1,847</strong> in nonmetro counties (<strong>34.4%</strong>); 239 more could not be matched to a county code and are counted in neither group</li>
    <li><strong>1,338</strong> Critical Access</li>
    <li><strong>45.8M</strong> US residents in nonmetro counties (<strong>13.8%</strong>, 2020 Census)</li>
  </ul>

  <p style="margin: 0 0 12px 0;">A third of the hospitals serve a seventh of the people. Rural facilities are about 2.5 times as numerous as population alone would imply, because distance rather than density decides where a hospital has to be.</p>

  <p style="margin: 0 0 16px 0;">That ratio sits under every rural health program and is rarely stated in one sentence. A funding formula weighted by population under-serves the facilities. One weighted by facility count over-serves them relative to residents. Both numbers are now in the same payload, per state.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">Pennsylvania: counting hospitals is not the same as reaching them</h2>

  <p style="margin: 0 0 12px 0;">Knowing where hospitals are does not tell you whether the software that routes patients, records and payment can find them. We measured that for Pennsylvania's 187 hospitals against the endpoint directories certified EHR vendors publish. One join answers two questions: whether a facility is digitally reachable, and which EHR it runs.</p>

  <p style="margin: 0 0 12px 0;">The result inverts the usual assumption. Among acute care hospitals we located <strong>96% of rural facilities against 80% of metro ones</strong>. Rural runs ahead of metro on every rural/metro split we ran: by hospital type, by ownership, and on the endpoint-linked measure.</p>

  <p style="margin: 0 0 16px 0;">The apparent Critical Access gap turned out to be a publishing pattern rather than missing technology. Six of Pennsylvania's 17 Critical Access hospitals produce no match under their own name. Four of the six carry a system brand: three Penn Highlands, one LECOM Health. Penn Highlands published 1 of its 7 Pennsylvania facilities, and that one runs MEDITECH, so the system plainly has a certified EHR. Geisinger published all nine of its facilities.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">A correction</h2>

  <p style="margin: 0 0 12px 0;">An earlier version of the Pennsylvania analysis said Epic "cross-links 49 of 4,445 organizations" and that endpoint traversal would "find nothing." That was wrong, and the error was ours.</p>

  <p style="margin: 0 0 16px 0;">Epic publishes a hierarchy. All 1,187 of its national brand-level organizations carry an endpoint, and the 83,678 facility records beneath them reach it through <code>partOf</code>. Other vendors publish flat. Both are valid FHIR. We had measured only the matched record and drew a conclusion the data did not support. The corrected finding is more useful: an integration that checks only the record it matched gets a false negative for all 86 Epic-published Pennsylvania hospitals in this set.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">A bug worth naming</h2>

  <p style="margin: 0 0 16px 0;">Fact-checking turned up a county-name join failure. CMS writes <code>MC KEAN</code>, USDA and Census write <code>McKean</code>, so an uppercase compare failed and one hospital resolved to no county. It dropped out of every county rollup: McKean read as a county with no hospital while the hospital table listed a hospital in McKean. One space, three wrong published counts, and a contradiction between two pages. Both pipelines now normalize county names and warn if any hospital fails to resolve.</p>

  <p style="margin: 0 0 16px 0; color: #6b7280; font-size: 13px;">Everything here is public data and costs nothing to reproduce.</p>

  <p style="margin: 0 0 8px 0;">Rural health section: <a href="${FINDING_URL}" style="color: #1d4ed8;">${FINDING_URL}</a></p>
  <p style="margin: 0 0 8px 0;">Full update: <a href="${REPORT_URL}" style="color: #1d4ed8;">${REPORT_URL}</a></p>
  <p style="margin: 0 0 16px 0;">Pennsylvania dashboard: <a href="https://ainpi.dev/states/pa/rural-health" style="color: #1d4ed8;">ainpi.dev/states/pa/rural-health</a></p>

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
