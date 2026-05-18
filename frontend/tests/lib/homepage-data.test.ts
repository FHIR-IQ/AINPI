import { describe, it, expect } from 'vitest';
import { loadHomepageMapData, type MapMetric } from '@/lib/homepage-data';

describe('loadHomepageMapData', () => {
  it('returns one entry per published state (50 + DC + PR = 52)', () => {
    const data = loadHomepageMapData();
    expect(data.states.length).toBeGreaterThanOrEqual(51);
    expect(data.states.length).toBeLessThanOrEqual(52);
    expect(data.states.every((s) => /^[A-Z]{2}$/.test(s.code))).toBe(true);
  });

  it('each state carries the 5 metric values', () => {
    const data = loadHomepageMapData();
    const va = data.states.find((s) => s.code === 'VA');
    expect(va).toBeDefined();
    expect(typeof va!.metrics.cohortSize).toBe('number');
    expect(typeof va!.metrics.strictPostExclusion).toBe('number');
    expect(typeof va!.metrics.deactivatedStillBilling).toBe('number');
    expect(typeof va!.metrics.industryPaymentsPostExclusion).toBe('number');
    expect(typeof va!.metrics.compositeRiskScore).toBe('number');
  });

  it('cohort size matches the published cohort CSV row count', () => {
    const data = loadHomepageMapData();
    const va = data.states.find((s) => s.code === 'VA');
    expect(va!.metrics.cohortSize).toBeGreaterThan(100);
    expect(va!.metrics.cohortSize).toBeLessThan(200);
  });

  it('each state entry carries an audit summary', () => {
    const data = loadHomepageMapData();
    const va = data.states.find((s) => s.code === 'VA');
    expect(va!.audit).toBeDefined();
    expect(typeof va!.audit.medicaid.fullWindowMatches).toBe('number');
    expect(typeof va!.audit.medicaid.strictPaid).toBe('number');
    expect(typeof va!.audit.partbPartd.partbMatches).toBe('number');
    expect(typeof va!.audit.partbPartd.opioidPrescribers).toBe('number');
    expect(typeof va!.audit.deactivatedBilling.matches).toBe('number');
    expect(typeof va!.audit.industryPayments.strictMatches).toBe('number');
    // VA has a cohort, so sampleNpi must be a 10-digit NPI.
    expect(va!.audit.sampleNpi).toMatch(/^\d{10}$/);
  });

  it('release metadata is populated from stats.json', () => {
    const data = loadHomepageMapData();
    expect(data.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.methodologyVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('compositeRiskScore is between 0 and 100 inclusive', () => {
    const data = loadHomepageMapData();
    for (const s of data.states) {
      expect(s.metrics.compositeRiskScore).toBeGreaterThanOrEqual(0);
      expect(s.metrics.compositeRiskScore).toBeLessThanOrEqual(100);
    }
  });

  it('the metrics list is exposed for the UI', () => {
    const data = loadHomepageMapData();
    const slugs = data.availableMetrics.map((m) => m.slug);
    expect(slugs).toEqual([
      'cohortSize',
      'strictPostExclusion',
      'deactivatedStillBilling',
      'industryPaymentsPostExclusion',
      'compositeRiskScore',
    ]);
    expect(data.availableMetrics[0].label).toBe('Critical cohort size');
  });
});
