import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const row = { current: null as Record<string, unknown> | null };
vi.mock('@/lib/prisma', () => {
  const client = {
    apiKey: {
      findUnique: async () => row.current,
      update: async () => ({}),
    },
  };
  return { default: client, prisma: client };
});

import { identify } from '@/lib/rate-limit';

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
