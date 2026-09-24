// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  upsert: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  receivingGet: vi.fn(),
  send: vi.fn(),
  alert: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    marketplaceInstall: {
      upsert: m.upsert,
      updateMany: m.updateMany,
      findUnique: m.findUnique,
      update: m.update,
    },
  },
}));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: m.send, receiving: { get: m.receivingGet } };
  },
}));
vi.mock('@/lib/resend-webhook', () => ({ verifyResendWebhook: () => true }));
vi.mock('@/lib/admin-email', () => ({ sendInstallAlert: m.alert }));

import { POST } from '@/app/api/v1/marketplace-install/route';

const NOTICE = `Test User has installed Test Listing
Listing:\tTest Listing
Installed by:\tTest User
Installed on:\tSeptember 20, 2026
Company:\tNot specified
Email:\tuser@example.com
Sharing identifier:\taws
`;

function req() {
  return new NextRequest('http://localhost/api/v1/marketplace-install', {
    method: 'POST',
    body: JSON.stringify({ type: 'email.received', data: { email_id: 'em_1' } }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test';
  m.receivingGet.mockResolvedValue({
    data: { text: NOTICE, html: null, subject: 'New installation of your listing' },
  });
  m.upsert.mockResolvedValue({});
  m.findUnique.mockResolvedValue(null);
  m.send.mockResolvedValue({ data: { id: 'x' }, error: null });
});

describe('POST /api/v1/marketplace-install (claim-then-send)', () => {
  it('upserts, claims with a conditional updateMany, then sends once', async () => {
    m.updateMany.mockResolvedValueOnce({ count: 1 });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(m.upsert).toHaveBeenCalledTimes(1);
    expect(m.upsert.mock.calls[0][0].create.welcomedAt).toBeUndefined();
    expect(m.updateMany.mock.calls[0][0]).toMatchObject({
      where: { email: 'user@example.com', welcomedAt: null },
    });
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.upsert.mock.invocationCallOrder[0]).toBeLessThan(m.updateMany.mock.invocationCallOrder[0]);
    expect(m.updateMany.mock.invocationCallOrder[0]).toBeLessThan(m.send.mock.invocationCallOrder[0]);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('sends nothing when the claim is lost to a concurrent run', async () => {
    m.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: 'already welcomed' });
    expect(m.send).not.toHaveBeenCalled();
  });

  it('releases exactly the claim it set when the send fails', async () => {
    m.updateMany.mockResolvedValue({ count: 1 });
    m.send.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const res = await POST(req());
    expect(res.status).toBe(502);
    const [claimCall, releaseCall] = m.updateMany.mock.calls.map((c) => c[0]);
    expect(releaseCall).toEqual({
      where: { email: 'user@example.com', welcomedAt: claimCall.data.welcomedAt },
      data: { welcomedAt: null },
    });
    expect(m.alert).toHaveBeenCalledWith(expect.objectContaining({ welcomed: false }));
  });
});
