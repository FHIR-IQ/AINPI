/**
 * scripts/send-2026-06-04-update.ts
 *
 * 2026-06-04 follow-up — two methodology clarifications surfaced by a sharp
 * reader within 48h of the 2026-06-02 release. Same safety design as
 * send-2026-06-02-update.ts (dry-run by default, --confirm to send,
 * --email / --limit narrow targeting, 250ms throttle, plain-prose HTML
 * with no marketing chrome).
 *
 * Required env:
 *   RESEND_API_KEY
 *   RESEND_FROM_ADDRESS (optional; defaults to onboarding@resend.dev)
 *   POSTGRES_PRISMA_URL
 *
 * Usage from frontend/:
 *
 *   # 1. Dry-run (no DB hit, prints body):
 *   npx tsx scripts/send-2026-06-04-update.ts
 *
 *   # 2. Preview to one address:
 *   npx tsx scripts/send-2026-06-04-update.ts --email gene@fhiriq.com --confirm
 *
 *   # 3. Smoke test on first 2 real subscribers:
 *   npx tsx scripts/send-2026-06-04-update.ts --limit 2 --confirm
 *
 *   # 4. Full blast:
 *   npx tsx scripts/send-2026-06-04-update.ts --confirm
 */
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const SUBJECT =
  'AINPI follow-up — two methodology clarifications from a sharp reader';
