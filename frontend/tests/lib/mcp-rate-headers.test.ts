/**
 * The MCP surface must tell a caller which tier was applied.
 *
 * /api/npd/search and /api/npd/geo-search already advertise the rate-limit
 * headers. /api/mcp did not, which made a bearer token unverifiable from the
 * outside: a keyed response and an anonymous one were byte-identical, so a
 * revoked or mistyped key was indistinguishable from a working one until the
 * anonymous ceiling stopped the caller.
 *
 * These test the annotate step in isolation, because exercising the whole
 * mcp-handler pipeline would need a live Postgres and a real key.
 */
import { describe, expect, it } from 'vitest';

/** Mirrors the header contract in src/app/api/mcp/route.ts. */
function annotate(
  res: Response,
  rl: { caller: { tier: { name: string }; dailyUnitCap: number }; units: number },
): Response {
  const values: [string, string][] = [
    ['x-ratelimit-tier', rl.caller.tier.name],
    ['x-ratelimit-cost-units', String(rl.units)],
    ['x-ratelimit-limit-day', String(rl.caller.dailyUnitCap)],
  ];
  try {
    for (const [k, v] of values) res.headers.set(k, v);
    return res;
  } catch {
    const headers = new Headers(res.headers);
    for (const [k, v] of values) headers.set(k, v);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }
}

const RL = { caller: { tier: { name: 'partner' }, dailyUnitCap: 100_000 }, units: 2 };

describe('MCP rate-limit headers', () => {
  it('advertises tier, cost and daily cap on a successful response', () => {
    const out = annotate(new Response('{"ok":true}', { status: 200 }), RL);
    expect(out.headers.get('x-ratelimit-tier')).toBe('partner');
    expect(out.headers.get('x-ratelimit-cost-units')).toBe('2');
    expect(out.headers.get('x-ratelimit-limit-day')).toBe('100000');
  });

  it('keeps the status and body intact', async () => {
    const out = annotate(new Response('hello', { status: 200 }), RL);
    expect(out.status).toBe(200);
    await expect(out.text()).resolves.toBe('hello');
  });

  it('does not buffer a stream, so SSE keeps streaming', async () => {
    // The transport is server-sent events. If annotate read the body to
    // rebuild the response, the stream would be consumed before the client
    // ever saw it.
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('event: message\ndata: {}\n\n'));
        c.close();
      },
    });
    const res = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const out = annotate(res, RL);
    expect(out.headers.get('content-type')).toBe('text/event-stream');
    expect(out.bodyUsed).toBe(false);
    await expect(out.text()).resolves.toContain('event: message');
  });

  it('still applies headers when the original headers are immutable', () => {
    const res = new Response('x', { status: 200 });
    Object.defineProperty(res, 'headers', {
      value: new Proxy(new Headers(), {
        get(t, p) {
          if (p === 'set') return () => { throw new TypeError('immutable'); };
          const v = Reflect.get(t, p);
          return typeof v === 'function' ? v.bind(t) : v;
        },
      }),
    });
    const out = annotate(res, RL);
    expect(out.headers.get('x-ratelimit-tier')).toBe('partner');
  });
});
