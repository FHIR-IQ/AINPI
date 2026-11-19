import { describe, expect, it } from 'vitest';
import { parseSignup } from '@/lib/npd-mcp-signup';

const MIN = { organization: 'Acme Health', contactName: 'Pat', email: 'pat@acme.org', orgType: 'payer' };

describe('parseSignup', () => {
  it('accepts a minimal valid body', () => {
    const r = parseSignup(MIN);
    expect(r).toEqual({
      ok: true,
      value: {
        organization: 'Acme Health',
        contactName: 'Pat',
        email: 'pat@acme.org',
        orgType: 'payer',
        participation: [],
        useCase: null,
        listPublicly: false,
      },
    });
  });

  it('trims and caps text', () => {
    const long = parseSignup({ ...MIN, organization: 'a'.repeat(300) });
    expect(long.ok && long.value.organization.length).toBe(200);
    const trimmed = parseSignup({ ...MIN, useCase: '  x  ' });
    expect(trimmed.ok && trimmed.value.useCase).toBe('x');
    const blank = parseSignup({ ...MIN, useCase: '   ' });
    expect(blank.ok && blank.value.useCase).toBeNull();
    const longUse = parseSignup({ ...MIN, useCase: 'u'.repeat(2500) });
    expect(longUse.ok && longUse.value.useCase?.length).toBe(2000);
  });

  it('rejects missing required fields', () => {
    for (const key of ['organization', 'contactName', 'email', 'orgType'] as const) {
      const missing: Record<string, unknown> = { ...MIN };
      delete missing[key];
      expect(parseSignup(missing).ok).toBe(false);
      expect(parseSignup({ ...MIN, [key]: '   ' }).ok).toBe(false);
    }
  });

  it('rejects bad email and unknown orgType', () => {
    expect(parseSignup({ ...MIN, email: 'not-an-email' }).ok).toBe(false);
    expect(parseSignup({ ...MIN, orgType: 'insurer' }).ok).toBe(false);
  });

  it('rejects an email longer than 254 characters rather than truncating it', () => {
    expect(parseSignup({ ...MIN, email: `${'a'.repeat(250)}@acme.org` }).ok).toBe(false);
  });

  it('filters participation to known codes and dedupes', () => {
    const r = parseSignup({ ...MIN, participation: ['test', 'test', 'bogus', 7] });
    expect(r.ok && r.value.participation).toEqual(['test']);
  });

  it('listPublicly is true only for literal true', () => {
    for (const v of ['true', 1]) {
      const r = parseSignup({ ...MIN, listPublicly: v });
      expect(r.ok && r.value.listPublicly).toBe(false);
    }
    const yes = parseSignup({ ...MIN, listPublicly: true });
    expect(yes.ok && yes.value.listPublicly).toBe(true);
  });

  it('rejects non-object bodies', () => {
    for (const b of [null, [], 'x', 42, undefined]) {
      expect(parseSignup(b).ok).toBe(false);
    }
  });

  it('returns a plain user-facing error', () => {
    const r = parseSignup({ ...MIN, organization: '' });
    expect(r).toEqual({ ok: false, error: "Please enter your organization's name." });
  });
});
