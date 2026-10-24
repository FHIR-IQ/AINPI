/**
 * suppression-intake: the one function every removal request goes through,
 * whichever path it arrived by (the /privacy/remove form, the inbound
 * removal mailbox, or frontend/scripts/suppress-npi.ts for a request that
 * reached a person).
 *
 * Recording is enough for the runtime effect: search and the MCP tools read
 * the table through src/lib/suppression.ts. The static files follow on the
 * next run of .github/workflows/suppression-apply.yml, and the requester is
 * emailed by /api/v1/admin/suppression-confirm once the page is gone.
 *
 * A repeat request for an NPI already on the list changes nothing and alerts
 * nothing new; callers return the same response either way, so the form does
 * not reveal whether an NPI is listed, held, or has a page.
 */
import { extractNpis, isNpiShape, invalidateSuppressionCache } from '@/lib/suppression';

export type IntakeSource = 'form' | 'email' | 'manual';
export type IntakeStatus = 'pending' | 'held';
export type HeldReason = 'organization_npi' | 'nppes_lookup_failed' | 'daily_cap';
export type EnumerationType = 'individual' | 'organization' | 'unknown';

/** New requests processed automatically per UTC day before the rest are held. */
export const DEFAULT_DAILY_CAP = 10;
/** Emailed requests one sender may file per UTC day. */
export const EMAIL_SENDER_DAILY_CAP = 3;

export function dailyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SUPPRESSION_DAILY_CAP);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_CAP;
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export interface IntakeDb {
  npiSuppression: {
    findUnique(args: { where: { npi: string } }): Promise<{ id: string; status: string } | null>;
    create(args: {
      data: {
        npi: string;
        requesterEmail: string | null;
        source: string;
        status: string;
        heldReason: string | null;
        hadPage: boolean | null;
      };
    }): Promise<unknown>;
    count(args: {
      where: {
        requestedAt?: { gte: Date };
        status?: { not: string } | string;
        heldReason?: string;
        requesterEmail?: string;
        source?: string;
      };
    }): Promise<number>;
  };
}

export interface IntakeAlert {
  npi: string;
  source: IntakeSource;
  requesterEmail: string | null;
  status: IntakeStatus;
  heldReason: HeldReason | null;
}

export interface IntakeDeps {
  db: IntakeDb;
  alert: (a: IntakeAlert) => Promise<void>;
  /** NPPES enumeration type: NPI-1 individual, NPI-2 organization. */
  lookupType: (npi: string) => Promise<EnumerationType>;
  /** Whether ainpi.dev/npi/<npi> exists now (null when unknown). */
  hasPage: (npi: string) => Promise<boolean | null>;
  cap?: number;
  now?: () => Date;
}

const MAX_EMAIL_INPUT = 512;

/**
 * Parse "Name <a@b.c>" or a bare address into a lower-case address, or null.
 * Written without regular expressions over the input, which arrives from the
 * public form and from inbound mail (no backtracking on hostile strings).
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw || raw.length > MAX_EMAIL_INPUT) return null;
  let addr = raw;
  const open = raw.lastIndexOf('<');
  if (open !== -1) {
    const close = raw.indexOf('>', open);
    if (close === -1) return null;
    addr = raw.slice(open + 1, close);
  }
  addr = addr.trim().toLowerCase();
  if (addr.length === 0 || addr.length > 254) return null;
  for (const ch of addr) {
    if (ch === '<' || ch === '>' || ch.trim() === '') return null;
  }
  const at = addr.indexOf('@');
  if (at <= 0 || at !== addr.lastIndexOf('@')) return null;
  const domain = addr.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  if (dot <= 0 || dot === domain.length - 1) return null;
  return addr;
}

/**
 * Record one request. Only individual (Type 1) NPIs confirmed by the NPPES
 * registry are processed automatically, and at most `cap` a day; anything
 * else is stored as `held` and alerted, with nothing automated for the
 * requester. `force` (the manual script only) skips both checks, for a
 * request a person has already reviewed.
 */
