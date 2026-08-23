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
const LANDSCAPE_URL = 'https://ainpi.dev/';
const FINDINGS_URL = 'https://ainpi.dev/findings';
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

/**
 * Role coverage by profession, Pennsylvania, 2026-05-08 -> 2026-08-20.
 * Source: /api/v1/role-gap-delta.json. Sorted by August coverage descending,
 * because the point of the table is the spread between professions, not the
 * size of the change.
 */
const PROFESSION_ROWS: [string, string, string, string][] = [
  // label, May, August, multiple
  ['Nurse practitioners and PAs', '77.9%', '82.0%', '1.0x'],
  ['Doctors', '69.8%', '74.3%', '1.1x'],
  ['Foot doctors', '61.6%', '69.3%', '1.1x'],
  ['Eye doctors', '62.4%', '67.7%', '1.1x'],
  ['Chiropractors', '39.4%', '46.2%', '1.1x'],
  ['Students and residents', '6.5%', '27.4%', '4.1x'],
  ['Physical and speech therapists', '19.6%', '24.6%', '1.3x'],
  ['Dietitians', '18.4%', '24.1%', '1.3x'],
  ['Counselors and social workers', '14.8%', '22.9%', '1.5x'],
  ['Dentists', '4.7%', '13.3%', '2.7x'],
  ['Aides and technicians', '0.4%', '7.8%', '17.5x'],
  ['Nurses', '2.7%', '4.8%', '1.7x'],
  ['Pharmacists', '0.008%', '4.2%', '526x'],
];

/** Row counts per resource type. Source: /api/v1/release-deltas.json. */
const FILE_ROWS: [string, string, string, string][] = [
  ['Where people work', '7,028,001', '16,545,158', '+135%'],
  ['Places', '1,362,869', '2,535,686', '+86%'],
  ['Organizations', '3,414,375', '4,402,671', '+29%'],
  ['Clinicians', '7,441,211', '7,373,232', '-1%'],
  ['Web addresses', '1,360,585', '1,128,169', '-17%'],
  ['Organization links', '1,086,694', '483,992', '-56%'],
];

/** Quality measures that improved. */
const BETTER_ROWS: [string, string, string][] = [
  ['Clinicians with a workplace (PA)', '38.1%', '43.7%'],
  ['Places with a phone number', '0%', '79.0%'],
  ['Places with map coordinates', '93.9%', '98.3%'],
  ['Workplaces with a phone number', '74.9%', '83.9%'],
  ['Parent-organization links that resolve', '0%', '100%'],
  ['Social Security numbers exposed', '41', '0'],
  ['Clinicians with a workplace (national)', '27%', '31%'],
];

/** Quality measures that regressed. */
const WORSE_ROWS: [string, string, string][] = [
  ['Machine-readable addresses naming their owner', '16.9%', '14.7%'],
  ['Usable machine-readable addresses', '114,071', '110,973'],
  ['Organizations with a phone number', '99.9%', '95.6%'],
  ['Organization-to-organization links', '1,086,694', '483,992'],
  ['Clinicians reachable end to end (PA)', '19.3%', '18.7%'],
];

