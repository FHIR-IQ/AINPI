/**
 * scripts/send-2026-11-substack-invite.ts
 *
 * One-time invitation for the people who subscribed on ainpi.dev before the
 * newsletter moved to Substack (PR "newsletter: one list, on Substack").
 * They signed up for AINPI updates only, so they are invited, not imported:
 * nobody joins the Substack list unless they click the link. This is the last
 * email AINPI sends them through Resend.
 *
 * Same safety design as the release send scripts: dry-run by default,
 * --confirm to send, --preview writes the HTML and exits, --email targets one
 * address, --limit narrows, 250ms throttle, in-blast dedup.
 *
 * --before <ISO time> is required for a list send. Use the time the Substack
 * change was deployed: anyone who subscribed after it signed up on Substack
 * directly and must not get this.
 *
 *   npx tsx scripts/send-2026-11-substack-invite.ts --preview /tmp/invite.html
 *   npx tsx scripts/send-2026-11-substack-invite.ts --email you@example.com --confirm
 *   npx tsx scripts/send-2026-11-substack-invite.ts --before 2026-11-18T15:00:00Z           # dry run
 *   npx tsx scripts/send-2026-11-substack-invite.ts --before 2026-11-18T15:00:00Z --confirm
 *
 * Required env: RESEND_API_KEY, RESEND_FROM_ADDRESS, POSTGRES_PRISMA_URL
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';
import { NEWSLETTER_NAME, SUBSTACK_SIGNUP_PAGE } from '../src/lib/newsletter';

const SUBJECT = 'AINPI updates are moving to Substack';
const FINDINGS_URL = 'https://ainpi.dev/findings';
const UNSUB_REPLY = 'gene@fhiriq.com';
const SEND_THROTTLE_MS = 250;
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || 'AINPI <reports@ainpi.dev>';

interface CliArgs {
  confirm: boolean;
  preview: string | null;
  email: string | null;
  limit: number | null;
  before: Date | null;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { confirm: false, preview: null, email: null, limit: null, before: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--preview') out.preview = argv[++i] ?? null;
    else if (a === '--email') out.email = argv[++i] ?? null;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      out.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } else if (a === '--before') {
      const d = new Date(argv[++i] ?? '');
      if (Number.isNaN(d.getTime())) {
        console.error('--before needs an ISO time, e.g. 2026-11-18T15:00:00Z');
        process.exit(2);
      }
      out.before = d;
    } else if (a === '-h' || a === '--help') {
      console.log('See header comment in scripts/send-2026-11-substack-invite.ts');
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
    `You subscribed to AINPI updates on ainpi.dev. This is the last email you`,
    `will get from this list.`,
    ``,
    `AINPI findings now go out in ${NEWSLETTER_NAME}, my newsletter on Substack.`,
    `It is free. It also carries the Out of the FHIR podcast and essays on FHIR`,
    `and healthcare data, so expect more than AINPI there.`,
    ``,
    `To keep getting the findings, sign up here:`,
    SUBSTACK_SIGNUP_PAGE,
    ``,
    `If you do nothing, you will not be added. The findings stay on the site:`,
    FINDINGS_URL,
    ``,
    `To have your address deleted from ainpi.dev, reply to this email.`,
    ``,
    `Eugene Vestel, FHIR IQ`,
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;line-height:1.55;max-width:560px;margin:0 auto;padding:24px 28px;">
  <p style="margin:0 0 14px;">You subscribed to AINPI updates on ainpi.dev. This is the last email you will get from this list.</p>
  <p style="margin:0 0 14px;">AINPI findings now go out in <em>${NEWSLETTER_NAME}</em>, my newsletter on Substack. It is free. It also carries the <em>Out of the FHIR</em> podcast and essays on FHIR and healthcare data, so expect more than AINPI there.</p>
  <p style="margin:20px 0;text-align:center;">
    <a href="${SUBSTACK_SIGNUP_PAGE}" style="display:inline-block;padding:12px 24px;background:#08519c;color:#fff;text-decoration:none;border-radius:3px;font-weight:700;">Keep getting the findings</a>
  </p>
  <p style="margin:0 0 14px;">If you do nothing, you will not be added. The findings stay on <a href="${FINDINGS_URL}" style="color:#08519c;">the site</a>.</p>
  <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">To have your address deleted from ainpi.dev, reply to this email (<a href="mailto:${UNSUB_REPLY}" style="color:#6b7280;">${UNSUB_REPLY}</a>).</p>
  <p style="margin:0;font-size:13px;color:#6b7280;">Eugene Vestel, FHIR IQ</p>
</div>`.trim();

  return { text, html };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { text, html } = buildBody();

  // Preview runs before every other branch so it can never send by accident.
  if (args.preview) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      args.preview,
      `<!doctype html><meta charset="utf-8"><title>${SUBJECT}</title>` +
        `<div style="background:#f3f4f6;padding:24px 12px;">` +
        `<div style="max-width:600px;margin:0 auto 16px;padding:12px 16px;background:#fff;border:1px solid #e5e7eb;border-radius:4px;font-size:13px;color:#374151;font-family:sans-serif;">` +
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
  console.log('---');
  console.log(text);
  console.log('---');

  if (!args.email && !args.before) {
    console.error(
      'A list send needs --before <deploy time of the Substack change>, so people who signed up on Substack directly are skipped.',
    );
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    let recipients: { email: string }[] = [];
    if (args.email) {
      recipients = [{ email: args.email }];
    } else {
      recipients = await prisma.subscriber.findMany({
        select: { email: true },
        where: { createdAt: { lt: args.before! } },
        orderBy: { createdAt: 'asc' },
        ...(args.limit ? { take: args.limit } : {}),
      });
    }

    const seen = new Set<string>();
    recipients = recipients.filter((r) => {
      const key = r.email.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (!args.confirm) {
      console.log(`[DRY RUN] Would send to ${recipients.length} recipient(s). Pass --confirm to send.`);
      return;
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY is not set; cannot send. Aborting.');
      process.exit(1);
    }
    const resend = new Resend(process.env.RESEND_API_KEY);

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
        process.stderr.write(`  ! ${r.email} ${e instanceof Error ? e.message : String(e)}\n`);
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
