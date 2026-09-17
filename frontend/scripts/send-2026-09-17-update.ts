/**
 * scripts/send-2026-09-17-update.ts
 *
 * 2026-09-17 subscriber update. Plain language for a general audience: the
 * release archive is on Databricks Marketplace, free, readable with or
 * without a Databricks account; what is new on the site since 2026-08-21
 * (explore by place, find nearby, primer, related work, the agent tool
 * endpoint, specialty by workplace, the homepage map on real data); one
 * correction to the listing text; and the ask for which quantity to track
 * release over release.
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
  'AINPI: every release of the provider directory since May, kept, free, on Databricks';
const REPORT_URL = 'https://ainpi.dev/reports/2026-09-17-update';
const LISTING_URL =
  'https://marketplace.databricks.com/details/6cf064b7-1fca-4a8f-addf-03ffd8bfdfd6/FHIR-IQ_CMS-National-Provider-Directory-Release-Archive';
const DATABRICKS_PAGE = 'https://ainpi.dev/databricks';
const EXPLORER_URL = 'https://ainpi.dev/explorer';
const FIND_URL = 'https://ainpi.dev/find';
const PRIMER_URL = 'https://ainpi.dev/primer';
const PARTNERS_URL = 'https://ainpi.dev/partners';
const DEVELOPER_URL = 'https://ainpi.dev/developer';
const ISSUES_URL = 'https://github.com/FHIR-IQ/AINPI/issues';
const UNSUB_REPLY = 'gene@fhiriq.com';
const SEND_THROTTLE_MS = 250;
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || 'AINPI <reports@ainpi.dev>';

interface CliArgs {
  confirm: boolean;
  preview: string | null;
  email: string | null;
  limit: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { confirm: false, preview: null, email: null, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--preview') out.preview = argv[++i] ?? null;
    else if (a === '--email') out.email = argv[++i] ?? null;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      out.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } else if (a === '-h' || a === '--help') {
      console.log('See header comment in scripts/send-2026-09-17-update.ts');
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
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const NEW_ON_SITE: [string, string, string][] = [
  [
    'Explore the directory by place',
    EXPLORER_URL,
    'Pick a state, then a county, then a ZIP. See how many providers the directory lists there, how many it can say work somewhere, and how that splits by profession. All fifty states and DC.',
  ],
  [
    'Find listed care near you',
    FIND_URL,
    "Enter a ZIP or share your location and see what the directory has nearby. Built on the directory's own coordinates, with no mapping service behind it.",
  ],
  [
    'A primer',
    PRIMER_URL,
    'What each identifier means, what each record type holds, how they join, and which joins are safe. Ends with a scoreboard of six directory measures.',
  ],
  [
    'Related work',
    PARTNERS_URL,
    'Other people measuring provider and insurer directory data from angles we do not cover, plus the CMS and HL7 venues where this work is discussed.',
  ],
  [
    'An answer engine for AI agents',
    DEVELOPER_URL,
    'The site now speaks the protocol AI assistants use to call tools. Look up an NPI, check the federal exclusion cohort, read any finding, pull a state audit. Free, no key, rate limited.',
  ],
];

function buildBody(): { text: string; html: string } {
  const text = [
    'AINPI update, 2026-09-17',
    'The archive is open: every release of the directory since May, kept, free',
    '',
    'The US government publishes its list of health care providers as',
    'one big file, and it keeps only the newest copy. When a new version',
    'comes out, the old one is gone. If you want to know whether the list',
    'got better or worse, you need someone to have saved both.',
    '',
    'We saved both. As of this week the archive is on Databricks',
    'Marketplace, and anyone can use it for free.',
    '',
    'WHAT IS IN IT',
    'Two releases so far, 2026-05-08 and 2026-08-20, as six tables.',
    '54,162,643 rows across the two. Every row keeps the original',
    'government record exactly as published, plus plain columns for the',
    'things people look up most. Each table is split by release date, so',
    'comparing two versions is one line of a query. A worked example is',
    'attached as a notebook.',
    '',
    'TWO WAYS TO READ IT',
    `With Databricks: open the listing and click Get access. ${LISTING_URL}`,
    'Without: the same tables read over OpenSharing (formerly Delta',
    'Sharing) with a small credential file and one Python package.',
    `Ask for a credential at ${DATABRICKS_PAGE}`,
    '',
    'Four organizations connected in the first three days.',
    '',
    'ONE WARNING BEFORE YOU COMPARE RELEASES',
    'Practitioner records carry the NPI in their id and line up across',
    'releases. Web address and place records get new random ids on every',
    'export. Match web addresses on the address itself, not the id.',
    '',
    'NEW ON THE SITE SINCE THE LAST UPDATE',
    ...NEW_ON_SITE.flatMap(([t, u, d]) => [`- ${t}: ${u}`, `  ${d}`, '']),
    '- Specialty by workplace. Of 445,527 practitioners the directory',
    '  places at two or more organizations, 82,977 carry a different',
    '  specialty at differently-named ones (18.6%). Published as',
    '  exploratory.',
    '- The homepage map now runs on measured numbers from the 2026-08-20',
    '  release, not a placeholder.',
    '',
    'A CORRECTION',
    'The Marketplace listing said practitioner and organization records',
    'both carry the NPI in their id. True for practitioners and for the',
    'provider half of organizations; false for the other half, which are',
    'tax records with a random id (2,199,519 of 4,402,671 in August).',
    'The listing is fixed.',
    '',
    'WHAT COMES NEXT',
    'A standing set of measures with one point per release, so "is the',
    'directory improving" becomes a chart instead of a question. Which',
    'quantity would you want tracked? Reply to this email, or open an',
    `issue: ${ISSUES_URL}`,
    '',
    `Read the full update: ${REPORT_URL}`,
    '',
    'This is a measurement of a federal file, not a source of truth about',
    'any individual provider.',
    '',
    'Eugene Vestel, FHIR IQ',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const li = NEW_ON_SITE.map(
    ([t, u, d]) =>
      `<li style="margin:0 0 10px 0;"><a href="${u}" style="color:#08519c;font-weight:600;">${escHtml(t)}</a>. ${escHtml(d)}</li>`,
  ).join('');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#171310;line-height:1.55;background:#faf8f5;">
  <div style="padding:24px 28px 16px;border-bottom:1px solid #d9d2c8;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#6b6259;text-transform:uppercase;">AINPI update · 2026-09-17</div>
    <h1 style="font-size:22px;margin:6px 0 4px;line-height:1.25;">The archive is open: every release of the directory since May, kept, free</h1>
  </div>

  <div style="padding:20px 28px;border-bottom:1px solid #d9d2c8;">
    <p style="margin:0 0 12px;font-size:15px;">The US government publishes its list of health care providers as one big file, and it keeps only the newest copy. When a new version comes out, the old one is gone. If you want to know whether the list got better or worse, you need someone to have saved both.</p>
    <p style="margin:0;font-size:15px;"><strong>We saved both.</strong> As of this week the archive is on Databricks Marketplace, and anyone can use it for free.</p>
  </div>

  <div style="padding:20px 28px;border-bottom:1px solid #d9d2c8;">
    <h2 style="font-size:17px;margin:0 0 8px;">What is in it</h2>
    <p style="margin:0 0 10px;font-size:14px;">Two releases so far, 2026-05-08 and 2026-08-20, as six tables. <strong>54,162,643 rows</strong> across the two. Every row keeps the original government record exactly as published, plus plain columns for the things people look up most, like the NPI, the state and the phone number. Each table is split by release date, so comparing two versions is one line of a query. A worked example is attached as a notebook.</p>
    <h2 style="font-size:17px;margin:16px 0 8px;">Two ways to read it</h2>
    <p style="margin:0 0 8px;font-size:14px;">With Databricks: <a href="${LISTING_URL}" style="color:#08519c;">open the listing</a> and click Get access. The tables land in your workspace.</p>
    <p style="margin:0 0 8px;font-size:14px;">Without: the same tables read over OpenSharing (formerly Delta Sharing) with a small credential file and one Python package. No Databricks account needed. <a href="${DATABRICKS_PAGE}" style="color:#08519c;">Ask for a credential here</a>, where the architecture and quickstart also live.</p>
    <p style="margin:0;font-size:14px;color:#6b6259;">Four organizations connected in the first three days.</p>
  </div>

  <div style="padding:20px 28px;background:#fff;border-bottom:1px solid #d9d2c8;">
    <h2 style="font-size:17px;margin:0 0 8px;">One warning before you compare releases</h2>
    <p style="margin:0;font-size:14px;">Practitioner records carry the NPI in their id, so they line up across releases. Web address and place records do not: CMS gives them new random ids on every export. If you match those on id, every single one looks changed, whether or not it did. Match web addresses on the address itself.</p>
  </div>

  <div style="padding:20px 28px;border-bottom:1px solid #d9d2c8;">
    <h2 style="font-size:17px;margin:0 0 10px;">New on the site since the last update</h2>
    <ul style="margin:0;padding-left:18px;font-size:14px;">
      ${li}
      <li style="margin:0 0 10px 0;"><strong>Specialty by workplace.</strong> Of 445,527 practitioners the directory places at two or more organizations, 82,977 carry a different specialty at differently-named ones (18.6%). Published as exploratory, because it answered a question that came up rather than one we registered in advance.</li>
      <li style="margin:0;"><strong>The homepage map is now measured.</strong> It runs on real numbers from the 2026-08-20 release for every state and specialty, not a placeholder.</li>
    </ul>
  </div>

  <div style="padding:20px 28px;background:#fff;border-bottom:1px solid #d9d2c8;">
    <h2 style="font-size:17px;margin:0 0 8px;">A correction</h2>
    <p style="margin:0;font-size:14px;">The Marketplace listing said practitioner and organization records both carry the NPI in their id. That was true for practitioners and for the provider half of organizations. It was false for the other half: 2,199,519 of the 4,402,671 organization records in August are tax records with a random id. The listing is fixed. We caught it while checking this update, which is what the checking is for.</p>
  </div>

  <div style="padding:20px 28px;border-bottom:1px solid #d9d2c8;">
    <h2 style="font-size:17px;margin:0 0 8px;">What comes next</h2>
    <p style="margin:0 0 10px;font-size:14px;">We hold the releases and will keep adding them as CMS publishes. The next step is a standing set of measures with one point per release, so "is the directory improving" becomes a chart instead of a question.</p>
    <p style="margin:0;font-size:14px;"><strong>Which quantity would you want tracked release over release?</strong> Reply to this email, or <a href="${ISSUES_URL}" style="color:#08519c;">open an issue</a>. The ones people ask for get built first.</p>
  </div>

  <div style="padding:28px;text-align:center;">
    <a href="${REPORT_URL}" style="display:inline-block;padding:12px 24px;background:#08519c;color:#fff;text-decoration:none;border-radius:3px;font-weight:700;font-size:15px;">Read the full update</a>
  </div>

  <div style="padding:16px 28px 24px;font-size:12px;color:#6b6259;text-align:center;border-top:1px solid #d9d2c8;">
    <p style="margin:0 0 6px;">This is a measurement of a federal file, not a source of truth about any individual provider.</p>
    <p style="margin:0 0 6px;">Eugene Vestel, FHIR IQ</p>
    <p style="margin:0;">Reply to this email to unsubscribe or ask a question (<a href="mailto:${UNSUB_REPLY}" style="color:#6b6259;">${UNSUB_REPLY}</a>).</p>
  </div>
</div>`.trim();

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
  console.log(`URLs:    ${REPORT_URL} | ${LISTING_URL} | ${DATABRICKS_PAGE}`);
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
