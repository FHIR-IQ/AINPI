/**
 * Validator for the NPD MCP working group sign-up form. Pure: no I/O, so the
 * route and the tests share one definition of a valid submission.
 */
import { ORG_TYPES, PARTICIPATION, type OrgType, type Participation } from '@/data/npd-mcp';

export interface Signup {
  organization: string;
  contactName: string;
  email: string;
  orgType: OrgType;
  participation: Participation[];
  useCase: string | null;
  listPublicly: boolean;
}

export type SignupResult = { ok: true; value: Signup } | { ok: false; error: string };

export const MAX_ORGANIZATION = 200;
export const MAX_CONTACT_NAME = 200;
export const MAX_EMAIL = 254;
export const MAX_USE_CASE = 2000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORG_TYPE_CODES = new Set<string>(ORG_TYPES.map((t) => t.code));
const PARTICIPATION_CODES = new Set<string>(PARTICIPATION.map((p) => p.code));

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function parseSignup(body: unknown): SignupResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Please fill in the form and try again.' };
  }
  const b = body as Record<string, unknown>;

  const organization = text(b.organization).slice(0, MAX_ORGANIZATION);
  if (!organization) return { ok: false, error: "Please enter your organization's name." };

  const contactName = text(b.contactName).slice(0, MAX_CONTACT_NAME);
  if (!contactName) return { ok: false, error: 'Please enter your name.' };

  // An over-long address is rejected, not cut: a cut address is a different one.
  const email = text(b.email);
  if (!email) return { ok: false, error: 'Please enter your email address.' };
  if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }

  const orgType = text(b.orgType);
  if (!ORG_TYPE_CODES.has(orgType)) {
    return { ok: false, error: 'Please choose your organization type.' };
  }

  const participation: Participation[] = [];
  if (Array.isArray(b.participation)) {
    for (const raw of b.participation) {
      if (typeof raw !== 'string') continue;
      const code = raw.trim();
      if (PARTICIPATION_CODES.has(code) && !participation.includes(code as Participation)) {
        participation.push(code as Participation);
      }
    }
  }

  const useCase = text(b.useCase).slice(0, MAX_USE_CASE) || null;

  return {
    ok: true,
    value: {
      organization,
      contactName,
      email,
      orgType: orgType as OrgType,
      participation,
      useCase,
      listPublicly: b.listPublicly === true,
    },
  };
}
