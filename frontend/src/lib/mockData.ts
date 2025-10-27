/**
 * Mock data providers for POC demo
 * This replaces the backend services for a serverless deployment
 */

export interface MockPractitioner {
  id: string;
  fhir_id: string;
  npi: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  suffix?: string;
  gender?: string;
  email: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  status: string;
  completeness: number;
  verified: boolean;
  specialty?: string;
  specialty_code?: string;
}

export interface MockNPPESData {
  resourceType: string;
  identifier: Array<{ system: string; value: string }>;
  active: boolean;
  name: Array<{
    use: string;
    family: string;
    given: string[];
    prefix?: string[];
    suffix?: string[];
  }>;
  telecom: Array<{
    system: string;
    value: string;
    use: string;
  }>;
  address: Array<{
    use: string;
    type: string;
    line: string[];
    city: string;
    state: string;
    postalCode: string;
    country: string;
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
    issuer: { display: string };
  }>;
}

// Default mock practitioner for POC
export const getDefaultPractitioner = (): MockPractitioner => ({
  id: 'poc-practitioner-1',
  fhir_id: 'prac-poc-001',
  npi: '1234567890',
  first_name: 'Sarah',
  middle_name: 'Marie',
  last_name: 'Smith',
  suffix: 'MD',
  gender: 'female',
  email: 'dr.sarah.smith@example.com',
  phone: '(555) 987-6543',
  address_line1: '100 Main Street',
  address_line2: 'Suite 200',
  city: 'Cambridge',
  state: 'MA',
  postal_code: '02139',
  status: 'active',
  completeness: 95,
  verified: true,
  specialty: 'Internal Medicine',
  specialty_code: '207R00000X',
});

// Mock NPPES data generator
export const getMockNPPESData = (npi: string): MockNPPESData => {
  const specialties = [
    { code: '207R00000X', display: 'Internal Medicine' },
    { code: '207RC0000X', display: 'Cardiovascular Disease' },
    { code: '208D00000X', display: 'General Practice' },
    { code: '208600000X', display: 'Surgery' },
    { code: '208000000X', display: 'Pediatrics' },
  ];

  const specialty = specialties[Math.floor(Math.random() * specialties.length)];

  return {
    resourceType: 'Practitioner',
    identifier: [
      {
        system: 'http://hl7.org/fhir/sid/us-npi',
        value: npi,
      },
    ],
    active: true,
    name: [
      {
        use: 'official',
        family: 'Johnson', // Intentionally different for demo
        given: ['Sarah', 'Marie'],
        prefix: ['Dr.'],
        suffix: ['MD'],
      },
    ],
    telecom: [
      {
        system: 'phone',
        value: '(555) 123-4567', // Different from ProviderCard
        use: 'work',
      },
      {
        system: 'email',
        value: 'sarah.johnson@nppes-mock.gov',
        use: 'work',
      },
    ],
    address: [
      {
        use: 'work',
        type: 'both',
        line: ['123 Medical Plaza', 'Suite 450'], // Different address
        city: 'Boston',
        state: 'MA',
        postalCode: '02115',
        country: 'US',
      },
    ],
    gender: 'female',
    qualification: [
      {
        code: {
          coding: [
            {
              system: 'http://nucc.org/provider-taxonomy',
              code: specialty.code,
              display: specialty.display,
            },
          ],
          text: specialty.display,
        },
        issuer: {
          display: 'American Board of Internal Medicine',
        },
      },
    ],
  };
};

