import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  ACCESS_PREFIX,
  authorizationServerMetadata,
  checkAuthorize,
  parseRegistration,
  pkceMatches,
  sha256Hex,
  validRedirectUri,
} from '@/lib/oauth';
import {
  issueCode,
  keyForSignIn,
  keyIdForAccessToken,
  redeemCode,
  refreshTokens,
  type OAuthDb,
} from '@/lib/oauth-store';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const VERIFIER = 'a'.repeat(43) + '-._~0123456789';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const KEY = 'ainpi_live_' + 'k'.repeat(43);

function fakeDb(keyState: { active?: boolean; revokedAt?: Date | null; expiresAt?: Date | null } = {}) {
  const key = { id: 'key1', active: true, revokedAt: null, expiresAt: null, ...keyState };
  const codes = new Map<string, any>();
  const tokens = new Map<string, any>();
  const db: OAuthDb = {
    apiKey: {
      findUnique: async ({ where }) =>
        (where.keyHash && where.keyHash === sha256Hex(KEY)) || where.id === 'key1' ? key : null,
    },
    oAuthCode: {
      create: async ({ data }) => codes.set(data.codeHash, { ...data, usedAt: null }),
      findUnique: async ({ where }) => codes.get(where.codeHash) ?? null,
      updateMany: async ({ where, data }) => {
        const c = codes.get(where.codeHash);
        if (!c || c.usedAt) return { count: 0 };
        c.usedAt = data.usedAt;
        return { count: 1 };
      },
    },
    oAuthToken: {
      create: async ({ data }) => tokens.set(data.tokenHash, { ...data, revokedAt: null }),
      findUnique: async ({ where }) => tokens.get(where.tokenHash) ?? null,
      updateMany: async ({ where, data }) => {
        const t = tokens.get(where.tokenHash);
        if (!t || t.revokedAt) return { count: 0 };
        t.revokedAt = data.revokedAt;
        return { count: 1 };
      },
    },
  };
  return { db, key, codes, tokens };
}

const PARAMS = { clientId: 'c1', redirectUri: 'https://claude.ai/api/mcp/auth_callback', state: 's', codeChallenge: CHALLENGE, resource: null };

describe('metadata', () => {
  it('advertises only what is implemented', () => {
    const m = authorizationServerMetadata();
    expect(m.code_challenge_methods_supported).toEqual(['S256']);
    expect(m.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(m.registration_endpoint).toBe('https://ainpi.dev/api/oauth/register');
  });
});

describe('redirect URIs and registration', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['http://localhost:6274/oauth/callback', true],
    ['http://127.0.0.1:33418/cb', true],
    ['cursor://anysphere.cursor-retrieval/oauth/callback', true],
    ['http://evil.example/cb', false],
    ['https://ok.example/cb#frag', false],
    ['javascript:alert(1)', false],
    ['https://user:pw@ok.example/cb', false],
    ['not a url', false],
  ])('%s -> %s', (uri, ok) => {
    expect(validRedirectUri(uri)).toBe(ok);
  });
  it('requires redirect URIs, strips markup from the name, dedupes', () => {
    expect(parseRegistration({}).ok).toBe(false);
    const r = parseRegistration({ client_name: '<b>Claude</b>', redirect_uris: ['https://a.example/cb', 'https://a.example/cb'] });
    expect(r).toEqual({ ok: true, value: { clientName: 'bClaude/b', redirectUris: ['https://a.example/cb'] } });
    expect(parseRegistration({ redirect_uris: ['https://a.example/cb'], grant_types: ['client_credentials'] }).ok).toBe(false);
  });
});

describe('checkAuthorize', () => {
  const client = { redirectUris: [PARAMS.redirectUri] };
  const q = { client_id: 'c1', redirect_uri: PARAMS.redirectUri, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 's' };
  it('accepts a valid request', () => {
    expect(checkAuthorize(q, client)).toMatchObject({ ok: true });
  });
  it('never redirects to an unregistered URI or for an unknown client', () => {
    expect(checkAuthorize({ ...q, redirect_uri: 'https://evil.example/cb' }, client)).toMatchObject({ ok: false, redirect: false });
    expect(checkAuthorize(q, null)).toMatchObject({ ok: false, redirect: false });
  });
  it('requires PKCE S256, and sends other errors back to the client', () => {
    expect(checkAuthorize({ ...q, code_challenge_method: 'plain' }, client)).toMatchObject({ ok: false, redirect: true, error: 'invalid_request' });
    expect(checkAuthorize({ ...q, response_type: 'token' }, client)).toMatchObject({ ok: false, redirect: true, error: 'unsupported_response_type' });
    expect(checkAuthorize({ ...q, resource: 'https://other.example/mcp' }, client)).toMatchObject({ error: 'invalid_target' });
  });
});

