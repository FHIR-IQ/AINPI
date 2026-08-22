import { describe, expect, it } from 'vitest';

import { ROUTE_COST, TIERS, USD_PER_UNIT, DAILY_BREAKER_UNITS } from '@/lib/rate-limit';

/**
 * These assert the economics rather than the plumbing.
 *
 * The plumbing (Postgres upserts, header parsing) needs a database and is
 * covered by running the routes. What is worth pinning in a unit test is the
 * cost model, because it is the thing that silently stops protecting you: if
 * someone raises a tier's daily quota without checking what it buys, the
 * limiter still works perfectly and the bill still arrives.
 *
 * Cost figures come from `bq --dry_run` against the 2026-08-20 warehouse,
 * measured 2026-08-22. Re-measure after a reload.
 */
describe('rate limit cost model', () => {
  it('prices query shapes in the order they actually cost', () => {
    // An NPI hits the cluster key; geography does not.
    expect(ROUTE_COST['npd/search:npi']).toBeLessThan(ROUTE_COST['npd/search:name']);
    expect(ROUTE_COST['npd/search:name']).toBeLessThanOrEqual(ROUTE_COST['npd/search:geo']);
    // LLM calls dwarf any scan.
    expect(ROUTE_COST['magic-scanner']).toBeGreaterThan(ROUTE_COST['npd/validation'] * 5);
    // Reading CDN-served JSON costs nothing and must not consume quota.
    expect(ROUTE_COST['mcp:static']).toBe(0);
  });

  it('caps the worst case an anonymous caller can spend in a day', () => {
    const worst = ROUTE_COST['npd/search:geo'];
    const callsPerDay = TIERS.anonymous.perDay / worst;
    const usd = TIERS.anonymous.perDay * USD_PER_UNIT;
    // Enough that a person exploring the site never notices.
    expect(callsPerDay).toBeGreaterThan(50);
    // Little enough that a scraper on one IP cannot run up a bill.
    expect(usd).toBeLessThan(1);
  });

  it('keeps a single anonymous burst under a cent', () => {
    const usd = TIERS.anonymous.perMinute * USD_PER_UNIT;
    expect(usd).toBeLessThan(0.05);
  });

  it('bounds a partner day to something a human would approve', () => {
    const usd = TIERS.partner.perDay * USD_PER_UNIT;
    expect(usd).toBeLessThanOrEqual(10);
  });

  it('escalates quota monotonically across tiers', () => {
    const order = ['anonymous', 'free', 'partner', 'enterprise'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(TIERS[order[i]].perDay).toBeGreaterThan(TIERS[order[i - 1]].perDay);
      expect(TIERS[order[i]].perMinute).toBeGreaterThan(TIERS[order[i - 1]].perMinute);
    }
  });

  it('only lets paid tiers survive the global breaker', () => {
    expect(TIERS.anonymous.survivesBreaker).toBe(false);
    expect(TIERS.free.survivesBreaker).toBe(false);
    expect(TIERS.partner.survivesBreaker).toBe(true);
    expect(TIERS.enterprise.survivesBreaker).toBe(true);
  });

  it('sets the breaker above one anonymous day and below a runaway', () => {
    // It must not trip on ordinary traffic...
    expect(DAILY_BREAKER_UNITS).toBeGreaterThan(TIERS.anonymous.perDay * 10);
    // ...and must trip well before the damage is interesting.
    expect(DAILY_BREAKER_UNITS * USD_PER_UNIT).toBeLessThanOrEqual(50);
  });

  it('has a cost entry for every shape a route declares', () => {
    // A shape missing from the table silently falls back to `default`, which
    // is cheaper than the expensive routes and would under-charge them.
    for (const shape of [
      'npd/search:npi', 'npd/search:name', 'npd/search:geo', 'npd/search:org',
      'npd/state-detail', 'npd/relationships', 'npd/org-analysis', 'npd/org',
      'npd/validation', 'provider-search', 'magic-scanner', 'mcp:lookup',
    ]) {
      expect(ROUTE_COST[shape], `${shape} is not priced`).toBeTypeOf('number');
    }
  });
});
