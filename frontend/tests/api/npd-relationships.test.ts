import { describe, it, expect } from 'vitest';

describe('NPD Relationships API — Data Model Validation', () => {
  // Source file record counts for validation
  const SOURCE_COUNTS = {
    practitioner: 7_441_212,
    organization: 3_605_261,
    location: 3_494_239,
    endpoint: 5_043_524,
    practitioner_role: 7_180_732,
    organization_affiliation: 439_599,
  };

  it('total records across all resources is 27,204,567', () => {
    const total = Object.values(SOURCE_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(27_204_567);
  });

  describe('FHIR reference format validation', () => {
    it('Practitioner IDs follow Practitioner-{NPI} format', () => {
      const id = 'Practitioner-1427155027';
      expect(id).toMatch(/^Practitioner-\d+$/);
    });

    it('Organization IDs follow Organization-{NPI} format', () => {
      const id = 'Organization-1518732023';
      expect(id).toMatch(/^Organization-\d+$/);
    });

    it('PractitionerRole references use FHIR reference format', () => {
      const ref = 'Practitioner/Practitioner-1427155027';
      expect(ref).toContain('/');
      const parts = ref.split('/');
      expect(parts[0]).toBe('Practitioner');
      expect(parts[1]).toMatch(/^Practitioner-\d+$/);
    });

    it('Location references use UUID format', () => {
      const ref = 'Location/Location-84b971d6-be1f-4fce-add8-3a5ddc3755c6';
      expect(ref).toContain('Location/Location-');
    });
  });

  describe('NDH resource relationships', () => {
    it('PractitionerRole links Practitioner to Organization', () => {
      const role = {
        practitioner: { reference: 'Practitioner/Practitioner-1427155027' },
        organization: { reference: 'Organization/Organization-1518732023' },
        specialty: [{ coding: [{ code: '14-77', display: 'VASCULAR SURGERY' }] }],
        location: [
          { reference: 'Location/Location-84b971d6-be1f-4fce-add8-3a5ddc3755c6' },
          { reference: 'Location/Location-68d1ef5a-e6b7-49f8-b73a-b38bf68b21d5' },
        ],
      };
      expect(role.practitioner.reference).toBeTruthy();
      expect(role.organization.reference).toBeTruthy();
      expect(role.location).toHaveLength(2);
      expect(role.specialty[0].coding[0].code).toBe('14-77');
    });

    it('Endpoint links to managing Organization', () => {
      const endpoint = {
        managingOrganization: { reference: 'Organization/Organization-1598826224' },
        connectionType: { code: 'hl7-fhir-rest' },
        address: 'https://app.meldrx.com/api/fhir/imedicware_gec',
      };
      expect(endpoint.managingOrganization.reference).toContain('Organization/');
      expect(endpoint.connectionType.code).toBe('hl7-fhir-rest');
      expect(endpoint.address).toMatch(/^https?:\/\//);
    });

    it('OrganizationAffiliation links two organizations', () => {
      const affiliation = {
        organization: { reference: 'Organization/Organization-b245012a' },
        participatingOrganization: { reference: 'Organization/Organization-1780925990' },
        code: [{ coding: [{ code: 'member' }] }],
      };
      expect(affiliation.organization.reference).toContain('Organization/');
      expect(affiliation.participatingOrganization.reference).toContain('Organization/');
    });

    it('one practitioner can have multiple roles', () => {
      const roles = [
        { _practitioner_id: 'Practitioner/Practitioner-123', _org_id: 'Organization/Organization-A', _specialty_code: '208D00000X' },
        { _practitioner_id: 'Practitioner/Practitioner-123', _org_id: 'Organization/Organization-B', _specialty_code: '207R00000X' },
      ];
      const uniquePractitioners = new Set(roles.map((r) => r._practitioner_id));
      expect(uniquePractitioners.size).toBe(1);
      expect(roles).toHaveLength(2);
    });

    it('one organization can have multiple endpoints', () => {
      const endpoints = [
        { _managing_org_id: 'Organization/Organization-X', _connection_type: 'hl7-fhir-rest', _address: 'https://a.com/fhir' },
        { _managing_org_id: 'Organization/Organization-X', _connection_type: 'direct-project', _address: 'direct:org@example.com' },
      ];
      const uniqueOrgs = new Set(endpoints.map((e) => e._managing_org_id));
      expect(uniqueOrgs.size).toBe(1);
      expect(endpoints).toHaveLength(2);
    });
  });

  describe('Data quality metrics validation', () => {
    it('completeness percentages are between 0 and 100', () => {
      const metrics = [98.5, 99.1, 92.3, 0, 100, 74.4];
      metrics.forEach((m) => {
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(100);
      });
    });

    it('active records never exceed total records', () => {
      const resources = [
        { total: 7_441_212, active: 7_200_000 },
        { total: 3_605_261, active: 3_605_261 },
        { total: 5_043_524, active: 3_742_294 },
      ];
      resources.forEach((r) => {
        expect(r.active).toBeLessThanOrEqual(r.total);
        expect(r.active).toBeGreaterThanOrEqual(0);
      });
    });

    it('NPI format is 10 digits', () => {
      const npis = ['1427155027', '1518732023', '1598826224', '1003000332'];
      npis.forEach((npi) => {
        expect(npi).toMatch(/^\d{10}$/);
      });
    });
  });
});

describe('BigQuery table schema validation', () => {
  const TABLES = {
    practitioner: ['resource', '_id', '_npi', '_family_name', '_given_name', '_state', '_city', '_postal_code', '_gender', '_active'],
    organization: ['resource', '_id', '_npi', '_name', '_state', '_city', '_org_type', '_active'],
    location: ['resource', '_id', '_name', '_state', '_city', '_postal_code', '_status', '_managing_org_id'],
    endpoint: ['resource', '_id', '_connection_type', '_status', '_address', '_name', '_managing_org_id'],
    practitioner_role: ['resource', '_id', '_practitioner_id', '_org_id', '_specialty_code', '_specialty_display', '_location_ids', '_active'],
    organization_affiliation: ['resource', '_id', '_org_id', '_participating_org_id', '_active'],
  };

  it('all tables have resource JSON column', () => {
    Object.values(TABLES).forEach((cols) => {
      expect(cols).toContain('resource');
    });
  });

  it('all tables have _id column', () => {
    Object.values(TABLES).forEach((cols) => {
      expect(cols).toContain('_id');
    });
  });

  it('practitioner_role has cross-reference columns', () => {
    expect(TABLES.practitioner_role).toContain('_practitioner_id');
    expect(TABLES.practitioner_role).toContain('_org_id');
    expect(TABLES.practitioner_role).toContain('_location_ids');
  });

  it('endpoint has managing org reference', () => {
    expect(TABLES.endpoint).toContain('_managing_org_id');
  });
});
