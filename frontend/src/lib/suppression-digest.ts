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
      last7: number;
      last7HadPage: number;
      heldOpen: number;
      awaitingConfirmation: number;
      confirmedTotal: number;
    }
  | { status: 'unavailable'; reason: string };

export async function loadRemovalCounts(db: RemovalCountsDb, since: Date): Promise<RemovalCounts> {
  try {
    const t = db.npiSuppression;
    const [last7, last7HadPage, heldOpen, awaitingConfirmation, confirmedTotal] = await Promise.all([
      t.count({ where: { requestedAt: { gte: since } } }),
      t.count({ where: { requestedAt: { gte: since }, hadPage: true } }),
      t.count({ where: { status: 'held' } }),
      t.count({ where: { status: { in: ['pending', 'applied'] } } }),
      t.count({ where: { status: 'confirmed' } }),
    ]);
    return { status: 'ok', last7, last7HadPage, heldOpen, awaitingConfirmation, confirmedTotal };
  } catch (err) {
    return { status: 'unavailable', reason: err instanceof Error ? err.message.slice(0, 120) : String(err) };
  }
}

export function renderRemovalText(c: RemovalCounts): string {
  if (c.status !== 'ok') return `NPI REMOVAL REQUESTS\n  unavailable: ${c.reason}`;
  return [
    'NPI REMOVAL REQUESTS (counts only)',
    `  New last 7 days:                 ${c.last7}`,
    `  ...that had a high-risk-cohort page: ${c.last7HadPage}`,
    `  Held for review (open):          ${c.heldOpen}`,
    `  Awaiting apply/confirmation:     ${c.awaitingConfirmation}`,
    `  Confirmed, all time:             ${c.confirmedTotal}`,
  ].join('\n');
}

export function renderRemovalHtml(c: RemovalCounts): string {
  const h = '<h2 style="font-size: 14px; margin: 24px 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em; color: #374151;">NPI removal requests</h2>';
  if (c.status !== 'ok') return `${h}<p style="font-size:13px;color:#6b7280;">Unavailable.</p>`;
  const row = (k: string, v: number) =>
    `<tr><td style="padding:6px 0;">${k}</td><td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${v}</td></tr>`;
  return `${h}<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">${[
    row('New last 7 days', c.last7),
    row('of which had a high-risk-cohort page', c.last7HadPage),
    row('Held for review (open)', c.heldOpen),
    row('Awaiting apply or confirmation', c.awaitingConfirmation),
    row('Confirmed, all time', c.confirmedTotal),
  ].join('')}</table>`;
}
