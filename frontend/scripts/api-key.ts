/**
 * Issue, list and revoke AINPI API keys.
 *
 * Keys exist so that a named integrator gets a workable quota without the
 * anonymous ceiling, and so that a partner keeps working when the global spend
 * breaker refuses anonymous traffic. They are not a paywall on the research:
 * everything under /api/v1/ stays free, unauthenticated and CDN-served.
 *
 * The plaintext key is printed once and never stored. Only its SHA-256 goes to
 * the database, so a leak of the table does not hand anyone working
 * credentials. If a key is lost, revoke and reissue.
 *
 *   npx tsx scripts/api-key.ts issue --label "Fasten Health" --tier partner \
 *       --org "Fasten Health" --email dev@example.com
 *   npx tsx scripts/api-key.ts list
 *   npx tsx scripts/api-key.ts revoke --id <uuid>
 *   npx tsx scripts/api-key.ts usage --days 7
 *
 * Required env: POSTGRES_PRISMA_URL (from frontend/.env.local).
 */
import { createHash, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { TIERS, USD_PER_UNIT } from '../src/lib/rate-limit';

const prisma = new PrismaClient();

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function issue() {
  const label = arg('label');
  const tier = arg('tier') ?? 'free';
  if (!label) {
    console.error('--label is required, and should name a human or an org you can contact.');
    process.exit(2);
  }
  if (!TIERS[tier]) {
    console.error(`Unknown tier '${tier}'. Known: ${Object.keys(TIERS).join(', ')}`);
    process.exit(2);
  }

  // 32 random bytes, base64url. The `ainpi_live_` prefix makes a leaked key
  // greppable in logs and recognisable in a secret scanner.
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `ainpi_live_${secret}`;
  const row = await prisma.apiKey.create({
    data: {
      keyHash: sha256(plaintext),
      keyPrefix: plaintext.slice(0, 20),
      label,
      tier,
      organization: arg('org') ?? null,
      contactEmail: arg('email') ?? null,
      dailyUnitCap: arg('cap') ? Number(arg('cap')) : null,
      notes: arg('notes') ?? null,
    },
  });

  const t = TIERS[tier];
  const cap = row.dailyUnitCap ?? t.perDay;
  console.log('\nKey issued. This is the only time the secret is shown.\n');
  console.log(`  key    ${plaintext}`);
  console.log(`  id     ${row.id}`);
  console.log(`  label  ${label}`);
  console.log(`  tier   ${tier}`);
  console.log(
    `  quota  ${t.perMinute.toLocaleString()} units/min, ` +
      `${cap.toLocaleString()} units/day (about $${(cap * USD_PER_UNIT).toFixed(2)} of scan)`,
  );
  console.log(
    `  breaker ${t.survivesBreaker ? 'survives' : 'does not survive'} the global daily breaker`,
  );
  console.log('\nUse it as either header:');
  console.log(`  Authorization: Bearer ${plaintext}`);
  console.log(`  X-API-Key: ${plaintext}\n`);
}

async function list() {
  const rows = await prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
  if (!rows.length) return console.log('No keys issued.');
  console.log(
    `\n${'id'.padEnd(38)}${'label'.padEnd(26)}${'tier'.padEnd(12)}${'state'.padEnd(10)}last used`,
  );
  for (const r of rows) {
    const state = r.revokedAt ? 'revoked' : r.active ? 'active' : 'inactive';
    console.log(
      r.id.padEnd(38) +
        r.label.slice(0, 24).padEnd(26) +
        r.tier.padEnd(12) +
        state.padEnd(10) +
        (r.lastUsedAt ? r.lastUsedAt.toISOString().slice(0, 16) : 'never'),
    );
  }
  console.log();
}

async function revoke() {
  const id = arg('id');
  if (!id) {
    console.error('--id is required (from `list`).');
    process.exit(2);
  }
  await prisma.apiKey.update({
    where: { id },
    data: { active: false, revokedAt: new Date() },
  });
  console.log(`Revoked ${id}. It stops working on the next request; there is no cache to clear.`);
}

async function usage() {
  const days = Number(arg('days') ?? 14);
  const rows = await prisma.usageLedger.findMany({
    orderBy: { day: 'desc' },
    take: days,
  });
  if (!rows.length) return console.log('No usage recorded yet.');
  console.log(`\n${'day'.padEnd(14)}${'requests'.padStart(10)}${'units'.padStart(12)}${'est. USD'.padStart(12)}  breaker`);
  let usd = 0;
  for (const r of rows) {
    usd += Number(r.estimatedUsd);
    console.log(
      r.day.padEnd(14) +
        String(r.requests).padStart(10) +
        String(r.units).padStart(12) +
        Number(r.estimatedUsd).toFixed(4).padStart(12) +
        (r.breakerTripped ? '  TRIPPED' : ''),
    );
  }
  console.log(`\n  ${days}-day estimated scan spend: $${usd.toFixed(2)}`);
  console.log('  Estimated from measured bytes-per-query-shape, not from GCP billing.');
  console.log('  Treat it as an early indicator; the billing console is authoritative.\n');
}

async function main() {
  const cmd = process.argv[2];
  try {
    if (cmd === 'issue') await issue();
    else if (cmd === 'list') await list();
    else if (cmd === 'revoke') await revoke();
    else if (cmd === 'usage') await usage();
    else {
      console.log('Usage: api-key.ts <issue|list|revoke|usage> [flags]');
      console.log('See the header comment in this file for examples.');
      process.exit(2);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
