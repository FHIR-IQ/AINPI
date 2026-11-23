import { describe, expect, it } from 'vitest';

import {
  checkReportRate,
  getReport,
  resolveReporter,
  submitReport,
  type Reporter,
} from '@/lib/interaction-report-store';
import { TIERS, type Caller } from '@/lib/rate-limit';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const BODY = {
  schemaVersion: '1.0',
  reportId: '984fc279-674a-4f06-8a59-98135df762ca',
  reporterRole: 'requester',
  interaction: { startedAt: '2026-10-29T14:00:00Z', endedAt: '2026-10-29T14:00:02Z' },
  outcome: 'success',
  issues: [],
};

type Row = { reportId: string; reporterParticipantId: string; bodyHash: string; receipt: unknown; receivedAt: Date };

function fakeDb(opts: { labels?: Record<string, string>; failCreate?: unknown } = {}) {
  const rows: Row[] = [];
  const key = (w: { reporterParticipantId_reportId: { reporterParticipantId: string; reportId: string } }) =>
    w.reporterParticipantId_reportId;
  const db = {
    rows,
    apiKey: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        opts.labels && where.id in opts.labels ? { label: opts.labels[where.id] } : null,
    },
    interactionReport: {
      deleteMany: async ({ where }: { where: { receivedAt: { lt: Date } } }) => {
        const keep = rows.filter((r) => r.receivedAt >= where.receivedAt.lt);
        rows.splice(0, rows.length, ...keep);
        return { count: 0 };
      },
      findUnique: async ({ where }: never) => {
        const k = key(where);
        return rows.find((r) => r.reporterParticipantId === k.reporterParticipantId && r.reportId === k.reportId) ?? null;
      },
      create: async ({ data }: { data: Row }) => {
        if (opts.failCreate) throw opts.failCreate;
        rows.push(data);
        return data;
      },
    },
  };
  return db as unknown as Parameters<typeof submitReport>[3] & { rows: Row[] };
}

const A: Reporter = { participantId: 'pA', keyId: 'kA' };
const B: Reporter = { participantId: 'pB', keyId: 'kB' };
const caller = (over: Partial<Caller>): Caller => ({
  subject: 'ip:1.2.3.4',
  tier: TIERS.anonymous,
  keyId: null,
  dailyUnitCap: 2000,
  ...over,
});

describe('resolveReporter', () => {
  const db = fakeDb({ labels: { k1: 'npd-mcp:p1', k2: 'Fasten Health' } });
  it('401 without a key', async () => {
    expect(await resolveReporter(caller({}), false, db)).toMatchObject({ status: 401 });
  });
  it('401 for an invalid key', async () => {
    expect(await resolveReporter(caller({ subject: 'badkey:abc' }), true, db)).toMatchObject({ status: 401 });
  });
  it('503 when a key was sent but could not be checked', async () => {
    expect(await resolveReporter(caller({}), true, db)).toMatchObject({ status: 503 });
  });
  it('403 for a valid key not issued to the working group', async () => {
    expect(await resolveReporter(caller({ keyId: 'k2', subject: 'key:k2' }), true, db)).toMatchObject({ status: 403 });
  });
  it('resolves a working-group key to its participant', async () => {
    expect(await resolveReporter(caller({ keyId: 'k1', subject: 'key:k1' }), true, db)).toEqual({
      participantId: 'p1',
      keyId: 'k1',
    });
  });
});

describe('submitReport', () => {
  it('201 then 200 with the original receipt on an identical retry, 409 on changed content', async () => {
    const db = fakeDb();
    const first = await submitReport(A, BODY, NOW, db);
    expect(first.status).toBe(201);
    expect(first.location).toBe(`https://ainpi.dev/api/v1/interaction-reports/${BODY.reportId}`);
    const retry = await submitReport(A, JSON.parse(JSON.stringify({ ...BODY, reportId: BODY.reportId.toUpperCase() })), NOW + 60_000, db);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    const changed = await submitReport(A, { ...BODY, outcome: 'failure' }, NOW, db);
    expect(changed.status).toBe(409);
    expect(db.rows).toHaveLength(1);
  });
  it('dedupes per reporter: the same reportId from another organization is a new report', async () => {
    const db = fakeDb();
    expect((await submitReport(A, BODY, NOW, db)).status).toBe(201);
    expect((await submitReport(B, BODY, NOW, db)).status).toBe(201);
  });
  it('400 with problem details for an invalid body', async () => {
    const r = await submitReport(A, { ...BODY, outcome: 'great' }, NOW, fakeDb());
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ type: 'about:blank', title: 'Bad Request', status: 400 });
  });
  it('503 when the table is missing', async () => {
    const r = await submitReport(A, BODY, NOW, fakeDb({ failCreate: Object.assign(new Error('x'), { code: 'P2021' }) }));
    expect(r.status).toBe(503);
  });
  it('treats a retry after the 90-day window as new', async () => {
    const db = fakeDb();
    await submitReport(A, BODY, NOW, db);
    const later = NOW + 91 * 86_400_000;
    const body = { ...BODY, interaction: { startedAt: new Date(later - 1000).toISOString(), endedAt: new Date(later).toISOString() } };
    expect((await submitReport(A, body, later, db)).status).toBe(201);
  });
});

describe('getReport', () => {
  it('returns only the reporter’s own report; others get 404', async () => {
    const db = fakeDb();
    const sent = await submitReport(A, BODY, NOW, db);
    expect(await getReport(A, BODY.reportId, NOW, db)).toEqual({ status: 200, body: sent.body });
    expect((await getReport(B, BODY.reportId, NOW, db)).status).toBe(404);
    expect((await getReport(A, 'nope', NOW, db)).status).toBe(404);
  });
});

describe('checkReportRate', () => {
  it('429 with Retry-After past the per-minute limit; allows when the counter is down', async () => {
    const over = await checkReportRate(A, NOW, async () => 31);
    expect(over).toMatchObject({ status: 429, retryAfter: 60 });
    expect(await checkReportRate(A, NOW, async () => null)).toBeNull();
  });
});
