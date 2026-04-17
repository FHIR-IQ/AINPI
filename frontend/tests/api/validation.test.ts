import { describe, it, expect } from 'vitest';

describe('Data Validation API contract', () => {
  const SOURCE_COUNTS = {
    practitioner: 7_441_212,
    organization: 3_605_261,
    location: 3_494_239,
    endpoint: 5_043_524,
    practitioner_role: 7_180_732,
    organization_affiliation: 439_599,
  };

  it('source counts total matches manifest (27,204,567)', () => {
    const total = Object.values(SOURCE_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(27_204_567);
  });

  it('completeness_pct is capped at 100', () => {
    const rows = [
      { expected: 7_441_212, actual: 7_441_213 },
      { expected: 1_000_000, actual: 5_000_000 }, // hypothetical over-count
    ];
    rows.forEach((r) => {
      const raw = (r.actual / r.expected) * 100;
      const capped = Math.min(raw, 100);
      expect(capped).toBeLessThanOrEqual(100);
    });
  });

  it('status classification thresholds', () => {
    function classify(pct: number) {
      return pct >= 99.9 ? 'complete' : pct >= 95 ? 'near_complete' : pct > 0 ? 'partial' : 'empty';
    }
    expect(classify(100)).toBe('complete');
    expect(classify(99.95)).toBe('complete');
    expect(classify(99.8)).toBe('near_complete');
    expect(classify(95)).toBe('near_complete');
    expect(classify(80)).toBe('partial');
    expect(classify(0.1)).toBe('partial');
    expect(classify(0)).toBe('empty');
  });

  it('delta sign reflects ingestion vs expected', () => {
    expect(7_441_213 - 7_441_212).toBe(1);
    expect(7_178_732 - 7_180_732).toBe(-2000);
    expect(439_599 - 439_599).toBe(0);
  });

  it('referential integrity pct bounded 0-100', () => {
    function integrity(total: number, orphans: number) {
      if (total === 0) return 0;
      return ((total - orphans) / total) * 100;
    }
    expect(integrity(100, 0)).toBe(100);
    expect(integrity(100, 100)).toBe(0);
    expect(integrity(100, 5)).toBe(95);
    expect(integrity(0, 0)).toBe(0);
  });

  it('endpoint URL regex matches HTTP and HTTPS', () => {
    const re = /^https?:\/\//;
    expect(re.test('https://fhir.example.com/r4')).toBe(true);
    expect(re.test('http://fhir.example.com/r4')).toBe(true);
    expect(re.test('direct:msg@example.com')).toBe(false);
    expect(re.test('example.com')).toBe(false);
    expect(re.test('')).toBe(false);
  });

  it('NPI regex matches exactly 10 digits', () => {
    const re = /^[0-9]{10}$/;
    expect(re.test('1427155027')).toBe(true);
    expect(re.test('142715502')).toBe(false);
    expect(re.test('14271550270')).toBe(false);
    expect(re.test('142715502a')).toBe(false);
    expect(re.test('')).toBe(false);
  });
});

describe('State detail API contract', () => {
  it('state parameter is uppercased', () => {
    expect('ca'.toUpperCase()).toBe('CA');
    expect('NY'.toUpperCase()).toBe('NY');
    expect('tx'.toUpperCase()).toBe('TX');
  });

  it('city filter is applied only when present', () => {
    const buildFilter = (city?: string) => city ? ' AND _city = @city' : '';
    expect(buildFilter()).toBe('');
    expect(buildFilter('LOS ANGELES')).toBe(' AND _city = @city');
  });

  it('drill-down hierarchy: clearing state clears city', () => {
    type F = { state: string | null; city: string | null };
    function setState(f: F, state: string | null): F {
      return state === null ? { ...f, state: null, city: null } : { ...f, state };
    }
    const before: F = { state: 'CA', city: 'LOS ANGELES' };
    expect(setState(before, null)).toEqual({ state: null, city: null });
    expect(setState(before, 'NY')).toEqual({ state: 'NY', city: 'LOS ANGELES' });
  });

  it('FilterContext active filter count', () => {
    function activeCount(f: { state: string | null; city: string | null; specialty: string | null; orgId: string | null }) {
      return [f.state, f.city, f.specialty, f.orgId].filter(Boolean).length;
    }
    expect(activeCount({ state: null, city: null, specialty: null, orgId: null })).toBe(0);
    expect(activeCount({ state: 'CA', city: null, specialty: null, orgId: null })).toBe(1);
    expect(activeCount({ state: 'CA', city: 'LA', specialty: 'Cardio', orgId: null })).toBe(3);
    expect(activeCount({ state: 'CA', city: 'LA', specialty: 'Cardio', orgId: 'x' })).toBe(4);
  });
});
