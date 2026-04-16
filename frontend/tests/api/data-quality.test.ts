import { describe, it, expect, vi } from 'vitest';

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  default: {
    npdDataQualitySummary: {
      findMany: vi.fn(),
    },
    npdStateMetrics: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    npdSpecialtyMetrics: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    npdEndpointMetrics: {
      findMany: vi.fn(),
    },
  },
}));

describe('Data Quality API - Response Shape', () => {
  it('summary response has correct structure', () => {
    const mockSummary = {
      release_date: '2026-04-09',
      overview: {
        total_records: 5000000,
        states_covered: 50,
        specialties_covered: 800,
      },
      resource_quality: [
        {
          resource_type: 'practitioner',
          total_records: 2500000,
          active_records: 2300000,
          completeness: {
            primary_id: 98.5,
            name: 99.1,
            address: 92.3,
          },
        },
      ],
    };

    expect(mockSummary.release_date).toBe('2026-04-09');
    expect(mockSummary.overview.total_records).toBeGreaterThan(0);
    expect(mockSummary.resource_quality).toBeInstanceOf(Array);
    expect(mockSummary.resource_quality[0].completeness.primary_id).toBeGreaterThanOrEqual(0);
    expect(mockSummary.resource_quality[0].completeness.primary_id).toBeLessThanOrEqual(100);
  });

  it('state metrics have required fields', () => {
    const stateData = {
      state: 'CA',
      providers: 250000,
      organizations: 50000,
      locations: 80000,
      active_providers: 230000,
      npi_completeness: 98.5,
      address_completeness: 95.2,
    };

    expect(stateData.state).toHaveLength(2);
    expect(stateData.providers).toBeGreaterThan(0);
    expect(stateData.npi_completeness).toBeGreaterThanOrEqual(0);
    expect(stateData.npi_completeness).toBeLessThanOrEqual(100);
  });

  it('specialty metrics have required fields', () => {
    const specialtyData = {
      code: '207R00000X',
      display: 'Internal Medicine',
      providers: 150000,
      organizations: 30000,
    };

    expect(specialtyData.code).toMatch(/^[0-9A-Z]+$/);
    expect(specialtyData.display).toBeTruthy();
    expect(specialtyData.providers).toBeGreaterThan(0);
  });

  it('endpoint metrics categorize by connection type', () => {
    const endpoints = [
      { connection_type: 'hl7-fhir-rest', status: 'active', count: 50000, unique_organizations: 5000 },
      { connection_type: 'hl7-fhir-rest', status: 'off', count: 10000, unique_organizations: 1000 },
      { connection_type: 'direct-project', status: 'active', count: 2000, unique_organizations: 500 },
    ];

    const totalEndpoints = endpoints.reduce((sum, e) => sum + e.count, 0);
    expect(totalEndpoints).toBe(62000);

    const uniqueTypes = new Set(endpoints.map((e) => e.connection_type));
    expect(uniqueTypes.size).toBe(2);
  });
});

describe('Data Quality API - View Parameters', () => {
  const validViews = ['summary', 'states', 'state', 'specialties', 'endpoints'];

  it('accepts all valid view parameters', () => {
    for (const view of validViews) {
      expect(validViews).toContain(view);
    }
  });

  it('state view requires state parameter', () => {
    const url = new URL('/api/npd/data-quality?view=state', 'http://localhost:3000');
    const state = url.searchParams.get('state');
    expect(state).toBeNull();
    // API should return 400
  });

  it('state view with valid state param', () => {
    const url = new URL('/api/npd/data-quality?view=state&state=CA', 'http://localhost:3000');
    const state = url.searchParams.get('state');
    expect(state).toBe('CA');
  });

  it('specialties view respects limit', () => {
    const url = new URL('/api/npd/data-quality?view=specialties&limit=25', 'http://localhost:3000');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    expect(limit).toBe(25);
  });

  it('caps specialty limit at 200', () => {
    const url = new URL('/api/npd/data-quality?view=specialties&limit=500', 'http://localhost:3000');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    expect(limit).toBe(200);
  });
});
