import type { AinpiLink, Network, NetworkRoute, NetworksPayload, UseCaseSlug } from '@/lib/api-v1-types';
import { FINDINGS } from '@/data/findings';

export const JURISDICTIONS: readonly string[] = [
  'AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA', 'HI', 'IA', 'ID', 'IL', 'IN', 'KS', 'KY',
  'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV', 'WY',
];

const USE_CASES: readonly UseCaseSlug[] = [
  'treatment-records', 'individual-access', 'find-endpoint', 'payer-exchange',
  'encounter-alerts', 'public-health', 'community-referral',
];
export const DEFAULT_USE_CASE: UseCaseSlug = 'treatment-records';
export const STALE_AFTER_DAYS = 180;

export type StateCategory = 'none' | 'state_hie' | 'multi_state' | 'both';
export interface Overlays { state_hie: boolean; multi_state: boolean }

export function parseUseCase(raw: string | string[] | undefined): UseCaseSlug {
  return typeof raw === 'string' && (USE_CASES as readonly string[]).includes(raw)
    ? (raw as UseCaseSlug)
    : DEFAULT_USE_CASE;
}

function utcDay(s: string): number {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function isStale(lastChecked: string, asOf: Date): boolean {
  const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return (asOfDay - utcDay(lastChecked)) / 86_400_000 > STALE_AFTER_DAYS;
}

export function routesFor(p: NetworksPayload, useCase: UseCaseSlug): NetworkRoute[] {
  return p.routes.filter((r) => r.use_case === useCase);
}

function attached(n: Network, r: NetworkRoute): boolean {
  if (!r.network_types.includes(n.type)) return false;
  return n.detail_level === 'full' ? n.routes.includes(r.id) : true;
}

export function networksForRoute(p: NetworksPayload, routeId: string, state: string | null): Network[] {
  const r = p.routes.find((x) => x.id === routeId);
  if (!r) return [];
  return p.networks.filter((n) => attached(n, r) && (n.national || (state !== null && n.states.includes(state))));
}

export function stateCategory(
  p: NetworksPayload,
  useCase: UseCaseSlug,
  state: string,
  overlays: Overlays = { state_hie: true, multi_state: true },
): { category: StateCategory; verified: boolean } {
  const routes = routesFor(p, useCase);
  let hie = false;
  let multi = false;
  let verified = true;
  for (const n of p.networks) {
    if (n.national || !n.states.includes(state)) continue;
    if (n.type !== 'state_hie' && n.type !== 'multi_state') continue;
    if (!overlays[n.type]) continue;
    if (!routes.some((r) => attached(n, r))) continue;
    if (n.type === 'state_hie') hie = true; else multi = true;
    if (n.detail_level !== 'full') verified = false;
  }
  const category: StateCategory = hie && multi ? 'both' : hie ? 'state_hie' : multi ? 'multi_state' : 'none';
  return { category, verified };
}

export function networksInState(p: NetworksPayload, state: string): { local: Network[]; national: Network[] } {
  return {
    local: p.networks.filter((n) => !n.national && n.states.includes(state)),
    national: p.networks.filter((n) => n.national),
  };
}

export function resolveAinpiLink(link: AinpiLink): { label: string; href: string } | null {
  if (link.finding_slug) {
    const f = FINDINGS.find((x) => x.slug === link.finding_slug);
    return f && f.status === 'published' ? { label: link.label, href: `/findings/${f.slug}` } : null;
  }
  return link.href && isInternalPath(link.href) ? { label: link.label, href: link.href } : null;
}

const SITE_ORIGIN = 'https://ainpi.dev';
// ASCII control characters (including tab, CR, LF) and any whitespace. The URL
// parser strips tab and newline, so `/\t/evil.com` would otherwise resolve to
// `https://evil.com/`.
const UNSAFE_PATH_CHARS = /[\u0000-\u001f\u007f\s]/;

/**
 * An AINPI link's `href` must be a path on this site. It must start with `/`,
 * contain no control characters or whitespace, and resolve against the site
 * origin to that same origin, which rejects `//host`, `/\\host` and anything
 * else the URL parser would send off-site.
 */
function isInternalPath(href: string): boolean {
  if (typeof href !== 'string' || !href.startsWith('/') || UNSAFE_PATH_CHARS.test(href)) return false;
  try {
    return new URL(href, SITE_ORIGIN).origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Validate an external URL from networks.json before it reaches an `href`.
 *
 * CodeQL's stored-XSS analysis flags any string read from a data file and
 * rendered as an anchor `href`, even though networks.json is authored by us
 * and checked by `analysis/validate_contract.py`. The check is also real
 * defence: nothing else restricts the scheme, so a `javascript:` or `data:`
 * URL in the file would otherwise render as a live link. Only a URL that
 * parses and whose protocol is exactly `https:` is returned; anything else is
 * null, and callers render the label as plain text instead of a link. The
 * returned value is the parsed, normalised href.
 */
export function safeExternalHref(url: string): string | null {
  if (typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
  return parsed.href;
}

export function oldestCheck(p: NetworksPayload): string | null {
  if (p.networks.length === 0) return null;
  return p.networks.map((n) => n.last_checked).reduce((a, b) => (a < b ? a : b));
}
