import { describe, expect, it, vi } from 'vitest';
import {
  buildInstallQuery,
  eventToNotice,
  parseStatementRows,
  pollMarketplaceInstalls,
  readPollConfig,
  runStatement,
  selectInstallsToWelcome,
  toInstallEvents,
  type InstallEvent,
  type PollDeps,
} from '@/lib/marketplace-install-poll';

const COLUMNS = [
  'consumer_email',
  'consumer_name',
  'consumer_company',
  'consumer_cloud',
  'consumer_region',
  'consumer_delta_sharing_recipient_type',
  'listing_name',
  'event_type',
  'event_time',
];
const manifest = {
  schema: { columns: COLUMNS.map((name, position) => ({ name, position })) },
};

function row(over: Partial<Record<string, string | null>> = {}): (string | null)[] {
  const base: Record<string, string | null> = {
    consumer_email: 'ada@example.com',
    consumer_name: 'Ada Example',
    consumer_company: null,
    consumer_cloud: 'AWS',
    consumer_region: 'us-east-1',
    consumer_delta_sharing_recipient_type: 'DATABRICKS',
    listing_name: 'Test Listing',
    event_type: 'GET_DATA',
    event_time: '2026-09-20T10:00:00.000Z',
    ...over,
  };
  return COLUMNS.map((c) => base[c]);
}

function ev(over: Partial<InstallEvent> = {}): InstallEvent {
  return {
    email: 'ada@example.com',
    name: 'Ada Example',
    company: null,
    cloud: 'AWS',
    region: 'us-east-1',
    recipientType: 'DATABRICKS',
    listingName: 'Test Listing',
    eventTime: '2026-09-20T10:00:00.000Z',
    ...over,
  };
}

describe('readPollConfig', () => {
  it('returns null when any Databricks env var is missing', () => {
    expect(readPollConfig({})).toBeNull();
    expect(
      readPollConfig({ DATABRICKS_HOST: 'h', DATABRICKS_TOKEN: 't' }),
    ).toBeNull();
  });

  it('normalizes the host with or without scheme and trailing slash', () => {
    const env = { DATABRICKS_TOKEN: 't', DATABRICKS_WAREHOUSE_ID: 'w' };
    expect(readPollConfig({ ...env, DATABRICKS_HOST: 'dbc-1.cloud.databricks.com' })?.host)
      .toBe('https://dbc-1.cloud.databricks.com');
    expect(readPollConfig({ ...env, DATABRICKS_HOST: 'https://dbc-1.cloud.databricks.com/' })?.host)
      .toBe('https://dbc-1.cloud.databricks.com');
  });

  it('defaults lookback to 30 days and rejects nonsense values', () => {
    const env = { DATABRICKS_HOST: 'h', DATABRICKS_TOKEN: 't', DATABRICKS_WAREHOUSE_ID: 'w' };
    expect(readPollConfig(env)?.lookbackDays).toBe(30);
    expect(readPollConfig({ ...env, DATABRICKS_POLL_LOOKBACK_DAYS: '7' })?.lookbackDays).toBe(7);
    expect(readPollConfig({ ...env, DATABRICKS_POLL_LOOKBACK_DAYS: '7; DROP' })?.lookbackDays).toBe(30);
    expect(readPollConfig({ ...env, DATABRICKS_POLL_LOOKBACK_DAYS: '9999' })?.lookbackDays).toBe(30);
  });
});

describe('buildInstallQuery', () => {
  it('reads only GET_DATA events inside a bounded, parameterized window', () => {
    const q = buildInstallQuery(30);
    expect(q.statement).toContain('system.marketplace.listing_access_events');
    expect(q.statement).toMatch(/event_type\s*=\s*'GET_DATA'/);
    expect(q.statement).toMatch(/LIMIT\s+\d+/);
    expect(q.statement).toContain(':lookback_days');
    expect(q.parameters).toEqual([{ name: 'lookback_days', value: '30', type: 'INT' }]);
  });

  it('aggregates to one row per address so repeat events cannot crowd out new installers', () => {
    const q = buildInstallQuery(30).statement;
    expect(q).toMatch(/GROUP BY\s+lower\(trim\(consumer_email\)\)/i);
    expect(q).toMatch(/MIN\(event_time\)\s+AS\s+first_seen/i);
    expect(q).toMatch(/ORDER BY\s+first_seen/i);
    expect(q).toMatch(/min_by\(consumer_name,\s*event_time\)/i);
  });
});

