/**
 * Issue an NPD MCP working-group API key to one sign-up and email it to them.
 *
 * Option A of the working-group design: a key is issued only after Gene has
 * checked the sign-up, because the key is what proves which organization a
 * sandbox interaction report comes from. The sign-up alert email carries the
 * exact command for each sign-up.
 *
 *   npx tsx scripts/npd-mcp-issue-key.ts <participant-id>             # dry run
 *   npx tsx scripts/npd-mcp-issue-key.ts <participant-id> --confirm   # issue + email
 *   npx tsx scripts/npd-mcp-issue-key.ts <participant-id> --confirm --reissue
 *
 * --reissue replaces the participant's existing working-group keys: they are revoked
 * only after the new key has been emailed.
 *
 * The plaintext key goes only into the email to the participant; it is never
 * printed or stored. If the email cannot be sent, the new key is revoked
 * before exit, so no working key exists that nobody holds.
 *
 * Required env (frontend/.env.local, copied to .env): POSTGRES_PRISMA_URL,
 * RESEND_API_KEY. Optional: RESEND_FROM_ADDRESS, ADMIN_EMAIL (reply-to).
 */
import { createHash, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

import { KEY_LABEL_PREFIX } from '../src/lib/interaction-report-store';

const prisma = new PrismaClient();
const FROM = process.env.RESEND_FROM_ADDRESS || 'AINPI <reports@ainpi.dev>';
const REPLY_TO = process.env.ADMIN_EMAIL || 'gene@fhiriq.com';

export function keyEmailText(organization: string, contactName: string, key: string): string {
  return [
    `Hello ${contactName},`,
    ``,
    `Thank you for joining the NPD MCP working group. This is the API key for ${organization}.`,
    `Keep it private: anyone holding it can submit reports as ${organization}.`,
    ``,
    `  ${key}`,
    ``,
    `What it opens:`,
    `- The AINPI sandbox of the proposed NPD Endpoint Feedback API (v0.2):`,
    `  POST https://ainpi.dev/api/v1/interaction-reports`,
    `  GET  https://ainpi.dev/api/v1/interaction-reports/{reportId}`,
    `  Send the key as X-API-Key: <key> or Authorization: Bearer <key>.`,
    `- The AINPI MCP server, https://ainpi.dev/api/mcp, including the report_interaction tool.`,
    `  Claude Code: claude mcp add --transport http ainpi https://ainpi.dev/api/mcp --header "Authorization: Bearer <key>"`,
    ``,
    `Examples and the tool list: https://ainpi.dev/npd-mcp#test`,
    ``,
    `This is a test service run by AINPI, an independent open-source project. It is not an NPD`,
    `or CMS service, and CMS has not reviewed or adopted the proposal. Reports are visible only to your organization and are deleted after 90 days.`,
    `Use test exchanges only, and never put patient data, credentials or raw payloads in a report.`,
    ``,
    `Reply to this email with questions, or if the key should be revoked.`,
  ].join('\n');
}

async function main() {
  const id = process.argv[2];
  const confirm = process.argv.includes('--confirm');
  const reissue = process.argv.includes('--reissue');
  if (!id || id.startsWith('--')) {
    console.error('Usage: npx tsx scripts/npd-mcp-issue-key.ts <participant-id> [--confirm] [--reissue]');
    process.exit(2);
  }

  const p = await prisma.npdMcpParticipant.findUnique({ where: { id } });
  if (!p) {
    console.error(`No sign-up with id ${id}.`);
    process.exit(1);
  }
  const label = `${KEY_LABEL_PREFIX}${p.id}`;
  const existing = await prisma.apiKey.findMany({
    where: { label, active: true, revokedAt: null },
    select: { id: true, keyPrefix: true },
  });

  console.log(`Sign-up:  ${p.organization} (${p.orgType}), contact ${p.contactName} <${p.email}>`);
  console.log(`Signed up ${p.createdAt.toISOString().slice(0, 10)}`);
  if (existing.length && !reissue) {
    console.error(`\nThis sign-up already has ${existing.length} active key(s). Pass --reissue to revoke and replace.`);
    process.exit(1);
  }
  if (!confirm) {
    console.log(`\nDry run. With --confirm: ${existing.length ? `revoke ${existing.length} key(s), ` : ''}issue a free-tier key labelled ${label} and email it to ${p.email}.`);
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set; nothing issued.');
    process.exit(1);
  }

  const plaintext = `ainpi_live_${randomBytes(32).toString('base64url')}`;
  const row = await prisma.apiKey.create({
    data: {
      keyHash: createHash('sha256').update(plaintext).digest('hex'),
      keyPrefix: plaintext.slice(0, 20),
      label,
      tier: 'free',
      organization: p.organization,
      contactEmail: p.email,
      notes: 'NPD MCP working group: interaction-report sandbox and MCP tools.',
    },
  });

  // The new key exists only in this process until the email goes out. Any
  // failure, thrown or returned, revokes it, and earlier keys stay as they
  // were, so the participant is never left without the key they already had.
  let sendFailure: string | null = null;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM,
      to: p.email,
      replyTo: REPLY_TO,
      subject: 'Your AINPI API key for the NPD MCP working group',
      text: keyEmailText(p.organization, p.contactName, plaintext),
    });
    if (error) sendFailure = error.name;
  } catch (e) {
    sendFailure = e instanceof Error ? e.name : 'send threw';
  }
  if (sendFailure) {
    await prisma.apiKey.update({ where: { id: row.id }, data: { active: false, revokedAt: new Date() } });
    console.error(
      `Email failed (${sendFailure}); the new key was revoked${existing.length ? ' and earlier keys are unchanged' : ''}. ` +
        'If the email did arrive, that key no longer works; run this again to send a working one.',
    );
    process.exit(1);
  }

  if (existing.length) {
    await prisma.apiKey.updateMany({
      where: { id: { in: existing.map((k) => k.id) } },
      data: { active: false, revokedAt: new Date() },
    });
    console.log(`Revoked ${existing.length} earlier key(s).`);
  }
  console.log(`Issued key ${row.keyPrefix}… (id ${row.id}) and emailed it to ${p.email}.`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.name : 'error');
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
