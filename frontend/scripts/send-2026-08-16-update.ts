/**
 * scripts/send-2026-08-16-update.ts
 *
 * 2026-08-16 release blast. Written in plain language for a general audience:
 * most web addresses in the national directory do not say who they belong to,
 * here is a free list of the ones that do, and here is what we think the
 * community should push for next.
 *
 * Same safety design as prior send scripts: dry-run by default, --confirm to
 * send, --preview writes the HTML and exits, --email / --limit narrow
 * targeting, 250ms throttle, in-blast dedup, plain semantic HTML.
 *
 * Required env: RESEND_API_KEY, RESEND_FROM_ADDRESS, POSTGRES_PRISMA_URL
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT =
  "AINPI: most web addresses in the national doctor directory don't say who they belong to";
const REPORT_URL = 'https://ainpi.dev/reports/2026-08-16-update';
const CROSSWALK_URL = 'https://ainpi.dev/api/v1/findings/endpoint-org-crosswalk.csv';
const FINDING_URL = 'https://ainpi.dev/findings/endpoint-org-linkage';
const PAYER_FINDING_URL = 'https://ainpi.dev/findings/ndh-payer-endpoint-coverage';
const CAPBLUE_URL = 'https://providerdirectory-api.capbluecross.com/r4';
const UNSUB_REPLY = 'gene@fhiriq.com';
const SEND_THROTTLE_MS = 250;
const FROM_ADDRESS =
  process.env.RESEND_FROM_ADDRESS || 'AINPI <onboarding@resend.dev>';

interface CliArgs {
  confirm: boolean;
  email: string | null;
  limit: number | null;
  /** Write the rendered HTML to this path and exit. Sends nothing. */
  preview: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { confirm: false, email: null, limit: null, preview: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--preview') out.preview = argv[++i] ?? null;
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
    'The US government keeps a big list of doctors, clinics and hospitals. It is',
    'called the National Provider Directory.',
    '',
    'Part of that list is web addresses. Software uses them to look up a',
    "patient's records. We checked 114,071 of these addresses and asked one",
    'simple question: does the list say who each address belongs to?',
    '',
    'Usually it does not.',
    '',
    'What we found',
    '',
    'Only 19,334 of the 114,071 addresses say who owns them. That is about one',
    'in six. The other 94,737 are web addresses with no name attached.',
    '',
    'Picture a phone book where five out of every six numbers have no name next',
    'to them. The numbers might ring fine. You still would not know who answers.',
    '',
    'Why this matters',
    '',
    "A doctor's office wants to send your records to a specialist. Software looks",
    'up the specialist in the directory and finds an address.',
    '',
    'If nothing says whose address it is, the software cannot safely use it.',
    'Sending medical records to the wrong place is not a small mistake.',
    '',
    'The good news, and a free list',
    '',
    'Nothing here is broken. The names were simply never filled in.',
    '',
    'We checked that carefully. Every time the directory does name an owner, that',
    'name points to a real organization. Not one was wrong or led nowhere. So',
    'this is a blank box, not a bug, and a blank box is much easier to fix.',
    '',
    'We also built a free list of the 19,334 addresses that do name an owner.',
    'Each row gives you the web address, the organization, and that',
    "organization's ID number. No login, no key.",
    '',
    `  ${CROSSWALK_URL}`,
    '',
    'Some companies fill the name in and some never do',
    '',
    'We expected the missing names to be spread out evenly. They are not.',
    '',
    'Most doctors do not run their own software. They buy it from a company, and',
    'that company publishes the addresses for them. Grouped by company:',
    '',
    '  healow            6,617 addresses, 68.4% name an owner',
    '  athenahealth     35,439 addresses, 24.5%',
    '  Allscripts        4,977 addresses, 21.2%',
    '  eClinicalWorks   16,809 addresses,     0%',
    '  Office Ally      13,090 addresses,     0%',
    '  Practice Fusion   4,714 addresses,     0%',
    '',
    'Sixteen companies have not filled in the name a single time. Together they',
    'account for 49,036 addresses.',
    '',
    'This is oddly encouraging. A company sitting at zero has not half-finished',
    'the job. It has not started. That is usually an easier conversation than',
    'fixing something half broken.',
    '',
    'One warning if you use this data. The company name is not the doctor. One',
    'company can run software for thousands of clinics on the same web address.',
    '',
    'Health insurers are not in the directory yet',
    '',
    'The published rulebook for the directory says it is meant to serve health',
    'insurers too. So we checked whether you can look up an insurer\'s public',
    'doctor list through the directory today. You cannot.',
    '',
    'Out of 114,071 addresses, one belongs to an insurer\'s doctor list. The',
    'directory also has no category for "insurer" at all.',
    '',
    'We wanted to be fair. Maybe insurers have not built these lists yet, which',
    'would not be the directory\'s fault. So we picked one and checked. Capital',
    'BlueCross publishes a working public doctor list right now, and the',
    'government requires insurers to publish one. It is not in the directory.',
    '',
    'So the lists exist. The directory just does not carry them yet.',
    '',
    'What we still do not know',
    '',
    'We can measure what is missing. We cannot yet explain it.',
    '',
    'We do not know why some software companies fill in the name and others never',
    'do. It could be a setting nobody switched on, or something harder. Nobody',
    'has asked them.',
    '',
    'We do not know if the 94,737 unnamed addresses have an owner recorded',
    'somewhere we cannot see.',
    '',
    'We do not know whether a future version of the directory will carry insurer',
    'lists, or how far off that would be.',
    '',
    'What we think should happen next',
    '',
    'CMS is building this directory in the open and asking people to help shape',
    'it. Here is where we think the effort pays off most.',
    '',
    'Start with the sixteen companies at zero. They cover 49,036 addresses',
    'between them. Fixing that one field would move the largest single block of',
    'addresses from unusable to usable.',
    '',
    'Add a category for health insurers. Right now the directory has no way to',
    'file one, so nobody could add an insurer list even if they wanted to.',
    '',
    'Treat a web address with no owner as incomplete. If the directory asks for',
    'the name up front, this problem does not come back later.',
    '',
    'Check our work',
    '',
    'We would rather you did not take our word for any of this. Every number',
    'above comes from a file anyone can download.',
    '',
    `  The free list:  ${CROSSWALK_URL}`,
    `  The addresses:  ${FINDING_URL}`,
    `  The insurers:   ${PAYER_FINDING_URL}`,
    `  Full write-up:  ${REPORT_URL}`,
    '',
    'The insurer list we tested is public too. It needs one extra setting and',
    'returns an error in a normal browser, so use this:',
    '',
    "  curl -H 'Accept: application/fhir+json' \\",
    `    '${CAPBLUE_URL}/Practitioner?family=Smith&_count=1'`,
    '',
    'All of it is public data. Repeating our work costs about three cents.',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const h2 =
    'font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;';
  const p = 'margin: 0 0 12px 0;';

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.55; padding: 20px;">

  <p style="${p}">The US government keeps a big list of doctors, clinics and hospitals. It is called the National Provider Directory.</p>

  <p style="${p}">Part of that list is web addresses. Software uses them to look up a patient's records. We checked 114,071 of these addresses and asked one simple question: does the list say who each address belongs to?</p>

  <p style="margin: 0 0 16px 0;">Usually it does not.</p>

  <h2 style="${h2}">What we found</h2>

  <p style="${p}">Only <strong>19,334</strong> of the 114,071 addresses say who owns them. That is about one in six. The other 94,737 are web addresses with no name attached.</p>

  <p style="margin: 0 0 16px 0;">Picture a phone book where five out of every six numbers have no name next to them. The numbers might ring fine. You still would not know who answers.</p>

  <h2 style="${h2}">Why this matters</h2>

  <p style="${p}">A doctor's office wants to send your records to a specialist. Software looks up the specialist in the directory and finds an address.</p>

  <p style="margin: 0 0 16px 0;">If nothing says whose address it is, the software cannot safely use it. Sending medical records to the wrong place is not a small mistake.</p>

  <h2 style="${h2}">The good news, and a free list</h2>

  <p style="${p}">Nothing here is broken. The names were simply never filled in.</p>

  <p style="${p}">We checked that carefully. Every time the directory does name an owner, that name points to a real organization. Not one was wrong or led nowhere. So this is a blank box, not a bug, and a blank box is much easier to fix.</p>

  <p style="margin: 0 0 16px 0;">We also built a <a href="${CROSSWALK_URL}" style="color:#1d4ed8;">free list</a> of the 19,334 addresses that do name an owner. Each row gives you the web address, the organization, and that organization's ID number. No login, no key.</p>

  <h2 style="${h2}">Some companies fill the name in and some never do</h2>

  <p style="${p}">We expected the missing names to be spread out evenly. They are not.</p>

  <p style="${p}">Most doctors do not run their own software. They buy it from a company, and that company publishes the addresses for them. Grouped by company:</p>

  <table style="border-collapse: collapse; width: 100%; font-size: 14px; margin: 0 0 12px 0;">
    <tr style="text-align: left; color: #6b7280;">
      <th style="padding: 4px 8px 4px 0;">Company</th>
      <th style="padding: 4px 8px; text-align: right;">Addresses</th>
      <th style="padding: 4px 0; text-align: right;">Name an owner</th>
    </tr>
    <tr><td style="padding: 4px 8px 4px 0;">healow</td><td style="padding: 4px 8px; text-align: right;">6,617</td><td style="padding: 4px 0; text-align: right;">68.4%</td></tr>
    <tr><td style="padding: 4px 8px 4px 0;">athenahealth</td><td style="padding: 4px 8px; text-align: right;">35,439</td><td style="padding: 4px 0; text-align: right;">24.5%</td></tr>
    <tr><td style="padding: 4px 8px 4px 0;">Allscripts</td><td style="padding: 4px 8px; text-align: right;">4,977</td><td style="padding: 4px 0; text-align: right;">21.2%</td></tr>
    <tr><td style="padding: 4px 8px 4px 0;">eClinicalWorks</td><td style="padding: 4px 8px; text-align: right;">16,809</td><td style="padding: 4px 0; text-align: right;">0%</td></tr>
    <tr><td style="padding: 4px 8px 4px 0;">Office Ally</td><td style="padding: 4px 8px; text-align: right;">13,090</td><td style="padding: 4px 0; text-align: right;">0%</td></tr>
    <tr><td style="padding: 4px 8px 4px 0;">Practice Fusion</td><td style="padding: 4px 8px; text-align: right;">4,714</td><td style="padding: 4px 0; text-align: right;">0%</td></tr>
  </table>

  <p style="${p}">Sixteen companies have not filled in the name a single time. Together they account for <strong>49,036</strong> addresses.</p>

  <p style="${p}">This is oddly encouraging. A company sitting at zero has not half-finished the job. It has not started. That is usually an easier conversation than fixing something half broken.</p>

  <p style="margin: 0 0 16px 0;">One warning if you use this data. The company name is not the doctor. One company can run software for thousands of clinics on the same web address.</p>

  <h2 style="${h2}">Health insurers are not in the directory yet</h2>

  <p style="${p}">The published rulebook for the directory says it is meant to serve health insurers too. So we checked whether you can look up an insurer's public doctor list through the directory today. You cannot.</p>

  <p style="${p}">Out of 114,071 addresses, one belongs to an insurer's doctor list. The directory also has no category for "insurer" at all.</p>

  <p style="${p}">We wanted to be fair. Maybe insurers have not built these lists yet, which would not be the directory's fault. So we picked one and checked. Capital BlueCross publishes a working public doctor list right now, and the government requires insurers to publish one. It is not in the directory.</p>

  <p style="margin: 0 0 16px 0;">So the lists exist. The directory just does not carry them yet.</p>

  <h2 style="${h2}">What we still do not know</h2>

  <p style="${p}">We can measure what is missing. We cannot yet explain it.</p>

  <p style="${p}">We do not know why some software companies fill in the name and others never do. It could be a setting nobody switched on, or something harder. Nobody has asked them.</p>

  <p style="${p}">We do not know if the 94,737 unnamed addresses have an owner recorded somewhere we cannot see.</p>

  <p style="margin: 0 0 16px 0;">We do not know whether a future version of the directory will carry insurer lists, or how far off that would be.</p>

  <h2 style="${h2}">What we think should happen next</h2>

  <p style="${p}">CMS is building this directory in the open and asking people to help shape it. Here is where we think the effort pays off most.</p>

  <p style="${p}">Start with the sixteen companies at zero. They cover 49,036 addresses between them. Fixing that one field would move the largest single block of addresses from unusable to usable.</p>

  <p style="${p}">Add a category for health insurers. Right now the directory has no way to file one, so nobody could add an insurer list even if they wanted to.</p>

  <p style="margin: 0 0 16px 0;">Treat a web address with no owner as incomplete. If the directory asks for the name up front, this problem does not come back later.</p>

  <h2 style="${h2}">Check our work</h2>

  <p style="${p}">We would rather you did not take our word for any of this. Every number above comes from a file anyone can download.</p>

  <p style="margin: 0 0 6px 0;">The free list: <a href="${CROSSWALK_URL}" style="color: #1d4ed8;">endpoint-org-crosswalk.csv</a></p>
  <p style="margin: 0 0 6px 0;">The addresses: <a href="${FINDING_URL}" style="color: #1d4ed8;">how we counted them</a></p>
  <p style="margin: 0 0 6px 0;">The insurers: <a href="${PAYER_FINDING_URL}" style="color: #1d4ed8;">how we counted those</a></p>
  <p style="margin: 0 0 16px 0;">Full write-up: <a href="${REPORT_URL}" style="color: #1d4ed8;">${REPORT_URL}</a></p>

  <p style="margin: 0 0 8px 0;">The insurer list we tested is public too. It needs one extra setting and returns an error in a normal browser, so use this:</p>

  <pre style="margin: 0 0 16px 0; padding: 12px; background: #f3f4f6; border-radius: 4px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all;"><code>curl -H 'Accept: application/fhir+json' \\
  '${CAPBLUE_URL}/Practitioner?family=Smith&amp;_count=1'</code></pre>

  <p style="margin: 0 0 16px 0; color: #6b7280; font-size: 13px;">All of it is public data. Repeating our work costs about three cents.</p>

  <p style="margin: 0; color: #6b7280; font-size: 13px;">Reply to this email to unsubscribe or ask a question (<a href="mailto:${UNSUB_REPLY}" style="color: #6b7280;">${UNSUB_REPLY}</a>).</p>

</div>
  `.trim();

  return { text, html };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { text, html } = buildBody();

  // Preview writes the exact HTML a subscriber receives, then exits. It runs
  // before every other branch so it can never send by accident.
  if (args.preview) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      args.preview,
      `<!doctype html><meta charset="utf-8"><title>${SUBJECT}</title>` +
        `<div style="background:#f3f4f6;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
        `<div style="max-width:600px;margin:0 auto 16px;padding:12px 16px;background:#fff;border:1px solid #e5e7eb;border-radius:4px;font-size:13px;color:#374151;">` +
        `<div><strong>Subject:</strong> ${SUBJECT}</div>` +
        `<div><strong>From:</strong> ${FROM_ADDRESS}</div>` +
        `<div><strong>Reply-To:</strong> ${UNSUB_REPLY}</div>` +
        `</div>` +
        `<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:4px;">${html}</div></div>`,
    );
    console.log(`Wrote HTML preview to ${args.preview}. Nothing was sent.`);
    return;
  }

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
