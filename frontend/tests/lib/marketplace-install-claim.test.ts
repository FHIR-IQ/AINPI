import { describe, expect, it, vi } from 'vitest';
import { prismaWelcomeClaim, welcomeOnce, type ClaimDb } from '@/lib/marketplace-install-claim';

/**
 * In-memory stand-in for prisma.marketplaceInstall.updateMany with the one
 * property that matters: the conditional write is atomic, so of two callers
 * racing on `welcomedAt: null` exactly one sees count === 1.
 */
function fakeDb(initial: Record<string, Date | null>) {
  const rows = new Map(Object.entries(initial));
  const db: ClaimDb = {
    marketplaceInstall: {
      updateMany: vi.fn(async ({ where, data }) => {
        const cur = rows.get(where.email);
        if (cur === undefined) return { count: 0 };
        const matches =
          where.welcomedAt === null
            ? cur === null
            : cur !== null && cur.getTime() === (where.welcomedAt as Date).getTime();
        if (!matches) return { count: 0 };
        rows.set(where.email, data.welcomedAt);
        return { count: 1 };
      }),
    },
  };
  return { db, rows };
}

describe('prismaWelcomeClaim', () => {
  it('claims an unwelcomed row once and only once', async () => {
    const { db, rows } = fakeDb({ 'a@example.com': null });
    const c = prismaWelcomeClaim(db, () => new Date('2026-09-23T00:00:00Z'));
    const first = await c.claim('a@example.com');
    const second = await c.claim('a@example.com');
    expect(first).toEqual(new Date('2026-09-23T00:00:00Z'));
    expect(second).toBeNull();
    expect(rows.get('a@example.com')).toEqual(first);
  });

  it('returns null when there is no row to claim', async () => {
    const { db } = fakeDb({});
    expect(await prismaWelcomeClaim(db).claim('none@example.com')).toBeNull();
  });

  it('release only clears the value this claim set', async () => {
    const { db, rows } = fakeDb({ 'a@example.com': null });
    const c = prismaWelcomeClaim(db, () => new Date('2026-09-23T00:00:00Z'));
    const at = (await c.claim('a@example.com'))!;
    // Someone else re-claimed with a different timestamp after our release window.
    rows.set('a@example.com', new Date('2026-09-24T00:00:00Z'));
    await c.release('a@example.com', at);
    expect(rows.get('a@example.com')).toEqual(new Date('2026-09-24T00:00:00Z'));
  });

  it('uses conditional updateMany calls, never an unconditional update', async () => {
    const { db } = fakeDb({ 'a@example.com': null });
    const c = prismaWelcomeClaim(db, () => new Date('2026-09-23T00:00:00Z'));
    const at = (await c.claim('a@example.com'))!;
    await c.release('a@example.com', at);
    const calls = (db.marketplaceInstall.updateMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toEqual({
      where: { email: 'a@example.com', welcomedAt: null },
      data: { welcomedAt: at },
    });
    expect(calls[1][0]).toEqual({
      where: { email: 'a@example.com', welcomedAt: at },
      data: { welcomedAt: null },
    });
  });
});

describe('welcomeOnce', () => {
  it('sends when the claim succeeds', async () => {
    const { db } = fakeDb({ 'a@example.com': null });
    const send = vi.fn(async () => ({ ok: true as const }));
    const r = await welcomeOnce('a@example.com', { ...prismaWelcomeClaim(db), send });
    expect(r).toEqual({ status: 'sent' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not send when the address is already claimed', async () => {
    const { db } = fakeDb({ 'a@example.com': new Date() });
    const send = vi.fn(async () => ({ ok: true as const }));
    const r = await welcomeOnce('a@example.com', { ...prismaWelcomeClaim(db), send });
    expect(r).toEqual({ status: 'already' });
    expect(send).not.toHaveBeenCalled();
  });

  it('two overlapping runs send exactly one welcome', async () => {
    const { db } = fakeDb({ 'a@example.com': null });
    const send = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true as const };
    });
    const deps = { ...prismaWelcomeClaim(db), send };
    const [a, b] = await Promise.all([
      welcomeOnce('a@example.com', deps),
      welcomeOnce('a@example.com', deps),
    ]);
    expect([a.status, b.status].sort()).toEqual(['already', 'sent']);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when the send fails, so a later run retries', async () => {
    const { db, rows } = fakeDb({ 'a@example.com': null });
    const send = vi.fn(async () => ({ ok: false as const, error: 'resend 500' }));
    const r = await welcomeOnce('a@example.com', { ...prismaWelcomeClaim(db), send });
    expect(r).toEqual({ status: 'failed', error: 'resend 500' });
    expect(rows.get('a@example.com')).toBeNull();
  });

  it('releases the claim when the send throws', async () => {
    const { db, rows } = fakeDb({ 'a@example.com': null });
    const send = vi.fn(async () => {
      throw new Error('network');
    });
    const r = await welcomeOnce('a@example.com', { ...prismaWelcomeClaim(db), send });
    expect(r).toEqual({ status: 'failed', error: 'network' });
    expect(rows.get('a@example.com')).toBeNull();
  });
});