describe('PKCE', () => {
  it('matches only the right verifier', () => {
    expect(pkceMatches(VERIFIER, CHALLENGE)).toBe(true);
    expect(pkceMatches('b'.repeat(43), CHALLENGE)).toBe(false);
    expect(pkceMatches('short', CHALLENGE)).toBe(false);
  });
});

describe('grant flows', () => {
  it('sign-in accepts only a live key', async () => {
    expect(await keyForSignIn(KEY, fakeDb().db, NOW)).toMatchObject({ id: 'key1' });
    expect(await keyForSignIn('ainpi_live_wrong_wrong_wrong_wrong', fakeDb().db, NOW)).toBeNull();
    expect(await keyForSignIn(KEY, fakeDb({ expiresAt: new Date(NOW - 1) }).db, NOW)).toBeNull();
    expect(await keyForSignIn(KEY, fakeDb({ revokedAt: new Date(NOW - 1) }).db, NOW)).toBeNull();
  });

  it('code -> tokens once; the code cannot be replayed; wrong verifier fails', async () => {
    const f = fakeDb();
    const code = await issueCode(PARAMS, 'key1', f.db, NOW);
    expect([...f.codes.keys()][0]).not.toContain(code); // stored hashed
    expect((await redeemCode({ code, client_id: 'c1', code_verifier: 'b'.repeat(43) }, f.db, NOW)).ok).toBe(false);
    const ok = await redeemCode({ code, client_id: 'c1', redirect_uri: PARAMS.redirectUri, code_verifier: VERIFIER }, f.db, NOW);
    expect(ok.ok && ok.tokens.access_token.startsWith(ACCESS_PREFIX)).toBe(true);
    expect((await redeemCode({ code, client_id: 'c1', code_verifier: VERIFIER }, f.db, NOW)).ok).toBe(false);
  });

  it('rejects an expired code and a code for another client', async () => {
    const f = fakeDb();
    const code = await issueCode(PARAMS, 'key1', f.db, NOW);
    expect((await redeemCode({ code, client_id: 'c2', code_verifier: VERIFIER }, f.db, NOW)).ok).toBe(false);
    expect((await redeemCode({ code, client_id: 'c1', code_verifier: VERIFIER }, f.db, NOW + 11 * 60_000)).ok).toBe(false);
  });

  it('refresh rotates: the old refresh token works exactly once', async () => {
    const f = fakeDb();
    const code = await issueCode(PARAMS, 'key1', f.db, NOW);
    const first = await redeemCode({ code, client_id: 'c1', code_verifier: VERIFIER }, f.db, NOW);
    if (!first.ok) throw new Error('fixture');
    const second = await refreshTokens({ refresh_token: first.tokens.refresh_token, client_id: 'c1' }, f.db, NOW);
    expect(second.ok).toBe(true);
    expect((await refreshTokens({ refresh_token: first.tokens.refresh_token, client_id: 'c1' }, f.db, NOW)).ok).toBe(false);
  });

  it('an access token resolves to its key until it expires', async () => {
    const f = fakeDb();
    const code = await issueCode(PARAMS, 'key1', f.db, NOW);
    const r = await redeemCode({ code, client_id: 'c1', code_verifier: VERIFIER }, f.db, NOW);
    if (!r.ok) throw new Error('fixture');
    expect(await keyIdForAccessToken(r.tokens.access_token, f.db, NOW)).toBe('key1');
    expect(await keyIdForAccessToken(r.tokens.access_token, f.db, NOW + 3_601_000)).toBeNull();
    expect(await keyIdForAccessToken(r.tokens.refresh_token, f.db, NOW)).toBeNull();
  });

  it('a key revoked after sign-in cannot refresh', async () => {
    const f = fakeDb();
    const code = await issueCode(PARAMS, 'key1', f.db, NOW);
    const r = await redeemCode({ code, client_id: 'c1', code_verifier: VERIFIER }, f.db, NOW);
    if (!r.ok) throw new Error('fixture');
    f.key.revokedAt = new Date(NOW);
    expect((await refreshTokens({ refresh_token: r.tokens.refresh_token, client_id: 'c1' }, f.db, NOW)).ok).toBe(false);
  });
});
