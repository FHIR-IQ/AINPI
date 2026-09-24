/**
 * scripts/seed-welcomed-installs.ts
 *
 * Mark Marketplace installers who were already welcomed by hand, so the
 * daily /api/v1/admin/marketplace-installs-poll cron never welcomes them a
 * second time. Sends nothing. Upserts one MarketplaceInstall row per address
 * with welcomedAt = now; an existing row keeps everything else it holds and
 * an already-set welcomedAt is left as it is.
 *
 * Run this BEFORE the Databricks env vars are set on Vercel. The poll looks
 * back 30 days by default, so any installer contacted by hand inside that
 * window gets a second welcome if they are not seeded first.
 *
 * Emails come from the command line only. Never hardcode them here.
 *
 * Required env (from frontend/.env.local, copied to .env): POSTGRES_PRISMA_URL
 *
 * Usage from frontend/:
 *   npx tsx scripts/seed-welcomed-installs.ts a@example.com b@example.com            # dry run
 *   npx tsx scripts/seed-welcomed-installs.ts a@example.com b@example.com --confirm  # write
 */
import { PrismaClient } from '@prisma/client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseArgs(argv: string[]): { emails: string[]; bad: string[]; confirm: boolean } {
  const confirm = argv.includes('--confirm');
  const raw = argv.filter((a) => !a.startsWith('--'));
  const seen = new Set<string>();
  const emails: string[] = [];
  const bad: string[] = [];
  for (const r of raw) {
    const e = r.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) bad.push(r);
    else if (!seen.has(e)) {
      seen.add(e);
      emails.push(e);
    }
  }
  return { emails, bad, confirm };
}

async function main() {
  const { emails, bad, confirm } = parseArgs(process.argv.slice(2));
  if (bad.length) {
    console.error(`Not an email address: ${bad.join(', ')}`);
    process.exit(2);
  }
  if (!emails.length) {
    console.error('Usage: npx tsx scripts/seed-welcomed-installs.ts <email> [<email> ...] [--confirm]');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.marketplaceInstall.findMany({
      where: { email: { in: emails } },
      select: { email: true, welcomedAt: true },
    });
    const byEmail = new Map(existing.map((r) => [r.email, r.welcomedAt]));

    for (const email of emails) {
      const had = byEmail.get(email);
      const state = had ? `already welcomed ${had.toISOString()}` : byEmail.has(email) ? 'row exists, not welcomed' : 'new row';
      console.log(`${confirm ? 'seed' : 'would seed'}  ${email}  (${state})`);
    }
    if (!confirm) {
      console.log('\nDry run. Nothing written. Re-run with --confirm to write.');
      return;
    }

    const now = new Date();
    let written = 0;
    for (const email of emails) {
      if (byEmail.get(email)) continue; // keep the original welcomedAt
      await prisma.marketplaceInstall.upsert({
        where: { email },
        update: { welcomedAt: now },
        create: {
          email,
          installedBy: email,
          company: null,
          listing: 'CMS National Provider Directory: Release Archive',
          welcomedAt: now,
        },
      });
      written++;
    }
    console.log(`\nseeded=${written} unchanged=${emails.length - written}. No email was sent.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