// Convert practitioner to FHIR format for comparison
export const practitionerToFHIR = (practitioner: MockPractitioner): any => {
  return {
    resourceType: 'Practitioner',
    id: practitioner.fhir_id,
    identifier: [
      {
        system: 'http://hl7.org/fhir/sid/us-npi',
        value: practitioner.npi,
      },
    ],
    active: practitioner.status === 'active',
    name: [
      {
        use: 'official',
        family: practitioner.last_name,
        given: practitioner.middle_name
          ? [practitioner.first_name, practitioner.middle_name]
          : [practitioner.first_name],
        suffix: practitioner.suffix ? [practitioner.suffix] : [],
      },
    ],
    telecom: [
      ...(practitioner.phone
        ? [
            {
              system: 'phone',
              value: practitioner.phone,
              use: 'work',
            },
          ]
        : []),
      {
        system: 'email',
        value: practitioner.email,
        use: 'work',
      },
    ],
    address: practitioner.address_line1
      ? [
          {
            use: 'work',
            type: 'both',
            line: [
              practitioner.address_line1,
              ...(practitioner.address_line2 ? [practitioner.address_line2] : []),
            ],
            city: practitioner.city,
            state: practitioner.state,
            postalCode: practitioner.postal_code,
            country: 'US',
          },
        ]
      : [],
    gender: practitioner.gender,
    qualification:
      practitioner.specialty && practitioner.specialty_code
        ? [
            {
              code: {
                coding: [
                  {
                    system: 'http://nucc.org/provider-taxonomy',
                    code: practitioner.specialty_code,
                    display: practitioner.specialty,
                  },
                ],
                text: practitioner.specialty,
              },
            },
          ]
        : [],
  };
};

// Mock integrations
export const getMockIntegrations = () => {
  return [
    {
      id: 'int-1',
      name: 'Blue Cross Blue Shield MA',
      type: 'payer',
      status: 'connected',
      last_sync: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      sync_frequency: 'daily',
      data_shared: ['demographics', 'specialty', 'license'],
      logo_url: null,
    },
    {
      id: 'int-2',
      name: 'MA Board of Registration in Medicine',
      type: 'state_board',
      status: 'connected',
      last_sync: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      sync_frequency: 'weekly',
      data_shared: ['demographics', 'license', 'certifications'],
      logo_url: null,
    },
    {
      id: 'int-3',
      name: 'Mass General Brigham',
      type: 'health_system',
      status: 'connected',
      last_sync: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      sync_frequency: 'real-time',
      data_shared: ['demographics', 'specialty', 'practice_location'],
      logo_url: null,
    },
    {
      id: 'int-4',
      name: 'Aetna',
      type: 'payer',
      status: 'pending',
      last_sync: null,
      sync_frequency: 'daily',
      data_shared: [],
      logo_url: null,
    },
    {
      id: 'int-5',
      name: 'Medicare',
      type: 'payer',
      status: 'connected',
      last_sync: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      sync_frequency: 'weekly',
      data_shared: ['demographics', 'specialty', 'npi'],
      logo_url: null,
    },
  ];
};

