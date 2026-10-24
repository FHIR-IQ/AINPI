import { describe, expect, it, vi } from 'vitest';
import {
  assertSuppressionVisible,
  createSuppressionLoader,
  isActiveSuppression,
  suppressionScope,
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
  DECLINED_REPLY,
  RemovalCeilingError,
  type IntakeCountWhere,
  type EnumerationType,
  type IntakeDb,
  type IntakeDeps,
} from '@/lib/suppression-intake';
import {
  buildRemovalConfirmation,
  isRemovedLive,
  runConfirmations,
  runOverdueCheck,
  runReclassify,
  runConfirmCron,
  RECLASSIFY_DEADLINE_MS,
  RECLASSIFY_LIMIT,
  type ConfirmDb,
  type OverdueDb,
  type ReclassifyDb,
} from '@/lib/suppression-confirm';

// Synthetic NPIs with valid check digits. None is meant to be a real provider.
const A = '1234567893';
const B = '1111111112';
const C = '2222222228';
const BAD_CHECK = '1234567890';
const D = '3333333334';
const E = '4444444440';

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
    expect(() => assertSuppressionVisible({ set: new Set(), orgSet: new Set(), dbRows: null }, 1)).toThrow(
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
    expect(await loader.state()).toEqual({ set: new Set([A]), orgSet: new Set([A]), dbRows: null });
    t = 1000; // inside the 30 s backoff: no new attempt
    await loader.get();
    expect(source).toHaveBeenCalledTimes(1);
    fail = false;
    t = 31_000;
    expect(await loader.state()).toEqual({ set: new Set([A, B]), orgSet: new Set([A, B]), dbRows: 1 });
    err.mockRestore();
  });

  it('keeps an unverified NPI out of organization scope', async () => {
    const loader = createSuppressionLoader({
      source: async () => [{ npi: A, practitionerOnly: true }, { npi: B, practitionerOnly: false }],
      env: () => undefined,
    });
    const st = await loader.state();
    // Practitioner results (search, provider-search, lookup_npi, pages) drop A ...
    expect(st.set).toEqual(new Set([A, B]));
    // ... organization results (search organizations, lookup_organization) keep it.
    expect(st.orgSet).toEqual(new Set([B]));
    expect(st.dbRows).toBe(1);
    expect(suppressionScope({ status: 'pending', notBefore: null, basis: 'unverified' })).toBe('practitioner');
    expect(suppressionScope({ status: 'pending', notBefore: null, basis: 'nppes' })).toBe('full');
    expect(suppressionScope({ status: 'declined', notBefore: null, basis: null })).toBe('none');
    // An unverified NPI listed as an organization stays in search and lookup_organization.
    const orgs = [{ npi: A, name: 'Some Org' }, { npi: C, name: 'Other' }];
    expect(filterSuppressed(orgs, st.orgSet)).toEqual(orgs);
    expect(filterSuppressed([{ npi: A }], st.set)).toEqual([]);
  });

  it('fails the build when committed removals cannot be seen', () => {
    expect(() => assertSuppressionVisible({ set: new Set(), orgSet: new Set(), dbRows: null }, 1)).toThrow(/Refusing to build/);
    expect(() => assertSuppressionVisible({ set: new Set([A]), orgSet: new Set([A]), dbRows: 0 }, 1)).toThrow(/zero rows/);
    expect(() => assertSuppressionVisible({ set: new Set([A]), orgSet: new Set([A]), dbRows: null }, 1)).not.toThrow();
    expect(() => assertSuppressionVisible({ set: new Set([A]), orgSet: new Set([A]), dbRows: 1 }, 1)).not.toThrow();
    expect(() => assertSuppressionVisible({ set: new Set(), orgSet: new Set(), dbRows: 0 }, 0)).not.toThrow();
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
  basis: string | null;
  hadPage: boolean | null;
  notBefore: Date | null;
  requestedAt: Date;
}

function matchWhere(r: Row, w: IntakeCountWhere): boolean {
  if (w.requestedAt) {
    if (r.requestedAt < w.requestedAt.gte) return false;
    if (w.requestedAt.lt && r.requestedAt >= w.requestedAt.lt) return false;
  }
  if (typeof w.status === 'string' && r.status !== w.status) return false;
  if (typeof w.status === 'object' && r.status === w.status.not) return false;
  if (w.notBefore === null && r.notBefore !== null) return false;
  if (w.notBefore && 'not' in w.notBefore && r.notBefore === null) return false;
  if (w.notBefore && 'gte' in w.notBefore) {
    if (!r.notBefore || r.notBefore < w.notBefore.gte || r.notBefore >= w.notBefore.lt) return false;
  }
  if (w.requesterEmail && r.requesterEmail !== w.requesterEmail) return false;
  if (typeof w.source === 'string' && r.source !== w.source) return false;
  if (typeof w.source === 'object' && r.source === w.source.not) return false;
  if (w.OR && !w.OR.some((c) => matchWhere(r, c))) return false;
  return true;
}

function intakeDb(existing: Row[] = [], now: () => Date = () => NOW) {
  const rows: Row[] = [...existing];
  const db: IntakeDb = {
    npiSuppression: {
      findUnique: async ({ where }) => {
        const r = rows.find((x) => x.npi === where.npi);
        return r ? { id: r.npi, status: r.status } : null;
      },
      create: async ({ data }) => {
        rows.push({ ...data, requestedAt: now() });
        return data;
      },
      count: async ({ where }) => rows.filter((r) => matchWhere(r, where)).length,
    },
  };
  return { db, rows };
}

const NOW = new Date('2026-10-24T12:00:00Z');

function deps(
  db: IntakeDb,
  type: EnumerationType = 'individual',
  over: Partial<IntakeDeps> = {},
) {
  const alert = vi.fn(async () => {});
  const sendDeclined = vi.fn(async () => {});
  const tokens = new Set<string>();
  const mailAllowed = vi.fn(async (to: string) => {
    if (tokens.has(to)) return false;
    tokens.add(to);
    return true;
  });
  return {
    alert,
    sendDeclined,
    mailAllowed,
    d: {
      db,
      alert,
      sendDeclined,
      mailAllowed,
      lookupType: async () => type,
      hasPage: async () => true,
      cap: 2,
      now: () => NOW,
      ...over,
    } as IntakeDeps,
  };
}

describe('recordSuppression', () => {
  it('accepts an NPPES individual at once, once, with one notice', async () => {
    const { db, rows } = intakeDb();
    const { d, alert } = deps(db);
    expect(await recordSuppression(A, 'Doc <Doc@Example.org>', 'form', d)).toMatchObject({
      created: true,
      status: 'pending',
      notBefore: null,
    });
    expect(rows[0]).toMatchObject({
      npi: A, requesterEmail: 'doc@example.org', source: 'form', status: 'pending', basis: 'nppes', hadPage: true,
    });
    expect(await recordSuppression(A, 'x@example.org', 'email', d)).toEqual({
      created: false,
      status: 'pending',
    });
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('accepts an NPI NPPES does not return (404, deactivated) when AINPI has its page', async () => {
    const { db, rows } = intakeDb();
    await recordSuppression(A, 'a@example.org', 'form', deps(db, 'unknown', { hasPage: async () => true }).d);
    expect(rows[0]).toMatchObject({ status: 'pending', basis: 'ainpi_files', notBefore: null });
  });

  it('still records an unclassified NPI that is in none of our files', async () => {
    const { db, rows } = intakeDb();
    await recordSuppression(A, 'a@example.org', 'form', deps(db, 'unknown', { hasPage: async () => false }).d);
    expect(rows[0]).toMatchObject({ status: 'pending', basis: 'unverified' });
  });

  it('declines an organization NPI with the automated reply and no admin alert', async () => {
    const { db, rows } = intakeDb();
    const { d, alert, sendDeclined } = deps(db, 'organization');
    expect(await recordSuppression(A, 'org@example.org', 'form', d)).toEqual({ created: true, status: 'declined' });
    expect(rows[0].status).toBe('declined');
    expect(sendDeclined).toHaveBeenCalledWith('org@example.org', A);
    expect(alert).not.toHaveBeenCalled();
    expect(DECLINED_REPLY.text).toContain('belongs to an organization');
    expect(DECLINED_REPLY.text).toContain('replies are not read');
  });

  it('queues past the cap to the first UTC day with room, alerts once, and it takes effect then', async () => {
    const { db, rows } = intakeDb();
    const { d, alert } = deps(db);
    // cap is 2 a day: 2 in force today, 2 queued to the 25th, the 5th to the 26th
    for (const npi of [A, B, C, D, E]) await recordSuppression(npi, null, 'form', d);
    expect(rows.map((r) => r.notBefore?.toISOString() ?? null)).toEqual([
      null,
      null,
      '2026-10-25T00:00:00.000Z',
      '2026-10-25T00:00:00.000Z',
      '2026-10-26T00:00:00.000Z',
    ]);
    // two accepted notices + one cap-reached notice
    expect(alert).toHaveBeenCalledTimes(3);
    const queued = rows[2];
    expect(isActiveSuppression(queued, NOW)).toBe(false);
    expect(isActiveSuppression(queued, new Date('2026-10-25T00:00:01Z'))).toBe(true);
    expect(isActiveSuppression({ status: 'declined', notBefore: null }, NOW)).toBe(false);
  });

  it('records but never mails an address past three requests in a day', async () => {
    const { db, rows } = intakeDb();
    const { d } = deps(db);
    for (const npi of [A, B, C, D]) await recordSuppression(npi, 'x@example.org', 'form', d);
    expect(rows.map((r) => r.requesterEmail)).toEqual([
      'x@example.org', 'x@example.org', 'x@example.org', null,
    ]);
    expect(rows[3].status).toBe('pending');
  });

  it('sends at most one automated email per address per day', async () => {
    const { db } = intakeDb();
    const { d, sendDeclined } = deps(db, 'organization');
    await recordSuppression(A, 'o@example.org', 'form', d);
    await recordSuppression(B, 'o@example.org', 'form', d);
    expect(sendDeclined).toHaveBeenCalledTimes(1);
  });

  it('charges the global ceiling for accepted requests only, never for declined ones', async () => {
    const admit = vi.fn(async () => true);
    const org = intakeDb();
    await recordSuppression(A, 'o@example.org', 'form', { ...deps(org.db, 'organization').d, admit });
    expect(admit).not.toHaveBeenCalled();
    const ind = intakeDb();
    await recordSuppression(A, 'p@example.org', 'form', { ...deps(ind.db).d, admit });
    expect(admit).toHaveBeenCalledTimes(1);
    const refused = intakeDb();
    await expect(
      recordSuppression(A, null, 'form', { ...deps(refused.db).d, admit: async () => false }),
    ).rejects.toBeInstanceOf(RemovalCeilingError);
    expect(refused.rows).toHaveLength(0);
  });

  it('lets the manual script record at once without the checks', async () => {
    const { db, rows } = intakeDb();
    await recordSuppression(A, null, 'manual', deps(db, 'organization').d, { force: true });
    expect(rows[0]).toMatchObject({ status: 'pending', basis: 'manual' });
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
    const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
    expect(await nppesEnumerationType(A, reply({ results: [{ enumeration_type: 'NPI-1' }] }))).toBe('individual');
    expect(await nppesEnumerationType(A, reply({ results: [{ enumeration_type: 'NPI-2' }] }))).toBe('organization');
    expect(await nppesEnumerationType(A, reply({ result_count: 0, results: [] }))).toBe('unknown');
    expect(await nppesEnumerationType(A, reply({}, 404))).toBe('unknown');
  });
});

describe('overdue backstop', () => {
  it('alerts once for requests older than 5 days and not confirmed', async () => {
    const rows = [
      { npi: A, status: 'applied', requestedAt: new Date('2026-10-18T00:00:00Z'), overdueAlertedAt: null as Date | null },
      { npi: B, status: 'pending', requestedAt: new Date('2026-10-23T00:00:00Z'), overdueAlertedAt: null as Date | null },
      { npi: C, status: 'confirmed', requestedAt: new Date('2026-10-01T00:00:00Z'), overdueAlertedAt: null as Date | null },
    ];
    const db: OverdueDb = {
      npiSuppression: {
        findMany: async ({ where }) =>
          rows
            .filter((r) => where.status.in.includes(r.status) && r.requestedAt < where.requestedAt.lt && r.overdueAlertedAt === null)
            .map(({ npi, status, requestedAt }) => ({ npi, status, requestedAt })),
        updateMany: async ({ where, data }) => {
          let n = 0;
          for (const r of rows) if (where.npi.in.includes(r.npi) && r.overdueAlertedAt === null) { r.overdueAlertedAt = data.overdueAlertedAt; n++; }
          return { count: n };
        },
      },
    };
    const alert = vi.fn(async () => {});
    expect(await runOverdueCheck({ db, alert, now: () => NOW })).toBe(1);
    expect(alert).toHaveBeenCalledWith([expect.objectContaining({ npi: A })]);
    expect(await runOverdueCheck({ db, alert, now: () => NOW })).toBe(0);
    expect(alert).toHaveBeenCalledTimes(1);
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

  it('defers a confirmation when the address already had its email today', async () => {
    const rows = [row(A, 'a@example.org')];
    const db = confirmDb(rows);
    const send = vi.fn(async () => ({ ok: true as const }));
    const s1 = await runConfirmations({ db, fetchFn: liveExcept([]), send, mailAllowed: async () => false });
    expect(s1.deferred).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: 'applied', confirmClaimedAt: null });
    await runConfirmations({ db, fetchFn: liveExcept([]), send, mailAllowed: async () => true });
    expect(send).toHaveBeenCalledTimes(1);
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

describe('daily NPPES re-check of unverified rows', () => {
  type RRow = { npi: string; requesterEmail: string | null; basis: string; status: string; reclassifyCheckedAt?: Date | null };
  function reDb(rows: RRow[]) {
    const db: ReclassifyDb = {
      npiSuppression: {
        findMany: async ({ where, take }) =>
          rows
            .filter((r) => r.basis === where.basis && r.status === where.status)
            .sort((a, b) => (a.reclassifyCheckedAt?.getTime() ?? -1) - (b.reclassifyCheckedAt?.getTime() ?? -1))
            .slice(0, take)
            .map(({ npi, requesterEmail }) => ({ npi, requesterEmail })),
        updateMany: async ({ where, data }) => {
          const r = rows.find(
            (x) =>
              x.npi === where.npi &&
              (where.basis === undefined || x.basis === where.basis) &&
              (where.status === undefined || x.status === where.status),
          );
          if (!r) return { count: 0 };
          Object.assign(r, data);
          return { count: 1 };
        },
      },
    };
    return db;
  }

  it('reaches every unverified row over successive runs, more rows than the per-run limit', async () => {
    const npis = [A, B, C, D, E, '5555555551', '9999999995'];
    const rows: RRow[] = npis.map((npi) => ({ npi, requesterEmail: null, basis: 'unverified', status: 'pending', reclassifyCheckedAt: null }));
    const seen = new Set<string>();
    let t = 1_800_000_000_000;
    for (let run = 0; run < 3; run++) {
      await runReclassify({
        db: reDb(rows),
        lookupType: async (npi) => {
          seen.add(npi);
          return 'unknown';
        },
        sendDeclined: async () => {},
        mailAllowed: async () => true,
        limit: 3,
        now: () => new Date(t++),
      });
    }
    expect(seen).toEqual(new Set(npis));
  });

  it('stops at its deadline when NPPES hangs', async () => {
    const rows: RRow[] = [A, B].map((npi) => ({ npi, requesterEmail: null, basis: 'unverified', status: 'pending' }));
    const started = Date.now();
    const r = await runReclassify({
      db: reDb(rows),
      lookupType: () => new Promise(() => {}),
      sendDeclined: async () => {},
      mailAllowed: async () => true,
      deadlineMs: 50,
    });
    expect(r.stoppedAtDeadline).toBe(true);
    expect(r.checked).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('declines an NPI-2 and sends the reply once', async () => {
    const rows = [{ npi: A, requesterEmail: 'o@example.org', basis: 'unverified', status: 'pending' }];
    const sendDeclined = vi.fn(async () => {});
    const run = () =>
      runReclassify({
        db: reDb(rows),
        lookupType: async () => 'organization',
        sendDeclined,
        mailAllowed: async () => true,
      });
    expect((await run()).declined).toBe(1);
    expect(rows[0].status).toBe('declined');
    await run();
    expect(sendDeclined).toHaveBeenCalledTimes(1);
  });

  it('moves an NPI-1 to full scope, which the loader then applies to organization data', async () => {
    const rows = [{ npi: A, requesterEmail: null, basis: 'unverified', status: 'pending' }];
    const r = await runReclassify({
      db: reDb(rows),
      lookupType: async () => 'individual',
      sendDeclined: async () => {},
      mailAllowed: async () => true,
    });
    expect(r.confirmedIndividual).toBe(1);
    expect(rows[0].basis).toBe('nppes');
    const loader = createSuppressionLoader({
      source: async () => rows.map((x) => ({ npi: x.npi, practitionerOnly: x.basis === 'unverified' })),
      env: () => undefined,
    });
    expect((await loader.state()).orgSet.has(A)).toBe(true);
  });

  it('leaves a still-unknown NPI unverified for tomorrow', async () => {
    const rows = [{ npi: A, requesterEmail: null, basis: 'unverified', status: 'pending' }];
    const r = await runReclassify({
      db: reDb(rows),
      lookupType: async () => 'unknown',
      sendDeclined: async () => {},
      mailAllowed: async () => true,
    });
    expect(r.stillUnknown).toBe(1);
    expect(rows[0]).toMatchObject({ basis: 'unverified', status: 'pending' });
  });
});

describe('confirm cron ordering', () => {
  it('sends confirmations even when the NPPES re-check hangs, and returns within its deadline', async () => {
    const order: string[] = [];
    const confirmRows = [{
      npi: A, requesterEmail: 'a@example.org', status: 'applied',
      confirmCheckedAt: null as Date | null, confirmClaimedAt: null as Date | null, confirmedAt: null as Date | null,
    }];
    const send = vi.fn(async () => ({ ok: true as const }));
    const db: ConfirmDb = {
      npiSuppression: {
        findMany: async () => confirmRows.filter((r) => r.status === 'applied').map((r) => ({ npi: r.npi, requesterEmail: r.requesterEmail })),
        updateMany: async ({ where, data }) => {
          const r = confirmRows.find((x) => x.npi === where.npi);
          if (!r) return { count: 0 };
          if (where.status && r.status !== where.status) return { count: 0 };
          if ('confirmClaimedAt' in where && where.confirmClaimedAt?.getTime() !== r.confirmClaimedAt?.getTime()) return { count: 0 };
          Object.assign(r, data);
          return { count: 1 };
        },
      },
    };
    const unverified = [{ npi: B, requesterEmail: null }];
    const reDb: ReclassifyDb = {
      npiSuppression: {
        findMany: async () => unverified,
        updateMany: async () => ({ count: 1 }),
      },
    };
    const started = Date.now();
    const result = await runConfirmCron({
      overdue: async () => {
        order.push('overdue');
        return 0;
      },
      confirm: async () => {
        order.push('confirm');
        return runConfirmations({
          db,
          send,
          fetchFn: async (url) => (url.includes('/npi/') ? res(404) : res(200, 'npi,name\n')),
        });
      },
      reclassify: async () => {
        order.push('reclassify');
        return runReclassify({
          db: reDb,
          lookupType: () => new Promise(() => {}), // NPPES hangs
          sendDeclined: async () => {},
          mailAllowed: async () => true,
          deadlineMs: 100,
        });
      },
    });
    expect(order).toEqual(['overdue', 'confirm', 'reclassify']);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.confirmations?.sent).toBe(1);
    expect(result.reclassified?.stoppedAtDeadline).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
    // The production deadline leaves room inside the route's maxDuration (60 s).
    expect(RECLASSIFY_DEADLINE_MS).toBeLessThan(60_000 / 2);
    expect(RECLASSIFY_LIMIT).toBe(10);
  });
});
