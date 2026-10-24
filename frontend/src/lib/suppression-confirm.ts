/**
 * suppression-confirm: the automated "your removal is complete" email,
 * sent by the daily cron /api/v1/admin/suppression-confirm.
 *
 * A row is confirmed only when it is `applied` (the suppression-apply
 * workflow has pushed the static-file removal) AND the live site shows the
 * removal: https://ainpi.dev/npi/<npi> returns 404 and the published cohort
 * CSV no longer contains the NPI. An NPI that never had a page passes both
 * checks as soon as it is applied, so it is confirmed too.
 *
 * Exactly-once, same pattern as marketplace-install-claim.ts: the send is
 * claimed first with one conditional write on confirmedAt; a failed send
 * releases the claim (only if it still carries this claim's timestamp), and
 * a successful one sets status = confirmed.
 */

export const DEFAULT_CONFIRM_CAP = 20;
export const DEFAULT_SITE = 'https://ainpi.dev';
export const COHORT_CSV_PATH = '/api/v1/findings/high-risk-cohort-export.csv';

export function buildRemovalConfirmation(npi: string): { subject: string; text: string } {
  return {
    subject: 'Your AINPI removal request is complete',
    text: [
      `Your removal request for NPI ${npi} is complete.`,
      '',
      `The page for this NPI on ainpi.dev has been removed, and the NPI no longer ` +
        `appears in AINPI's search, downloadable files or API. Search engines remove ` +
        `the old page when they next crawl it.`,
      '',
      'This mailbox is not monitored, and replies are not read.',
    ].join('\n'),
  };
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** True when the live site no longer shows the NPI's page or cohort row. */
export async function isRemovedLive(
  npi: string,
  fetchFn: FetchLike,
  base: string = DEFAULT_SITE,
  bust: string = String(Date.now()),
): Promise<boolean> {
  const page = await fetchFn(`${base}/npi/${npi}?v=${bust}`, {
    redirect: 'manual',
    cache: 'no-store',
  });
  if (page.status !== 404) return false;
  const csv = await fetchFn(`${base}${COHORT_CSV_PATH}?v=${bust}`, { cache: 'no-store' });
  if (!csv.ok) return false; // cannot prove absence, so do not claim it
  const body = await csv.text();
  if (!body.startsWith('npi,')) return false;
  return !body.includes(npi);
}

export interface ConfirmRow {
  npi: string;
  requesterEmail: string | null;
}

export interface ConfirmDb {
  npiSuppression: {
    findMany(args: {
      where: { status: string; confirmedAt: null };
      select: { npi: true; requesterEmail: true };
      orderBy: { requestedAt: 'asc' };
      take: number;
    }): Promise<ConfirmRow[]>;
    updateMany(args: {
      where: { npi: string; status?: string; confirmedAt: Date | null };
      data: { confirmedAt?: Date | null; status?: string };
    }): Promise<{ count: number }>;
  };
}

export type SendResult = { ok: true } | { ok: false; error: string };

export interface ConfirmDeps {
  db: ConfirmDb;
  fetchFn: FetchLike;
  send: (to: string, msg: { subject: string; text: string }) => Promise<SendResult>;
  base?: string;
  cap?: number;
  now?: () => Date;
}

export interface ConfirmSummary {
  checked: number;
  notYetLive: number;
  sent: number;
  confirmedWithoutEmail: number;
  alreadyClaimed: number;
  failed: number;
}

export async function runConfirmations(deps: ConfirmDeps): Promise<ConfirmSummary> {
  const now = deps.now ?? (() => new Date());
  const s: ConfirmSummary = {
    checked: 0, notYetLive: 0, sent: 0, confirmedWithoutEmail: 0, alreadyClaimed: 0, failed: 0,
  };
  const rows = await deps.db.npiSuppression.findMany({
    where: { status: 'applied', confirmedAt: null },
    select: { npi: true, requesterEmail: true },
    orderBy: { requestedAt: 'asc' },
    take: deps.cap ?? DEFAULT_CONFIRM_CAP,
  });

  for (const row of rows) {
    s.checked++;
    let live = false;
    try {
      live = await isRemovedLive(row.npi, deps.fetchFn, deps.base);
    } catch {
      live = false;
    }
    if (!live) {
      s.notYetLive++;
      continue;
    }

    const at = now();
    const claim = await deps.db.npiSuppression.updateMany({
      where: { npi: row.npi, status: 'applied', confirmedAt: null },
      data: { confirmedAt: at },
    });
    if (claim.count !== 1) {
      s.alreadyClaimed++;
      continue;
    }

    if (!row.requesterEmail) {
      await deps.db.npiSuppression.updateMany({
        where: { npi: row.npi, confirmedAt: at },
        data: { status: 'confirmed' },
      });
      s.confirmedWithoutEmail++;
      continue;
    }

    let result: SendResult;
    try {
      result = await deps.send(row.requesterEmail, buildRemovalConfirmation(row.npi));
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (result.ok) {
      await deps.db.npiSuppression.updateMany({
        where: { npi: row.npi, confirmedAt: at },
        data: { status: 'confirmed' },
      });
      s.sent++;
    } else {
      await deps.db.npiSuppression.updateMany({
        where: { npi: row.npi, confirmedAt: at },
        data: { confirmedAt: null },
      });
      s.failed++;
    }
  }
  return s;
}
