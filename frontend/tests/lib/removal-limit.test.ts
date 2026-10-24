import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Capture every SQL statement the limiter sends, without a database.
const sql: string[] = [];
vi.mock('@/lib/prisma', () => {
  const prisma = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push(strings.join('?') + ' :: ' + values.map(String).join(','));
      return [{ units: 1 }];
    }),
    apiKey: { findUnique: vi.fn(async () => null), update: vi.fn() },
    usageLedger: { update: vi.fn(async () => ({})) },
  };
  return { prisma, default: prisma };
});

import { enforceRateLimit, recordSpend, NON_WAREHOUSE_SHAPES } from '@/lib/rate-limit';
import {
  REMOVAL_PER_DAY,
  REMOVAL_PER_MINUTE,
  checkRemovalCeiling,
  checkRemovalLimit,
  checkRemovalSubject,
  type Bump,
} from '@/lib/removal-limit';

function store() {
  const m = new Map<string, number>();
  const bump: Bump = async (id, units) => {
    const v = (m.get(id) ?? 0) + units;
    m.set(id, v);
    return v;
  };
  return { m, bump };
}

beforeEach(() => {
  sql.length = 0;
});

describe('removal limiter', () => {
  it('uses only its own buckets, never the search buckets or the ledger', async () => {
    const { m, bump } = store();
    await checkRemovalLimit('ip:203.0.113.7', { bump, alertCeiling: async () => {} });
    expect([...m.keys()].every((k) => k.startsWith('remove:'))).toBe(true);
    expect([...m.keys()].some((k) => k.startsWith('ip:'))).toBe(false);
  });

  it('is not blocked by an exhausted search quota on the same IP', async () => {
    const { m, bump } = store();
    const now = 1_800_000_000_000;
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);
    m.set(`ip:203.0.113.7:m:${minute}`, 1_000_000);
    m.set(`ip:203.0.113.7:d:${day}`, 1_000_000);
    const r = await checkRemovalLimit('ip:203.0.113.7', { bump, alertCeiling: async () => {}, now: () => now });
    expect(r.ok).toBe(true);
  });

  it('enforces per-minute and per-day limits per subject', async () => {
    const { bump } = store();
    let t = 1_800_000_000_000;
    const deps = { bump, alertCeiling: async () => {}, now: () => t, ceiling: 1000 };
    for (let i = 0; i < REMOVAL_PER_MINUTE; i++) expect((await checkRemovalLimit('ip:a', deps)).ok).toBe(true);
    expect(await checkRemovalLimit('ip:a', deps)).toMatchObject({ ok: false, reason: 'per-minute' });
    expect((await checkRemovalLimit('ip:b', deps)).ok).toBe(true);
    let refused = false;
    for (let i = 0; i < REMOVAL_PER_DAY + 5; i++) {
      t += 61_000;
      const r = await checkRemovalLimit('ip:c', deps);
      if (!r.ok) {
        expect(r.reason).toBe('per-day');
        refused = true;
        break;
      }
    }
    expect(refused).toBe(true);
  });

  it('charges the per-IP bucket, not the global ceiling, before validation', async () => {
    const { m, bump } = store();
    const deps = { bump, alertCeiling: async () => {}, ceiling: 1, now: () => 1_800_000_000_000 };
    // Ten malformed posts: per-IP only, so a valid request still gets through.
    for (let i = 0; i < 10; i++) await checkRemovalSubject(`ip:10.1.0.${i}`, deps);
    expect([...m.keys()].some((k) => k.startsWith('remove:global'))).toBe(false);
    expect((await checkRemovalCeiling(deps)).ok).toBe(true);
    expect((await checkRemovalCeiling(deps)).ok).toBe(false);
  });

  it('applies a global daily ceiling with exactly one alert', async () => {
    const { bump } = store();
    const alert = vi.fn(async () => {});
    const deps = { bump, alertCeiling: alert, ceiling: 3, now: () => 1_800_000_000_000 };
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await checkRemovalLimit(`ip:10.0.0.${i}`, deps));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false, false, false]);
    expect(alert).toHaveBeenCalledTimes(1);
  });
});

describe('warehouse breaker isolation', () => {
  it('never writes the usage ledger for non-warehouse shapes', async () => {
    expect(NON_WAREHOUSE_SHAPES.has('privacy/remove')).toBe(true);
    expect(await recordSpend('2026-10-24', 100, 'privacy/remove')).toBeNull();
    expect(sql).toHaveLength(0);
    await recordSpend('2026-10-24', 25, 'npd/search:name');
    expect(sql.some((q) => q.includes('usage_ledger'))).toBe(true);
  });

  it('a privacy/remove shape through enforceRateLimit does not touch the ledger', async () => {
    const req = new NextRequest('https://ainpi.dev/api/x', { headers: { 'x-forwarded-for': '198.51.100.4' } });
    const r = await enforceRateLimit(req, { shape: 'privacy/remove' });
    expect(r.ok).toBe(true);
    // The per-caller buckets were written (so the mock is live) ...
    expect(sql.some((q) => q.includes('rate_limit_buckets'))).toBe(true);
    // ... and the global ledger was not.
    expect(sql.some((q) => q.includes('usage_ledger'))).toBe(false);
  });
});