describe('parseStatementRows', () => {
  it('maps values by column name, not by position', () => {
    const shuffled = {
      schema: {
        columns: [
          { name: 'event_type', position: 1 },
          { name: 'consumer_email', position: 0 },
        ],
      },
    };
    expect(parseStatementRows(shuffled, [['x@example.com', 'GET_DATA']])).toEqual([
      { consumer_email: 'x@example.com', event_type: 'GET_DATA' },
    ]);
  });

  it('returns [] for an empty result', () => {
    expect(parseStatementRows(manifest, undefined)).toEqual([]);
  });
});

describe('toInstallEvents', () => {
  it('lowercases email and drops REQUEST_DATA and invalid emails', () => {
    const recs = parseStatementRows(manifest, [
      row({ consumer_email: 'Ada@Example.COM ' }),
      row({ consumer_email: 'req@example.com', event_type: 'REQUEST_DATA' }),
      row({ consumer_email: null }),
      row({ consumer_email: 'not-an-email' }),
    ]);
    const out = toInstallEvents(recs);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe('ada@example.com');
    expect(out[0].name).toBe('Ada Example');
  });

  it('reads first_seen from the aggregated query as the event time', () => {
    const agg = {
      schema: {
        columns: [
          { name: 'consumer_email', position: 0 },
          { name: 'event_type', position: 1 },
          { name: 'first_seen', position: 2 },
        ],
      },
    };
    const out = toInstallEvents(
      parseStatementRows(agg, [['ada@example.com', 'GET_DATA', '2026-09-18T00:00:00.000Z']]),
    );
    expect(out[0].eventTime).toBe('2026-09-18T00:00:00.000Z');
  });
});

describe('selectInstallsToWelcome', () => {
  it('skips already-welcomed addresses', () => {
    const r = selectInstallsToWelcome(
      [ev(), ev({ email: 'bob@example.com' })],
      new Set(['ada@example.com']),
      20,
    );
    expect(r.toWelcome.map((e) => e.email)).toEqual(['bob@example.com']);
    expect(r.alreadyWelcomed).toBe(1);
  });

  it('dedupes by email, keeping the earliest event', () => {
    const r = selectInstallsToWelcome(
      [
        ev({ eventTime: '2026-09-21T00:00:00.000Z', region: 'late' }),
        ev({ eventTime: '2026-09-19T00:00:00.000Z', region: 'early' }),
      ],
      new Set(),
      20,
    );
    expect(r.toWelcome).toHaveLength(1);
    expect(r.toWelcome[0].region).toBe('early');
  });

  it('caps sends per run and reports the overflow', () => {
    const evs = Array.from({ length: 25 }, (_, i) => ev({ email: `u${i}@example.com` }));
    const r = selectInstallsToWelcome(evs, new Set(), 20);
    expect(r.toWelcome).toHaveLength(20);
    expect(r.overCap).toBe(5);
  });
});

describe('eventToNotice', () => {
  it('uses the recorded name and company', () => {
    const n = eventToNotice(ev({ company: 'Example Co' }));
    expect(n.installedBy).toBe('Ada Example');
    expect(n.company).toBe('Example Co');
    expect(n.sharingIdentifier).toBe('AWS:us-east-1');
    expect(n.installedOn).toBe('2026-09-20T10:00:00.000Z');
    expect(n.listing).toBe('Test Listing');
  });

  it('falls back to the email domain for company and the email for name, never a guessed name', () => {
    const n = eventToNotice(ev({ name: null, company: null }));
    expect(n.company).toBe('example.com');
    expect(n.installedBy).toBe('ada@example.com');
  });

  it('reports OPEN recipients without cloud as open', () => {
    const n = eventToNotice(ev({ cloud: null, region: null, recipientType: 'OPEN' }));
    expect(n.sharingIdentifier).toBe('open');
  });
});

// --- Statement API ---------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const cfg = {
  host: 'https://dbc.example.com',
  token: 'tok',
  warehouseId: 'wh',
  lookbackDays: 30,
};

