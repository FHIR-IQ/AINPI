// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: m.send };
  },
}));

import { sendNpdMcpSignupAlert } from '@/lib/admin-email';

const ARGS = {
  id: 'abc-123',
  organization: '<b>Acme</b> Health',
  contactName: 'Pat',
  email: 'pat@acme.org',
  orgType: 'payer',
  participation: ['test'],
  useCase: null,
  listPublicly: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  m.send.mockResolvedValue({ data: { id: 'x' }, error: null });
});

describe('sendNpdMcpSignupAlert', () => {
  it('sends one email with the plan subject and escaped HTML', async () => {
    process.env.RESEND_API_KEY = 'test';
    await sendNpdMcpSignupAlert(ARGS);
    expect(m.send).toHaveBeenCalledTimes(1);
    const sent = m.send.mock.calls[0][0];
    expect(sent.subject).toBe('NPD MCP sign-up: <b>Acme</b> Health');
    expect(sent.html).toContain('&lt;b&gt;Acme&lt;/b&gt; Health');
    expect(sent.html).not.toContain('<b>Acme</b>');
    expect(sent.text).toContain('pat@acme.org');
  });

  it('collapses whitespace in the subject', async () => {
    process.env.RESEND_API_KEY = 'test';
    await sendNpdMcpSignupAlert({ ...ARGS, organization: 'Acme\r\n  Health\tPlan ' });
    expect(m.send.mock.calls[0][0].subject).toBe('NPD MCP sign-up: Acme Health Plan');
  });

  it('carries the approve statement when the organization asked to be listed', async () => {
    process.env.RESEND_API_KEY = 'test';
    await sendNpdMcpSignupAlert({ ...ARGS, listPublicly: true });
    const sent = m.send.mock.calls[0][0];
    const sql = "update npd_mcp_participants set approved = true where id = 'abc-123';";
    expect(sent.text).toContain(sql);
    expect(sent.html).toContain(sql.replace(/'/g, '&#39;'));
  });

  it('has no approve statement when the organization did not ask to be listed', async () => {
    process.env.RESEND_API_KEY = 'test';
    await sendNpdMcpSignupAlert(ARGS);
    const sent = m.send.mock.calls[0][0];
    expect(sent.text).not.toContain('set approved');
    expect(sent.html).not.toContain('set approved');
  });

  it('skips without RESEND_API_KEY and never throws', async () => {
    delete process.env.RESEND_API_KEY;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendNpdMcpSignupAlert(ARGS)).resolves.toBeUndefined();
    expect(m.send).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('swallows a send failure', async () => {
    process.env.RESEND_API_KEY = 'test';
    m.send.mockRejectedValue(new Error('down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sendNpdMcpSignupAlert(ARGS)).resolves.toBeUndefined();
    err.mockRestore();
  });
});
