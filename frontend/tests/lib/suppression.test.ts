import { describe, expect, it, vi } from 'vitest';
import {
  createSuppressionLoader,
  extractNpis,
  filterSuppressed,
  isValidNpi,
  parseSuppressedNpis,
} from '@/lib/suppression';
import {
  normalizeEmail,
  parseRemovalEmail,
  recordSuppression,
  type IntakeDb,
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

function intakeDb(existing: string[] = []) {
  const rows = new Set(existing);
  const created: unknown[] = [];
  const db: IntakeDb = {
    npiSuppression: {
      findUnique: async ({ where }) => (rows.has(where.npi) ? { id: where.npi } : null),
      create: async ({ data }) => {
        rows.add(data.npi);
        created.push(data);
        return data;
      },
    },
  };
  return { db, created };
}

describe('recordSuppression', () => {
  it('records once and alerts once', async () => {
    const { db, created } = intakeDb();
    const alert = vi.fn(async () => {});
    expect(await recordSuppression(A, 'Doc <Doc@Example.org>', 'form', { db, alert })).toEqual({
      created: true,
    });
    expect(created).toEqual([{ npi: A, requesterEmail: 'doc@example.org', source: 'form' }]);
    expect(await recordSuppression(A, 'x@example.org', 'email', { db, alert })).toEqual({
      created: false,
    });
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-NPI', async () => {
    const { db } = intakeDb();
    await expect(recordSuppression('12', null, 'manual', { db, alert: async () => {} })).rejects.toThrow();
  });
});

describe('inbound removal email', () => {
  it('reads recipient, sender and NPIs', () => {
    expect(normalizeEmail('Someone <A@B.org>')).toBe('a@b.org');
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
  it('says the removal is complete and that replies are not read', () => {
    const m = buildRemovalConfirmation(A);
    expect(m.text).toContain(`NPI ${A} is complete`);
    expect(m.text).toContain('replies are not read');
    expect(m.text).not.toMatch(/google/i);
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

  function confirmDb(rows: { npi: string; requesterEmail: string | null; status: string; confirmedAt: Date | null }[]) {
    const db: ConfirmDb = {
      npiSuppression: {
        findMany: async ({ where, take }) =>
          rows
            .filter((r) => r.status === where.status && r.confirmedAt === null)
            .slice(0, take)
            .map((r) => ({ npi: r.npi, requesterEmail: r.requesterEmail })),
        updateMany: async ({ where, data }) => {
          const r = rows.find(
            (x) =>
              x.npi === where.npi &&
              (where.status === undefined || x.status === where.status) &&
              (where.confirmedAt === null
                ? x.confirmedAt === null
                : x.confirmedAt?.getTime() === where.confirmedAt.getTime()),
          );
          if (!r) return { count: 0 };
          Object.assign(r, data);
          return { count: 1 };
        },
      },
    };
    return db;
  }

  it('sends once per applied row that is live, and only once', async () => {
    const rows = [
      { npi: A, requesterEmail: 'a@example.org', status: 'applied', confirmedAt: null },
      { npi: B, requesterEmail: 'b@example.org', status: 'applied', confirmedAt: null },
      { npi: C, requesterEmail: 'c@example.org', status: 'pending', confirmedAt: null },
    ];
    const db = confirmDb(rows);
    const send = vi.fn(async () => ({ ok: true as const }));
    // B's page is still up.
    const fetchFn = async (url: string) =>
      url.includes('/npi/') ? res(url.includes(B) ? 200 : 404) : res(200, 'npi,name\n');
    const s1 = await runConfirmations({ db, fetchFn, send });
    expect(s1).toMatchObject({ checked: 2, sent: 1, notYetLive: 1 });
    expect(send).toHaveBeenCalledWith('a@example.org', expect.objectContaining({ subject: expect.any(String) }));
    expect(rows[0].status).toBe('confirmed');
    expect(rows[2].status).toBe('pending');
    const s2 = await runConfirmations({ db, fetchFn, send });
    expect(s2.sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when the send fails', async () => {
    const rows = [{ npi: A, requesterEmail: 'a@example.org', status: 'applied', confirmedAt: null as Date | null }];
    const db = confirmDb(rows);
    const fetchFn = async (url: string) => (url.includes('/npi/') ? res(404) : res(200, 'npi,name\n'));
    const s = await runConfirmations({
      db,
      fetchFn,
      send: async () => ({ ok: false, error: 'boom' }),
    });
    expect(s.failed).toBe(1);
    expect(rows[0]).toMatchObject({ status: 'applied', confirmedAt: null });
  });

  it('confirms without email when no requester address was given', async () => {
    const rows = [{ npi: A, requesterEmail: null, status: 'applied', confirmedAt: null as Date | null }];
    const db = confirmDb(rows);
    const send = vi.fn();
    const s = await runConfirmations({
      db,
      fetchFn: async (url) => (url.includes('/npi/') ? res(404) : res(200, 'npi,name\n')),
      send,
    });
    expect(s.confirmedWithoutEmail).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('confirmed');
  });
});
