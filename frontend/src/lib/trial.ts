/**
 * Self-serve API trial (/trial): validation, key issue, and the emails a
 * trialist receives. I/O is injected (db, send) so the route, the reminder
 * cron and the tests share one implementation.
 *
 * What a trial is: a 14-day API key on the `trial` tier (src/lib/rate-limit.ts:
 * 10x the anonymous daily quota, ~8x the per-minute rate, refused like a revoked
 * key once `expiresAt` passes). The data stays free and public with or without
 * a key; a trial and a plan buy limits and support, never access to the data.
 *
 * Abuse bounds: one trial per email address, ever (trial_signups.email_norm is
 * unique); the key reaches only that inbox, which is the verification; per-IP
 * and global daily ceilings in the route; and trial keys do not survive the
 * global spend breaker, so all trial traffic together is bounded by it.
 *
 * Conversion is manual for now: Gene runs scripts/trial.ts convert.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const TRIAL_DAYS = 14;
export const REMINDER_DAYS_BEFORE = 3;
export const TRIAL_TIER = 'trial';
export const TRIAL_LABEL_PREFIX = 'trial:';
export const CONTACT_EMAIL = 'gene@fhiriq.com';
const SITE = 'https://ainpi.dev';

export const MAX_ORGANIZATION = 200;
export const MAX_CONTACT_NAME = 200;
export const MAX_EMAIL = 254;
export const MAX_ROLE = 120;
export const MAX_USE_CASE = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TrialInput {
  organization: string;
  contactName: string;
  email: string;
  role: string | null;
  useCase: string | null;
}

export type ParseResult = { ok: true; value: TrialInput } | { ok: false; error: string };

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * The identity used for one-trial-per-address: lowercased, `+tag` removed,
 * and for Gmail the dots too (Gmail ignores them), with googlemail.com folded
 * into gmail.com. Catch-all domains are bounded by the per-IP limits, the
 * global ceiling and the shared trial pool instead.
 */
export function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

// The key email repeats the name and organization the form was given, so a
// value that looks like a link could turn our email into someone's phishing.
const LINKISH = /:\/\/|www\.|<|>/i;

export function parseTrial(body: unknown): ParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Please fill in the form and try again.' };
  }
  const b = body as Record<string, unknown>;
  const organization = text(b.organization).slice(0, MAX_ORGANIZATION);
  if (!organization) return { ok: false, error: "Please enter your organization's name." };
  const contactName = text(b.contactName).slice(0, MAX_CONTACT_NAME);
  if (!contactName) return { ok: false, error: 'Please enter your name.' };
  if (LINKISH.test(organization) || LINKISH.test(contactName)) {
    return { ok: false, error: 'Please enter the organization and your name without links.' };
  }
  const email = text(b.email);
  if (!email) return { ok: false, error: 'Please enter your work email address.' };
  if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  if (b.acceptTerms !== true) {
    return { ok: false, error: 'Please confirm you have read the trial terms.' };
  }
  return {
    ok: true,
    value: {
      organization,
      contactName,
      email,
      role: text(b.role).slice(0, MAX_ROLE) || null,
      useCase: text(b.useCase).slice(0, MAX_USE_CASE) || null,
    },
  };
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export function keyEmail(t: TrialInput, key: string, expiresAt: Date): Email {
  return {
    to: t.email,
    subject: 'Your AINPI API trial key',
    text: [
      `Hello ${t.contactName},`,
      ``,
      `Here is the API trial key for ${t.organization}. It works until ${day(expiresAt)} (UTC).`,
      `Keep it private: it is charged against your quota whoever uses it.`,
      ``,
      `  ${key}`,
      ``,
      `Send it as X-API-Key: <key> or Authorization: Bearer <key> on:`,
      `- the search API, e.g. ${SITE}/api/npd/search?org=geisinger&state=PA`,
      `- cross-source provider search, ${SITE}/api/provider-search`,
      `- the MCP server, ${SITE}/api/mcp`,
      `  (Claude Code: claude mcp add --transport http ainpi ${SITE}/api/mcp --header "Authorization: Bearer <key>")`,
      ``,
      `With the key you get 10 times the anonymous daily quota and 8 times the per-minute rate.`,
      `Docs and limits: ${SITE}/developer`,
      ``,
      `The published data under ${SITE}/api/v1/ is free and needs no key, during the trial and after.`,
      `AINPI is research on public CMS, federal and payer-directory data: verify any number against`,
      `the primary source before`,
      `acting on it.`,
      ``,
      `Reply to this email to talk about a plan, or with any question.`,
    ].join('\n'),
  };
}

