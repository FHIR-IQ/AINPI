/**
 * removal-limit: the limiter for NPI removal requests (the /privacy/remove
 * form and the removal inbox), kept apart from the BigQuery quota on purpose.
 *
 * - Its own subject namespace (`remove:ip:<ip>`, `remove:mail:<sender>`), so a
 *   removal request neither uses up nor is blocked by a caller's search quota.
 * - Never writes the global usage_ledger, so it cannot trip the warehouse
 *   breaker, and the breaker cannot block it.
 * - Per subject: REMOVAL_PER_MINUTE a minute and REMOVAL_PER_DAY a UTC day.
 * - One small global daily ceiling (REMOVAL_DAILY_CEILING, default 100) that
 *   refuses only removal requests, with one admin alert the moment it is
 *   reached (the counter is atomic, so exactly one request sees ceiling + 1).
 *
 * Counters live in the existing rate_limit_buckets table. If it cannot be
 * reached the request is allowed, as elsewhere: intake itself caps what is
 * processed automatically (SUPPRESSION_DAILY_CAP).
 */

export const REMOVAL_PER_MINUTE = 5;
export const REMOVAL_PER_DAY = 20;
export const DEFAULT_REMOVAL_DAILY_CEILING = 100;

export function removalDailyCeiling(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.REMOVAL_DAILY_CEILING);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_REMOVAL_DAILY_CEILING;
}

export type Bump = (id: string, units: number, ttlMs: number) => Promise<number | null>;

export interface RemovalLimitDeps {
  bump: Bump;
  alertCeiling: (ceiling: number) => Promise<void>;
  ceiling?: number;
  now?: () => number;
}

export type RemovalLimitResult =
  | { ok: true }
  | { ok: false; reason: 'per-minute' | 'per-day' | 'global-ceiling'; retryAfterSec: number };

export async function checkRemovalLimit(
  subject: string,
  deps: RemovalLimitDeps,
): Promise<RemovalLimitResult> {
  const now = (deps.now ?? Date.now)();
  const minute = Math.floor(now / 60_000);
  const day = Math.floor(now / 86_400_000);
  const ceiling = deps.ceiling ?? removalDailyCeiling();
  const key = `remove:${subject}`;

  const m = await deps.bump(`${key}:m:${minute}`, 1, 120_000);
  if (m !== null && m > REMOVAL_PER_MINUTE) {
    return { ok: false, reason: 'per-minute', retryAfterSec: 60 };
  }
  const d = await deps.bump(`${key}:d:${day}`, 1, 172_800_000);
  if (d !== null && d > REMOVAL_PER_DAY) {
    return { ok: false, reason: 'per-day', retryAfterSec: 3600 };
  }
  const g = await deps.bump(`remove:global:d:${day}`, 1, 172_800_000);
  if (g !== null && g > ceiling) {
    if (g === ceiling + 1) await deps.alertCeiling(ceiling).catch(() => {});
    return { ok: false, reason: 'global-ceiling', retryAfterSec: 3600 };
  }
  return { ok: true };
}

/** Production wiring: the shared bucket table, the admin alert. */
export async function defaultRemovalLimitDeps(): Promise<RemovalLimitDeps> {
  const { bump } = await import('@/lib/rate-limit');
  const { sendRemovalCeilingAlert } = await import('@/lib/admin-email');
  return { bump, alertCeiling: sendRemovalCeilingAlert };
}