export async function recordSuppression(
  npi: string,
  email: string | null,
  source: IntakeSource,
  deps?: IntakeDeps,
  opts: { force?: boolean } = {},
): Promise<{ created: boolean; status: string }> {
  if (!isNpiShape(npi)) throw new Error('recordSuppression: not a 10-digit NPI');
  const d = deps ?? (await defaultDeps());
  const now = (d.now ?? (() => new Date()))();
  const requesterEmail = normalizeEmail(email);

  const existing = await d.db.npiSuppression.findUnique({ where: { npi } });
  if (existing) return { created: false, status: existing.status };

  let status: IntakeStatus = 'pending';
  let heldReason: HeldReason | null = null;
  let alertThis = true;

  if (!(source === 'manual' && opts.force)) {
    const type = await d.lookupType(npi).catch((): EnumerationType => 'unknown');
    if (type === 'organization') {
      status = 'held';
      heldReason = 'organization_npi';
    } else if (type !== 'individual') {
      status = 'held';
      heldReason = 'nppes_lookup_failed';
    } else {
      const today = startOfUtcDay(now);
      const auto = await d.db.npiSuppression.count({
        where: { requestedAt: { gte: today }, status: { not: 'held' } },
      });
      if (auto >= (d.cap ?? dailyCap())) {
        status = 'held';
        heldReason = 'daily_cap';
        // One alert when the cap is first reached each day, not one per row.
        const already = await d.db.npiSuppression.count({
          where: { requestedAt: { gte: today }, heldReason: 'daily_cap' },
        });
        alertThis = already === 0;
      }
    }
  }

  const hadPage = await d.hasPage(npi).catch(() => null);
  try {
    await d.db.npiSuppression.create({
      data: { npi, requesterEmail, source, status, heldReason, hadPage },
    });
  } catch (err) {
    // Lost a race with a concurrent request for the same NPI: same outcome.
    if ((err as { code?: string })?.code === 'P2002') return { created: false, status: 'pending' };
    throw err;
  }
  if (status === 'pending') invalidateSuppressionCache();
  if (alertThis) await d.alert({ npi, source, requesterEmail, status, heldReason }).catch(() => {});
  return { created: true, status };
}

/** Emailed requests from one sender today (the per-sender cap). */
export async function senderRequestsToday(db: IntakeDb, sender: string, now = new Date()): Promise<number> {
  return db.npiSuppression.count({
    where: { requesterEmail: sender, source: 'email', requestedAt: { gte: startOfUtcDay(now) } },
  });
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** NPPES registry API (free, public): NPI-1 individual, NPI-2 organization. */
export async function nppesEnumerationType(npi: string, fetchFn: FetchLike = fetch): Promise<EnumerationType> {
  const res = await fetchFn(
    `https://npiregistry.cms.hhs.gov/api/?version=2.1&number=${encodeURIComponent(npi)}`,
    { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } },
  );
  if (!res.ok) return 'unknown';
  const body = (await res.json().catch(() => null)) as
    | { results?: { enumeration_type?: string }[] }
    | null;
  const t = body?.results?.[0]?.enumeration_type;
  if (t === 'NPI-1') return 'individual';
  if (t === 'NPI-2') return 'organization';
  return 'unknown';
}

export async function npiPageExists(
  npi: string,
  fetchFn: FetchLike = fetch,
  base: string = process.env.SITE_URL || 'https://ainpi.dev',
): Promise<boolean | null> {
  const res = await fetchFn(`${base}/npi/${npi}`, {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  return null;
}

async function defaultDeps(): Promise<IntakeDeps> {
  const { prisma } = await import('@/lib/prisma');
  const { sendSuppressionAlert } = await import('@/lib/admin-email');
  return {
    db: prisma as unknown as IntakeDb,
    alert: sendSuppressionAlert,
    lookupType: (npi) => nppesEnumerationType(npi),
    hasPage: (npi) => npiPageExists(npi),
  };
}

export async function defaultIntakeDeps(): Promise<IntakeDeps> {
  return defaultDeps();
}

/** Most NPIs one emailed request may name; anything past this is ignored. */
export const MAX_NPIS_PER_EMAIL = 3;

export const DEFAULT_REMOVAL_INBOX = 'remove@ainpi.dev';

export interface InboundEmail {
  to: string[] | null | undefined;
  from: string | null | undefined;
  subject: string | null | undefined;
  text: string | null | undefined;
  html: string | null | undefined;
}

/**
 * Read an inbound removal email: is it addressed to the removal inbox, who
 * sent it, and which check-digit-valid NPIs does it name.
 */
export function parseRemovalEmail(
  mail: InboundEmail,
  inbox: string = DEFAULT_REMOVAL_INBOX,
): { forUs: boolean; sender: string | null; npis: string[] } {
  const want = inbox.toLowerCase();
  const forUs = (mail.to ?? []).some((t) => normalizeEmail(t) === want);
  const body =
    mail.text && mail.text.trim().length > 0
      ? mail.text
      : (mail.html ?? '').replace(/<[^>]+>/g, ' ');
  const npis = extractNpis(`${mail.subject ?? ''}\n${body}`).slice(0, MAX_NPIS_PER_EMAIL);
  return { forUs, sender: normalizeEmail(mail.from ?? null), npis };
}
