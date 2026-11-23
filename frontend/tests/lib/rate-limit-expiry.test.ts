import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const row = { current: null as Record<string, unknown> | null };
vi.mock('@/lib/prisma', () => {
  const client = {
    apiKey: {
      findUnique: async () => row.current,
      update: async () => ({}),
    },
    // bump()/recordSpend(): report the trial pool as over its cap, all else at 1.
    $queryRaw: async (_s: TemplateStringsArray, id: unknown) => [
      { units: typeof id === 'string' && id.startsWith('pool:trial') ? 10_000_000 : 1 },
    ],
    usageLedger: { update: async () => ({}) },
  };
  return { default: client, prisma: client };
});

import { enforceRateLimit, identify } from '@/lib/rate-limit';

const req = () => new NextRequest('https://ainpi.dev/x', { headers: { 'x-api-key': 'ainpi_live_test' } });
const base = { id: 'k1', active: true, revokedAt: null, tier: 'trial', dailyUnitCap: null };

describe('identify: key expiry', () => {
  beforeEach(() => {
    row.current = null;
  });
  it('accepts a key whose expiry is in the future', async () => {
    row.current = { ...base, expiresAt: new Date(Date.now() + 60_000) };
    const c = await identify(req());
    expect(c.keyId).toBe('k1');
    expect(c.tier.name).toBe('trial');
  });
  it('refuses an expired key exactly like a revoked one', async () => {
    row.current = { ...base, expiresAt: new Date(Date.now() - 1) };
    const c = await identify(req());
    expect(c.keyId).toBeNull();
    expect(c.subject.startsWith('badkey:')).toBe(true);
    expect(c.dailyUnitCap).toBe(0);
  });
  it('treats a null expiry as no expiry', async () => {
    row.current = { ...base, tier: 'partner', expiresAt: null };
    expect((await identify(req())).keyId).toBe('k1');
  });
});

describe('enforceRateLimit: trial keys', () => {
  it('refuses a trial key once the shared trial pool is spent, with 503', async () => {
    row.current = { ...base, id: 'k-pool', expiresAt: new Date(Date.now() + 60_000) };
    const r = await enforceRateLimit(req(), { shape: 'npd/search:org' });
    expect(r.ok).toBe(false);
    expect(r.response?.status).toBe(503);
  });
  it('refuses magic-scanner for a trial key with 403', async () => {
    row.current = { ...base, id: 'k-llm', expiresAt: new Date(Date.now() + 60_000) };
    const r = await enforceRateLimit(req(), { shape: 'magic-scanner' });
    expect(r.response?.status).toBe(403);
  });
  it('does not apply the trial pool to a partner key', async () => {
    row.current = { ...base, id: 'k-partner', tier: 'partner', expiresAt: null };
    const r = await enforceRateLimit(req(), { shape: 'npd/search:org' });
    expect(r.ok).toBe(true);
  });
});

describe('identify: OAuth token audience', () => {
  it('an access token is not accepted outside the MCP paths', async () => {
    row.current = { ...base, tier: 'partner', expiresAt: null };
    const r = new NextRequest('https://ainpi.dev/api/v1/roster/verify', { headers: { authorization: 'Bearer ainpi_at_whatever' } });
    const c = await identify(r);
    expect(c.keyId).toBeNull();
    expect(c.subject.startsWith('badkey:')).toBe(true);
  });
});
