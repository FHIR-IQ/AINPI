/**
 * suppression-digest: count-only section on NPI removal requests for the
 * weekly admin digest. No NPIs, names or email addresses, only counts.
 * Never throws: a missing table (SQL not yet run) reads "unavailable".
 */

export interface RemovalCountsDb {
  npiSuppression: {
    count(args?: { where?: Record<string, unknown> }): Promise<number>;
  };
}

export type RemovalCounts =
  | {
      status: 'ok';
      /** Requests received in the last 7 days, every outcome. */
      received: number;
      /** Of those, accepted and put in force on arrival. */
      autoAccepted: number;
      /** Of those, accepted but queued past the daily cap. */
      queued: number;
      /** Of those, organization NPIs answered with the automated reply. */
      declined: number;
      /** Of those, NPIs that had a high-risk-cohort page. */
      hadPage: number;
      /** Confirmed (requester emailed) in the last 7 days. */
      confirmed: number;
      /** Any age: more than 5 days old and not yet confirmed. */
      overdue: number;
      /** Any age: NPI type still unconfirmed (practitioner-only, re-checked daily). */
      unverified: number;
    }
  | { status: 'unavailable'; reason: string };

export async function loadRemovalCounts(db: RemovalCountsDb, since: Date, now: Date = new Date()): Promise<RemovalCounts> {
  try {
    const t = db.npiSuppression;
    const recent = { requestedAt: { gte: since } };
    const [received, autoAccepted, queued, declined, hadPage, confirmed, overdue, unverified] = await Promise.all([
      t.count({ where: recent }),
      t.count({ where: { ...recent, status: { not: 'declined' }, notBefore: null } }),
      t.count({ where: { ...recent, notBefore: { not: null } } }),
      t.count({ where: { ...recent, status: 'declined' } }),
      t.count({ where: { ...recent, hadPage: true } }),
      t.count({ where: { confirmedAt: { gte: since } } }),
      t.count({
        where: {
          status: { in: ['pending', 'applied'] },
          requestedAt: { lt: new Date(now.getTime() - 5 * 86_400_000) },
        },
      }),
      t.count({ where: { status: 'pending', basis: 'unverified' } }),
    ]);
    return { status: 'ok', received, autoAccepted, queued, declined, hadPage, confirmed, overdue, unverified };
  } catch (err) {
    return { status: 'unavailable', reason: err instanceof Error ? err.message.slice(0, 120) : String(err) };
  }
}

export function renderRemovalText(c: RemovalCounts): string {
  if (c.status !== 'ok') return `NPI REMOVAL REQUESTS\n  unavailable: ${c.reason}`;
  return [
    'NPI REMOVAL REQUESTS (counts only, last 7 days)',
    `  Received:                  ${c.received}`,
    `  Auto-accepted:             ${c.autoAccepted}`,
    `  Queued past daily cap:     ${c.queued}`,
    `  Declined (organization):   ${c.declined}`,
    `  Had a high-risk page:      ${c.hadPage}`,
    `  Confirmed:                 ${c.confirmed}`,
    `  Overdue (>5 days, any age): ${c.overdue}`,
    `  Type unverified (any age): ${c.unverified}`,
  ].join('\n');
}

export function renderRemovalHtml(c: RemovalCounts): string {
  const h = '<h2 style="font-size: 14px; margin: 24px 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em; color: #374151;">NPI removal requests (last 7 days)</h2>';
  if (c.status !== 'ok') return `${h}<p style="font-size:13px;color:#6b7280;">Unavailable.</p>`;
  const row = (k: string, v: number) =>
    `<tr><td style="padding:6px 0;">${k}</td><td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${v}</td></tr>`;
  return `${h}<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">${[
    row('Received', c.received),
    row('Auto-accepted', c.autoAccepted),
    row('Queued past the daily cap', c.queued),
    row('Declined (organization NPI)', c.declined),
    row('Had a high-risk-cohort page', c.hadPage),
    row('Confirmed', c.confirmed),
    row('Overdue: more than 5 days, not confirmed (any age)', c.overdue),
    row('NPI type unverified, re-checked daily (any age)', c.unverified),
  ].join('')}</table>`;
}
