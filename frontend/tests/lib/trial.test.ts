import { describe, expect, it, vi } from 'vitest';

import { TIERS, USD_PER_UNIT } from '@/lib/rate-limit';
import {
  TRIAL_DAYS,
  normalizeEmail,
  parseTrial,
  startTrial,
  type Email,
  type TrialDb,
} from '@/lib/trial';

const INPUT = {
  organization: 'Acme Analytics',
  contactName: 'Pat Example',
  email: 'Pat@Example.com',
  role: 'Data lead',
  useCase: 'Endpoint coverage by state',
  acceptTerms: true,
};
const NOW = new Date('2026-11-22T12:00:00Z');
const META = { ip: '203.0.113.9', userAgent: 'test' };

function fakeDb(opts: { existing?: boolean; createError?: unknown } = {}) {
  const keys: Record<string, unknown>[] = [];
  const signups: Record<string, unknown>[] = [];
  const keyUpdates: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const db: TrialDb = {
    trialSignup: {
      findUnique: async () => (opts.existing ? { id: 's0', contactName: 'Earlier Name' } : null),
      create: async ({ data }) => {
        if (opts.createError) throw opts.createError;
        signups.push(data);
        return data;
      },
      delete: async ({ where }) => {
        deleted.push(where.id);
        return {};
      },
    },
    apiKey: {
      create: async ({ data }) => {
        keys.push(data);
        return { id: 'k1' };
      },
      update: async ({ data }) => {
        keyUpdates.push(data);
        return {};
      },
    },
  };
  return { db, keys, signups, keyUpdates, deleted };
}

function parsed() {
  const r = parseTrial(INPUT);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('parseTrial', () => {
  it('accepts a complete form and trims', () => {
    const r = parseTrial({ ...INPUT, organization: '  Acme  ' });
    expect(r.ok && r.value.organization).toBe('Acme');
  });
  it('requires the terms box, an organization, a name and a valid email', () => {
    expect(parseTrial({ ...INPUT, acceptTerms: false }).ok).toBe(false);
    expect(parseTrial({ ...INPUT, acceptTerms: 'true' }).ok).toBe(false);
    expect(parseTrial({ ...INPUT, organization: ' ' }).ok).toBe(false);
    expect(parseTrial({ ...INPUT, contactName: '' }).ok).toBe(false);
    expect(parseTrial({ ...INPUT, email: 'not-an-email' }).ok).toBe(false);
    expect(parseTrial({ ...INPUT, email: `${'a'.repeat(250)}@x.io` }).ok).toBe(false);
    expect(parseTrial(null).ok).toBe(false);
  });
  it('treats role and use case as optional', () => {
    const r = parseTrial({ ...INPUT, role: '', useCase: undefined });
    expect(r.ok && r.value.role).toBeNull();
    expect(r.ok && r.value.useCase).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims, so case cannot buy a second trial', () => {
    expect(normalizeEmail('  Pat@Example.COM ')).toBe('pat@example.com');
  });
});

describe('startTrial', () => {
  it('issues a trial-tier key that expires in 14 days and emails it, never returning it', async () => {
    const f = fakeDb();
    const sent: Email[] = [];
    const out = await startTrial(parsed(), META, NOW, f.db, async (e) => (sent.push(e), true));
    expect(out.kind).toBe('issued');
    expect(JSON.stringify(out)).not.toContain('ainpi_live_');
    const key = f.keys[0];
    expect(key.tier).toBe('trial');
    expect(String(key.label)).toMatch(/^trial:/);
    expect((key.expiresAt as Date).getTime() - NOW.getTime()).toBe(TRIAL_DAYS * 86_400_000);
    expect(key).not.toHaveProperty('plaintext');
    expect(String(key.keyHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(f.signups[0].emailNorm).toBe('pat@example.com');
    expect(f.signups[0].apiKeyId).toBe('k1');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('Pat@Example.com');
    expect(sent[0].text).toMatch(/ainpi_live_[A-Za-z0-9_-]{43}/);
    expect(sent[0].text).toContain('2026-12-06');
  });

  it('for an address that already had a trial: no new key, an "already" email, same outcome to the caller', async () => {
    const f = fakeDb({ existing: true });
    const sent: Email[] = [];
    const out = await startTrial(parsed(), META, NOW, f.db, async (e) => (sent.push(e), true));
    expect(out.kind).toBe('existing');
    expect(f.keys).toHaveLength(0);
    expect(sent[0].text).not.toContain('ainpi_live_');
    expect(sent[0].text).toContain('already has one');
  });

  it('revokes the key when a concurrent sign-up for the same address wins', async () => {
    const f = fakeDb({ createError: Object.assign(new Error('dup'), { code: 'P2002' }) });
    const send = vi.fn(async () => true);
    const out = await startTrial(parsed(), META, NOW, f.db, send);
    expect(out.kind).toBe('existing');
    expect(f.keyUpdates[0]).toMatchObject({ active: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('rolls back key and row when the email cannot be sent, so nobody-held keys never exist', async () => {
    const f = fakeDb();
    const out = await startTrial(parsed(), META, NOW, f.db, async () => false);
    expect(out.kind).toBe('send-failed');
    expect(f.keyUpdates[0]).toMatchObject({ active: false });
    expect(f.deleted).toHaveLength(1);
  });

  it('also rolls back when the send throws', async () => {
    const f = fakeDb();
    const out = await startTrial(parsed(), META, NOW, f.db, async () => {
      throw new Error('network');
    });
    expect(out.kind).toBe('send-failed');
    expect(f.deleted).toHaveLength(1);
  });

  it('propagates other database errors after revoking the key', async () => {
    const f = fakeDb({ createError: Object.assign(new Error('no table'), { code: 'P2021' }) });
    await expect(startTrial(parsed(), META, NOW, f.db, async () => true)).rejects.toThrow();
    expect(f.keyUpdates[0]).toMatchObject({ active: false });
  });
});

describe('trial tier economics', () => {
  it('is bounded by the global breaker and costs at most ~$2 a key a day', () => {
    expect(TIERS.trial.survivesBreaker).toBe(false);
    expect(TIERS.trial.perDay * USD_PER_UNIT).toBeLessThanOrEqual(2);
  });
  it('is never worse than a free key, so the trial is worth starting', () => {
    expect(TIERS.trial.perDay).toBeGreaterThanOrEqual(TIERS.free.perDay);
    expect(TIERS.trial.perMinute).toBeGreaterThanOrEqual(TIERS.free.perMinute);
  });
});
