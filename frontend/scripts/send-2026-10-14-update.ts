/**
 * scripts/send-2026-10-14-update.ts
 *
 * 2026-10-14 subscriber update. Plain language for a general audience: the
 * 2026-10-07 CMS release, reloaded and re-measured. The file shrank by a
 * quarter and coverage held; 997 insurers arrived with no web address; phone
 * coverage and Pennsylvania record reachability slipped; one correction (the
 * federal exclusion check read zero for two days after OIG changed its file).
 *
 * Same safety design as prior send scripts: dry-run by default, --confirm to
 * send, --preview writes the HTML and exits, --email / --limit narrow
 * targeting, 250ms throttle, in-blast dedup, plain semantic HTML.
 *
 * Every number here is read from frontend/public/api/v1 at 2026-10-07:
 * release-deltas.json, role-gap-delta.json, findings/ndh-payer-endpoint-coverage.json,
 * findings/practitioner-phone-reachability.json, states/pa-connectivity.json,
 * findings/oig-leie-exclusions.json.
 *
 * Required env: RESEND_API_KEY, RESEND_FROM_ADDRESS, POSTGRES_PRISMA_URL
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT =
  'AINPI: the provider directory got a quarter smaller, and almost nobody fell out of it';
const REPORT_URL = 'https://ainpi.dev/reports/2026-10-14-update';
const PAYER_URL = 'https://ainpi.dev/findings/ndh-payer-endpoint-coverage';
const MEASURES_URL = 'https://ainpi.dev/api/v1/measures.json';
const LISTING_URL =
  'https://marketplace.databricks.com/details/6cf064b7-1fca-4a8f-addf-03ffd8bfdfd6/FHIR-IQ_CMS-National-Provider-Directory-Release-Archive';
const LEIE_URL = 'https://ainpi.dev/findings/oig-leie-exclusions';
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
      console.log('See header comment in scripts/send-2026-10-14-update.ts');
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

function buildBody(): { text: string; html: string } {
  const text = [
    'AINPI update, 2026-10-14',
    'The directory got a quarter smaller, and almost nobody fell out of it',
    '',
    'The US government published a new version of its national list of',
    'health care providers on 7 October. We reloaded all of it, re-ran',
    'every check we publish, and compared each number with August.',
    '',
    'A QUARTER SMALLER',
    'All records: 32,468,908 in August, 24,761,939 now (-23.7%).',
    'Organizations halved, mostly because 2.1 million records',
    'that carried only a tax label left the file.',
    'Where-they-work records fell from 16.5 million to 11.1 million.',
    '',
    'AND COVERAGE HELD',
    'In Pennsylvania, where we track this most closely, the share of',
    'clinicians with a workplace listed went from 43.7% to 44.0%. The',
    'records that left were mostly second and third entries for people',
    'who already had one.',
    '',
    'INSURERS ARRIVED. NONE HAS A WEB ADDRESS',
    'The file now names 997 health insurers and 7,575 health plans, up',
    'from 27 insurers in August. None of the 997 has a web address in',
    'the directory. 50 addresses that look like insurer directories now',
    'appear, up from 1, and none is connected to an insurer.',
    `Details: ${PAYER_URL}`,
    '',
    'TWO THINGS GOT WORSE',
    '- Phone numbers: 168,778 clinicians now have none listed, against',
    '  about 1,900 in August. Most of them list only a fax.',
    '- In Pennsylvania, the share of clinicians we can connect to a web',
    '  address where software could request patient records from their',
    '  practice fell from 18.7% to 15.8%.',
    '',
    'A CORRECTION',
    'For two days, our federal exclusion check and the high-risk list',
    'built on it showed no excluded providers in the directory. The government changed how its',
    'exclusion file marks empty fields, and our check read every',
    'exclusion as lifted. It is fixed, and the loader now checks the file',
    'first and refuses one like that:',
    '7,799 of 8,924 excluded providers with an NPI appear in the October',
    `directory. ${LEIE_URL}`,
    '',
    'THE AUGUST RELEASE IS KEPT',
    'The government serves only the newest file, so August is gone from',
    'its site. Every release since May, now including October, is in our',
    `free archive on Databricks Marketplace: ${LISTING_URL}`,
    `The measures we track, release by release: ${MEASURES_URL}`,
    '',
    `Read the full update: ${REPORT_URL}`,
    '',
    'This is a measurement of a federal file, not a source of truth about',
    'any individual provider.',
    '',
    'Eugene Vestel, FHIR IQ',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  const rows: [string, string, string][] = [["All records", "32,468,908", "24,761,939"], ["Clinicians", "7,373,232", "7,481,907"], ["Where-they-work records", "16,545,158", "11,056,751"], ["Organizations", "4,402,671", "2,058,500"]];
  const table = rows
    .map(
      ([label, aug, oct]) =>
        `<tr><td style="padding:4px 8px 4px 0;">${escHtml(label)}</td><td style="padding:4px 8px;text-align:right;">${aug}</td><td style="padding:4px 0 4px 8px;text-align:right;font-weight:600;">${oct}</td></tr>`,
    )
    .join('');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#171310;line-height:1.55;background:#faf8f5;">
  <div style="padding:24px 28px 16px;border-bottom:1px solid #d9d2c8;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#6b6259;text-transform:uppercase;">AINPI update · 2026-10-14</div>
    <h1 style="font-size:22px;margin:6px 0 4px;line-height:1.25;">The directory got a quarter smaller, and almost nobody fell out of it</h1>
  </div>

  <div style="padding:20px 28px;border-bottom:1px solid #d9d2c8;">
    <p style="margin:0 0 12px;font-size:15px;">The US government published a new version of its national list of health care providers on 7 October. We reloaded all of it, re-ran every check we publish, and compared each number with August.</p>
    <table style="border-collapse:collapse;font-size:14px;margin:0 0 12px;">
      <tr style="color:#6b6259;font-size:12px;"><td></td><td style="padding:0 8px;text-align:right;">August</td><td style="padding:0 0 0 8px;text-align:right;">October</td></tr>
      ${table}
    </table>
    <p style="margin:0 0 10px;font-size:14px;">Organizations halved, mostly because 2.1 million records that carried only a tax label left the file.</p>
    <p style="margin:0;font-size:14px;"><strong>Coverage held.</strong> In Pennsylvania, where we track this most closely, the share of clinicians with a workplace listed went from 43.7% to 44.0%. Most of the records that left were second and third entries for people who already had one.</p>
  </div>

  <div style="padding:20px 28px;background:#fff;border-bottom:1px solid #d9d2c8;">
    <h2 style="font-size:17px;margin:0 0 8px;">Insurers arrived. None has a web address</h2>
    <p style="margin:0 0 10px;font-size:14px;">The file now names <strong>997 health insurers</strong> and 7,575 health plans, up from 27 insurers in August. <strong>None of the 997 has a web address in the directory.</strong></p>
    <p style="margin:0;font-size:14px;">50 addresses that look like insurer directories now appear, up from 1, and none is connected to an insurer. <a href="${PAYER_URL}" style="color:#08519c;">The details</a>.</p>
  </div>

  <div style="padding:20px 28px;border-bottom:1px solid #d9d2c8;">
    <h2 style="font-size:17px;margin:0 0 8px;">Two things got worse</h2>
    <ul style="margin:0;padding-left:18px;font-size:14px;">
      <li style="margin:0 0 8px;"><strong>Phone numbers.</strong> 168,778 clinicians now have none listed, against about 1,900 in August. Most of them list only a fax.</li>
      <li style="margin:0;"><strong>Reaching patient records in Pennsylvania.</strong> The share of clinicians we can connect to a web address where software could request patient records from their practice fell from 18.7% to 15.8%.</li>
    </ul>
  </div>

  <div style="padding:20px 28px;background:#fff;border-bottom:1px solid #d9d2c8;">
    <h2 style="font-size:17px;margin:0 0 8px;">A correction</h2>
    <p style="margin:0;font-size:14px;">For two days, our federal exclusion check and the high-risk list built on it showed no excluded providers in the directory. The government changed how its exclusion file marks empty fields, and our check read every exclusion as lifted. It is fixed, and the loader now checks the file first and refuses one like that: <a href="${LEIE_URL}" style="color:#08519c;">7,799 of 8,924 excluded providers with an NPI</a> appear in the October directory.</p>
  </div>

  <div style="padding:20px 28px;border-bottom:1px solid #d9d2c8;">
    <h2 style="font-size:17px;margin:0 0 8px;">The August release is kept</h2>
    <p style="margin:0;font-size:14px;">The government serves only the newest file, so August is gone from its site. Every release since May, now including October, is in our <a href="${LISTING_URL}" style="color:#08519c;">free archive on Databricks Marketplace</a>. <a href="${MEASURES_URL}" style="color:#08519c;">The measures we track, release by release</a>.</p>
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
  console.log(`URLs:    ${REPORT_URL} | ${PAYER_URL} | ${LEIE_URL} | ${LISTING_URL}`);
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
