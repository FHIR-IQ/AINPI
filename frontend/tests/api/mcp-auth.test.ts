// @vitest-environment node
/**
 * Authentication on /api/mcp, exercised through the real route handler.
 *
 * The MCP server is public and must stay usable with no credentials. Clients
 * that cannot connect without one (Databricks Unity Catalog HTTP connections
 * accept only authenticated servers) send an issued AINPI API key as
 * `Authorization: Bearer <key>`, which the shared rate limiter already
 * resolves. These pin the three behaviours that contract depends on:
 *
 *   no header      -> served anonymously, exactly as before
 *   issued key     -> served, and the response names the key's tier
 *   unknown key    -> 401, never silently downgraded to anonymous
 *
 * Only Prisma is mocked. The limiter, the route wrapper and mcp-handler all
 * run for real, so a change to any of them that breaks keyed MCP access fails
 * here rather than in a partner's connection test.
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const GOOD_KEY = 'ainpi_test_0000000000000000000000000000';
const REVOKED_KEY = 'ainpi_test_revoked_000000000000000000000';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  queryRaw: vi.fn(),
  ledgerUpdate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const client = {
    apiKey: { findUnique: m.findUnique, update: m.update },
    usageLedger: { update: m.ledgerUpdate },
    $queryRaw: m.queryRaw,
  };
  return { default: client, prisma: client };
});

import { POST } from '@/app/api/mcp/route';

function initialize(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://ainpi.dev/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-forwarded-for': '203.0.113.7',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '0' },
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.update.mockResolvedValue({});
  m.ledgerUpdate.mockResolvedValue({});
  // Durable buckets unreachable: the limiter degrades to allow, which keeps
  // these tests about identity rather than about quota arithmetic.
  m.queryRaw.mockRejectedValue(new Error('no database in unit tests'));
  m.findUnique.mockImplementation(async ({ where }: { where: { keyHash: string } }) => {
    if (where.keyHash === sha(GOOD_KEY)) {
      return { id: 'k1', tier: 'free', active: true, revokedAt: null, dailyUnitCap: null };
    }
    if (where.keyHash === sha(REVOKED_KEY)) {
      return { id: 'k2', tier: 'free', active: true, revokedAt: new Date(), dailyUnitCap: null };
    }
    return null;
  });
});

describe('/api/mcp authentication', () => {
  it('serves a request with no Authorization header anonymously', async () => {
    const res = await POST(initialize());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-ratelimit-tier')).toBe('anonymous');
    expect(m.findUnique).not.toHaveBeenCalled();
    await expect(res.text()).resolves.toContain('"name":"ainpi"');
  });

  it('accepts an issued API key sent as a Bearer token', async () => {
    const res = await POST(initialize({ authorization: `Bearer ${GOOD_KEY}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-ratelimit-tier')).toBe('free');
    expect(m.findUnique).toHaveBeenCalledWith({ where: { keyHash: sha(GOOD_KEY) } });
    await expect(res.text()).resolves.toContain('"name":"ainpi"');
  });

  it('accepts the scheme case-insensitively and via X-API-Key', async () => {
    const lower = await POST(initialize({ authorization: `bearer ${GOOD_KEY}` }));
    expect(lower.status).toBe(200);
    expect(lower.headers.get('x-ratelimit-tier')).toBe('free');

    const header = await POST(initialize({ 'x-api-key': GOOD_KEY }));
    expect(header.status).toBe(200);
    expect(header.headers.get('x-ratelimit-tier')).toBe('free');
  });

  it('refuses an unknown key with 401 rather than downgrading it', async () => {
    const res = await POST(initialize({ authorization: 'Bearer not-a-real-key' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/not recognised/i);
  });

  it('refuses a revoked key with 401', async () => {
    const res = await POST(initialize({ authorization: `Bearer ${REVOKED_KEY}` }));
    expect(res.status).toBe(401);
  });
});
