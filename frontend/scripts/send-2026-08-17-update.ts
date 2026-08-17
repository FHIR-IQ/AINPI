/**
 * scripts/send-2026-08-17-update.ts
 *
 * 2026-08-17 release blast. Plain language for a general audience: the
 * national directory records a workplace for nearly 8 in 10 nurse
 * practitioners and 1 in 12,995 pharmacy workers, and the split tracks who
 * bills Medicare rather than who provides care.
 *
 * **This blast also carries the 2026-08-16 story.** That report was written,
 * published and registered, and its blast was never sent. Rather than mail
 * two updates in two days, this one leads with the new finding and points at
 * the earlier report in a short second section. If you are copying this file
 * for the next release, drop that section: it is not a standing fixture.
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
  'AINPI: the directory knows doctors, and barely knows nurses and pharmacists';
const REPORT_URL = 'https://ainpi.dev/reports/2026-08-17-update';
const FINDING_URL = 'https://ainpi.dev/findings/role-gap-composition';
const MAP_URL = 'https://ainpi.dev/states/pa/connectivity';
const CSV_URL =
  'https://ainpi.dev/api/v1/findings/role-gap-composition-pa.csv';
const PRIOR_REPORT_URL = 'https://ainpi.dev/reports/2026-08-16-update';
const PRIOR_CSV_URL =
  'https://ainpi.dev/api/v1/findings/endpoint-org-crosswalk.csv';
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
      console.log('See header comment in scripts/send-2026-08-17-update.ts');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

const ROWS: [string, string][] = [
  ['Nurse practitioners and physician assistants', '77.9%'],
  ['Doctors', '69.8%'],
  ['Eye doctors', '62.4%'],
  ['Chiropractors', '39.4%'],
  ['Physical and speech therapists', '19.6%'],
  ['Counselors and social workers', '14.8%'],
  ['Dentists', '4.7%'],
  ['Nurses', '2.7%'],
  ['Pharmacists and pharmacy techs', '1 out of 12,995'],
];

function buildBody(): { text: string; html: string } {
  const text = [
    'The US government keeps a big list of everyone who provides health care.',
    'For each person it is supposed to say where they work. That one fact is',
    'what makes the rest useful.',
    '',
    'We already knew a lot of people were missing it. Nobody had checked who.',
    '',
    'So we checked all 227,727 health workers the list says are active in',
    'Pennsylvania.',
    '',
    'Share with a workplace recorded:',
    '',
    ...ROWS.map(([job, pct]) => `  ${job}: ${pct}`),
    '',
    'Read that last row again. Pennsylvania lists 12,419 pharmacists and 576',
    'pharmacy technicians. Exactly one of them has a workplace recorded.',
    '',
    'WHY IT SPLITS THIS WAY',
    '',
    'The jobs near the top bill Medicare. The ones near the bottom mostly do',
    'not. Dentists are barely in Medicare. Pharmacists bill through the',
    'pharmacy, not as themselves. Counselors are usually paid by Medicaid or',
    'private insurance.',
    '',
    'So the list is not really describing who provides care. It is describing',
    'who bills Medicare, and nothing in it tells you that.',
    '',
    'That matters twice. Any "X% of providers are in the directory" number is',
    'mostly about Medicare-billing jobs. And if you look up a dentist and find',
    'no workplace, you cannot tell which is true. Maybe nothing can reach them.',
    'Maybe the list simply never wrote it down. Those need different fixes.',
    '',
    'WE GUESSED WRONG',
    '',
    'Before running this we wrote down what we expected: that the gap was',
    'mostly filler, like student IDs and equipment suppliers. There is some.',
    'All of it together is 11,858 of 227,727, about 5.2%. Removing it moves',
    'the overall number by roughly one point. Our guess was wrong, and we are',
    'leaving it written down rather than swapping it for the answer we found.',
    '',
    'WE TRIED THE OBVIOUS FIX',
    '',
    'Medicare publishes its own records of where people work, free. We loaded',
    'all of it: four government files, no login. It found workplaces for',
    '95,054 Pennsylvania health workers, and closed 1.9% of the gap. Almost',
    'everyone Medicare knows about was already in the directory. It found the',
    'same people twice, which is the strongest evidence we have that the',
    'pattern above is real.',
    '',
    'A NEW MAP',
    '',
    `We also built a Pennsylvania county map you can zoom: ${MAP_URL}`,
    '',
    'It shows shares, not totals, because a map of totals is just a map of',
    'where people live. Empty counties are striped rather than pale, so you',
    'can tell "nobody here" from "nobody reachable". And the color steps are',
    'uneven on purpose. One county, Montour, has 7,146 health workers and only',
    '17,860 residents, because Geisinger is headquartered there. With even steps',
    'it takes the whole range and flattens the other 66.',
    '',
    'ALSO PUBLISHED, IF YOU MISSED IT',
    '',
    'A separate piece on the web addresses in the same directory. Only 19,334',
    'of 114,071 say who they belong to, about one in six. Nothing is broken,',
    'the names were never filled in. It includes a free list of the ones that',
    'work, and why sixteen software companies have never filled one in.',
    '',
    `  ${PRIOR_REPORT_URL}`,
    `  ${PRIOR_CSV_URL}`,
    '',
    'CHECK OUR WORK',
    '',
    `  Full update:  ${REPORT_URL}`,
    `  How we counted:  ${FINDING_URL}`,
    `  Every person we counted, one row each:  ${CSV_URL}`,
    '',
    'The job categories are not ours. They come from the standard code set',
    'every provider already uses. All of it is public data, and repeating our',
    'work is free.',
    '',
    'Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe (${UNSUB_REPLY}).`,
  ].join('\n');

  const p = 'margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151;';
  const h2 =
    'margin:28px 0 10px;font-size:16px;font-weight:600;color:#111827;';
  const a = 'color:#08519c;';

  const rowsHtml = ROWS.map(
    ([job, pct], i) =>
      `<tr${i === ROWS.length - 1 ? ' style="font-weight:600;"' : ''}>` +
      `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">${job}</td>` +
      `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:right;white-space:nowrap;">${pct}</td>` +
      `</tr>`,
  ).join('');

  const html = `
<div style="padding:28px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="${p}">The US government keeps a big list of everyone who provides health care. For each person it is supposed to say where they work. That one fact is what makes the rest useful.</p>
  <p style="${p}">We already knew a lot of people were missing it. Nobody had checked <strong>who</strong>.</p>
  <p style="${p}">So we checked all 227,727 health workers the list says are active in Pennsylvania.</p>

  <table style="width:100%;border-collapse:collapse;margin:0 0 8px;">
    <thead><tr>
      <th style="padding:6px 10px;border-bottom:2px solid #d1d5db;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;text-align:left;">Job</th>
      <th style="padding:6px 10px;border-bottom:2px solid #d1d5db;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;text-align:right;">Workplace recorded</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <p style="${p}">Read that last row again. Pennsylvania lists 12,419 pharmacists and 576 pharmacy technicians. Exactly one of them has a workplace recorded.</p>

  <h2 style="${h2}">Why it splits this way</h2>
  <p style="${p}">The jobs near the top bill Medicare. The ones near the bottom mostly do not. Dentists are barely in Medicare. Pharmacists bill through the pharmacy, not as themselves. Counselors are usually paid by Medicaid or private insurance.</p>
  <p style="${p}">So the list is not really describing who provides care. It is describing who bills Medicare, and nothing in it tells you that.</p>
  <p style="${p}">That matters twice. Any "X% of providers are in the directory" number is mostly about Medicare-billing jobs. And if you look up a dentist and find no workplace, you cannot tell which is true. Maybe nothing can reach them. Maybe the list simply never wrote it down. Those need different fixes.</p>

  <h2 style="${h2}">We guessed wrong</h2>
  <p style="${p}">Before running this we wrote down what we expected: that the gap was mostly filler, like student IDs and equipment suppliers. There is some. All of it together is 11,858 of 227,727, about 5.2%, which moves the overall number by roughly one point. Our guess was wrong, and we are leaving it written down rather than swapping it for the answer we found.</p>

  <h2 style="${h2}">We tried the obvious fix</h2>
  <p style="${p}">Medicare publishes its own records of where people work, free. We loaded all of it: four government files, no login. It found workplaces for 95,054 Pennsylvania health workers, and closed 1.9% of the gap. Almost everyone Medicare knows about was already in the directory. It found the same people twice, which is the strongest evidence we have that the pattern above is real.</p>

  <h2 style="${h2}">A new map</h2>
  <p style="${p}">We also built a <a href="${MAP_URL}" style="${a}">Pennsylvania county map you can zoom</a>.</p>
  <p style="${p}">It shows shares, not totals, because a map of totals is just a map of where people live. Empty counties are striped rather than pale, so you can tell "nobody here" from "nobody reachable". And the color steps are uneven on purpose. One county, Montour, has 7,146 health workers and only 17,860 residents, because Geisinger is headquartered there. With even steps it takes the whole range and flattens the other 66.</p>

  <h2 style="${h2}">Also published, if you missed it</h2>
  <p style="${p}">A separate piece on the web addresses in the same directory. Only 19,334 of 114,071 say who they belong to, about one in six. Nothing is broken, the names were never filled in. It includes a <a href="${PRIOR_CSV_URL}" style="${a}">free list of the ones that work</a>, and why sixteen software companies have never filled one in.</p>
  <p style="${p}"><a href="${PRIOR_REPORT_URL}" style="${a}">Read that update</a></p>

  <h2 style="${h2}">Check our work</h2>
  <ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.6;color:#374151;">
    <li><a href="${REPORT_URL}" style="${a}">The full update</a></li>
    <li><a href="${FINDING_URL}" style="${a}">How we counted</a></li>
    <li><a href="${CSV_URL}" style="${a}">Every person we counted, one row each</a></li>
  </ul>
  <p style="${p}">The job categories are not ours. They come from the standard code set every provider already uses. All of it is public data, and repeating our work is free.</p>

  <p style="${p}">Eugene Vestel, FHIR IQ</p>
  <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Reply to this email to unsubscribe (${UNSUB_REPLY}).</p>
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
  console.log(`URLs:    ${REPORT_URL} | ${MAP_URL} | ${CSV_URL}`);
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
