// @vitest-environment node
/**
 * lookup_organization through the real /api/mcp route handler.
 *
 * The pure logic is covered in tests/lib/org-lookup.test.ts. These pin the
 * two things only the route can get wrong: a source that cannot be fetched
 * surfaces as a tool error (never as "not found"), and a successful load is
 * served through the MCP envelope. Global fetch is stubbed, so nothing here
 * touches the network. Order matters: the index is cached in module scope, so
 * the failure case runs before anything has loaded.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({ queryRaw: vi.fn(), findUnique: vi.fn() }));

vi.mock('@/lib/prisma', () => {
  const client = {
    apiKey: { findUnique: m.findUnique, update: vi.fn() },
    usageLedger: { update: vi.fn() },
    $queryRaw: m.queryRaw,
  };
  return { default: client, prisma: client };
});

import { POST } from '@/app/api/mcp/route';

const NPI = '1234567893';
const CROSSWALK =
  'endpoint_id,base_url,host,status,org_id,org_npi,org_name,org_state\n' +
  `Endpoint-1,https://fhir.example.com/r4,fhir.example.com,active,Organization-${NPI},${NPI},EXAMPLE CLINIC,KS\n`;
const VENDOR =
  'url,org_name,org_npi,vendor,in_ndh,ndh_has_owner\n' +
  `https://fhir.example.com/r4/,Example Clinic,${NPI},Acme EHR,yes,yes\n`;
const LINKAGE = JSON.stringify({ numerator: 200, denominator: 1000, release_date: '2026-08-20' });

let failCsv = true;
const realFetch = globalThis.fetch;

beforeEach(() => {
  m.queryRaw.mockRejectedValue(new Error('no database in unit tests'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (failCsv && u.endsWith('.csv')) return new Response('nope', { status: 503 });
      if (u.endsWith('endpoint-org-crosswalk.csv')) return new Response(CROSSWALK);
      if (u.endsWith('vendor-endpoint-attribution.csv')) return new Response(VENDOR);
      if (u.endsWith('endpoint-org-linkage.json')) return new Response(LINKAGE);
      return new Response('unexpected', { status: 404 });
    }),
  );
});

afterAll(() => {
  vi.stubGlobal('fetch', realFetch);
});

function callTool(npi: string): NextRequest {
  return new NextRequest('https://ainpi.dev/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-forwarded-for': '203.0.113.9',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'lookup_organization', arguments: { npi } },
    }),
  });
}

/** The transport is SSE; pull the JSON-RPC result out of the data line. */
async function result(res: Response) {
  const body = await res.text();
  const line = body.split('\n').find((l) => l.startsWith('data: '));
  const msg = JSON.parse(line ? line.slice(6) : body);
  return msg.result as { isError?: boolean; content: { text: string }[] };
}

describe('lookup_organization via /api/mcp', () => {
  it('reports a tool error, not "not found", when a source CSV cannot be fetched', async () => {
    failCsv = true;
    const r = await result(await POST(callTool(NPI)));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/could not load/);
    expect(r.content[0].text).not.toMatch(/not found in either source/);
  });

  it('serves a merged, de-duplicated result once the sources load', async () => {
    failCsv = false;
    const r = await result(await POST(callTool(NPI)));
    expect(r.isError).toBeFalsy();
    const payload = JSON.parse(r.content[0].text);
    expect(payload.found).toBe(true);
    expect(payload.state).toBe('KS');
    expect(payload.endpoints).toHaveLength(1);
    expect(payload.endpoints[0].sources).toEqual(['ndh', 'vendor_file']);
    expect(payload.endpoints[0].vendor).toBe('Acme EHR');
  });

  it('rejects a malformed NPI at the schema', async () => {
    const res = await POST(callTool('12345'));
    const body = await res.text();
    expect(body).toMatch(/error/i);
    expect(body).not.toMatch(/"found"/);
  });
});