describe('runStatement', () => {
  it('returns rows when the statement succeeds on the first call', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        statement_id: 's1',
        status: { state: 'SUCCEEDED' },
        manifest,
        result: { data_array: [row()] },
      }),
    );
    const r = await runStatement(cfg, buildInstallQuery(30), { fetchImpl, sleep: async () => {} });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0].consumer_email).toBe('ada@example.com');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://dbc.example.com/api/2.0/sql/statements');
    expect(init.headers.Authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body);
    expect(body.warehouse_id).toBe('wh');
    expect(body.on_wait_timeout).toBe('CONTINUE');
  });

  it('polls a PENDING statement until it succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ statement_id: 's1', status: { state: 'PENDING' } }))
      .mockResolvedValueOnce(jsonResponse({ statement_id: 's1', status: { state: 'RUNNING' } }))
      .mockResolvedValueOnce(
        jsonResponse({
          statement_id: 's1',
          status: { state: 'SUCCEEDED' },
          manifest,
          result: { data_array: [row()] },
        }),
      );
    const r = await runStatement(cfg, buildInstallQuery(30), { fetchImpl, sleep: async () => {} });
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[1][0]).toBe('https://dbc.example.com/api/2.0/sql/statements/s1');
  });

  it('follows next_chunk_internal_link', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          statement_id: 's1',
          status: { state: 'SUCCEEDED' },
          manifest,
          result: {
            data_array: [row()],
            next_chunk_internal_link: '/api/2.0/sql/statements/s1/result/chunks/1',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data_array: [row({ consumer_email: 'bob@example.com' })] }));
    const r = await runStatement(cfg, buildInstallQuery(30), { fetchImpl, sleep: async () => {} });
    expect(r.ok && r.rows.map((x) => x.consumer_email)).toEqual(['ada@example.com', 'bob@example.com']);
  });

  it('surfaces FAILED with the error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({ statement_id: 's1', status: { state: 'FAILED', error: { message: 'no such table' } } }),
    );
    const r = await runStatement(cfg, buildInstallQuery(30), { fetchImpl, sleep: async () => {} });
    expect(r).toEqual({ ok: false, error: expect.stringContaining('no such table') });
  });

  it('fails on HTTP errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'bad token' }, 403));
    const r = await runStatement(cfg, buildInstallQuery(30), { fetchImpl, sleep: async () => {} });
    expect(r.ok).toBe(false);
  });

  it('gives up and cancels after the deadline', async () => {
    let t = 0;
    const fetchImpl = vi.fn().mockImplementation(async () =>
      jsonResponse({ statement_id: 's1', status: { state: 'PENDING' } }),
    );
    const r = await runStatement(cfg, buildInstallQuery(30), {
      fetchImpl,
      sleep: async (ms) => {
        t += ms;
      },
      now: () => t,
      deadlineMs: 10_000,
      pollIntervalMs: 3_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/timed out/i);
    const last = fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1];
    expect(last[0]).toBe('https://dbc.example.com/api/2.0/sql/statements/s1/cancel');
  });
});

// --- Orchestration ---------------------------------------------------------

const CLAIMED_AT = new Date('2026-09-23T14:17:00.000Z');

function makeDeps(over: Partial<PollDeps> = {}) {
  const existing = new Map<string, { welcomedAt: Date | null; company: string | null }>();
  const deps = {
    fetchRows: vi.fn().mockResolvedValue({
      ok: true,
      rows: parseStatementRows(manifest, [
        row(),
        row({ consumer_email: 'bob@example.com', consumer_name: 'Bob Example' }),
      ]),
    }),
    findExisting: vi.fn(async (emails: string[]) =>
      emails.filter((e) => existing.has(e)).map((e) => ({ email: e, ...existing.get(e)! })),
    ),
    upsertInstall: vi.fn(async () => {}),
    claim: vi.fn(async (_email: string): Promise<Date | null> => CLAIMED_AT),
    release: vi.fn(async (_email: string, _at: Date) => {}),
    sendWelcome: vi.fn(async () => ({ ok: true as const })),
    alertInstall: vi.fn(async () => {}),
    alertFailure: vi.fn(async () => {}),
    cap: 20,
    ...over,
  };
  return { deps, existing };
}

