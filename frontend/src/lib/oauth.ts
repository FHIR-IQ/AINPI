/**
 * OAuth 2.1 authorization server for the AINPI MCP server, sign-in option A:
 * the user proves who they are by pasting an AINPI API key on
 * https://ainpi.dev/oauth/authorize. No accounts, no passwords.
 *
 * What is implemented, and only this: RFC 8414 metadata, RFC 7591 dynamic
 * client registration for public clients, the authorization-code grant with
 * PKCE S256 (required), and the refresh-token grant with rotation. RFC 9728
 * protected-resource metadata is served for the MCP endpoints.
 *
 * Everything secret (codes, tokens) is stored as a SHA-256 hash and bound to
 * an api_keys row. Token checks re-read that row, so revoking or expiring the
 * key ends every token issued for it, with nothing to clean up.
 *
 * Pure helpers only; routes are under src/app/api/oauth and src/app/.well-known.
 */
import { createHash, randomBytes } from 'node:crypto';

export const ISSUER = 'https://ainpi.dev';
export const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
export const TOKEN_URL = `${ISSUER}/api/oauth/token`;
export const REGISTER_URL = `${ISSUER}/api/oauth/register`;
export const RESOURCES = [`${ISSUER}/api/account/mcp`, `${ISSUER}/api/mcp`] as const;
export const SCOPE = 'mcp';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const ACCESS_PREFIX = 'ainpi_at_';
export const REFRESH_PREFIX = 'ainpi_rt_';
export const CODE_PREFIX = 'ainpi_ac_';

/**
 * SHA-256 for lookup hashes. Not a password hash, and deliberately so: every
 * input is a 256-bit random secret (AINPI API keys, OAuth codes and tokens),
 * which no slow hash would make stronger, and api_keys.key_hash already
 * stores SHA-256 (scripts/api-key.ts, identify()), so sign-in must match it.
 * CodeQL js/insufficient-password-hash reads the pasted key as a password.
 */
export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function newSecret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

export function authorizationServerMetadata() {
  return {
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZE_URL,
    token_endpoint: TOKEN_URL,
    registration_endpoint: REGISTER_URL,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    service_documentation: `${ISSUER}/developer#mcp`,
  };
}

export function protectedResourceMetadata(resource: string) {
  return {
    resource,
    authorization_servers: [ISSUER],
    bearer_methods_supported: ['header'],
    scopes_supported: [SCOPE],
    resource_name: 'AINPI provider directory tools',
    resource_documentation: `${ISSUER}/developer#mcp`,
  };
}

// ---------------------------------------------------------------------------
// Redirect URIs and registration
// ---------------------------------------------------------------------------

/**
 * App schemes desktop clients use for their callback. Must equal the list in
 * the /oauth/authorize form-action CSP in next.config.js, or the browser
 * blocks the final redirect.
 */
export const APP_SCHEMES = new Set(['cursor:', 'vscode:', 'vscode-insiders:', 'windsurf:']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Allowed: https anywhere, http only to a loopback host (RFC 8252 native
 * apps), and the app schemes in APP_SCHEMES. Never a fragment, never
 * credentials in the URL.
 */
export function validRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return Boolean(u.hostname);
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname);
  return APP_SCHEMES.has(u.protocol);
}

export interface Registration {
  clientName: string | null;
  redirectUris: string[];
}

export type RegistrationResult = { ok: true; value: Registration } | { ok: false; error: string; description: string };

export function parseRegistration(body: unknown): RegistrationResult {
  const bad = (description: string, error = 'invalid_client_metadata'): RegistrationResult => ({ ok: false, error, description });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('The body must be a JSON object.');
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
    return bad('redirect_uris must list 1 to 10 URIs.', 'invalid_redirect_uri');
  }
  if (!uris.every(validRedirectUri)) {
    return bad('Each redirect URI must be https, http to a loopback host, or a private-use scheme, with no fragment.', 'invalid_redirect_uri');
  }
  const grants = b.grant_types;
  if (grants !== undefined && (!Array.isArray(grants) || !grants.includes('authorization_code'))) {
    return bad('grant_types must include authorization_code.');
  }
  const name = typeof b.client_name === 'string' ? b.client_name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 100) : '';
  return { ok: true, value: { clientName: name || null, redirectUris: Array.from(new Set(uris as string[])) } };
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

export function validChallenge(c: unknown): c is string {
  return typeof c === 'string' && CHALLENGE.test(c);
}

export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !VERIFIER.test(verifier)) return false;
  return createHash('sha256').update(verifier).digest('base64url') === challenge;
}

// ---------------------------------------------------------------------------
// Authorization request
// ---------------------------------------------------------------------------

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string | null;
}

export type AuthorizeCheck =
  /** Safe to redirect back to the client with an error. */
  | { ok: false; redirect: true; redirectUri: string; state: string | null; error: string; description: string }
  /** Client or redirect URI unknown: show an error page, never redirect. */
  | { ok: false; redirect: false; description: string }
  | { ok: true; params: AuthorizeParams };

/**
 * Validate an authorization request against the registered client. Errors in
 * client_id or redirect_uri are shown on the page; anything else is returned
 * to the (verified) redirect URI, per RFC 6749 4.1.2.1.
 */
export function checkAuthorize(
  q: Record<string, string | undefined>,
  client: { redirectUris: string[] } | null,
): AuthorizeCheck {
  if (!q.client_id || !client) return { ok: false, redirect: false, description: 'Unknown application (client_id).' };
  const redirectUri = q.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !client.redirectUris.some((r) => redirectMatches(r, redirectUri))) {
    return { ok: false, redirect: false, description: 'The redirect address does not match what this application registered.' };
  }
  const state = q.state ?? null;
  const back = (error: string, description: string): AuthorizeCheck => ({ ok: false, redirect: true, redirectUri, state, error, description });
  if (q.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
  if (q.code_challenge_method !== 'S256' || !validChallenge(q.code_challenge)) {
    return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }
  const resource = q.resource ?? null;
  if (resource && !(RESOURCES as readonly string[]).includes(resource)) {
    return back('invalid_target', 'Unknown resource.');
  }
  return { ok: true, params: { clientId: q.client_id, redirectUri, state, codeChallenge: q.code_challenge, resource } };
}

/**
 * Exact match, except that a loopback redirect may use any port (RFC 8252
 * 7.3): native apps pick a free port at run time.
 */
export function redirectMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  try {
    const a = new URL(registered);
    const b = new URL(requested);
    return (
      a.protocol === 'http:' && b.protocol === 'http:' && LOOPBACK.has(a.hostname) && a.hostname === b.hostname &&
      a.pathname === b.pathname && a.search === b.search && !b.hash && !b.username && !b.password
    );
  } catch {
    return false;
  }
}

export function redirectWith(redirectUri: string, params: Record<string, string | null>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}

/** OAuth error body for the token and registration endpoints. */
export function oauthError(error: string, description: string) {
  return { error, error_description: description };
}

export interface TokenPair {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}