export function alreadyEmail(contactName: string, to: string): Email {
  return {
    to,
    subject: 'Your AINPI API trial',
    text: [
      `Hello ${contactName},`,
      ``,
      `A trial was requested for this address, but it already has one, current or finished.`,
      `Each address can start one trial. If you lost the key or need more time, reply to this`,
      `email and we will sort it out. If you did not request this, you can ignore it.`,
    ].join('\n'),
  };
}

export function reminderEmail(contactName: string, organization: string, to: string, expiresAt: Date): Email {
  return {
    to,
    subject: `Your AINPI API trial ends on ${day(expiresAt)}`,
    text: [
      `Hello ${contactName},`,
      ``,
      `The API trial key for ${organization} stops working on ${day(expiresAt)} (UTC).`,
      ``,
      `To keep the key working, reply to this email and we will set up a plan. A plan has`,
      `higher limits than the trial, keeps working when the daily spend ceiling pauses anonymous`,
      `and trial traffic, and includes direct support. If you need a few more days to finish`,
      `evaluating, reply and say so.`,
      ``,
      `The published data under ${SITE}/api/v1/ stays free with or without a key.`,
    ].join('\n'),
  };
}

export function endedEmail(contactName: string, organization: string, to: string): Email {
  return {
    to,
    subject: 'Your AINPI API trial has ended',
    text: [
      `Hello ${contactName},`,
      ``,
      `The API trial key for ${organization} has expired. Requests with it now return 401.`,
      `Anonymous access and the free published data under ${SITE}/api/v1/ keep working.`,
      ``,
      `Reply to this email to talk about a plan.`,
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export interface TrialDb {
  trialSignup: {
    findUnique(args: { where: { emailNorm: string } }): Promise<{ id: string; contactName: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  apiKey: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

export type Send = (e: Email) => Promise<boolean>;

/**
 * Rate gates owned by the route (they use the shared counter). `mailOnce`
 * returns false when this address was already emailed today. `reserveNew`
 * returns false when today's ceiling of new trials is reached; it is charged
 * only for an address that has never had a trial, so repeat requests for
 * existing addresses cannot use up the ceiling.
 */
export interface Gates {
  mailOnce(emailNorm: string): Promise<boolean>;
  reserveNew(): Promise<boolean>;
}

export type StartOutcome =
  | { kind: 'issued'; signupId: string; expiresAt: Date }
  | { kind: 'existing' }
  | { kind: 'paused' }
  | { kind: 'send-failed' };

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}

/**
 * Start a trial. Never returns the key: it goes only into the email. Any
 * database error other than a duplicate address propagates to the caller.
 */
export async function startTrial(
  t: TrialInput,
  meta: { ip: string | null; userAgent: string | null },
  now: Date,
  db: TrialDb,
  send: Send,
  gates: Gates,
): Promise<StartOutcome> {
  const emailNorm = normalizeEmail(t.email);
  const existing = await db.trialSignup.findUnique({ where: { emailNorm } });
  if (existing) {
    if (await gates.mailOnce(emailNorm)) {
      await send(alreadyEmail(existing.contactName, t.email)).catch(() => false);
    }
    return { kind: 'existing' };
  }
  if (!(await gates.reserveNew())) return { kind: 'paused' };
  // Count the key email against the address's one email a day.
  await gates.mailOnce(emailNorm);

  const signupId = randomUUID();
  const expiresAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
  const plaintext = `ainpi_live_${randomBytes(32).toString('base64url')}`;
  const key = await db.apiKey.create({
    data: {
      keyHash: createHash('sha256').update(plaintext).digest('hex'),
      keyPrefix: plaintext.slice(0, 20),
      label: `${TRIAL_LABEL_PREFIX}${signupId}`,
      tier: TRIAL_TIER,
      organization: t.organization,
      contactEmail: t.email,
      expiresAt,
      notes: 'Self-serve API trial (/trial).',
    },
  });
  const revoke = () =>
    db.apiKey.update({ where: { id: key.id }, data: { active: false, revokedAt: new Date() } }).catch(() => {});

  try {
    await db.trialSignup.create({
      data: {
        id: signupId,
        organization: t.organization,
        contactName: t.contactName,
        email: t.email,
        emailNorm,
        role: t.role,
        useCase: t.useCase,
        apiKeyId: key.id,
        expiresAt,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  } catch (e) {
    await revoke();
    // Two submissions for one address at once: the other one won.
    if (isUniqueViolation(e)) return { kind: 'existing' };
    throw e;
  }

  const sent = await send(keyEmail(t, plaintext, expiresAt)).catch(() => false);
  if (!sent) {
    // Nobody holds the key, so remove both and let the person try again.
    await revoke();
    await db.trialSignup.delete({ where: { id: signupId } }).catch(() => {});
    return { kind: 'send-failed' };
  }
  return { kind: 'issued', signupId, expiresAt };
}
