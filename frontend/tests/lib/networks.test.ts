import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { Network, NetworkRoute, NetworksPayload } from '@/lib/api-v1-types';
import {
  JURISDICTIONS, DEFAULT_USE_CASE, parseUseCase, isStale, routesFor, networksForRoute,
  stateCategory, networksInState, resolveAinpiLink, oldestCheck, safeExternalHref,
} from '@/lib/networks';

const PUB: ReadonlySet<string> = new Set(['endpoint-url-validity']);
const src = [{ url: 'https://example.org', title: 't', accessed: '2026-11-01', primary: true }];
const route = (id: string, use_case: NetworkRoute['use_case'], network_types: NetworkRoute['network_types']): NetworkRoute => ({
  id, use_case, title: id, summary: '', who_can_use: '', rule: '', standard: '', how_to_join: '',
  network_types, sources: src, ainpi_links: [],
});
const net = (o: Partial<Network> & Pick<Network, 'id' | 'type'>): Network => ({
  name: o.id, national: false, states: [], detail_level: 'full', routes: [], website: 'https://example.org',
  how_to_join: '', sources: src, last_checked: '2026-10-01', ...o,
});
const p: NetworksPayload = {
  schema_version: 1, generated_at: '2026-11-06', use_cases: [], glossary: [],
  routes: [
    route('t1', 'treatment-records', ['state_hie', 'multi_state', 'qhin']),
    route('t2', 'treatment-records', ['vendor_network']),
    route('p1', 'public-health', ['state_hie']),
  ],
  networks: [
    net({ id: 'pa-hie', type: 'state_hie', states: ['PA'], routes: ['p1'] }),
    net({ id: 'nj-hie', type: 'state_hie', states: ['NJ'], detail_level: 'basic', last_checked: '2026-08-01' }),
    net({ id: 'ms', type: 'multi_state', states: ['MD', 'DC'], routes: ['t1'] }),
    net({ id: 'qhin', type: 'qhin', national: true, routes: ['t1'] }),
    net({ id: 'va-hie', type: 'state_hie', states: ['VA'], routes: ['t1'] }),
    net({ id: 'va-ms', type: 'multi_state', states: ['VA'], routes: ['t1'] }),
  ],
};
const byId = (ns: Network[]) => ns.map((n) => n.id).sort();

