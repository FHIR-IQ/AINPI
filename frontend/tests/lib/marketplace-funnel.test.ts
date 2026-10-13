import { describe, expect, it, vi } from 'vitest';
import {
  buildFunnelQuery,
  loadMarketplaceFunnel,
  renderFunnelHtml,
  renderFunnelText,
  shortReason,
  toAllTime,
  toFunnelListings,
} from '@/lib/marketplace-funnel';

const ENV = {
  DATABRICKS_HOST: 'dbc.example.com',
  DATABRICKS_TOKEN: 'tok',
  DATABRICKS_WAREHOUSE_ID: 'wh',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function manifestOf(columns: string[]) {
  return { schema: { columns: columns.map((name, position) => ({ name, position })) } };
}

const FUNNEL_COLS = [
  'listing_name',
  'period',
  'views',
  'requests',
  'installs',
  'started',
  'completed',
  'abandoned',
  'failed',
];

/** The positive-control row every successful statement returns first. */
function allTimeRow(views: number, installs: number): (string | null)[] {
  return [null, 'all_time', String(views), '0', String(installs), '0', '0', '0', '0'];
}

function succeeded(data: (string | null)[][] | undefined) {
  return jsonResponse({
    statement_id: 's1',
    status: { state: 'SUCCEEDED' },
    manifest: manifestOf(FUNNEL_COLS),
    result: data ? { data_array: data } : {},
  });
}

const noSleep = { sleep: async () => {} };

describe('buildFunnelQuery', () => {
  it('reads views from the funnel table and requests/installs from access events, 14 days back', () => {
    const q = buildFunnelQuery().statement;
    expect(q).toContain('system.marketplace.listing_funnel_events');
    expect(q).toContain('system.marketplace.listing_access_events');
    expect(q).toMatch(/event_type\s*=\s*'VIEW_LISTING'/);
    expect(q).toMatch(/event_type\s+IN\s+\('REQUEST_DATA',\s*'GET_DATA'\)/);
    for (const t of ['VIEW_LISTING', 'START_GET_DATA', 'COMPLETE_GET_DATA', 'ABANDON_GET_DATA', 'FAIL_GET_DATA']) {
      expect(q).toContain(`'${t}'`);
    }
    expect(q).toMatch(/date_sub\(current_date\(\),\s*14\)/);
    expect(q).toMatch(/date_sub\(current_date\(\),\s*7\)/);
    expect(q).toMatch(/GROUP BY 1, 2/);
    expect(q).toMatch(/LIMIT\s+\d+/);
  });

  it('carries an all-time positive control row that the LIMIT cannot drop', () => {
    const q = buildFunnelQuery().statement;
    const control = q.slice(q.indexOf('all_time AS ('), q.indexOf('SELECT listing_name, period'));
    expect(control).toContain("'all_time'");
    // No date filter and no GROUP BY: one row, all of history, even over empty tables.
    expect(control).not.toMatch(/event_date/);
    expect(control).not.toMatch(/GROUP BY/);
    expect(q).toMatch(/ORDER BY CASE WHEN period = 'all_time' THEN 0 ELSE 1 END/);
  });

  it('never selects a consumer column', () => {
    const q = buildFunnelQuery().statement;
    expect(q).not.toMatch(/consumer_/i);
  });
});

describe('toFunnelListings', () => {
  it('pivots (listing, period) rows into one entry per listing', () => {
    const out = toFunnelListings([
      { listing_name: 'B', period: 'current', views: '10', requests: '1', installs: '2' },
      { listing_name: 'B', period: 'prior', views: '4', requests: '0', installs: '1' },
      { listing_name: 'A', period: 'prior', views: '3', requests: null, installs: '0' },
      { listing_name: null, period: 'all_time', views: '23', requests: '0', installs: '6' },
    ]);
    expect(out.map((l) => l.listingName)).toEqual(['A', 'B']);
    expect(out[1].current).toMatchObject({ views: 10, requests: 1, installs: 2 });
    expect(out[1].prior).toMatchObject({ views: 4, requests: 0, installs: 1 });
    expect(out[0].current).toMatchObject({ views: 0, requests: 0, installs: 0 });
  });

  it('skips the all_time control row, which toAllTime reads instead', () => {
    const rows = [
      { listing_name: null, period: 'all_time', views: '23', requests: '0', installs: '6' },
    ];
    expect(toFunnelListings(rows)).toEqual([]);
    expect(toAllTime(rows)).toEqual({ views: 23, installs: 6 });
    expect(toAllTime([])).toEqual({ views: 0, installs: 0 });
  });
});

describe('shortReason', () => {
  it('truncates long Databricks errors', () => {
    const r = shortReason('x'.repeat(400));
    expect(r.length).toBeLessThanOrEqual(120);
  });
});

describe('loadMarketplaceFunnel', () => {
  it('returns not_configured and makes no request when DATABRICKS_* is unset', async () => {
    const fetchImpl = vi.fn();
    const s = await loadMarketplaceFunnel({}, { fetchImpl, ...noSleep });
    expect(s).toEqual({ status: 'not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(renderFunnelHtml(s)).toContain('not configured');
    expect(renderFunnelText(s)).toContain('not configured');
  });

  it('runs one statement and renders per-listing counts when configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      succeeded([
        allTimeRow(23, 6),
        ['NPD Archive', 'current', '12', '0', '3', '4', '3', '1', '0'],
        ['NPD Archive', 'prior', '5', '1', '1', '2', '1', '0', '1'],
      ]),
    );
    const s = await loadMarketplaceFunnel(ENV, { fetchImpl, ...noSleep });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://dbc.example.com/api/2.0/sql/statements');
    const body = JSON.parse(init.body);
    expect(body.warehouse_id).toBe('wh');
    expect(body.statement).toContain('listing_funnel_events');

    expect(s.status).toBe('ok');
    if (s.status !== 'ok') return;
    expect(s.listings).toEqual([
      {
        listingName: 'NPD Archive',
        current: { views: 12, requests: 0, installs: 3, started: 4, completed: 3, abandoned: 1, failed: 0 },
        prior: { views: 5, requests: 1, installs: 1, started: 2, completed: 1, abandoned: 0, failed: 1 },
      },
    ]);
    expect(s.allTime).toEqual({ views: 23, installs: 6 });
    const html = renderFunnelHtml(s);
    expect(html).toContain('NPD Archive');
    expect(html).toContain('Marketplace funnel');
    expect(renderFunnelText(s)).toContain('installs 3 (prior 1)');
  });

  it('renders the get-data funnel (started / completed / abandoned / failed) for the window', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      succeeded([
        allTimeRow(23, 6),
        ['NPD Archive', 'current', '12', '0', '3', '4', '3', '1', '0'],
        ['NPD Archive', 'prior', '5', '1', '1', '2', '1', '0', '1'],
      ]),
    );
    const s = await loadMarketplaceFunnel(ENV, { fetchImpl, ...noSleep });
    const text = renderFunnelText(s);
    expect(text).toContain(
      'get-data funnel: started 4 (prior 2)  completed 3 (prior 1)  abandoned 1 (prior 0)  failed 0 (prior 1)',
    );
    const html = renderFunnelHtml(s);
    for (const h of ['Started', 'Completed', 'Abandoned', 'Failed']) expect(html).toContain(`>${h}</th>`);
    expect(html).toContain('All time: 23 views, 6 installs');
  });

  it('positive control: an empty window with history reads as a quiet fortnight, not a broken read', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(succeeded([allTimeRow(23, 6)]));
    const s = await loadMarketplaceFunnel(ENV, { fetchImpl, ...noSleep });
    expect(s).toEqual({ status: 'ok', listings: [], allTime: { views: 23, installs: 6 } });
    for (const out of [renderFunnelHtml(s), renderFunnelText(s)]) {
      expect(out).toContain('no events in the last 14 days (23 views all time');
      expect(out).not.toContain('no events visible');
      expect(out).not.toContain('unavailable');
    }
  });

  it('positive control: an empty window with no history says the token may not see the tables', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(succeeded([allTimeRow(0, 0)]));
    const s = await loadMarketplaceFunnel(ENV, { fetchImpl, ...noSleep });
    expect(s).toEqual({ status: 'ok', listings: [], allTime: { views: 0, installs: 0 } });
    for (const out of [renderFunnelHtml(s), renderFunnelText(s)]) {
      expect(out).toContain('no events visible: check the token can read system.marketplace tables');
      expect(out).not.toContain('no events in the last 14 days');
    }
  });

  it('treats a successful result with no rows at all (not even the control) as "not looking"', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(succeeded(undefined));
    const s = await loadMarketplaceFunnel(ENV, { fetchImpl, ...noSleep });
    expect(s).toEqual({ status: 'ok', listings: [], allTime: { views: 0, installs: 0 } });
    expect(renderFunnelHtml(s)).toContain('no events visible');
    expect(renderFunnelHtml(s)).not.toContain('unavailable');
  });

  it('returns unavailable with a short, escaped reason on an HTTP error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ message: '<b>PERMISSION_DENIED</b> on listing_funnel_events ' + 'x'.repeat(300) }, 403),
      );
    const s = await loadMarketplaceFunnel(ENV, { fetchImpl, ...noSleep });
    expect(s.status).toBe('unavailable');
    if (s.status !== 'unavailable') return;
    expect(s.reason).toContain('HTTP 403');
    expect(s.reason.length).toBeLessThanOrEqual(120);
    const html = renderFunnelHtml(s);
    expect(html).toContain('funnel unavailable: ');
    expect(html).not.toContain('<b>');
    expect(renderFunnelText(s)).toContain('funnel unavailable: ');
  });

  it('returns unavailable when the statement FAILS', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        statement_id: 's1',
        status: { state: 'FAILED', error: { message: 'TABLE_OR_VIEW_NOT_FOUND' } },
      }),
    );
    const s = await loadMarketplaceFunnel(ENV, { fetchImpl, ...noSleep });
    expect(s).toEqual({
      status: 'unavailable',
      reason: 'Databricks statement FAILED: TABLE_OR_VIEW_NOT_FOUND',
    });
  });

  it('never throws, even when fetch itself rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const s = await loadMarketplaceFunnel(ENV, { fetchImpl, ...noSleep });
    expect(s.status).toBe('unavailable');
  });

  it('keeps consumer_email and consumer_name out of the rendered digest even if the result carries them', async () => {
    const cols = [...FUNNEL_COLS, 'consumer_email', 'consumer_name', 'consumer_company'];
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        statement_id: 's1',
        status: { state: 'SUCCEEDED' },
        manifest: manifestOf(cols),
        result: {
          data_array: [
            [null, 'all_time', '9', '0', '3', '0', '0', '0', '0', 'leak-sentinel@example.com', 'Sentinel Person', 'Sentinel Co'],
            ['NPD Archive', 'current', '2', '0', '1', '1', '1', '0', '0', 'leak-sentinel@example.com', 'Sentinel Person', 'Sentinel Co'],
          ],
        },
      }),
    );
    const s = await loadMarketplaceFunnel(ENV, { fetchImpl, ...noSleep });
    expect(s.status).toBe('ok');
    for (const out of [renderFunnelHtml(s), renderFunnelText(s)]) {
      expect(out).not.toContain('leak-sentinel@example.com');
      expect(out).not.toContain('Sentinel Person');
      expect(out).not.toContain('Sentinel Co');
      expect(out).not.toMatch(/@example\.com/);
    }
  });
});
