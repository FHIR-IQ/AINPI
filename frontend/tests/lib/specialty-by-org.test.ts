/**
 * Guards the payload behind /exploratory/specialty-by-organization.
 *
 * The page cites specific NPIs in outside conversation, and the sample is
 * drawn by hash so any given case can fall out on a re-run. The compute
 * script pins the cited ones and fails if they stop resolving; this asserts
 * the published file actually carries them, which is the half a Python-side
 * check cannot see.
 */
import { describe, expect, it } from 'vitest';
import { loadSpecialtyByOrg } from '@/lib/load-api-v1';

describe('specialty-by-organization payload', () => {
  const payload = loadSpecialtyByOrg();

  it('is published', () => {
    expect(payload, 'run analysis/explore_specialty_context.py').not.toBeNull();
  });

  it('publishes every pinned case, because they are cited elsewhere', () => {
    const npis = new Set(payload!.cases.map((c) => c.npi));
    for (const pinned of payload!.pinned) {
      expect(npis.has(pinned), `pinned case ${pinned} is missing`).toBe(true);
    }
  });

  it('only carries cases whose specialty actually differs between organizations', () => {
    // A case that reads the same at every organization would undercut the
    // whole page, so none should be in here.
    for (const c of payload!.cases) {
      expect(c.orgs.length).toBeGreaterThanOrEqual(2);
      const sets = new Set(c.orgs.map((o) => [...o.specialties].sort().join('|')));
      expect(sets.size, `${c.npi} shows the same specialty everywhere`).toBeGreaterThan(1);
    }
  });

  it('labels an organization that resolves to nothing rather than dropping it', () => {
    for (const c of payload!.cases) {
      for (const o of c.orgs) {
        expect(o.org.length).toBeGreaterThan(0);
        expect(o.specialties.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the stricter count below the record-level count', () => {
    // 89,061 counts organization records, 82,977 merges same-named ones. If
    // these ever invert, the caveat on the page is backwards.
    expect(payload!.population_distinct_org_name).toBeLessThan(payload!.population);
    expect(payload!.only_across_same_named_records).toBe(
      payload!.population - payload!.population_distinct_org_name,
    );
  });
});