describe('networks helpers', () => {
  it('parseUseCase', () => {
    expect(parseUseCase('public-health')).toBe('public-health');
    for (const v of ['bogus', undefined, '', ['a', 'b']]) expect(parseUseCase(v as never)).toBe(DEFAULT_USE_CASE);
    expect(DEFAULT_USE_CASE).toBe('treatment-records');
  });
  it('isStale', () => {
    expect(isStale('2026-05-10', new Date('2026-11-06'))).toBe(false);
    expect(isStale('2026-05-09', new Date('2026-11-06'))).toBe(true);
  });
  it('JURISDICTIONS', () => {
    expect(JURISDICTIONS.length).toBe(51);
    expect(JURISDICTIONS).toContain('DC');
    expect(JURISDICTIONS).not.toContain('PR');
  });
  it('routesFor', () => {
    expect(routesFor(p, 'treatment-records').map((r) => r.id)).toEqual(['t1', 't2']);
  });
  it('stateCategory', () => {
    expect(stateCategory(p, 'treatment-records', 'PA')).toEqual({ category: 'none', verified: true });
    expect(stateCategory(p, 'public-health', 'PA')).toEqual({ category: 'state_hie', verified: true });
    expect(stateCategory(p, 'treatment-records', 'NJ')).toEqual({ category: 'state_hie', verified: false });
    expect(stateCategory(p, 'treatment-records', 'MD')).toEqual({ category: 'multi_state', verified: true });
    expect(stateCategory(p, 'treatment-records', 'WY')).toEqual({ category: 'none', verified: true });
  });
  it('basic network does not count for a use case whose routes exclude its type', () => {
    expect(stateCategory(p, 'public-health', 'NJ').category).toBe('state_hie');
    const q: NetworksPayload = { ...p, routes: [route('v', 'treatment-records', ['vendor_network'])] };
    expect(stateCategory(q, 'treatment-records', 'NJ')).toEqual({ category: 'none', verified: true });
  });
  it('overlays', () => {
    expect(stateCategory(p, 'treatment-records', 'VA').category).toBe('both');
    expect(stateCategory(p, 'treatment-records', 'VA', { state_hie: false, multi_state: true }).category).toBe('multi_state');
    expect(stateCategory(p, 'treatment-records', 'VA', { state_hie: false, multi_state: false }).category).toBe('none');
  });
  it('networksInState', () => {
    const r = networksInState(p, 'WY');
    expect(r.local).toEqual([]);
    expect(byId(r.national)).toEqual(['qhin']);
    expect(byId(networksInState(p, 'MD').local)).toEqual(['ms']);
  });
  it('networksForRoute', () => {
    expect(byId(networksForRoute(p, 't1', 'MD'))).toEqual(['ms', 'qhin']);
    expect(byId(networksForRoute(p, 't1', null))).toEqual(['qhin']);
    expect(byId(networksForRoute(p, 't1', 'NJ'))).toEqual(['nj-hie', 'qhin']);
    expect(byId(networksForRoute(p, 'p1', 'PA'))).toEqual(['pa-hie']);
  });
  it('resolveAinpiLink', () => {
    expect(resolveAinpiLink({ label: 'x', finding_slug: 'endpoint-url-validity' }, PUB)).toEqual({ label: 'x', href: '/findings/endpoint-url-validity' });
    expect(resolveAinpiLink({ label: 'x', finding_slug: 'payer-seed-coverage' }, PUB)).toBeNull();
    expect(resolveAinpiLink({ label: 'x', finding_slug: 'endpoint-url-validity' }, new Set())).toBeNull();
    expect(resolveAinpiLink({ label: 'x', href: '/states/pa/connectivity' }, PUB)).toEqual({ label: 'x', href: '/states/pa/connectivity' });
    expect(resolveAinpiLink({ label: 'x' }, PUB)).toBeNull();
  });
  it('resolveAinpiLink accepts only single-slash internal paths', () => {
    expect(resolveAinpiLink({ label: 'x', href: '/states/pa/connectivity' }, PUB)?.href).toBe('/states/pa/connectivity');
    expect(resolveAinpiLink({ label: 'x', href: '//evil.com' }, PUB)).toBeNull();
    expect(resolveAinpiLink({ label: 'x', href: 'https://x' }, PUB)).toBeNull();
    expect(resolveAinpiLink({ label: 'x', href: 'javascript:alert(1)' }, PUB)).toBeNull();
    expect(resolveAinpiLink({ label: 'x', href: '/\t/evil.com' }, PUB)).toBeNull();
    expect(resolveAinpiLink({ label: 'x', href: '/\n/evil.com' }, PUB)).toBeNull();
    expect(resolveAinpiLink({ label: 'x', href: '/ /evil.com' }, PUB)).toBeNull();
    expect(resolveAinpiLink({ label: 'x', href: '/\\evil.com' }, PUB)).toBeNull();
  });
  it('safeExternalHref keeps only https URLs', () => {
    expect(safeExternalHref('https://example.org/a?b=1')).toBe('https://example.org/a?b=1');
    expect(safeExternalHref('http://example.org')).toBeNull();
    expect(safeExternalHref('javascript:alert(1)')).toBeNull();
    expect(safeExternalHref('JavaScript:alert(1)')).toBeNull();
    expect(safeExternalHref('data:text/html,<b>x</b>')).toBeNull();
    expect(safeExternalHref('/relative/path')).toBeNull();
    expect(safeExternalHref('not a url')).toBeNull();
    expect(safeExternalHref('https://')).toBeNull();
  });
  it('oldestCheck', () => {
    expect(oldestCheck(p)).toBe('2026-08-01');
    expect(oldestCheck({ ...p, networks: [] })).toBeNull();
  });
});

describe('client bundle boundary', () => {
  it('no client-reachable networks module imports the findings catalog', () => {
    const root = path.resolve(__dirname, '../../src');
    for (const f of [
      'lib/networks.ts',
      'app/networks/networks-client.tsx',
      'components/charts/NetworkStateMap.tsx',
      'components/charts/network-map-style.ts',
    ]) {
      expect(fs.readFileSync(path.join(root, f), 'utf8'), f).not.toMatch(/@\/data\/findings|data\/findings/);
    }
  });
});
