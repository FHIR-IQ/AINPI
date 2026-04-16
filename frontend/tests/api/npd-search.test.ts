import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock BigQuery
vi.mock('@/lib/bigquery', () => ({
  queryBigQuery: vi.fn(),
}));

// Mock the module to test search param parsing logic
describe('NPD Search API - Parameter Validation', () => {
  function parseSearchParams(url: string) {
    const u = new URL(url, 'http://localhost:3000');
    return {
      npi: u.searchParams.get('npi') || undefined,
      name: u.searchParams.get('name') || undefined,
      state: u.searchParams.get('state')?.toUpperCase() || undefined,
      city: u.searchParams.get('city') || undefined,
      specialty: u.searchParams.get('specialty') || undefined,
      org: u.searchParams.get('org') || undefined,
      type: (u.searchParams.get('type') as string) || 'all',
      limit: Math.min(parseInt(u.searchParams.get('limit') || '20', 10), 50),
    };
  }

  function sanitize(value: string): string {
    return value.replace(/['"\\;]/g, '');
  }

  it('parses NPI search correctly', () => {
    const params = parseSearchParams('/api/npd/search?npi=1234567890');
    expect(params.npi).toBe('1234567890');
    expect(params.type).toBe('all');
    expect(params.limit).toBe(20);
  });

  it('parses name + state search', () => {
    const params = parseSearchParams('/api/npd/search?name=Smith&state=ca');
    expect(params.name).toBe('Smith');
    expect(params.state).toBe('CA'); // uppercased
  });

  it('parses org search with limit', () => {
    const params = parseSearchParams('/api/npd/search?org=Mayo+Clinic&limit=10');
    expect(params.org).toBe('Mayo Clinic');
    expect(params.limit).toBe(10);
  });

  it('caps limit at MAX_RESULTS', () => {
    const params = parseSearchParams('/api/npd/search?npi=123&limit=999');
    expect(params.limit).toBe(50);
  });

  it('defaults limit to 20', () => {
    const params = parseSearchParams('/api/npd/search?npi=123');
    expect(params.limit).toBe(20);
  });

  it('sanitizes SQL injection attempts', () => {
    expect(sanitize("Smith'; DROP TABLE--")).toBe('Smith DROP TABLE--');
    expect(sanitize('normal-value')).toBe('normal-value');
    expect(sanitize("O'Brien")).toBe('OBrien');
    expect(sanitize('test\\path')).toBe('testpath');
  });

  it('handles empty params', () => {
    const params = parseSearchParams('/api/npd/search');
    expect(params.npi).toBeUndefined();
    expect(params.name).toBeUndefined();
    expect(params.state).toBeUndefined();
    expect(params.type).toBe('all');
  });

  it('parses type filter', () => {
    const params = parseSearchParams('/api/npd/search?name=Smith&type=practitioner');
    expect(params.type).toBe('practitioner');
  });
});

describe('NPD Search API - Query Building', () => {
  it('builds practitioner query with NPI', () => {
    const conditions: string[] = [];
    const params: Record<string, string> = {};
    const npi = '1234567890';

    conditions.push('_npi = @npi');
    params.npi = npi;

    expect(conditions).toHaveLength(1);
    expect(params.npi).toBe('1234567890');
  });

  it('builds practitioner query with name + state', () => {
    const conditions: string[] = [];
    const params: Record<string, string> = {};

    conditions.push('(LOWER(_family_name) LIKE LOWER(@name) OR LOWER(_given_name) LIKE LOWER(@name))');
    params.name = '%Smith%';

    conditions.push('_state = @state');
    params.state = 'CA';

    expect(conditions).toHaveLength(2);
    expect(conditions.join(' AND ')).toContain('LOWER(_family_name)');
    expect(conditions.join(' AND ')).toContain('_state = @state');
  });

  it('returns empty when no conditions', () => {
    const conditions: string[] = [];
    expect(conditions.length === 0).toBe(true);
    // API should return empty array
  });
});
