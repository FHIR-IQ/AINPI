import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { npdMcpParticipant: { findMany: m.findMany } } }));

import { listPublicParticipants } from '@/lib/npd-mcp-participants';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('listPublicParticipants', () => {
  it('asks only for opted-in rows and only for organization and type', async () => {
    m.findMany.mockResolvedValue([{ organization: 'Acme Health', orgType: 'payer' }]);
    const rows = await listPublicParticipants();
    expect(rows).toEqual([{ organization: 'Acme Health', orgType: 'payer' }]);
    expect(m.findMany).toHaveBeenCalledWith({
      where: { listPublicly: true },
      select: { organization: true, orgType: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('lists an organization that signed up twice once', async () => {
    m.findMany.mockResolvedValue([
      { organization: 'Acme Health', orgType: 'payer' },
      { organization: 'acme health ', orgType: 'payer' },
      { organization: 'Beta Labs', orgType: 'app' },
    ]);
    expect(await listPublicParticipants()).toEqual([
      { organization: 'Acme Health', orgType: 'payer' },
      { organization: 'Beta Labs', orgType: 'app' },
    ]);
  });

  it('returns [] and logs when the table is missing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.findMany.mockRejectedValue(new Error('relation "npd_mcp_participants" does not exist'));
    expect(await listPublicParticipants()).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
