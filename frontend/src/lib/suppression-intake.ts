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
 * not reveal whether an NPI is listed or has a page.
 */
import { extractNpis, isNpiShape, invalidateSuppressionCache } from '@/lib/suppression';

export type IntakeSource = 'form' | 'email' | 'manual';

export interface IntakeDb {
  npiSuppression: {
    findUnique(args: { where: { npi: string } }): Promise<{ id: string } | null>;
    create(args: {
      data: { npi: string; requesterEmail: string | null; source: string };
    }): Promise<unknown>;
  };
}

export interface IntakeDeps {
  db: IntakeDb;
  alert: (a: { npi: string; source: IntakeSource; requesterEmail: string | null }) => Promise<void>;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Accept "Name <a@b.c>" as well as a bare address.
  const m = raw.match(/<([^>]+)>/);
  const addr = (m ? m[1] : raw).trim().toLowerCase();
  return EMAIL_RE.test(addr) ? addr : null;
}

export async function recordSuppression(
  npi: string,
  email: string | null,
  source: IntakeSource,
  deps?: IntakeDeps,
): Promise<{ created: boolean }> {
  if (!isNpiShape(npi)) throw new Error('recordSuppression: not a 10-digit NPI');
  const d = deps ?? (await defaultDeps());
  const requesterEmail = normalizeEmail(email);

  const existing = await d.db.npiSuppression.findUnique({ where: { npi } });
  if (existing) return { created: false };

  try {
    await d.db.npiSuppression.create({ data: { npi, requesterEmail, source } });
  } catch (err) {
    // Lost a race with a concurrent request for the same NPI: same outcome.
    if ((err as { code?: string })?.code === 'P2002') return { created: false };
    throw err;
  }
  invalidateSuppressionCache();
  await d.alert({ npi, source, requesterEmail }).catch(() => {});
  return { created: true };
}

async function defaultDeps(): Promise<IntakeDeps> {
  const { prisma } = await import('@/lib/prisma');
  const { sendSuppressionAlert } = await import('@/lib/admin-email');
  return { db: prisma as unknown as IntakeDb, alert: sendSuppressionAlert };
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
