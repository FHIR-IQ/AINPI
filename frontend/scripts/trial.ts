/**
 * Manage self-serve API trials (/trial). Every change is a dry run unless
 * --confirm is passed.
 *
 *   npx tsx scripts/trial.ts list
 *   npx tsx scripts/trial.ts extend  <signup-id> --days 7 [--confirm]
 *   npx tsx scripts/trial.ts convert <signup-id> [--tier partner] [--confirm]
 *   npx tsx scripts/trial.ts revoke  <signup-id> [--confirm]
 *
 * convert: the trialist became a customer. Their existing key keeps working
 * (same secret, nothing to resend): it moves to the paid tier (partner by
 * default), loses its expiry and the trial daily cap, and no more trial emails
 * go out. extend: pushes the expiry out and re-arms the reminder and
 * ended emails. revoke: stops the key now.
 *
 * Required env (frontend/.env.local copied to .env): POSTGRES_PRISMA_URL.
 */
import { PrismaClient } from '@prisma/client';

import { TIERS } from '../src/lib/rate-limit';

const prisma = new PrismaClient();
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const confirm = process.argv.includes('--confirm');

async function load(id: string | undefined) {
  if (!id || id.startsWith('--')) {
    console.error('A signup id is required (see `list`).');
    process.exit(2);
  }
  const t = await prisma.trialSignup.findUnique({ where: { id } });
  if (!t) {
    console.error(`No trial with id ${id}.`);
    process.exit(1);
  }
  if (!t.apiKeyId) {
    console.error('This trial has no key on record.');
    process.exit(1);
  }
  console.log(`${t.organization}: ${t.contactName} <${t.email}>, ends ${t.expiresAt.toISOString().slice(0, 10)}${t.convertedAt ? ', converted' : ''}`);
  return t as typeof t & { apiKeyId: string };
}

async function main() {
  const [cmd, id] = process.argv.slice(2);
  if (cmd === 'list') {
    const rows = await prisma.trialSignup.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    if (!rows.length) return console.log('No trials yet.');
    const now = Date.now();
    for (const r of rows) {
      const state = r.convertedAt ? 'customer' : r.expiresAt.getTime() > now ? 'active' : 'expired';
      console.log(
        `${r.id}  ${state.padEnd(9)} ends ${r.expiresAt.toISOString().slice(0, 10)}  ${r.organization.slice(0, 40).padEnd(40)} ${r.email}`,
      );
    }
    return;
  }
  if (cmd === 'extend') {
    const days = Number(arg('days'));
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      console.error('--days must be a whole number from 1 to 90.');
      process.exit(2);
    }
    const t = await load(id);
    const base = Math.max(Date.now(), t.expiresAt.getTime());
    const expiresAt = new Date(base + days * 86_400_000);
    if (!confirm) return console.log(`Dry run. --confirm moves the end to ${expiresAt.toISOString().slice(0, 10)}.`);
    await prisma.apiKey.update({ where: { id: t.apiKeyId }, data: { expiresAt, active: true, revokedAt: null } });
    await prisma.trialSignup.update({ where: { id: t.id }, data: { expiresAt, reminderSentAt: null, endedSentAt: null } });
    return console.log(`Extended to ${expiresAt.toISOString().slice(0, 10)}. The key works again if it had expired.`);
  }
  if (cmd === 'convert') {
    const tier = arg('tier') ?? 'partner';
    if (!TIERS[tier] || tier === 'anonymous' || tier === 'trial') {
      console.error(`--tier must be a paid tier: free, partner or enterprise.`);
      process.exit(2);
    }
    const t = await load(id);
    if (!confirm) return console.log(`Dry run. --confirm moves the key to tier ${tier} with no expiry and stops trial emails.`);
    await prisma.apiKey.update({
      where: { id: t.apiKeyId },
      data: { tier, expiresAt: null, dailyUnitCap: null, active: true, revokedAt: null, notes: `Converted from trial ${t.id}.` },
    });
    await prisma.trialSignup.update({ where: { id: t.id }, data: { convertedAt: new Date() } });
    return console.log(`Converted. The same key now runs on tier ${tier}; nothing needs resending.`);
  }
  if (cmd === 'revoke') {
    const t = await load(id);
    if (!confirm) return console.log('Dry run. --confirm stops the key now.');
    await prisma.apiKey.update({ where: { id: t.apiKeyId }, data: { active: false, revokedAt: new Date() } });
    return console.log('Revoked.');
  }
  console.error('Usage: list | extend <id> --days N | convert <id> [--tier partner] | revoke <id>  (add --confirm)');
  process.exit(2);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.name : 'error');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
