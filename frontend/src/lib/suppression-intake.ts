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
 * not reveal whether an NPI is listed, declined, queued, or has a page.
 */
import { extractNpis, isNpiShape, invalidateSuppressionCache } from '@/lib/suppression';

export type IntakeSource = 'form' | 'email' | 'manual';
/** pending: in force (at once, or from notBefore when queued); declined: NPI-2. */
export type IntakeStatus = 'pending' | 'declined';
export type IntakeBasis = 'nppes' | 'ainpi_files' | 'unverified' | 'manual';
export type EnumerationType = 'individual' | 'organization' | 'unknown';

/**
 * New requests put in force per UTC day. Past it a request is not refused or
 * held: it is queued (notBefore = the next UTC day) and processed then.
 */
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

export function nextUtcDay(d: Date): Date {
  return new Date(startOfUtcDay(d).getTime() + 86_400_000);
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
        basis: string | null;
        hadPage: boolean | null;
        notBefore: Date | null;
      };
    }): Promise<unknown>;
    count(args: {
      where: {
        requestedAt?: { gte: Date };
        status?: { not: string } | string;
        notBefore?: null | { not: null };
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
  basis: IntakeBasis;
  /** Set when the request was queued past the daily cap. */
  notBefore: Date | null;
  /** True on the first queued request of the day: the cap was just reached. */
  capReached: boolean;
}

export interface IntakeDeps {
  db: IntakeDb;
  /** Admin notice for an accepted request. Not sent for declined ones. */
  alert: (a: IntakeAlert) => Promise<void>;
  /** NPPES enumeration type: NPI-1 individual, NPI-2 organization. */
  lookupType: (npi: string) => Promise<EnumerationType>;
  /** Whether ainpi.dev/npi/<npi> exists now (null when unknown). */
  hasPage: (npi: string) => Promise<boolean | null>;
  /** Automated reply to the requester of an organization NPI. */
  sendDeclined: (to: string, npi: string) => Promise<void>;
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
 * Record one request. Nothing here waits on a person:
 *
 *   NPPES says NPI-1                  -> pending, basis nppes
 *   NPPES says NPI-2                  -> declined, automated reply, no admin alert
 *   NPPES silent (404, deactivated, API down)
 *     and the NPI has an AINPI page   -> pending, basis ainpi_files
 *     and it does not                 -> pending, basis unverified (there is
 *                                        nothing to remove; the filter and the
 *                                        confirmation cron handle it as usual)
 *   past the daily cap                -> pending with notBefore = next UTC day
 *                                        (one admin alert when the cap is hit)
 *
 * `force` (the manual script only) records pending with basis manual and no
 * lookup or cap.
 */
export async function recordSuppression(
  npi: string,
  email: string | null,
  source: IntakeSource,
  deps?: IntakeDeps,
  opts: { force?: boolean } = {},
): Promise<{ created: boolean; status: string; notBefore?: Date | null }> {
  if (!isNpiShape(npi)) throw new Error('recordSuppression: not a 10-digit NPI');
  const d = deps ?? (await defaultDeps());
  const now = (d.now ?? (() => new Date()))();
  const requesterEmail = normalizeEmail(email);

  const existing = await d.db.npiSuppression.findUnique({ where: { npi } });
  if (existing) return { created: false, status: existing.status };

  const hadPage = await d.hasPage(npi).catch(() => null);

  if (source === 'manual' && opts.force) {
    return create(d, { npi, requesterEmail, source, basis: 'manual', hadPage, notBefore: null, capReached: false });
  }

  const type = await d.lookupType(npi).catch((): EnumerationType => 'unknown');
  if (type === 'organization') {
    try {
      await d.db.npiSuppression.create({
        data: { npi, requesterEmail, source, status: 'declined', basis: null, hadPage, notBefore: null },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') return { created: false, status: 'declined' };
      throw err;
    }
    if (requesterEmail) await d.sendDeclined(requesterEmail, npi).catch(() => {});
    return { created: true, status: 'declined' };
  }
  const basis: IntakeBasis =
    type === 'individual' ? 'nppes' : hadPage ? 'ainpi_files' : 'unverified';

  const today = startOfUtcDay(now);
  const inForceToday = await d.db.npiSuppression.count({
    where: { requestedAt: { gte: today }, status: { not: 'declined' }, notBefore: null },
  });
  let notBefore: Date | null = null;
  let capReached = false;
  if (inForceToday >= (d.cap ?? dailyCap())) {
    notBefore = nextUtcDay(now);
    const queuedToday = await d.db.npiSuppression.count({
      where: { requestedAt: { gte: today }, notBefore: { not: null } },
    });
    capReached = queuedToday === 0;
  }
  return create(d, { npi, requesterEmail, source, basis, hadPage, notBefore, capReached });
}

async function create(
  d: IntakeDeps,
  r: {
    npi: string;
    requesterEmail: string | null;
    source: IntakeSource;
    basis: IntakeBasis;
    hadPage: boolean | null;
    notBefore: Date | null;
    capReached: boolean;
  },
): Promise<{ created: boolean; status: string; notBefore: Date | null }> {
  try {
    await d.db.npiSuppression.create({
      data: {
        npi: r.npi,
        requesterEmail: r.requesterEmail,
        source: r.source,
        status: 'pending',
        basis: r.basis,
        hadPage: r.hadPage,
        notBefore: r.notBefore,
      },
    });
  } catch (err) {
    // Lost a race with a concurrent request for the same NPI: same outcome.
    if ((err as { code?: string })?.code === 'P2002') return { created: false, status: 'pending', notBefore: null };
    throw err;
  }
  if (!r.notBefore) invalidateSuppressionCache();
  // Every accepted request is a notice to the admin, never a to-do. Queued
  // ones after the first of the day add nothing new, so only the first alerts.
  if (!r.notBefore || r.capReached) {
    await d
      .alert({
        npi: r.npi,
        source: r.source,
        requesterEmail: r.requesterEmail,
        basis: r.basis,
        notBefore: r.notBefore,
        capReached: r.capReached,
      })
      .catch(() => {});
  }
  return { created: true, status: 'pending', notBefore: r.notBefore };
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

export const DECLINED_REPLY = {
  subject: 'About your AINPI removal request',
  text:
    'The NPI you submitted belongs to an organization. AINPI\'s removal process covers pages ' +
    'about individual providers. Organization records come from public CMS data and are not ' +
    'removed. This mailbox is not monitored, and replies are not read.',
};

async function defaultDeps(): Promise<IntakeDeps> {
  const { prisma } = await import('@/lib/prisma');
  const { sendSuppressionAlert } = await import('@/lib/admin-email');
  return {
    db: prisma as unknown as IntakeDb,
    alert: sendSuppressionAlert,
    lookupType: (npi) => nppesEnumerationType(npi),
    hasPage: (npi) => npiPageExists(npi),
    sendDeclined: sendDeclinedReply,
  };
}

/** Plain text, from the no-reply address, no Reply-To. */
export async function sendDeclinedReply(to: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const { Resend } = await import('resend');
  const from = process.env.REMOVAL_FROM_ADDRESS || 'AINPI <no-reply@ainpi.dev>';
  const r = await new Resend(key).emails.send({
    from,
    to,
    subject: DECLINED_REPLY.subject,
    text: DECLINED_REPLY.text,
  });
  if (r.error) console.error('[suppression-intake] declined reply failed:', r.error.message);
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
