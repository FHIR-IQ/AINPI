import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyResendWebhook } from '@/lib/resend-webhook';

// Resend signs webhooks the Svix way: secret "whsec_<base64>", signed
// content "<id>.<timestamp>.<body>", HMAC-SHA256, header "v1,<base64sig>".
const SECRET_RAW = Buffer.from('0123456789abcdef0123456789abcdef');
const SECRET = `whsec_${SECRET_RAW.toString('base64')}`;

function sign(id: string, ts: string, body: string, key = SECRET_RAW): string {
  return createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

const now = () => Math.floor(Date.now() / 1000);

describe('verifyResendWebhook', () => {
  const body = '{"type":"email.received","data":{"email_id":"abc"}}';

  it('accepts a correctly signed, fresh payload', () => {
    const ts = String(now());
    const sig = `v1,${sign('msg_1', ts, body)}`;
    expect(verifyResendWebhook(body, { id: 'msg_1', timestamp: ts, signature: sig }, SECRET)).toBe(true);
  });

  it('accepts when one of several signatures matches', () => {
    const ts = String(now());
    const sig = `v1,notthisone v1,${sign('msg_1', ts, body)}`;
    expect(verifyResendWebhook(body, { id: 'msg_1', timestamp: ts, signature: sig }, SECRET)).toBe(true);
  });

  it('rejects a bad signature', () => {
    const ts = String(now());
    const sig = `v1,${sign('msg_1', ts, body, Buffer.from('wrongwrongwrongwrongwrongwrongwr'))}`;
    expect(verifyResendWebhook(body, { id: 'msg_1', timestamp: ts, signature: sig }, SECRET)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const ts = String(now());
    const sig = `v1,${sign('msg_1', ts, body)}`;
    expect(verifyResendWebhook(body + ' ', { id: 'msg_1', timestamp: ts, signature: sig }, SECRET)).toBe(false);
  });

  it('rejects a stale timestamp (replay)', () => {
    const ts = String(now() - 10 * 60);
    const sig = `v1,${sign('msg_1', ts, body)}`;
    expect(verifyResendWebhook(body, { id: 'msg_1', timestamp: ts, signature: sig }, SECRET)).toBe(false);
  });

  it('rejects missing headers or secret', () => {
    const ts = String(now());
    const sig = `v1,${sign('msg_1', ts, body)}`;
    expect(verifyResendWebhook(body, { id: null, timestamp: ts, signature: sig }, SECRET)).toBe(false);
    expect(verifyResendWebhook(body, { id: 'msg_1', timestamp: ts, signature: sig }, '')).toBe(false);
  });
});
