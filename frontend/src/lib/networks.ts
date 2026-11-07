import {
  USE_CASE_SLUGS,
  type AinpiLink,
  type Network,
  type NetworkRoute,
  type NetworksPayload,
  type UseCaseSlug,
} from '@/lib/api-v1-types';
import { ALL_STATE_NAMES } from '@/data/states';

/** The 50 states and DC, as two-letter codes. */
export const JURISDICTIONS: readonly string[] = Object.keys(ALL_STATE_NAMES);

export const DEFAULT_USE_CASE: UseCaseSlug = 'treatment-records';
export const STALE_AFTER_DAYS = 180;

/**
 * `hidden`: the state has a matching network in our sources, but every one of
 * them belongs to an overlay the reader has switched off. Kept apart from
 * `none` so a display filter never reads as a statement about the sources.
 */
export type StateCategory = 'none' | 'hidden' | 'state_hie' | 'multi_state' | 'both';
export interface Overlays { state_hie: boolean; multi_state: boolean }

export function parseUseCase(raw: string | string[] | undefined): UseCaseSlug {
  return typeof raw === 'string' && (USE_CASE_SLUGS as readonly string[]).includes(raw)
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
  let filteredOut = false;
  let verified = true;
  for (const n of p.networks) {
    if (n.national || !n.states.includes(state)) continue;
    if (n.type !== 'state_hie' && n.type !== 'multi_state') continue;
    if (!routes.some((r) => attached(n, r))) continue;
    if (!overlays[n.type]) {
      filteredOut = true;
      continue;
    }
    if (n.type === 'state_hie') hie = true; else multi = true;
    if (n.detail_level !== 'full') verified = false;
  }
  if (!hie && !multi) return { category: filteredOut ? 'hidden' : 'none', verified: true };
  const category: StateCategory = hie && multi ? 'both' : hie ? 'state_hie' : 'multi_state';
  return { category, verified };
}

export function networksInState(p: NetworksPayload, state: string): { local: Network[]; national: Network[] } {
  return {
    local: p.networks.filter((n) => !n.national && n.states.includes(state)),
    national: p.networks.filter((n) => n.national),
  };
}

/**
 * Resolve an AINPI link to a label and an internal href, or null. `published`
 * holds the slugs of published findings; it is computed on the server
 * (`publishedFindingSlugs` in networks-published.ts) so the findings catalog
 * never reaches the client bundle. A link to an unpublished finding falls back
 * to its `href` when it has one, and is otherwise dropped.
 */
export function resolveAinpiLink(
  link: AinpiLink,
  published: ReadonlySet<string>,
): { label: string; href: string } | null {
  if (link.finding_slug && published.has(link.finding_slug)) {
    return { label: link.label, href: `/findings/${link.finding_slug}` };
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
