/**
 * FHIR Conversion Utilities
 * Convert database models to/from FHIR resources
 */
import type { Practitioner, PractitionerRole } from '@prisma/client';

export interface FHIRPractitioner {
  resourceType: string;
  id: string;
  identifier: Array<{ system: string; value: string }>;
  active: boolean;
  name: Array<{
    use: string;
    family: string;
    given: string[];
    suffix?: string[];
  }>;
  telecom: Array<{
    system: string;
    value: string;
    use: string;
  }>;
  address?: Array<{
    use: string;
    type: string;
    line: string[];
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }>;
  gender?: string;
  qualification?: Array<{
    code: {
      coding: Array<{
        system: string;
        code: string;
        display: string;
      }>;
      text: string;
    };
  }>;
}

export interface FHIRPractitionerRole {
  resourceType: string;
  id: string;
  practitioner: { reference: string };
  code?: Array<{
    coding: Array<{
      system: string;
      code: string;
      display: string;
    }>;
    text: string;
  }>;
  specialty?: Array<{
    coding: Array<{
      system: string;
      code: string;
      display: string;
    }>;
    text: string;
  }>;
  location?: Array<{ display: string }>;
}

/**
 * Convert Practitioner database model to FHIR resource
 */
export function practitionerToFHIR(practitioner: Practitioner): FHIRPractitioner {
  const resource: FHIRPractitioner = {
    resourceType: 'Practitioner',
    id: practitioner.fhirId,
    identifier: [],
    active: practitioner.status !== 'inactive',
    name: [
      {
        use: 'official',
        family: practitioner.lastName,
        given: practitioner.middleName
          ? [practitioner.firstName, practitioner.middleName]
          : [practitioner.firstName],
        ...(practitioner.suffix && { suffix: [practitioner.suffix] }),
      },
    ],
    telecom: [
      {
        system: 'email',
        value: practitioner.email,
        use: 'work',
      },
    ],
  };

  // Add NPI identifier
  if (practitioner.npi) {
    resource.identifier.push({
      system: 'http://hl7.org/fhir/sid/us-npi',
      value: practitioner.npi,
    });
  }

  // Add phone
  if (practitioner.phone) {
    resource.telecom.push({
      system: 'phone',
      value: practitioner.phone,
      use: 'work',
    });
  }

  // Add address
  if (practitioner.addressLine1) {
    resource.address = [
      {
        use: 'work',
        type: 'both',
        line: [
          practitioner.addressLine1,
          ...(practitioner.addressLine2 ? [practitioner.addressLine2] : []),
        ],
        city: practitioner.city || undefined,
        state: practitioner.state || undefined,
        postalCode: practitioner.postalCode || undefined,
        country: practitioner.country || 'US',
      },
    ];
  }

  // Add gender
  if (practitioner.gender) {
    resource.gender = practitioner.gender;
  }

  return resource;
}

/**
 * Convert PractitionerRole database model to FHIR resource
 */
export function practitionerRoleToFHIR(
  role: PractitionerRole,
  practitionerFhirId: string
): FHIRPractitionerRole {
  const resource: FHIRPractitionerRole = {
    resourceType: 'PractitionerRole',
    id: role.fhirId,
    practitioner: {
      reference: `Practitioner/${practitionerFhirId}`,
    },
  };

  // Add specialty
  if (role.specialtyCode && role.specialtyDisplay) {
    resource.specialty = [
      {
        coding: [
          {
            system: 'http://nucc.org/provider-taxonomy',
            code: role.specialtyCode,
            display: role.specialtyDisplay,
          },
        ],
        text: role.specialtyDisplay,
      },
    ];

    resource.code = resource.specialty;
  }

  // Add location
  if (role.practiceAddressLine1 && role.practiceCity && role.practiceState) {
    resource.location = [
      {
        display: `${role.practiceAddressLine1}, ${role.practiceCity}, ${role.practiceState}`,
      },
    ];
  }

  return resource;
}

/**
 * Create a FHIR Bundle from practitioner and roles
 */
export function createFHIRBundle(
  practitioner: Practitioner,
  roles: PractitionerRole[] = []
) {
  const entries = [];

  // Add Practitioner resource
  const practitionerResource = practitionerToFHIR(practitioner);
  entries.push({
    fullUrl: `urn:uuid:${practitioner.fhirId}`,
    resource: practitionerResource,
    request: {
      method: 'PUT',
      url: `Practitioner/${practitioner.fhirId}`,
    },
  });

  // Add PractitionerRole resources
  for (const role of roles) {
    const roleResource = practitionerRoleToFHIR(role, practitioner.fhirId);
    entries.push({
      fullUrl: `urn:uuid:${role.fhirId}`,
      resource: roleResource,
      request: {
        method: 'PUT',
        url: `PractitionerRole/${role.fhirId}`,
      },
    });
  }

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries,
  };
}

/**
 * Calculate profile completeness percentage
 */
export function calculateCompleteness(practitioner: Practitioner): number {
  let score = 0;
  const checks = [
    practitioner.firstName,
    practitioner.lastName,
    practitioner.email,
    practitioner.npi,
    practitioner.phone,
    practitioner.addressLine1,
    practitioner.city,
    practitioner.state,
    practitioner.postalCode,
    practitioner.gender,
  ];

  score = checks.filter(Boolean).length;
  return Math.round((score / checks.length) * 100);
}
