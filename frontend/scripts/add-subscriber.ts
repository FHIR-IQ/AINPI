/**
 * scripts/add-subscriber.ts
 *
 * Add a manual entry to the AINPI subscriber list. Use sparingly. Most
 * subscribers self-add via /subscribe or the download gate; this script
 * is for the cases where a known stakeholder has explicitly asked to be on
 * the list, or where their role makes them a natural recipient and the
 * maintainer has authorized the add.
 *
 * Required env (from frontend/.env.local):
 *   POSTGRES_PRISMA_URL
 *
 * Usage from frontend/:
 *
 *   # 1. Dry-run (prints what it would do, no DB hit):
 *   npx tsx scripts/add-subscriber.ts --email user@example.com --source manual-add-stakeholder
 *
 *   # 2. Actually add:
 *   npx tsx scripts/add-subscriber.ts --email user@example.com --source manual-add-stakeholder --confirm
 *
 *   # 3. Already present? Script is idempotent (upsert), prints "already on list".
 *
 * Always note WHO authorized the add in the commit message that ships the
 * change. CAN-SPAM is fine for B2B technical newsletters with named
 * stakeholders, but a maintainer audit trail is still worth keeping.
 */
import { PrismaClient } from '@prisma/client';

interface CliArgs {
  email: string | null;
  source: string | null;
  confirm: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { email: null, source: null, confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') out.email = (argv[++i] ?? '').trim().toLowerCase() || null;
    else if (a === '--source') out.source = argv[++i] ?? null;
    else if (a === '--confirm') out.confirm = true;
    else if (a === '-h' || a === '--help') {
      console.log('See header comment in scripts/add-subscriber.ts');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    console.error('--email is required');
    process.exit(2);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
    console.error(`Not a plausible email: ${args.email}`);
    process.exit(2);
  }
  if (!args.source) {
    args.source = 'manual-add';
  }

  console.log(`Email:  ${args.email}`);
  console.log(`Source: ${args.source}`);

  if (!args.confirm) {
    console.log('[DRY RUN] Pass --confirm to actually upsert into subscribers.');
    return;
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.subscriber.findUnique({
      where: { email: args.email },
      select: { email: true, source: true, createdAt: true },
    });

    if (existing) {
      console.log(`Already on list since ${existing.createdAt.toISOString()} (source: ${existing.source ?? 'unspecified'}).`);
      console.log('No change.');
      return;
    }

    const row = await prisma.subscriber.create({
      data: { email: args.email, source: args.source },
      select: { id: true, email: true, source: true, createdAt: true },
    });
    const total = await prisma.subscriber.count();
    console.log(`Added: ${row.email} (id=${row.id}, source=${row.source}). Total subscribers: ${total}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
