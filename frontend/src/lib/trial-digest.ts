/**
 * trial-digest: count-only section on API trials and roster verification for
 * the weekly admin digest. It answers one question: is anyone using the trial
 * for real roster work? A trial key that runs verify_roster on a batch of 25
 * or more NPIs is the signal; lookups alone are not. No names, emails or NPIs.
 * Never throws: a missing table reads "unavailable".
 */

export const REAL_BATCH = 25;

export interface TrialCountsDb {
  trialSignup: {
    count(args?: { where?: Record<string, unknown> }): Promise<number>;
    findMany(args: { where?: Record<string, unknown>; select: { apiKeyId: true } }): Promise<Array<{ apiKeyId: string | null }>>;
  };
  rosterVerification: {
    findMany(args: {
      where?: Record<string, unknown>;
      select: { keyId: true; npiCount: true };
    }): Promise<Array<{ keyId: string; npiCount: number }>>;
  };
}

export type TrialCounts =
  | {
      status: 'ok';
      /** Trials started in the last 7 days. */
      started: number;
      /** Trials not yet expired, revoked or converted (any start date). */
      live: number;
      /** Distinct trial keys that ran verify_roster in the last 30 days. */
      trialKeysVerifying: number;
      /** Of those, keys that ran at least one batch of REAL_BATCH NPIs or more. */
      trialKeysRealBatch: number;
      /** Roster verification calls in the last 30 days, every tier. */
      rosterCalls: number;
      /** NPIs checked in those calls. */
      rosterNpis: number;
    }
  | { status: 'unavailable'; reason: string };

export async function loadTrialCounts(db: TrialCountsDb, since7: Date, since30: Date, now: Date = new Date()): Promise<TrialCounts> {
  try {
    const [started, live, trialKeys, calls] = await Promise.all([
      db.trialSignup.count({ where: { createdAt: { gte: since7 } } }),
      db.trialSignup.count({ where: { expiresAt: { gt: now }, revokedAt: null, convertedAt: null } }),
      db.trialSignup.findMany({ where: { apiKeyId: { not: null } }, select: { apiKeyId: true } }),
      db.rosterVerification.findMany({ where: { createdAt: { gte: since30 } }, select: { keyId: true, npiCount: true } }),
    ]);
    const trialIds = new Set(trialKeys.map((t) => t.apiKeyId).filter((x): x is string => Boolean(x)));
    const verifying = new Set<string>();
    const real = new Set<string>();
    let rosterNpis = 0;
    for (const c of calls) {
      rosterNpis += c.npiCount;
      if (!trialIds.has(c.keyId)) continue;
      verifying.add(c.keyId);
      if (c.npiCount >= REAL_BATCH) real.add(c.keyId);
    }
    return {
      status: 'ok',
      started,
      live,
      trialKeysVerifying: verifying.size,
      trialKeysRealBatch: real.size,
      rosterCalls: calls.length,
      rosterNpis,
    };
  } catch (err) {
    return { status: 'unavailable', reason: err instanceof Error ? err.message.slice(0, 120) : String(err) };
  }
}

export function renderTrialText(c: TrialCounts): string {
  if (c.status !== 'ok') return `API TRIALS AND ROSTER VERIFICATION\n  unavailable: ${c.reason}`;
  return [
    'API TRIALS AND ROSTER VERIFICATION (counts only)',
    `  Trials started, last 7 days:                 ${c.started}`,
    `  Trials live now:                             ${c.live}`,
    `  Trial keys running verify_roster, 30 days:   ${c.trialKeysVerifying}`,
    `  ...with a batch of ${REAL_BATCH}+ NPIs:                  ${c.trialKeysRealBatch}`,
    `  Roster calls, 30 days, every tier:           ${c.rosterCalls}`,
    `  NPIs checked in those calls:                 ${c.rosterNpis}`,
  ].join('\n');
}

export function renderTrialHtml(c: TrialCounts): string {
  const h = '<h2 style="font-size: 14px; margin: 24px 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em; color: #374151;">API trials and roster verification</h2>';
  if (c.status !== 'ok') return `${h}<p style="font-size:13px;color:#6b7280;">Unavailable.</p>`;
  const row = (k: string, v: number) =>
    `<tr><td style="padding:6px 0;">${k}</td><td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${v}</td></tr>`;
  return `${h}<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">${[
    row('Trials started, last 7 days', c.started),
    row('Trials live now', c.live),
    row('Trial keys running verify_roster, last 30 days', c.trialKeysVerifying),
    row(`Of those, with a batch of ${REAL_BATCH} or more NPIs`, c.trialKeysRealBatch),
    row('Roster verification calls, last 30 days, every tier', c.rosterCalls),
    row('NPIs checked in those calls', c.rosterNpis),
  ].join('')}</table>`;
}
