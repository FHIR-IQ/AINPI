/**
 * Storage side of the OAuth server (see src/lib/oauth.ts). The database is
 * injected so the grant flows can be tested without Postgres.
 */
import {
  ACCESS_PREFIX,
  ACCESS_TTL_S,
  CODE_PREFIX,
  CODE_TTL_MS,
  REFRESH_PREFIX,
  REFRESH_TTL_MS,
  SCOPE,
  newSecret,
  pkceMatches,
  sha256Hex,
  type AuthorizeParams,
  type TokenPair,
} from '@/lib/oauth';

export interface KeyRow {
  id: string;
  active: boolean;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

export function keyIsLive(k: KeyRow | null, now: number): k is KeyRow {
  return Boolean(k && k.active && !k.revokedAt && (!k.expiresAt || k.expiresAt.getTime() > now));
}

interface CodeRow {
  codeHash: string;
  clientId: string;
  apiKeyId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: Date;
  usedAt: Date | null;
}
interface TokenRow {
  tokenHash: string;
  kind: string;
  clientId: string;
  apiKeyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface OAuthDb {
  apiKey: {
    findUnique(a: { where: { keyHash?: string; id?: string } }): Promise<KeyRow | null>;
  };
  oAuthCode: {
    create(a: { data: Omit<CodeRow, 'usedAt'> }): Promise<unknown>;
    findUnique(a: { where: { codeHash: string } }): Promise<CodeRow | null>;
    updateMany(a: { where: { codeHash: string; usedAt: null }; data: { usedAt: Date } }): Promise<{ count: number }>;
  };
  oAuthToken: {
    create(a: { data: Omit<TokenRow, 'revokedAt'> }): Promise<unknown>;
    findUnique(a: { where: { tokenHash: string } }): Promise<TokenRow | null>;
    updateMany(a: { where: { tokenHash: string; revokedAt: null }; data: { revokedAt: Date } }): Promise<{ count: number }>;
  };
}

/** The API key a user pasted, if it is one that may sign in. */
export async function keyForSignIn(plaintext: string, db: OAuthDb, now: number): Promise<KeyRow | null> {
  const t = plaintext.trim();
  if (!/^ainpi_live_[A-Za-z0-9_-]{20,}$/.test(t)) return null;
  const row = await db.apiKey.findUnique({ where: { keyHash: sha256Hex(t) } });
  return keyIsLive(row, now) ? row : null;
}

export async function issueCode(p: AuthorizeParams, apiKeyId: string, db: OAuthDb, now: number): Promise<string> {
  const code = newSecret(CODE_PREFIX);
  await db.oAuthCode.create({
    data: {
      codeHash: sha256Hex(code),
      clientId: p.clientId,
      apiKeyId,
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
      expiresAt: new Date(now + CODE_TTL_MS),
    },
  });
  return code;
}

async function issuePair(clientId: string, apiKeyId: string, db: OAuthDb, now: number): Promise<TokenPair> {
  const access = newSecret(ACCESS_PREFIX);
  const refresh = newSecret(REFRESH_PREFIX);
  await db.oAuthToken.create({
    data: { tokenHash: sha256Hex(access), kind: 'access', clientId, apiKeyId, expiresAt: new Date(now + ACCESS_TTL_S * 1000) },
  });
  await db.oAuthToken.create({
    data: { tokenHash: sha256Hex(refresh), kind: 'refresh', clientId, apiKeyId, expiresAt: new Date(now + REFRESH_TTL_MS) },
  });
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
}

export type GrantResult = { ok: true; tokens: TokenPair } | { ok: false; error: string; description: string };

const invalidGrant = (description: string): GrantResult => ({ ok: false, error: 'invalid_grant', description });

export async function redeemCode(
  f: { code?: string; client_id?: string; redirect_uri?: string; code_verifier?: string },
  db: OAuthDb,
  now: number,
): Promise<GrantResult> {
  if (!f.code || !f.client_id || !f.code_verifier) {
    return { ok: false, error: 'invalid_request', description: 'code, client_id and code_verifier are required.' };
  }
  const row = await db.oAuthCode.findUnique({ where: { codeHash: sha256Hex(f.code) } });
  if (!row || row.usedAt || row.expiresAt.getTime() <= now) return invalidGrant('The code is invalid, used or expired.');
  if (row.clientId !== f.client_id) return invalidGrant('The code was issued to another client.');
  if (f.redirect_uri !== undefined && f.redirect_uri !== row.redirectUri) return invalidGrant('redirect_uri does not match.');
  if (!pkceMatches(f.code_verifier, row.codeChallenge)) return invalidGrant('code_verifier does not match the code_challenge.');
  // Single use, even under concurrent redemption.
  const claim = await db.oAuthCode.updateMany({ where: { codeHash: row.codeHash, usedAt: null }, data: { usedAt: new Date(now) } });
  if (claim.count !== 1) return invalidGrant('The code is invalid, used or expired.');
  const key = await db.apiKey.findUnique({ where: { id: row.apiKeyId } });
  if (!keyIsLive(key, now)) return invalidGrant('The API key behind this sign-in is no longer active.');
  return { ok: true, tokens: await issuePair(row.clientId, row.apiKeyId, db, now) };
}

export async function refreshTokens(
  f: { refresh_token?: string; client_id?: string },
  db: OAuthDb,
  now: number,
): Promise<GrantResult> {
  if (!f.refresh_token || !f.client_id) {
    return { ok: false, error: 'invalid_request', description: 'refresh_token and client_id are required.' };
  }
  const row = await db.oAuthToken.findUnique({ where: { tokenHash: sha256Hex(f.refresh_token) } });
  if (!row || row.kind !== 'refresh' || row.revokedAt || row.expiresAt.getTime() <= now) {
    return invalidGrant('The refresh token is invalid, revoked or expired.');
  }
  if (row.clientId !== f.client_id) return invalidGrant('The refresh token was issued to another client.');
  // Rotation: the old refresh token works exactly once.
  const claim = await db.oAuthToken.updateMany({ where: { tokenHash: row.tokenHash, revokedAt: null }, data: { revokedAt: new Date(now) } });
  if (claim.count !== 1) return invalidGrant('The refresh token is invalid, revoked or expired.');
  const key = await db.apiKey.findUnique({ where: { id: row.apiKeyId } });
  if (!keyIsLive(key, now)) return invalidGrant('The API key behind this sign-in is no longer active.');
  return { ok: true, tokens: await issuePair(row.clientId, row.apiKeyId, db, now) };
}

/** The api_keys id an access token stands for, or null. The key's own state is checked by the caller. */
export async function keyIdForAccessToken(token: string, db: OAuthDb, now: number): Promise<string | null> {
  if (!token.startsWith(ACCESS_PREFIX)) return null;
  const row = await db.oAuthToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!row || row.kind !== 'access' || row.revokedAt || row.expiresAt.getTime() <= now) return null;
  return row.apiKeyId;
}