// Compare NPPES with ProviderCard data
export const compareProviderData = (nppes: any, providercard: any) => {
  const discrepancies: any[] = [];

  // Extract helper functions
  const extractName = (nameArray: any[]) => {
    if (!nameArray || nameArray.length === 0) return null;
    const name = nameArray[0];
    return {
      given: name.given?.join(' ') || '',
      family: name.family || '',
      suffix: name.suffix?.join(' ') || '',
    };
  };

  const extractAddress = (addressArray: any[]) => {
    if (!addressArray || addressArray.length === 0) return null;
    const addr = addressArray[0];
    return {
      line: addr.line?.join(' ') || '',
      city: addr.city || '',
      state: addr.state || '',
      postalCode: addr.postalCode || '',
    };
  };

  const extractPhone = (telecomArray: any[]) => {
    if (!telecomArray) return null;
    const phone = telecomArray.find((t) => t.system === 'phone');
    return phone?.value || null;
  };

  // Compare names
  const nppesName = extractName(nppes.name);
  const providerCardName = extractName(providercard.name);

  if (nppesName && providerCardName) {
    if (nppesName.family !== providerCardName.family) {
      discrepancies.push({
        field: 'Last Name',
        nppes_value: nppesName.family,
        providercard_value: providerCardName.family,
        severity: 'high',
        recommendation: 'Update ProviderCard to match NPPES official record',
      });
    }

    if (nppesName.given !== providerCardName.given) {
      discrepancies.push({
        field: 'First/Middle Name',
        nppes_value: nppesName.given,
        providercard_value: providerCardName.given,
        severity: 'medium',
        recommendation: 'Consider updating to match NPPES format',
      });
    }
  }

  // Compare addresses
  const nppesAddr = extractAddress(nppes.address);
  const providerCardAddr = extractAddress(providercard.address);

  if (nppesAddr && providerCardAddr) {
    if (nppesAddr.line !== providerCardAddr.line) {
      discrepancies.push({
        field: 'Address',
        nppes_value: nppesAddr.line,
        providercard_value: providerCardAddr.line,
        severity: 'medium',
        recommendation: 'Verify which address is current',
      });
    }

    if (nppesAddr.city !== providerCardAddr.city) {
      discrepancies.push({
        field: 'City',
        nppes_value: nppesAddr.city,
        providercard_value: providerCardAddr.city,
        severity: 'high',
        recommendation: 'Update to match NPPES',
      });
    }
  }

  // Compare phone numbers
  const nppesPhone = extractPhone(nppes.telecom);
  const providerCardPhone = extractPhone(providercard.telecom);

  if (nppesPhone && providerCardPhone) {
    const normalizePhone = (phone: string) => phone.replace(/\D/g, '');
    if (normalizePhone(nppesPhone) !== normalizePhone(providerCardPhone)) {
      discrepancies.push({
        field: 'Phone Number',
        nppes_value: nppesPhone,
        providercard_value: providerCardPhone,
        severity: 'low',
        recommendation: 'ProviderCard may have more recent contact info',
      });
    }
  }

  // Compare specialty
  const nppesSpecialty = nppes.qualification?.[0]?.code?.text || '';
  const providerCardSpecialty = providercard.qualification?.[0]?.code?.text || '';

  if (nppesSpecialty && providerCardSpecialty && nppesSpecialty !== providerCardSpecialty) {
    discrepancies.push({
      field: 'Specialty',
      nppes_value: nppesSpecialty,
      providercard_value: providerCardSpecialty,
      severity: 'high',
      recommendation: 'Verify current specialty certification',
    });
  }

  // Calculate match score
  const totalFields = 6;
  const matchScore = ((totalFields - discrepancies.length) / totalFields) * 100;

  return {
    match_score: Math.round(matchScore * 10) / 10,
    total_discrepancies: discrepancies.length,
    discrepancies,
    high_severity_count: discrepancies.filter((d) => d.severity === 'high').length,
    medium_severity_count: discrepancies.filter((d) => d.severity === 'medium').length,
    low_severity_count: discrepancies.filter((d) => d.severity === 'low').length,
    nppes_data: nppes,
    providercard_data: providercard,
    comparison_timestamp: new Date().toISOString(),
  };
};

// Create FHIR bundle
export const createFHIRBundle = (practitioner: MockPractitioner) => {
  const practitionerResource = practitionerToFHIR(practitioner);

  const entries = [
    {
      fullUrl: `urn:uuid:${practitioner.fhir_id}`,
      resource: practitionerResource,
      request: {
        method: 'PUT',
        url: `Practitioner/${practitioner.fhir_id}`,
      },
    },
  ];

  // Add PractitionerRole if specialty exists
  if (practitioner.specialty && practitioner.specialty_code) {
    const roleResource = {
      resourceType: 'PractitionerRole',
      id: `${practitioner.fhir_id}-role-1`,
      practitioner: {
        reference: `Practitioner/${practitioner.fhir_id}`,
      },
      code: [
        {
          coding: [
            {
              system: 'http://nucc.org/provider-taxonomy',
              code: practitioner.specialty_code,
              display: practitioner.specialty,
            },
          ],
          text: practitioner.specialty,
        },
      ],
      specialty: [
        {
          coding: [
            {
              system: 'http://nucc.org/provider-taxonomy',
              code: practitioner.specialty_code,
              display: practitioner.specialty,
            },
          ],
          text: practitioner.specialty,
        },
      ],
      location: practitioner.address_line1
        ? [
            {
              display: `${practitioner.address_line1}, ${practitioner.city}, ${practitioner.state}`,
            },
          ]
        : [],
    };

    entries.push({
      fullUrl: `urn:uuid:${practitioner.fhir_id}-role-1`,
      resource: roleResource,
      request: {
        method: 'PUT',
        url: `PractitionerRole/${practitioner.fhir_id}-role-1`,
      },
    });
  }

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries,
  };
};