describe('pollMarketplaceInstalls', () => {
  it('welcomes each new installer once and records it', async () => {
    const { deps } = makeDeps();
    const r = await pollMarketplaceInstalls(deps);
    expect(r).toMatchObject({ ok: true, welcomed: ['ada@example.com', 'bob@example.com'] });
    expect(deps.sendWelcome).toHaveBeenCalledTimes(2);
    expect(deps.claim).toHaveBeenCalledWith('ada@example.com');
    expect(deps.release).not.toHaveBeenCalled();
    expect(deps.alertInstall).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.com', welcomed: true }),
    );
  });

  it('sends nothing to addresses already welcomed', async () => {
    const { deps, existing } = makeDeps();
    existing.set('ada@example.com', { welcomedAt: new Date(), company: null });
    existing.set('bob@example.com', { welcomedAt: new Date(), company: null });
    const r = await pollMarketplaceInstalls(deps);
    expect(r).toMatchObject({ ok: true, welcomed: [], alreadyWelcomed: 2 });
    expect(deps.sendWelcome).not.toHaveBeenCalled();
    expect(deps.upsertInstall).not.toHaveBeenCalled();
  });

  it('keeps a stored company rather than overwriting it with the email domain', async () => {
    const { deps, existing } = makeDeps();
    existing.set('ada@example.com', { welcomedAt: null, company: 'Stored Co' });
    await pollMarketplaceInstalls(deps);
    const upserts = (deps.upsertInstall as ReturnType<typeof vi.fn>).mock.calls;
    const call = upserts.find((c: any[]) => c[0].email === 'ada@example.com');
    expect(call![0].company).toBe('Stored Co');
    const bob = upserts.find((c: any[]) => c[0].email === 'bob@example.com');
    expect(bob![0].company).toBe('example.com');
  });

  it('alerts admin and sends nothing when Databricks fails', async () => {
    const { deps } = makeDeps({
      fetchRows: vi.fn().mockResolvedValue({ ok: false, error: 'warehouse down' }),
    });
    const r = await pollMarketplaceInstalls(deps);
    expect(r.ok).toBe(false);
    expect(deps.alertFailure).toHaveBeenCalledWith(expect.stringContaining('warehouse down'));
    expect(deps.sendWelcome).not.toHaveBeenCalled();
  });

  it('upserts the row before claiming it, and claims before sending', async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      upsertInstall: vi.fn(async (n) => void order.push(`upsert:${n.email}`)),
      claim: vi.fn(async (e: string) => (order.push(`claim:${e}`), CLAIMED_AT)),
      sendWelcome: vi.fn(async (n) => (order.push(`send:${n.email}`), { ok: true as const })),
    });
    await pollMarketplaceInstalls(deps);
    expect(order.slice(0, 3)).toEqual([
      'upsert:ada@example.com',
      'claim:ada@example.com',
      'send:ada@example.com',
    ]);
  });

  it('sends nothing when another run claimed the address first', async () => {
    const { deps } = makeDeps({
      claim: vi.fn(async (e: string) => (e === 'ada@example.com' ? null : CLAIMED_AT)),
    });
    const r = await pollMarketplaceInstalls(deps);
    expect(r).toMatchObject({ ok: true, welcomed: ['bob@example.com'], alreadyWelcomed: 1 });
    expect(deps.sendWelcome).toHaveBeenCalledTimes(1);
    expect(deps.alertInstall).not.toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.com' }),
    );
  });

  it('releases the claim it set when the send fails, and continues with the rest', async () => {
    const { deps } = makeDeps({
      sendWelcome: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, error: 'resend 500' })
        .mockResolvedValueOnce({ ok: true }),
    });
    const r = await pollMarketplaceInstalls(deps);
    expect(r).toMatchObject({ ok: true, welcomed: ['bob@example.com'], failed: ['ada@example.com'] });
    expect(deps.release).toHaveBeenCalledTimes(1);
    expect(deps.release).toHaveBeenCalledWith('ada@example.com', CLAIMED_AT);
    expect(deps.alertFailure).toHaveBeenCalledWith(expect.stringContaining('resend 500'));
  });

  it('alerts admin when the per-run cap is hit', async () => {
    const { deps } = makeDeps({ cap: 1 });
    const r = await pollMarketplaceInstalls(deps);
    expect(r).toMatchObject({ ok: true, overCap: 1 });
    expect(deps.sendWelcome).toHaveBeenCalledTimes(1);
    expect(deps.alertFailure).toHaveBeenCalledWith(expect.stringMatching(/cap/i));
  });
});
