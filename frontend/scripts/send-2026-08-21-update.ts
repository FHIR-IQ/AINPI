/**
 * scripts/send-2026-08-21-update.ts
 *
 * 2026-08-21 release blast. Plain language for a general audience, covering
 * the reload from the 2026-08-20 NDH release: where-they-work records went
 * from 7.0M to 16.5M while coverage moved only five points, every profession
 * improved, a hierarchy field that resolved to nothing now resolves, and the
 * Social Security numbers we tracked across three releases are gone.
 *
 * It also carries two corrections, which is why they are in the mail rather
 * than only on the site. We told subscribers a field was broken and it is now
 * fixed, and we caught a check of our own that would have flagged 245,374
 * working clinicians as ghosts because our reference data was stale.
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
  'AINPI: the provider directory just changed a lot, here is what moved';
const REPORT_URL = 'https://ainpi.dev/reports/2026-08-21-update';
const FINDING_URL = 'https://ainpi.dev/findings/ndh-new-resource-types';
const MAP_URL = 'https://ainpi.dev/states/pa/connectivity';
const CSV_URL = 'https://ainpi.dev/api/v1/release-deltas.json';
const PROFESSION_DELTA_URL = 'https://ainpi.dev/api/v1/role-gap-delta.json';
const PRIMER_URL = 'https://ainpi.dev/primer';
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
      console.log('See header comment in scripts/send-2026-08-21-update.ts');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

const ROWS: [string, string][] = [
  ['Nurse practitioners and PAs', '77.9%  ->  82.0%'],
  ['Doctors', '69.8%  ->  74.3%'],
  ['Chiropractors', '39.4%  ->  46.2%'],
  ['Physical and speech therapists', '19.6%  ->  24.6%'],
  ['Counselors and social workers', '14.8%  ->  22.9%'],
  ['Dentists', '4.7%  ->  13.3%'],
  ['Nurses', '2.7%  ->  4.8%'],
  ['Pharmacists', '1 person  ->  526'],
];

function buildBody(): { text: string; html: string } {
  const text = [
    'CMS published a new version of the national provider directory on',
    '20 August. It is not a routine refresh. We reloaded all 45 GB of it and',
    're-ran every measurement against the previous version.',
    '',
    'Seven things moved. Two are corrections: one to something we told you',
    'was broken, and one to a check of our own that was wrong.',
    '',
    '1. THE WHERE-THEY-WORK RECORDS MORE THAN DOUBLED',
    '',
    'The most important fact in the directory is where each clinician works.',
    'Without it, software cannot find your records. There were 7.0 million of',
    'those records. Now there are 16.5 million.',
    '',
    '2. BUT COVERAGE ONLY MOVED FIVE POINTS',
    '',
    'Adding 6.9 million active records moved the share of clinicians who have',
    'a workplace at all from 27% to 31% nationally. In Pennsylvania, 38.1% to',
    '43.7%.',
    '',
    'Most of the new records went to people who already had one. The average',
    'covered clinician went from about 2 records to about 4.7. The directory',
    'got much more detailed about the people it already described, and only',
    'somewhat better at describing new ones. Those are different things, and',
    'the headline count hides which happened.',
    '',
    '3. LAST WEEK WE TOLD YOU 1 PHARMACIST IN 12,995 HAD A WORKPLACE',
    '',
    'That is now 526. Here is the same table we sent you, before and after:',
    '',
    ...ROWS.map(([job, pct]) => `  ${job}: ${pct}`),
    '',
    'Every profession improved, and the biggest jumps are at the bottom of the',
    'table where the gaps were worst. The pattern we described is still there,',
    'a nurse practitioner is still far more likely to be covered than a',
    'pharmacist, but it is a much smaller gap than it was.',
    '',
    'We published that finding a few days before this release. We have no',
    'reason to think the two are connected, and we are not claiming credit',
    'for it.',
    '',
    '4. SOMETHING WE SAID WAS BROKEN IS NOW FIXED',
    '',
    'The directory has a field for saying one organization is part of a larger',
    'one. In the last release it was filled in 148,834 times and every single',
    'one pointed at an organization that was not in the file. It led nowhere.',
    'We said so publicly, and told people building on this not to rely on it.',
    '',
    'It works now. 140,017 links, 43,551 parent organizations, none missing.',
    'If you built around that field being useless, rebuild. We were right',
    'about the old release and we are glad to be wrong about this one.',
    '',
    '5. HEALTH INSURERS APPEARED, AND ONE NUMBER WENT BACKWARDS',
    '',
    'The directory now carries 233 health plans from 27 insurers, filed under',
    'a category that did not exist before. You can look up who an insurer is.',
    'You still cannot reach them: none publishes a working address for',
    'software. Identity arrived, reachability did not.',
    '',
    'And the share of web addresses that say who they belong to fell, from',
    '16.9% to 14.7%. We do not know why, and we would rather say that than',
    'guess. It is the one number that moved the wrong way and we are not',
    'burying it.',
    '',
    '6. THE SOCIAL SECURITY NUMBERS ARE GONE',
    '',
    'The Washington Post reported last year that this file contained doctors\'',
    'Social Security numbers. We checked ourselves and found 46 in April and',
    '41 in May. In this release there are none, in any of the 7,373,232',
    'records.',
    '',
    'A search that finds nothing looks the same as a search pointed at the',
    'wrong place, so we checked that ours still works. 7,371,126 records still',
    'contain the field the numbers used to sit in. The field is there. The',
    'numbers are not. 46, then 41, then zero.',
    '',
    '7. WE ALMOST SENT YOU A FALSE ALARM ABOUT 245,000 PROVIDERS',
    '',
    'One of our checks compares the directory against the federal registry of',
    'providers. This time it said 245,374 people were in the directory but not',
    'in the registry.',
    '',
    'That was our mistake. The public copy of the registry we compare against',
    'stops in February, and this release is from August, so everyone who',
    'registered in between looked like a ghost. We picked eight at random and',
    'looked them up. All eight were real, active providers.',
    '',
    'We have changed the check so it scores nothing while our reference data',
    'is behind. We are telling you because you would have had no way to know.',
    '',
    'While we were at it we found the same shape of problem in two other',
    'places: a code change that made every specialty look invalid, and a',
    'failed download that made it look like software vendors publish nothing.',
    'None of the three raised an error. Each returned a zero that read like a',
    'finding. The full update walks through all of them.',
    '',
    'CHECK OUR WORK',
    '',
    `  Full update:  ${REPORT_URL}`,
    `  Every number as data:  ${CSV_URL}`,
    `  Profession by profession:  ${PROFESSION_DELTA_URL}`,
    `  Plain-language guide to all of it:  ${PRIMER_URL}`,
    '',
    'All of it is public data. We reloaded the whole thing and re-ran every',
    'measurement, and the scripts are open, so you can check any of it.',
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
  <p style="${p}">CMS published a new version of the national provider directory on 20 August. It is not a routine refresh. We reloaded all 45 GB of it and re-ran every measurement against the previous version.</p>
  <p style="${p}">Seven things moved. Two are corrections: one to something we told you was broken, and one to a check of our own that was wrong.</p>

  <h2 style="${h2}">1. The where-they-work records more than doubled</h2>
  <p style="${p}">The most important fact in the directory is where each clinician works. Without it, software cannot find your records. There were 7.0 million of those records. Now there are 16.5 million.</p>

  <h2 style="${h2}">2. But coverage only moved five points</h2>
  <p style="${p}">Adding 6.9 million active records moved the share of clinicians who have a workplace at all from 27% to 31% nationally. In Pennsylvania, 38.1% to 43.7%.</p>
  <p style="${p}">Most of the new records went to people who already had one. The average covered clinician went from about 2 records to about 4.7. The directory got much more detailed about the people it already described, and only somewhat better at describing new ones. Those are different things, and the headline count hides which happened.</p>

  <h2 style="${h2}">3. Last week we told you 1 pharmacist in 12,995 had a workplace</h2>
  <p style="${p}">That is now 526. Here is the same table we sent you, before and after.</p>
  <table style="width:100%;border-collapse:collapse;margin:0 0 14px;">
    <thead><tr>
      <th style="padding:6px 10px;border-bottom:2px solid #d1d5db;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;text-align:left;">Job</th>
      <th style="padding:6px 10px;border-bottom:2px solid #d1d5db;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;text-align:right;">May to August</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p style="${p}">Every profession improved, and the biggest jumps are at the bottom of the table where the gaps were worst. The pattern we described is still there, a nurse practitioner is still far more likely to be covered than a pharmacist, but it is a much smaller gap than it was.</p>
  <p style="${p}">We published that finding a few days before this release. We have no reason to think the two are connected, and we are not claiming credit for it.</p>

  <h2 style="${h2}">4. Something we said was broken is now fixed</h2>
  <p style="${p}">The directory has a field for saying one organization is part of a larger one. In the last release it was filled in 148,834 times and every single one pointed at an organization that was not in the file. It led nowhere. We said so publicly, and told people building on this not to rely on it.</p>
  <p style="${p}">It works now. 140,017 links, 43,551 parent organizations, none missing. If you built around that field being useless, rebuild. We were right about the old release and we are glad to be wrong about this one.</p>

  <h2 style="${h2}">5. Health insurers appeared, and one number went backwards</h2>
  <p style="${p}">The directory now carries 233 health plans from 27 insurers, filed under a category that did not exist before. You can look up who an insurer is. You still cannot reach them: none publishes a working address for software. Identity arrived, reachability did not.</p>
  <p style="${p}">And the share of web addresses that say who they belong to fell, from 16.9% to 14.7%. We do not know why, and we would rather say that than guess. It is the one number that moved the wrong way and we are not burying it.</p>

  <h2 style="${h2}">6. The Social Security numbers are gone</h2>
  <p style="${p}">The Washington Post reported last year that this file contained doctors' Social Security numbers. We checked ourselves and found 46 in April and 41 in May. In this release there are none, in any of the 7,373,232 records.</p>
  <p style="${p}">A search that finds nothing looks the same as a search pointed at the wrong place, so we checked that ours still works. 7,371,126 records still contain the field the numbers used to sit in. The field is there. The numbers are not. 46, then 41, then zero.</p>

  <h2 style="${h2}">7. We almost sent you a false alarm about 245,000 providers</h2>
  <p style="${p}">One of our checks compares the directory against the federal registry of providers. This time it said 245,374 people were in the directory but not in the registry.</p>
  <p style="${p}">That was our mistake. The public copy of the registry we compare against stops in February, and this release is from August, so everyone who registered in between looked like a ghost. We picked eight at random and looked them up. All eight were real, active providers. We have changed the check so it scores nothing while our reference data is behind. We are telling you because you would have had no way to know.</p>
  <p style="${p}">While we were at it we found the same shape of problem in two other places: a code change that made every specialty look invalid, and a failed download that made it look like software vendors publish nothing. None of the three raised an error. Each returned a zero that read like a finding. <a href="${REPORT_URL}" style="${a}">The full update</a> walks through all of them.</p>

  <h2 style="${h2}">Check our work</h2>
  <ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.6;color:#374151;">
    <li><a href="${REPORT_URL}" style="${a}">The full update</a></li>
    <li><a href="${CSV_URL}" style="${a}">Every number as data</a></li>
    <li><a href="${PROFESSION_DELTA_URL}" style="${a}">Profession by profession</a></li>
    <li><a href="${PRIMER_URL}" style="${a}">Plain-language guide to all of it</a></li>
  </ul>
  <p style="${p}">All of it is public data. We reloaded the whole thing and re-ran every measurement, and the scripts are open, so you can check any of it.</p>

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
