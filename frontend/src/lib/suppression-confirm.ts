/**
 * suppression-confirm: the automated "your removal is complete" email,
 * sent by the daily cron /api/v1/admin/suppression-confirm.
 *
 * A row is confirmed only when it is `applied` (the suppression-apply
 * workflow has pushed the static-file removal) AND the live site shows the
 * removal: https://ainpi.dev/npi/<npi> returns 404 and the published cohort
 * CSV no longer contains the NPI. An NPI that never had a page passes both
 * checks as soon as it is applied, so it is confirmed too. Held rows are
 * never `applied`, so they never get an email.
 *
 * Fairness: candidates are taken least-recently-checked first
 * (confirmCheckedAt, nulls first) and every check stamps the row, so a row
 * whose page is slow to go cannot hold up newer ones. Up to CHECK_LIMIT
 * checks and `cap` sends per run.
 *
 * Exactly-once, as far as a mail API allows: the send is claimed first with
 * one conditional write on confirmClaimedAt. Success sets status=confirmed
 * and confirmedAt in one write keyed on that claim; a failed send releases
 * it. A claim older than CLAIM_EXPIRY_MS (a run that died mid-send) can be
 * claimed again, so a crash between send and write can cause one duplicate
 * email rather than leaving the row stuck forever.
 */

export const DEFAULT_CONFIRM_CAP = 20;
export const CHECK_LIMIT = 100;
export const CLAIM_EXPIRY_MS = 15 * 60 * 1000;
export const DEFAULT_SITE = 'https://ainpi.dev';
export const COHORT_CSV_PATH = '/api/v1/findings/high-risk-cohort-export.csv';

export function buildRemovalConfirmation(npi: string): { subject: string; text: string } {
  return {
    subject: 'Your AINPI removal request is complete',
    text:
      `Your removal request for NPI ${npi} is complete. If this NPI had a page on ainpi.dev, ` +
      `that page has been removed, and the NPI no longer appears in search results, ` +
      `downloadable files or the API on ainpi.dev. Search engines remove an old page when ` +
      `they next crawl it. This mailbox is not monitored, and replies are not read.`,
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
      where: { status: 'applied'; confirmedAt: null };
      select: { npi: true; requesterEmail: true };
      orderBy: { confirmCheckedAt: { sort: 'asc'; nulls: 'first' } }[];
      take: number;
    }): Promise<ConfirmRow[]>;
    updateMany(args: {
      where: {
        npi: string;
        status?: string;
        confirmClaimedAt?: Date | null;
        OR?: ({ confirmClaimedAt: null } | { confirmClaimedAt: { lt: Date } })[];
      };
      data: {
        confirmCheckedAt?: Date;
        confirmClaimedAt?: Date | null;
        confirmedAt?: Date;
        status?: string;
      };
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
  checkLimit?: number;
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
  const cap = deps.cap ?? DEFAULT_CONFIRM_CAP;
  const db = deps.db.npiSuppression;
  const s: ConfirmSummary = {
    checked: 0, notYetLive: 0, sent: 0, confirmedWithoutEmail: 0, alreadyClaimed: 0, failed: 0,
  };
  const rows = await db.findMany({
    where: { status: 'applied', confirmedAt: null },
    select: { npi: true, requesterEmail: true },
    orderBy: [{ confirmCheckedAt: { sort: 'asc', nulls: 'first' } }],
    take: deps.checkLimit ?? CHECK_LIMIT,
  });

  for (const row of rows) {
    if (s.sent >= cap) break;
    s.checked++;
    let live = false;
    try {
      live = await isRemovedLive(row.npi, deps.fetchFn, deps.base);
    } catch {
      live = false;
    }
    await db.updateMany({ where: { npi: row.npi }, data: { confirmCheckedAt: now() } });
    if (!live) {
      s.notYetLive++;
      continue;
    }

    const at = now();
    const claim = await db.updateMany({
      where: {
        npi: row.npi,
        status: 'applied',
        OR: [
          { confirmClaimedAt: null },
          { confirmClaimedAt: { lt: new Date(at.getTime() - CLAIM_EXPIRY_MS) } },
        ],
      },
      data: { confirmClaimedAt: at },
    });
    if (claim.count !== 1) {
      s.alreadyClaimed++;
      continue;
    }

    if (!row.requesterEmail) {
      await db.updateMany({
        where: { npi: row.npi, confirmClaimedAt: at },
        data: { status: 'confirmed', confirmedAt: now() },
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
      await db.updateMany({
        where: { npi: row.npi, confirmClaimedAt: at },
        data: { status: 'confirmed', confirmedAt: now() },
      });
      s.sent++;
    } else {
      await db.updateMany({
        where: { npi: row.npi, confirmClaimedAt: at },
        data: { confirmClaimedAt: null },
      });
      s.failed++;
    }
  }
  return s;
}
