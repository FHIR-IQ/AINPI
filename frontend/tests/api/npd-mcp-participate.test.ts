// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  create: vi.fn(),
  alert: vi.fn(),
  bump: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { npdMcpParticipant: { create: m.create } },
}));
vi.mock('@/lib/admin-email', () => ({ sendNpdMcpSignupAlert: m.alert }));
vi.mock('@/lib/rate-limit', () => ({
  bump: m.bump,
  clientIp: () => '203.0.113.7',
}));

import { POST } from '@/app/api/v1/npd-mcp/participate/route';

const VALID = { organization: 'Acme Health', contactName: 'Pat', email: 'pat@acme.org', orgType: 'payer' };

function req(body: unknown, raw = false, extraHeaders: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/v1/npd-mcp/participate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest', ...extraHeaders },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.bump.mockResolvedValue(1);
  m.create.mockResolvedValue({ id: 'row' });
  m.alert.mockResolvedValue(undefined);
});

describe('POST /api/v1/npd-mcp/participate', () => {
  it('valid post creates one row and alerts', async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.create.mock.calls[0][0].data).toMatchObject({
      organization: 'Acme Health',
      contactName: 'Pat',
      email: 'pat@acme.org',
      orgType: 'payer',
      listPublicly: false,
      participation: [],
      useCase: null,
      ipAddress: '203.0.113.7',
      userAgent: 'vitest',
    });
    expect(m.alert).toHaveBeenCalledTimes(1);
    expect(m.alert.mock.calls[0][0]).toMatchObject({ id: 'row', organization: 'Acme Health', email: 'pat@acme.org' });
  });

  it('same body twice gives two rows and two 200s', async () => {
    const a = await POST(req(VALID));
    const b = await POST(req(VALID));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
    expect(m.create).toHaveBeenCalledTimes(2);
  });

  it('invalid body returns 400 and writes nothing', async () => {
    const res = await POST(req({ ...VALID, email: 'nope' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe('string');
    expect(m.create).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  });

  it('non-JSON body returns 400', async () => {
    const res = await POST(req('{not json', true));
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('per-minute limit', async () => {
    m.bump.mockResolvedValue(6);
    const res = await POST(req(VALID));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: 'Too many submissions. Please try again later.' });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.bump.mock.calls[0][0]).toMatch(/^npdmcp:ip:203\.0\.113\.7:m:\d+$/);
    expect(m.bump.mock.calls[0][2]).toBe(120_000);
  });

  it('per-day limit', async () => {
    m.bump.mockResolvedValueOnce(1).mockResolvedValueOnce(21);
    const res = await POST(req(VALID));
    expect(res.status).toBe(429);
    expect(m.create).not.toHaveBeenCalled();
    expect(m.bump.mock.calls[1][0]).toMatch(/^npdmcp:ip:203\.0\.113\.7:d:\d+$/);
    expect(m.bump.mock.calls[1][2]).toBe(172_800_000);
  });

  it('counts junk against the limit before parsing', async () => {
    const res = await POST(req('{not json', true));
    expect(res.status).toBe(400);
    expect(m.bump).toHaveBeenCalledTimes(2);
  });

  it('a body over 16 KB returns 413 and writes nothing', async () => {
    const res = await POST(req(VALID, false, { 'content-length': '16385' }));
    expect(res.status).toBe(413);
    expect((await res.json()).ok).toBe(false);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('a filled honeypot gets the same 200 and stores nothing', async () => {
    const res = await POST(req({ ...VALID, website: 'http://spam.example' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  });

  it('a filled honeypot gets 200 even when the rest of the body is invalid', async () => {
    const res = await POST(req({ website: 'x' }));
    expect(res.status).toBe(200);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('an empty honeypot is a normal sign-up', async () => {
    const res = await POST(req({ ...VALID, website: '' }));
    expect(res.status).toBe(200);
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it('limiter unreachable', async () => {
    m.bump.mockResolvedValue(null);
    const res = await POST(req(VALID));
    expect(res.status).toBe(200);
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it('prisma error returns 503 with the plain message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A database error message can echo the submitted values. Only the code
    // may be logged.
    m.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed for email pat@acme.org (Pat)'), { code: 'P2002' }),
    );
    const res = await POST(req(VALID));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'Sign-up is not open yet. Please try again soon.' });
    expect(m.alert).not.toHaveBeenCalled();
    // The log line carries no contact details.
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('pat@acme.org');
    expect(logged).not.toContain('Pat');
    expect(logged).toContain('P2002');
    spy.mockRestore();
  });

  it('an alert failure does not fail the request', async () => {
    m.alert.mockRejectedValue(new Error('smtp down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(req(VALID));
    expect(res.status).toBe(200);
    spy.mockRestore();
  });
});
