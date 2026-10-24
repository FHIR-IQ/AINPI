import { describe, expect, it, vi } from 'vitest';
import {
  assertSuppressionVisible,
  createSuppressionLoader,
  extractNpis,
  filterSuppressed,
  isValidNpi,
  parseSuppressedNpis,
} from '@/lib/suppression';
import {
  normalizeEmail,
  nppesEnumerationType,
  parseRemovalEmail,
  recordSuppression,
  senderRequestsToday,
  type EnumerationType,
  type IntakeDb,
  type IntakeDeps,
} from '@/lib/suppression-intake';
import {
  buildRemovalConfirmation,
  isRemovedLive,
  runConfirmations,
  type ConfirmDb,
} from '@/lib/suppression-confirm';

// Synthetic NPIs with valid check digits. None is meant to be a real provider.
const A = '1234567893';
const B = '1111111112';
const C = '2222222228';
const BAD_CHECK = '1234567890';

describe('NPI validation and parsing', () => {
  it('checks the NPI check digit', () => {
    expect(isValidNpi(A)).toBe(true);
    expect(isValidNpi(B)).toBe(true);
    expect(isValidNpi(BAD_CHECK)).toBe(false);
    expect(isValidNpi('123')).toBe(false);
  });

  it('parses the env override, ignoring blanks', () => {
    expect(parseSuppressedNpis(` ${A}, ,${B}\n${C} `)).toEqual(new Set([A, B, C]));
    expect(parseSuppressedNpis(undefined).size).toBe(0);
  });

  it('rejects an entry with a bad check digit', () => {
    expect(() => parseSuppressedNpis(BAD_CHECK)).toThrow(/check digit/);
  });

  it('names the fix in the fail-closed error', () => {
    expect(() => assertSuppressionVisible({ set: new Set(), dbRows: null }, 1)).toThrow(
      /Set SUPPRESSED_NPIS in Vercel production and preview, or run frontend\/prisma\/sql\/npi_suppressions\.sql/,
    );
  });

  it('throws on a malformed entry without echoing it', () => {
    expect(() => parseSuppressedNpis(`${A},98765`)).toThrow(/entry #2/);
    expect(() => parseSuppressedNpis(`${A},98765`)).not.toThrow(/98765/);
  });

  it('extracts only check-digit-valid NPIs from free text', () => {
    expect(extractNpis(`Please remove ${A}. Not ${BAD_CHECK} or 12345678931.`)).toEqual([A]);
  });

  it('filters rows on any named key', () => {
    const rows = [{ npi: A }, { npi: B, org_npi: C }, { npi: null }];
    expect(filterSuppressed(rows, new Set([A]))).toEqual([{ npi: B, org_npi: C }, { npi: null }]);
    expect(filterSuppressed(rows, new Set([C]), ['npi', 'org_npi'])).toHaveLength(2);
    expect(filterSuppressed(rows, new Set())).toBe(rows);
  });
});

describe('suppression loader', () => {
  it('merges env and table, and caches for the TTL', async () => {
    let t = 0;
    const source = vi.fn(async () => [B]);
    const loader = createSuppressionLoader({ source, env: () => A, ttlMs: 1000, now: () => t });
    expect(await loader.get()).toEqual(new Set([A, B]));
    t = 500;
    await loader.get();
    expect(source).toHaveBeenCalledTimes(1);
    t = 1500;
    await loader.get();
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good table read when the database fails', async () => {
    let t = 0;
    let fail = false;
    const loader = createSuppressionLoader({
      source: async () => {
        if (fail) throw new Error('down');
        return [B];
      },
      env: () => undefined,
      ttlMs: 10,
      now: () => t,
    });
    expect(await loader.get()).toEqual(new Set([B]));
    fail = true;
    t = 100;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await loader.get()).toEqual(new Set([B]));
    err.mockRestore();
  });

  it('retries a failed read after the backoff instead of caching it', async () => {
    let t = 0;
    let fail = true;
    const source = vi.fn(async () => {
      if (fail) throw new Error('down');
      return [B];
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loader = createSuppressionLoader({ source, env: () => A, now: () => t });
    expect(await loader.state()).toEqual({ set: new Set([A]), dbRows: null });
    t = 1000; // inside the 30 s backoff: no new attempt
    await loader.get();
    expect(source).toHaveBeenCalledTimes(1);
    fail = false;
    t = 31_000;
    expect(await loader.state()).toEqual({ set: new Set([A, B]), dbRows: 1 });
    err.mockRestore();
  });

  it('fails the build when committed removals cannot be seen', () => {
    expect(() => assertSuppressionVisible({ set: new Set(), dbRows: null }, 1)).toThrow(/Refusing to build/);
    expect(() => assertSuppressionVisible({ set: new Set([A]), dbRows: 0 }, 1)).toThrow(/zero rows/);
    expect(() => assertSuppressionVisible({ set: new Set([A]), dbRows: null }, 1)).not.toThrow();
    expect(() => assertSuppressionVisible({ set: new Set([A]), dbRows: 1 }, 1)).not.toThrow();
    expect(() => assertSuppressionVisible({ set: new Set(), dbRows: 0 }, 0)).not.toThrow();
  });

  it('falls back to env alone when the table was never readable', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loader = createSuppressionLoader({
      source: async () => {
        throw new Error('relation does not exist');
      },
      env: () => C,
    });
    expect(await loader.get()).toEqual(new Set([C]));
    err.mockRestore();
  });
});

interface Row {
  npi: string;
  requesterEmail: string | null;
  source: string;
  status: string;
  heldReason: string | null;
  hadPage: boolean | null;
  requestedAt: Date;
}

function intakeDb(existing: Row[] = []) {
  const rows: Row[] = [...existing];
  const db: IntakeDb = {
    npiSuppression: {
      findUnique: async ({ where }) => {
        const r = rows.find((x) => x.npi === where.npi);
        return r ? { id: r.npi, status: r.status } : null;
      },
      create: async ({ data }) => {
        rows.push({ ...data, requestedAt: NOW });
        return data;
      },
      count: async ({ where }) =>
        rows.filter((r) => {
          if (where.requestedAt && r.requestedAt < where.requestedAt.gte) return false;
          if (typeof where.status === 'string' && r.status !== where.status) return false;
          if (typeof where.status === 'object' && r.status === where.status.not) return false;
          if (where.heldReason && r.heldReason !== where.heldReason) return false;
          if (where.requesterEmail && r.requesterEmail !== where.requesterEmail) return false;
          if (where.source && r.source !== where.source) return false;
          return true;
        }).length,
    },
  };
  return { db, rows };
}

const NOW = new Date('2026-10-24T12:00:00Z');

function deps(db: IntakeDb, type: EnumerationType = 'individual', over: Partial<IntakeDeps> = {}) {
  const alert = vi.fn(async () => {});
  return {
    alert,
    d: {
      db,
      alert,
      lookupType: async () => type,
      hasPage: async () => true,
      cap: 2,
      now: () => NOW,
      ...over,
    } as IntakeDeps,
  };
}

describe('recordSuppression', () => {
  it('records an individual NPI as pending, once, with one alert', async () => {
    const { db, rows } = intakeDb();
    const { d, alert } = deps(db);
    expect(await recordSuppression(A, 'Doc <Doc@Example.org>', 'form', d)).toEqual({
      created: true,
      status: 'pending',
    });
    expect(rows[0]).toMatchObject({
      npi: A, requesterEmail: 'doc@example.org', source: 'form', status: 'pending', hadPage: true,
    });
    expect(await recordSuppression(A, 'x@example.org', 'email', d)).toEqual({
      created: false,
      status: 'pending',
    });
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('holds organization NPIs and failed lookups', async () => {
    const { db, rows } = intakeDb();
    await recordSuppression(A, 'a@example.org', 'form', deps(db, 'organization').d);
    await recordSuppression(B, 'b@example.org', 'form', deps(db, 'unknown').d);
    expect(rows.map((r) => [r.status, r.heldReason])).toEqual([
      ['held', 'organization_npi'],
      ['held', 'nppes_lookup_failed'],
    ]);
  });

  it('holds past the daily cap and alerts once for the cap', async () => {
    const { db, rows } = intakeDb();
    const { d, alert } = deps(db);
    for (const npi of [A, B, C, '9999999995']) await recordSuppression(npi, null, 'form', d);
    expect(rows.map((r) => r.status)).toEqual(['pending', 'pending', 'held', 'held']);
    // two pending alerts + one cap alert
    expect(alert).toHaveBeenCalledTimes(3);
  });

  it('lets a reviewed manual request skip the checks', async () => {
    const { db, rows } = intakeDb();
    await recordSuppression(A, null, 'manual', deps(db, 'unknown').d, { force: true });
    expect(rows[0].status).toBe('pending');
  });

  it('counts one sender\'s emailed requests today', async () => {
    const { db } = intakeDb();
    const { d } = deps(db);
    await recordSuppression(A, 's@example.org', 'email', d);
    await recordSuppression(B, 's@example.org', 'email', d);
    expect(await senderRequestsToday(db, 's@example.org', NOW)).toBe(2);
  });

  it('rejects a non-NPI', async () => {
    const { db } = intakeDb();
    await expect(recordSuppression('12', null, 'manual', deps(db).d)).rejects.toThrow();
  });

  it('reads the NPPES enumeration type', async () => {
    const reply = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });
    expect(await nppesEnumerationType(A, reply({ results: [{ enumeration_type: 'NPI-1' }] }))).toBe('individual');
    expect(await nppesEnumerationType(A, reply({ results: [{ enumeration_type: 'NPI-2' }] }))).toBe('organization');
    expect(await nppesEnumerationType(A, reply({ result_count: 0, results: [] }))).toBe('unknown');
  });
});

describe('inbound removal email', () => {
  it('reads recipient, sender and NPIs', () => {
    expect(normalizeEmail('Someone <A@B.org>')).toBe('a@b.org');
    expect(normalizeEmail('no-at-sign')).toBeNull();
    expect(normalizeEmail('a@b@c.org')).toBeNull();
    expect(normalizeEmail('<' + '<='.repeat(5000))).toBeNull();
    expect(normalizeEmail('!@!.' + '!.'.repeat(5000))).toBeNull();
    const got = parseRemovalEmail({
      to: ['AINPI <remove@ainpi.dev>'],
      from: 'Dr X <x@example.org>',
      subject: `Removal ${A}`,
      text: `also ${B} and ${BAD_CHECK}`,
      html: null,
    });
    expect(got).toEqual({ forUs: true, sender: 'x@example.org', npis: [A, B] });
  });

  it('ignores mail to another inbox and caps the NPI count', () => {
    const got = parseRemovalEmail({
      to: ['installs@ainpi.dev'],
      from: 'x@example.org',
      subject: '',
      text: null,
      html: `<p>${A} ${B} ${C} 9999999995</p>`,
    });
    expect(got.forUs).toBe(false);
    expect(got.npis).toHaveLength(3);
  });
});

function res(status: number, body = ''): Response {
  return new Response(body, { status });
}

describe('confirmation', () => {
  it('uses the agreed wording, in plain text', () => {
    const m = buildRemovalConfirmation(A);
    expect(m.text).toBe(
      `Your removal request for NPI ${A} is complete. If this NPI had a page on ainpi.dev, ` +
        'that page has been removed, and the NPI no longer appears in search results, ' +
        'downloadable files or the API on ainpi.dev. Search engines remove an old page when ' +
        'they next crawl it. This mailbox is not monitored, and replies are not read.',
    );
  });

  it('requires a 404 page and an NPI-free cohort CSV', async () => {
    const live = (page: number, csv: string, csvStatus = 200) =>
      isRemovedLive(A, async (url) => (url.includes('/npi/') ? res(page) : res(csvStatus, csv)));
    expect(await live(404, `npi,name\n${B},X\n`)).toBe(true);
    expect(await live(200, `npi,name\n${B},X\n`)).toBe(false);
    expect(await live(404, `npi,name\n${A},X\n`)).toBe(false);
    expect(await live(404, '', 500)).toBe(false);
    expect(await live(404, '<html>')).toBe(false);
  });

  interface CRow {
    npi: string;
    requesterEmail: string | null;
    status: string;
    confirmCheckedAt: Date | null;
    confirmClaimedAt: Date | null;
    confirmedAt: Date | null;
  }
  const row = (npi: string, email: string | null, status = 'applied'): CRow => ({
    npi, requesterEmail: email, status, confirmCheckedAt: null, confirmClaimedAt: null, confirmedAt: null,
  });

  function confirmDb(rows: CRow[]) {
    const matches = (r: CRow, where: Record<string, unknown>) => {
      if (r.npi !== where.npi) return false;
      if (where.status !== undefined && r.status !== where.status) return false;
      if ('confirmClaimedAt' in where) {
        const w = where.confirmClaimedAt as Date | null;
        if (w === null ? r.confirmClaimedAt !== null : r.confirmClaimedAt?.getTime() !== w.getTime()) return false;
      }
      if (where.OR) {
        const ok = (where.OR as Record<string, unknown>[]).some((c) => {
          const v = c.confirmClaimedAt as null | { lt: Date };
          return v === null ? r.confirmClaimedAt === null : r.confirmClaimedAt !== null && r.confirmClaimedAt < v.lt;
        });
        if (!ok) return false;
      }
      return true;
    };
    const db: ConfirmDb = {
      npiSuppression: {
        findMany: async ({ where, take }) =>
          rows
            .filter((r) => r.status === where.status && r.confirmedAt === null)
            .sort((a, b) => (a.confirmCheckedAt?.getTime() ?? -1) - (b.confirmCheckedAt?.getTime() ?? -1))
            .slice(0, take)
            .map((r) => ({ npi: r.npi, requesterEmail: r.requesterEmail })),
        updateMany: async ({ where, data }) => {
          const r = rows.find((x) => matches(x, where as Record<string, unknown>));
          if (!r) return { count: 0 };
          Object.assign(r, data);
          return { count: 1 };
        },
      },
    };
    return db;
  }

  const liveExcept = (stuck: string[]) => async (url: string) =>
    url.includes('/npi/') ? res(stuck.some((n) => url.includes(n)) ? 200 : 404) : res(200, 'npi,name\n');

  it('sends once per applied row that is live, and only once', async () => {
    const rows = [row(A, 'a@example.org'), row(B, 'b@example.org'), row(C, 'c@example.org', 'pending')];
    const db = confirmDb(rows);
    const send = vi.fn(async () => ({ ok: true as const }));
    const s1 = await runConfirmations({ db, fetchFn: liveExcept([B]), send });
    expect(s1).toMatchObject({ checked: 2, sent: 1, notYetLive: 1 });
    expect(rows[0].status).toBe('confirmed');
    expect(rows[0].confirmedAt).not.toBeNull();
    expect(rows[2].status).toBe('pending');
    await runConfirmations({ db, fetchFn: liveExcept([B]), send });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not let stuck rows block newer ones', async () => {
    const rows = [row(A, 'a@example.org'), row(B, 'b@example.org'), row(C, 'c@example.org')];
    const db = confirmDb(rows);
    const send = vi.fn(async () => ({ ok: true as const }));
    let t = 0;
    const now = () => new Date(1_000_000 + t++ * 1000);
    // Room for one check per run; A is stuck.
    await runConfirmations({ db, fetchFn: liveExcept([A]), send, checkLimit: 1, now });
    await runConfirmations({ db, fetchFn: liveExcept([A]), send, checkLimit: 1, now });
    await runConfirmations({ db, fetchFn: liveExcept([A]), send, checkLimit: 1, now });
    expect(rows.map((r) => r.status)).toEqual(['applied', 'confirmed', 'confirmed']);
  });

  it('releases the claim when the send fails', async () => {
    const rows = [row(A, 'a@example.org')];
    const db = confirmDb(rows);
    const s = await runConfirmations({
      db,
      fetchFn: liveExcept([]),
      send: async () => ({ ok: false, error: 'boom' }),
    });
    expect(s.failed).toBe(1);
    expect(rows[0]).toMatchObject({ status: 'applied', confirmClaimedAt: null });
  });

  it('re-claims a claim left by a run that died, after it expires', async () => {
    const rows = [{ ...row(A, 'a@example.org'), confirmClaimedAt: new Date('2026-10-24T10:00:00Z') }];
    const db = confirmDb(rows);
    const send = vi.fn(async () => ({ ok: true as const }));
    const fresh = await runConfirmations({
      db, fetchFn: liveExcept([]), send, now: () => new Date('2026-10-24T10:05:00Z'),
    });
    expect(fresh.alreadyClaimed).toBe(1);
    const later = await runConfirmations({
      db, fetchFn: liveExcept([]), send, now: () => new Date('2026-10-24T11:00:00Z'),
    });
    expect(later.sent).toBe(1);
    expect(rows[0].status).toBe('confirmed');
  });

  it('confirms without email when no requester address was given', async () => {
    const rows = [row(A, null)];
    const db = confirmDb(rows);
    const send = vi.fn();
    const s = await runConfirmations({ db, fetchFn: liveExcept([]), send });
    expect(s.confirmedWithoutEmail).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('confirmed');
  });
});