function buildBody(): { text: string; html: string } {
  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
  const lpad = (s: string, n: number) => ' '.repeat(Math.max(0, n - s.length)) + s;

  const textTable = (
    head: string[],
    rows: string[][],
    widths: number[],
  ): string[] => [
    '  ' + head.map((h, i) => (i === 0 ? pad(h, widths[i]) : lpad(h, widths[i]))).join('  '),
    '  ' + widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map(
      (r) =>
        '  ' + r.map((c, i) => (i === 0 ? pad(c, widths[i]) : lpad(c, widths[i]))).join('  '),
    ),
  ];

  const text = [
    'CMS published a new version of the national provider directory on',
    '20 August. It is the largest change since we started measuring. We',
    'reloaded all 45 GB and re-ran our measurements against the previous',
    'version.',
    '',
    'This is the breakdown. Every number below is on the site as data you can',
    'download and recompute.',
    '',
    '1. THE FILE ITSELF',
    '',
    ...textTable(['Record type', 'May', 'August', 'Change'], FILE_ROWS.map((r) => [...r]), [30, 12, 12, 8]),
    '',
    'The directory grew by half, from 21.7 million records to 32.5 million.',
    'Almost all of that growth is in one place: the records saying where a',
    'clinician works. Nearly ten million new ones.',
    '',
    '2. WHO THE DIRECTORY CAN DESCRIBE',
    '',
    'Ten million records did not translate into ten million newly described',
    'clinicians. In Pennsylvania, where we track this closely, the share with',
    'a workplace listed went from 38.1% to 43.7%. Nationally, 27% to 31%.',
    '',
    'The reason is that most new records went to people who already had one.',
    'The average covered clinician went from about 2 workplace records to',
    'about 4.7. The directory got more detailed about the people it already',
    'knew, and somewhat better at covering new ones. Those are different',
    'achievements and a record count cannot tell them apart.',
    '',
    'Broken out by profession, Pennsylvania:',
    '',
    ...textTable(
      ['Profession', 'May', 'August', 'Multiple'],
      PROFESSION_ROWS.map((r) => [...r]),
      [32, 9, 9, 9],
    ),
    '',
    'Every profession improved. The gradient is the story: a nurse',
    'practitioner is still roughly twenty times more likely to have a',
    'workplace listed than a pharmacist. In May it was ten thousand times.',
    'The gap tracks who bills Medicare rather than who provides care, and it',
    'is now much narrower without having changed shape.',
    '',
    '3. WHAT GOT BETTER',
    '',
    ...textTable(['Measure', 'May', 'August'], BETTER_ROWS.map((r) => [...r]), [38, 10, 10]),
    '',
    'Two of those deserve a sentence. Places in the directory carried no phone',
    'numbers at all in May and now carry one for four in five. And the field',
    'that says one organization belongs to a larger one pointed at nothing',
    '148,834 times in May; it now resolves completely, across 140,017',
    'references to 43,551 parent organizations.',
    '',
    '4. WHAT GOT WORSE',
    '',
    ...textTable(['Measure', 'May', 'August'], WORSE_ROWS.map((r) => [...r]), [38, 12, 12]),
    '',
    'The important one is the first. A web address in this directory is only',
    'useful if you know whose it is, and fewer of them say. 16,262 of 110,973',
    'name an owner you can look up. We do not know why it fell. The total',
    'number of addresses fell too, so some of this is deletion rather than',
    'lost names, and we cannot separate the two.',
    '',
    'The last row is the one to watch. Pennsylvania gained five points of',
    'workplace coverage and lost half a point of end-to-end reach, because',
    'the newly described workplaces were mostly organizations that publish no',
    'address. Coverage and reachability are not the same thing and this',
    'release moved them in opposite directions.',
    '',
    '5. WHAT ARRIVED',
    '',
    'Health insurers are in the directory for the first time: 233 health plans',
    'owned by 27 insurers, under a category that did not exist in May.',
    '',
    'Every one of the 27 is named. None publishes an address software can',
    'call. You can now look up who an insurer is and still not reach them.',
    '',
    'A second new record type, meant to describe the services an organization',
    'offers, arrived effectively empty: 54,445 of them, of which 0.5% name a',
    'location and exactly one names the organization providing the service.',
    '',
    '6. THE CHAIN, END TO END',
    '',
    'For a patient app to find your records it has to get from you to a',
    'clinician, to where they work, to an organization, to a working address.',
    'Every link has to hold. Pennsylvania, August:',
    '',
    '  230,837 clinicians listed',
    '   43.7% have a workplace                       100,918',
    '   42.7% of those reach an address               43,060',
    '   18.7% of all clinicians reach an address',
    '',
    'That last number is the honest one, and it is not this directory on its',
    'own. Reaching 43,060 takes the directory plus vendor endpoint files plus',
    'Medicare enrollment records. The directory by itself reaches 2,461.',
    'Four in five clinicians in the state cannot be reached by software at',
    'all, and the reason is not one broken link but a chain where each link',
    'loses some.',
    '',
    'EXPLORE IT',
    '',
    'The numbers above are summaries. The site is built for pulling them',
    'apart by state, profession and organization:',
    '',
    `  Every state, scored:              ${LANDSCAPE_URL}`,
    `  Pennsylvania, the whole chain:    ${MAP_URL}`,
    `  All findings:                     ${FINDINGS_URL}`,
    `  This update in full:              ${REPORT_URL}`,
    `  Profession by profession, data:   ${PROFESSION_DELTA_URL}`,
    `  Every number as data:             ${CSV_URL}`,
    `  Plain-language guide:             ${PRIMER_URL}`,
    '',
    'COMING SHORTLY: THE RELEASE ARCHIVE, AS OPEN TABLES',
    '',
    'CMS publishes only the current version of the directory. When a new one',
    'lands, the previous one is gone from the source. We have kept them, and',
    'we are publishing that archive on the Databricks Marketplace shortly. It',
    'will be free: six tables, one per record type, split by version, so',
    'comparing two releases is a filter rather than a download. It is served',
    'over open Delta Sharing, so reading it needs a Python package and no',
    'Databricks account.',
    '',
    'Here is the kind of question that answers. It is a different pair of',
    'releases from section 4, and it does not explain the fall reported there.',
    'Between the April and May releases the count of web addresses fell 73%,',
    'from 5,043,524 to 1,360,585, which reads as mass deletion. It was not.',
    'April listed each address 3.9 times over on',
    'average; May listed it 1.05 times. Of 1,300,241 distinct addresses in',
    'April, 1,299,999 were still there in May. CMS removed duplicate rows, not',
    'addresses, and anyone who read the April figure as a count of addresses',
    'was counting nearly four times over. You can only see that if someone',
    'kept April. Nobody has to keep it twice.',
    '',
    'WE ARE LOOKING FOR INTEGRATION PARTNERS',
    '',
    'If you are at a provider or payer organization working with directory',
    'data, and your team would rather query a maintained copy than ingest and',
    'reconcile this themselves, reply to this email. We want to hear what you',
    'need out of it before we finish building it.',
    '',
    'TWO CORRECTIONS',
    '',
    'We said publicly that the parent-organization field was broken. It works',
    'now, so if you built around it being useless, rebuild. And in June we',
    'reported that the location path added no phone numbers; that is no longer',
    'true, as above.',
    '',
    'All of it is public data and the scripts are open, so you can check any',
    'of it.',
    '',
    'Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe (${UNSUB_REPLY}).`,
  ].join('\n');

  const p = 'margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151;';
  const h2 = 'margin:30px 0 10px;font-size:16px;font-weight:600;color:#111827;';
  const a = 'color:#08519c;';
  const th =
    'padding:6px 10px;border-bottom:2px solid #d1d5db;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;';
  const td = 'padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;';
  const tdN =
    'padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;';

  const htmlTable = (head: string[], rows: string[][], accent?: string) => `
  <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
    <thead><tr>${head
      .map(
        (h, i) =>
          `<th style="${th}text-align:${i === 0 ? 'left' : 'right'};">${h}</th>`,
      )
      .join('')}</tr></thead>
    <tbody>${rows
      .map(
        (r) =>
          `<tr>${r
            .map((c, i) =>
              i === 0
                ? `<td style="${td}">${c}</td>`
                : `<td style="${tdN}${
                    accent && i === r.length - 1 ? `color:${accent};font-weight:600;` : ''
                  }">${c}</td>`,
            )
            .join('')}</tr>`,
      )
      .join('')}</tbody>
  </table>`;

  const html = `
<div style="padding:28px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="${p}">CMS published a new version of the national provider directory on 20 August. It is the largest change since we started measuring. We reloaded all 45 GB and re-ran our measurements against the previous version.</p>
  <p style="${p}">This is the breakdown. Every number below is on the site as data you can download and recompute.</p>

  <h2 style="${h2}">1. The file itself</h2>
  ${htmlTable(['Record type', 'May', 'August', 'Change'], FILE_ROWS.map((r) => [...r]))}
  <p style="${p}">The directory grew by half, from 21.7 million records to 32.5 million. Almost all of that growth is in one place: the records saying where a clinician works. Nearly ten million new ones.</p>

  <h2 style="${h2}">2. Who the directory can describe</h2>
  <p style="${p}">Ten million records did not translate into ten million newly described clinicians. In Pennsylvania, where we track this closely, the share with a workplace listed went from 38.1% to 43.7%. Nationally, 27% to 31%.</p>
  <p style="${p}">The reason is that most new records went to people who already had one. The average covered clinician went from about 2 workplace records to about 4.7. The directory got more detailed about the people it already knew, and somewhat better at covering new ones. Those are different achievements and a record count cannot tell them apart.</p>
  <p style="${p}">Broken out by profession, Pennsylvania:</p>
  ${htmlTable(['Profession', 'May', 'August', 'Multiple'], PROFESSION_ROWS.map((r) => [...r]), '#08519c')}
  <p style="${p}">Every profession improved. The gradient is the story: a nurse practitioner is still roughly twenty times more likely to have a workplace listed than a pharmacist. In May it was ten thousand times. The gap tracks who bills Medicare rather than who provides care, and it is now much narrower without having changed shape.</p>

  <h2 style="${h2}">3. What got better</h2>
  ${htmlTable(['Measure', 'May', 'August'], BETTER_ROWS.map((r) => [...r]))}
  <p style="${p}">Two of those deserve a sentence. Places in the directory carried no phone numbers at all in May and now carry one for four in five. And the field that says one organization belongs to a larger one pointed at nothing 148,834 times in May; it now resolves completely, across 140,017 references to 43,551 parent organizations.</p>

  <h2 style="${h2}">4. What got worse</h2>
  ${htmlTable(['Measure', 'May', 'August'], WORSE_ROWS.map((r) => [...r]), '#a8321c')}
  <p style="${p}">The important one is the first. A web address in this directory is only useful if you know whose it is, and fewer of them say. 16,262 of 110,973 name an owner you can look up. We do not know why it fell. The total number of addresses fell too, so some of this is deletion rather than lost names, and we cannot separate the two.</p>
  <p style="${p}">The last row is the one to watch. Pennsylvania gained five points of workplace coverage and lost half a point of end-to-end reach, because the newly described workplaces were mostly organizations that publish no address. Coverage and reachability are not the same thing and this release moved them in opposite directions.</p>

  <h2 style="${h2}">5. What arrived</h2>
  <p style="${p}">Health insurers are in the directory for the first time: 233 health plans owned by 27 insurers, under a category that did not exist in May.</p>
  <p style="${p}">Every one of the 27 is named. None publishes an address software can call. You can now look up who an insurer is and still not reach them.</p>
  <p style="${p}">A second new record type, meant to describe the services an organization offers, arrived effectively empty: 54,445 of them, of which 0.5% name a location and exactly one names the organization providing the service.</p>

  <h2 style="${h2}">6. The chain, end to end</h2>
  <p style="${p}">For a patient app to find your records it has to get from you to a clinician, to where they work, to an organization, to a working address. Every link has to hold. Pennsylvania, August:</p>
  <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
    <tbody>
      <tr><td style="${td}">Clinicians listed</td><td style="${tdN}">230,837</td></tr>
      <tr><td style="${td}">Have a workplace <span style="color:#6b7280;">(43.7%)</span></td><td style="${tdN}">100,918</td></tr>
      <tr><td style="${td}">Reach an address <span style="color:#6b7280;">(42.7% of those)</span></td><td style="${tdN}">43,060</td></tr>
      <tr><td style="${td}"><strong>Reachable end to end</strong></td><td style="${tdN}color:#a8321c;font-weight:600;">18.7%</td></tr>
    </tbody>
  </table>
  <p style="${p}">That last number is the honest one, and it is not this directory on its own. Reaching 43,060 takes the directory plus vendor endpoint files plus Medicare enrollment records. The directory by itself reaches 2,461. Four in five clinicians in the state cannot be reached by software at all, and the reason is not one broken link but a chain where each link loses some.</p>

  <h2 style="${h2}">Explore it</h2>
  <p style="${p}">The numbers above are summaries. The site is built for pulling them apart by state, profession and organization.</p>
  <ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.6;color:#374151;">
    <li><a href="${LANDSCAPE_URL}" style="${a}">Every state and specialty, scored on six dimensions</a></li>
    <li><a href="${MAP_URL}" style="${a}">Pennsylvania, the whole chain, with county maps</a></li>
    <li><a href="${FINDINGS_URL}" style="${a}">All findings</a></li>
    <li><a href="${REPORT_URL}" style="${a}">This update in full</a></li>
    <li><a href="${PROFESSION_DELTA_URL}" style="${a}">Profession by profession, as data</a></li>
    <li><a href="${CSV_URL}" style="${a}">Every number as data</a></li>
    <li><a href="${PRIMER_URL}" style="${a}">Plain-language guide to all of it</a></li>
  </ul>

  <h2 style="${h2}">Coming shortly: the release archive, as open tables</h2>
  <p style="${p}">CMS publishes only the current version of the directory. When a new one lands, the previous one is gone from the source. We have kept them, and we are publishing that archive on the Databricks Marketplace shortly. It will be free: six tables, one per record type, split by version, so comparing two releases is a filter rather than a download. It is served over open Delta Sharing, so reading it needs a Python package and no Databricks account.</p>
  <p style="${p}">Here is the kind of question that answers. It is a different pair of releases from section 4, and it does not explain the fall reported there. Between the April and May releases the count of web addresses fell 73%, from 5,043,524 to 1,360,585, which reads as mass deletion. It was not. April listed each address 3.9 times over on average; May listed it 1.05 times. Of 1,300,241 distinct addresses in April, 1,299,999 were still there in May. CMS removed duplicate rows, not addresses, and anyone who read the April figure as a count of addresses was counting nearly four times over. You can only see that if someone kept April. Nobody has to keep it twice.</p>

  <h2 style="${h2}">We are looking for integration partners</h2>
  <p style="${p}">If you are at a provider or payer organization working with directory data, and your team would rather query a maintained copy than ingest and reconcile this themselves, reply to this email. We want to hear what you need out of it before we finish building it.</p>

  <h2 style="${h2}">Two corrections</h2>
  <p style="${p}">We said publicly that the parent-organization field was broken. It works now, so if you built around it being useless, rebuild. And in June we reported that the location path added no phone numbers; that is no longer true, as above.</p>

  <p style="${p}">All of it is public data and the scripts are open, so you can check any of it.</p>
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
  console.log(`URLs:    ${REPORT_URL} | ${LANDSCAPE_URL} | ${MAP_URL} | ${CSV_URL}`);
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
