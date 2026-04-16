import { describe, it, expect } from 'vitest';

// Replicate the extraction logic from ingest-cms-npd.ts for unit testing
function extractNpi(identifiers: Array<{ system?: string; value?: string }> | undefined): string | null {
  if (!identifiers) return null;
  const npiId = identifiers.find(
    (id) => id.system === 'http://hl7.org/fhir/sid/us-npi' || id.system === 'http://terminology.hl7.org/NamingSystem/npi'
  );
  return npiId?.value || null;
}

function extractPractitionerFields(r: Record<string, unknown>) {
  const names = r.name as Array<{ family?: string; given?: string[] }> | undefined;
  const addresses = r.address as Array<{ state?: string; city?: string; postalCode?: string }> | undefined;
  const identifiers = r.identifier as Array<{ system?: string; value?: string }> | undefined;
  return {
    _npi: extractNpi(identifiers),
    _family_name: names?.[0]?.family || null,
    _given_name: names?.[0]?.given?.[0] || null,
    _state: addresses?.[0]?.state || null,
    _city: addresses?.[0]?.city || null,
    _postal_code: addresses?.[0]?.postalCode || null,
  };
}

function extractOrganizationFields(r: Record<string, unknown>) {
  const identifiers = r.identifier as Array<{ system?: string; value?: string }> | undefined;
  const addresses = r.address as Array<{ state?: string; city?: string }> | undefined;
  const types = r.type as Array<{ coding?: Array<{ code?: string }> }> | undefined;
  return {
    _npi: extractNpi(identifiers),
    _state: addresses?.[0]?.state || null,
    _city: addresses?.[0]?.city || null,
    _org_type: types?.[0]?.coding?.[0]?.code || null,
  };
}

function extractEndpointFields(r: Record<string, unknown>) {
  const connectionType = r.connectionType as { code?: string } | undefined;
  const managingOrg = r.managingOrganization as { display?: string } | undefined;
  const mimeTypes = r.payloadMimeType as string[] | undefined;
  return {
    _connection_type_code: connectionType?.code || null,
    _managing_org_name: managingOrg?.display || null,
    _mime_types: mimeTypes?.join(',') || null,
  };
}

describe('FHIR Resource Field Extraction', () => {
  describe('extractNpi', () => {
    it('extracts NPI from standard identifier array', () => {
      const identifiers = [
        { system: 'http://hl7.org/fhir/sid/us-npi', value: '1234567890' },
        { system: 'http://example.com/other', value: 'other-id' },
      ];
      expect(extractNpi(identifiers)).toBe('1234567890');
    });

    it('returns null when no NPI identifier exists', () => {
      const identifiers = [{ system: 'http://example.com/other', value: 'other-id' }];
      expect(extractNpi(identifiers)).toBeNull();
    });

    it('returns null for undefined identifiers', () => {
      expect(extractNpi(undefined)).toBeNull();
    });

    it('returns null for empty array', () => {
      expect(extractNpi([])).toBeNull();
    });
  });

  describe('extractPractitionerFields', () => {
    it('extracts all fields from a complete practitioner resource', () => {
      const resource = {
        resourceType: 'Practitioner',
        id: '123',
        identifier: [{ system: 'http://hl7.org/fhir/sid/us-npi', value: '1234567890' }],
        name: [{ family: 'Smith', given: ['John', 'Michael'] }],
        address: [{ state: 'CA', city: 'San Francisco', postalCode: '94102' }],
      };

      const fields = extractPractitionerFields(resource);
      expect(fields._npi).toBe('1234567890');
      expect(fields._family_name).toBe('Smith');
      expect(fields._given_name).toBe('John');
      expect(fields._state).toBe('CA');
      expect(fields._city).toBe('San Francisco');
      expect(fields._postal_code).toBe('94102');
    });

    it('handles practitioner with minimal data', () => {
      const resource = { resourceType: 'Practitioner', id: '456' };
      const fields = extractPractitionerFields(resource);
      expect(fields._npi).toBeNull();
      expect(fields._family_name).toBeNull();
      expect(fields._given_name).toBeNull();
      expect(fields._state).toBeNull();
    });

    it('handles multiple names - uses first', () => {
      const resource = {
        name: [
          { family: 'Smith', given: ['John'] },
          { family: 'Jones', given: ['Jane'] },
        ],
      };
      const fields = extractPractitionerFields(resource);
      expect(fields._family_name).toBe('Smith');
      expect(fields._given_name).toBe('John');
    });
  });

  describe('extractOrganizationFields', () => {
    it('extracts org fields correctly', () => {
      const resource = {
        identifier: [{ system: 'http://hl7.org/fhir/sid/us-npi', value: '9876543210' }],
        address: [{ state: 'TX', city: 'Houston' }],
        type: [{ coding: [{ code: 'prov', display: 'Healthcare Provider' }] }],
      };

      const fields = extractOrganizationFields(resource);
      expect(fields._npi).toBe('9876543210');
      expect(fields._state).toBe('TX');
      expect(fields._city).toBe('Houston');
      expect(fields._org_type).toBe('prov');
    });

    it('handles missing type', () => {
      const resource = { identifier: [], address: [] };
      const fields = extractOrganizationFields(resource);
      expect(fields._org_type).toBeNull();
    });
  });

  describe('extractEndpointFields', () => {
    it('extracts endpoint fields correctly', () => {
      const resource = {
        connectionType: { code: 'hl7-fhir-rest' },
        managingOrganization: { display: 'Epic Systems' },
        payloadMimeType: ['application/fhir+json', 'application/json'],
      };

      const fields = extractEndpointFields(resource);
      expect(fields._connection_type_code).toBe('hl7-fhir-rest');
      expect(fields._managing_org_name).toBe('Epic Systems');
      expect(fields._mime_types).toBe('application/fhir+json,application/json');
    });

    it('handles missing fields', () => {
      const resource = {};
      const fields = extractEndpointFields(resource);
      expect(fields._connection_type_code).toBeNull();
      expect(fields._managing_org_name).toBeNull();
      expect(fields._mime_types).toBeNull();
    });
  });
});

describe('NDJSON line parsing', () => {
  it('parses valid NDJSON lines', () => {
    const line = '{"resourceType":"Practitioner","id":"test-1","active":true}';
    const parsed = JSON.parse(line);
    expect(parsed.resourceType).toBe('Practitioner');
    expect(parsed.id).toBe('test-1');
    expect(parsed.active).toBe(true);
  });

  it('handles complex nested FHIR resources', () => {
    const line = JSON.stringify({
      resourceType: 'Practitioner',
      id: 'test-2',
      identifier: [
        { system: 'http://hl7.org/fhir/sid/us-npi', value: '1111111111' },
      ],
      name: [{ family: 'Doe', given: ['Jane'], prefix: ['Dr.'] }],
      address: [
        {
          use: 'work',
          line: ['123 Main St', 'Suite 100'],
          city: 'Boston',
          state: 'MA',
          postalCode: '02101',
        },
      ],
      qualification: [
        {
          code: { coding: [{ system: 'http://nucc.org', code: '207R00000X' }] },
        },
      ],
    });

    const parsed = JSON.parse(line);
    const fields = extractPractitionerFields(parsed);
    expect(fields._npi).toBe('1111111111');
    expect(fields._family_name).toBe('Doe');
    expect(fields._state).toBe('MA');
    expect(fields._city).toBe('Boston');
  });

  it('rejects invalid JSON gracefully', () => {
    const line = '{"broken json';
    expect(() => JSON.parse(line)).toThrow();
  });
});