const FINDING_URL = 'https://ainpi.dev/findings/endpoint-liveness';
const PROBE_REPO = 'https://github.com/FHIR-IQ/ainpi-probe';
const POLICY_URL = 'https://ainpi.dev/real-health-providers';
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
      console.log('See header comment in scripts/send-2026-06-04-update.ts');
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
    'Two days after the 2026-06-02 release, a smart and knowledgeable',
    'reader sent two questions about the methodology. Both worth',
    'publishing because the whole point of an open audit substrate is',
    'that smart readers catch what you missed.',
    '',
    "Question 1: what's the denominator on endpoint reachability?",
    '',
    'The page reports "85.4% of FHIR-REST endpoints answer with a',
    'parseable CapabilityStatement." The natural reading is "85% of',
    'practitioners are reachable." That reading is wrong, and it',
    'overstates patient access.',
    '',
    'The actual chain:',
    '  - 5,043,524 Endpoint resources in the 2026-04-09 NDH release',
    '  - Filter to FHIR REST connection type',
    '  - Dedupe to unique hostnames (many endpoint records share a base URL)',
    '  - Result: 2,974 distinct FHIR-REST hosts',
    '  - 85.4% of those serve a parseable CapabilityStatement',
    '',
    'Practitioner-level reachability is dramatically lower because 98.7%',
    'of organizations in the federal directory carry zero Endpoint',
    'references at all. Even when a host is alive, only a small share of',
    'practitioners hang off it via the practitioner -> role ->',
    'managing_org -> endpoint chain.',
    '',
    'Updating the methodology page to make the host-level vs',
    'practitioner-level distinction explicit. The numbers do not change;',
    'the framing does.',
    '',
    'Question 2: are you pinging endpoints through Claude or a script?',
    '',
    'A real script. The probe is a standalone Python crawler at',
    `${PROBE_REPO}, separated from the site repo specifically so`,
    'operators can audit (or whitelist) just the probe code without',
    'inspecting the whole platform. Named User-Agent. Stable IP ranges',
    'via GitHub Actions. Accept header advertising FHIR JSON.',
    '',
    'But the underlying question — anti-bot filtering — is broader than',
    'AINPI. Everyone doing FHIR audit work hits it now. Three flavors of',
    'block, three different fixes:',
    '',
    '  - TLS fingerprint blocking (Akamai, Cloudflare): plain Python',
    '    urllib and httpx get 403d even with valid headers. Shelling out',
    '    to curl via subprocess works because curl uses the system TLS',
    '    stack and gets fingerprinted as a real client.',
    '',
    '  - User-Agent blocking: stable named UA plus a published allowlist',
    '    path so ops teams can whitelist intentionally.',
    '',
    '  - Vendor-specific agent blocking: some EHR and payer systems',
    '    explicitly block calls originating from LLM agents (Claude, GPT,',
    '    etc.) regardless of UA. Different fix — requires a fixed egress',
    '    IP allowlisted in advance.',
    '',
    'The unspoken implication for CMS scoring methodology: if directory',
    'accuracy is going to be measured at scale by 2029, regulators and',
    'plans will hit the same walls. The audit methodology has to be',
    'public enough that vendors can choose to allowlist it without it',
    'being either security-by-obscurity or vendor-by-vendor manual',
    'coordination. That is an unsolved problem worth flagging upstream of',
    'the 2028 CMS scoring RFC.',
    '',
    'The broader point: the open audit substrate premise only works if',
    'smart readers actually push back. This is the loop working.',
    '',
    'If you spot something else that needs sharpening, reply to this',
    'email — same address — and I will dig in.',
    '',
    `Updated finding: ${FINDING_URL}`,
    `Probe repo: ${PROBE_REPO}`,
    `Policy brief: ${POLICY_URL}`,
    '',
    '- Eugene Vestel, FHIR IQ',
    '',
    `Reply to this email to unsubscribe or ask a question (${UNSUB_REPLY}).`,
  ].join('\n');

  // Same plain semantic HTML as the 2026-06-02 send — no gradients, no
  // badges, no CTA stacks, no unicode arrows. Reads as a maintainer
  // update.
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.55; padding: 20px;">

  <p style="margin: 0 0 16px 0;">Two days after the 2026-06-02 release, a smart and knowledgeable reader sent two questions about the methodology. Both worth publishing because the whole point of an open audit substrate is that smart readers catch what you missed.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">Question 1: what is the denominator on endpoint reachability?</h2>

  <p style="margin: 0 0 12px 0;">The page reports "85.4% of FHIR-REST endpoints answer with a parseable CapabilityStatement." The natural reading is "85% of practitioners are reachable." That reading is wrong, and it overstates patient access.</p>

  <p style="margin: 0 0 8px 0;">The actual chain:</p>

  <ul style="margin: 0 0 12px 0; padding-left: 22px;">
    <li>5,043,524 Endpoint resources in the 2026-04-09 NDH release</li>
    <li>Filter to FHIR REST connection type</li>
    <li>Dedupe to unique hostnames (many endpoint records share a base URL)</li>
    <li>Result: <strong>2,974 distinct FHIR-REST hosts</strong></li>
    <li>85.4% of those serve a parseable CapabilityStatement</li>
  </ul>

  <p style="margin: 0 0 12px 0;">Practitioner-level reachability is dramatically lower because 98.7% of organizations in the federal directory carry zero Endpoint references at all. Even when a host is alive, only a small share of practitioners hang off it via the practitioner-to-role-to-managing_org-to-endpoint chain.</p>

  <p style="margin: 0 0 16px 0;">Updating the methodology page to make the host-level vs practitioner-level distinction explicit. The numbers do not change; the framing does.</p>

  <h2 style="font-size: 16px; font-weight: 600; margin: 24px 0 8px 0; color: #111827;">Question 2: are you pinging endpoints through Claude or a script?</h2>

  <p style="margin: 0 0 12px 0;">A real script. The probe is a standalone Python crawler at <a href="${PROBE_REPO}" style="color: #1d4ed8;">${PROBE_REPO}</a>, separated from the site repo specifically so operators can audit (or whitelist) just the probe code without inspecting the whole platform. Named User-Agent. Stable IP ranges via GitHub Actions. Accept header advertising FHIR JSON.</p>

  <p style="margin: 0 0 12px 0;">But the underlying question — anti-bot filtering — is broader than AINPI. Everyone doing FHIR audit work hits it now. Three flavors of block, three different fixes:</p>

  <ul style="margin: 0 0 12px 0; padding-left: 22px;">
    <li><strong>TLS fingerprint blocking</strong> (Akamai, Cloudflare): plain Python urllib and httpx get 403d even with valid headers. Shelling out to curl via subprocess works because curl uses the system TLS stack and gets fingerprinted as a real client.</li>
    <li><strong>User-Agent blocking</strong>: stable named UA plus a published allowlist path so ops teams can whitelist intentionally.</li>
    <li><strong>Vendor-specific agent blocking</strong>: some EHR and payer systems explicitly block calls originating from LLM agents (Claude, GPT, etc.) regardless of UA. Different fix — requires a fixed egress IP allowlisted in advance.</li>
  </ul>

  <p style="margin: 0 0 16px 0;">The unspoken implication for CMS scoring methodology: if directory accuracy is going to be measured at scale by 2029, regulators and plans will hit the same walls. The audit methodology has to be public enough that vendors can choose to allowlist it without it being either security-by-obscurity or vendor-by-vendor manual coordination. That is an unsolved problem worth flagging upstream of the 2028 CMS scoring RFC.</p>

  <p style="margin: 0 0 12px 0;">The broader point: the open audit substrate premise only works if smart readers actually push back. This is the loop working.</p>

  <p style="margin: 0 0 16px 0;">If you spot something else that needs sharpening, reply to this email — same address — and I will dig in.</p>

  <p style="margin: 0 0 8px 0;">Updated finding: <a href="${FINDING_URL}" style="color: #1d4ed8;">${FINDING_URL}</a></p>
  <p style="margin: 0 0 8px 0;">Probe repo: <a href="${PROBE_REPO}" style="color: #1d4ed8;">${PROBE_REPO}</a></p>
  <p style="margin: 0 0 16px 0;">Policy brief: <a href="${POLICY_URL}" style="color: #1d4ed8;">${POLICY_URL}</a></p>

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
  console.log(`URLs:    ${FINDING_URL} | ${PROBE_REPO} | ${POLICY_URL}`);
  console.log('---');
  console.log(text);
  console.log('---');

  if (!args.confirm) {
    console.log('[DRY RUN] Pass --confirm to actually send.');
    if (args.email) {
      console.log(`         (Would target only: ${args.email})`);
    } else if (args.limit) {
      console.log(`         (Would target first ${args.limit} subscribers)`);
    }
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
