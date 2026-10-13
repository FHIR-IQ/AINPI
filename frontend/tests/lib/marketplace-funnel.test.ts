import { describe, expect, it, vi } from 'vitest';
import {
  buildFunnelQuery,
  loadMarketplaceFunnel,
  renderFunnelHtml,
  renderFunnelText,
  shortReason,
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

const FUNNEL_COLS = ['listing_name', 'period', 'views', 'requests', 'installs'];

const noSleep = { sleep: async () => {} };

describe('buildFunnelQuery', () => {
  it('reads views from the funnel table and requests/installs from access events, 14 days back', () => {
    const q = buildFunnelQuery().statement;
    expect(q).toContain('system.marketplace.listing_funnel_events');
    expect(q).toContain('system.marketplace.listing_access_events');
    expect(q).toMatch(/event_type\s*=\s*'VIEW_LISTING'/);
    expect(q).toMatch(/event_type\s+IN\s+\('REQUEST_DATA',\s*'GET_DATA'\)/);
    expect(q).toMatch(/date_sub\(current_date\(\),\s*14\)/);
    expect(q).toMatch(/date_sub\(current_date\(\),\s*7\)/);
    expect(q).toMatch(/GROUP BY 1, 2/);
    expect(q).toMatch(/LIMIT\s+\d+/);
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
    ]);
    expect(out.map((l) => l.listingName)).toEqual(['A', 'B']);
    expect(out[1].current).toEqual({ views: 10, requests: 1, installs: 2 });
    expect(out[1].prior).toEqual({ views: 4, requests: 0, installs: 1 });
    expect(out[0].current).toEqual({ views: 0, requests: 0, installs: 0 });
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
      jsonResponse({
        statement_id: 's1',
        status: { state: 'SUCCEEDED' },
        manifest: manifestOf(FUNNEL_COLS),
        result: {
          data_array: [
            ['NPD Archive', 'current', '12', '0', '3'],
            ['NPD Archive', 'prior', '5', '1', '1'],
          ],
        },
      }),
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
        current: { views: 12, requests: 0, installs: 3 },
        prior: { views: 5, requests: 1, installs: 1 },
      },
    ]);
    const html = renderFunnelHtml(s);
    expect(html).toContain('NPD Archive');
    expect(html).toContain('Marketplace funnel');
    expect(renderFunnelText(s)).toContain('installs 3 (prior 1)');
  });

  it('distinguishes an empty successful result from an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        statement_id: 's1',
        status: { state: 'SUCCEEDED' },
        manifest: manifestOf(FUNNEL_COLS),
        result: {},
      }),
    );
    const s = await loadMarketplaceFunnel(ENV, { fetchImpl, ...noSleep });
    expect(s).toEqual({ status: 'ok', listings: [] });
    expect(renderFunnelHtml(s)).toContain('no funnel events in the last 14 days');
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
            ['NPD Archive', 'current', '2', '0', '1', 'leak-sentinel@example.com', 'Sentinel Person', 'Sentinel Co'],
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
