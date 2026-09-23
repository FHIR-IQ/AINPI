/**
 * marketplace-install-claim: the one guard that makes an install welcome
 * go out at most once, shared by the webhook (/api/v1/marketplace-install)
 * and the daily poll (/api/v1/admin/marketplace-installs-poll).
 *
 * Reading `welcomedAt` and writing it after the send is a race: two
 * overlapping runs (cron plus webhook, or cron plus a manual curl) both read
 * null and both send. So the claim comes first, as one conditional write:
 *
 *   updateMany({ where: { email, welcomedAt: null }, data: { welcomedAt: now } })
 *
 * Postgres applies that atomically, so exactly one caller sees count === 1
 * and only that caller sends. If the send fails the claim is released, and
 * the release is conditional on the exact timestamp this claim wrote, so it
 * can never clear a claim some other run made afterwards. The row must exist
 * before claiming (callers upsert it without welcomedAt first); with no row
 * the claim returns null and nothing is sent.
 *
 * Failure mode accepted on purpose: if the process dies between a successful
 * send and nothing else, the row stays claimed and no retry happens. That
 * errs toward one missing welcome rather than a duplicate one.
 */

export interface ClaimDb {
  marketplaceInstall: {
    updateMany(args: {
      where: { email: string; welcomedAt: Date | null };
      data: { welcomedAt: Date | null };
    }): Promise<{ count: number }>;
  };
}

export interface WelcomeClaim {
  /** The timestamp written when this caller won the claim, else null. */
  claim(email: string): Promise<Date | null>;
  /** Undo a claim, only if the row still carries the value this claim wrote. */
  release(email: string, at: Date): Promise<void>;
}

export function prismaWelcomeClaim(db: ClaimDb, now: () => Date = () => new Date()): WelcomeClaim {
  return {
    async claim(email) {
      const at = now();
      const r = await db.marketplaceInstall.updateMany({
        where: { email, welcomedAt: null },
        data: { welcomedAt: at },
      });
      return r.count === 1 ? at : null;
    },
    async release(email, at) {
      await db.marketplaceInstall.updateMany({
        where: { email, welcomedAt: at },
        data: { welcomedAt: null },
      });
    },
  };
}

export type SendResult = { ok: true } | { ok: false; error: string };

export type WelcomeOutcome =
  | { status: 'sent' }
  | { status: 'already' }
  | { status: 'failed'; error: string };

export async function welcomeOnce(
  email: string,
  deps: WelcomeClaim & { send: () => Promise<SendResult> },
): Promise<WelcomeOutcome> {
  const at = await deps.claim(email);
  if (!at) return { status: 'already' };
  let result: SendResult;
  try {
    result = await deps.send();
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (result.ok) return { status: 'sent' };
  await deps.release(email, at);
  return { status: 'failed', error: result.error };
}
