/**
 * scripts/suppress-npi.ts
 *
 * Record a removal request that reached a person rather than the form or the
 * removal inbox (for example an email to gene@fhiriq.com). Same function as
 * the other two intake paths (src/lib/suppression-intake.ts), source=manual,
 * so it gets the same admin alert, the same static-file removal by the
 * suppression-apply workflow, and the same automated confirmation email.
 *
 * The NPI and the requester's email come from the command line only. Never
 * write them into this file, a commit, or a PR.
 *
 * Required env (from frontend/.env.local, copied to .env): POSTGRES_PRISMA_URL,
 * and RESEND_API_KEY for the admin alert.
 *
 * Like the other paths, it checks the NPPES registry and the daily cap, and
 * records anything that is not a confirmed individual NPI as `held`. Pass
 * --force to skip both, for a request a person has already reviewed (it is
 * then recorded as `pending`).
 *
 * Usage from frontend/:
 *   npx tsx scripts/suppress-npi.ts <npi> <requester-email>                     # dry run
 *   npx tsx scripts/suppress-npi.ts <npi> <requester-email> --confirm           # write
 *   npx tsx scripts/suppress-npi.ts <npi> <requester-email> --confirm --force   # reviewed: skip checks
 */
import { PrismaClient } from '@prisma/client';
import { isNpiShape, isValidNpi } from '../src/lib/suppression';
import {
  normalizeEmail,
  npiPageExists,
  nppesEnumerationType,
  recordSuppression,
  type IntakeDb,
} from '../src/lib/suppression-intake';
import { sendSuppressionAlert } from '../src/lib/admin-email';

async function main() {
  const argv = process.argv.slice(2);
  const confirm = argv.includes('--confirm');
  const force = argv.includes('--force');
  const [npi, email] = argv.filter((a) => !a.startsWith('--'));

  if (!isNpiShape(npi)) {
    console.error('Usage: npx tsx scripts/suppress-npi.ts <10-digit npi> <email> [--confirm]');
    process.exit(2);
  }
  if (!isValidNpi(npi)) {
    console.warn('Warning: the NPI fails its check digit. Recording it anyway, as given.');
  }
  const requester = normalizeEmail(email);
  if (email && !requester) {
    console.error('The email address does not parse.');
    process.exit(2);
  }
  if (!requester) {
    console.warn('No requester email: the row will be confirmed without a confirmation email.');
  }

  if (!confirm) {
    console.log('Dry run. Re-run with --confirm to record the request.');
    return;
  }

  const prisma = new PrismaClient();
  try {
    const { created, status } = await recordSuppression(
      npi,
      requester,
      'manual',
      {
        db: prisma as unknown as IntakeDb,
        alert: sendSuppressionAlert,
        lookupType: (n) => nppesEnumerationType(n),
        hasPage: (n) => npiPageExists(n),
      },
      { force },
    );
    console.log(
      created ? `Recorded (status ${status}).` : `Already on the list (status ${status}); nothing changed.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
