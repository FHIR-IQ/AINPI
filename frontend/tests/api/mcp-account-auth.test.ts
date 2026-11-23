import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const client = {
    apiKey: { findUnique: async () => null, update: async () => ({}) },
    oAuthToken: { findUnique: async () => null },
    $queryRaw: async () => [{ units: 1 }],
    usageLedger: { update: async () => ({}) },
  };
  return { default: client, prisma: client };
});

import { POST } from '@/app/api/account/mcp/route';

const init = (headers: Record<string, string> = {}) =>
  new NextRequest('https://ainpi.dev/api/account/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
  });

describe('/api/account/mcp requires sign-in', () => {
  it('401 with an RFC 9728 challenge when no token is sent', async () => {
    const res = await POST(init());
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://ainpi.dev/.well-known/oauth-protected-resource/api/account/mcp"',
    );
  });
  it('401 invalid_token for an unknown access token, so the client signs in again', async () => {
    const res = await POST(init({ authorization: 'Bearer ainpi_at_unknown' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });
});
