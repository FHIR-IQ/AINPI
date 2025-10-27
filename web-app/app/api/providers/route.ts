import { NextRequest, NextResponse } from 'next/server';

interface ProviderData {
  npi: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  email: string;
  phone: string;
  specialties: Array<{ code: string; display: string; isPrimary: boolean }>;
  licenses: Array<{
    state: string;
    licenseNumber: string;
    type: string;
    status: string;
    expirationDate: string;
  }>;
  practiceLocations: Array<{
    name: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zipCode: string;
    phone: string;
    isPrimary: boolean;
  }>;
  insurancePlans: Array<{
    carrier: string;
    planName: string;
    lob: string;
    networkStatus: string;
    acceptingNewPatients: boolean;
  }>;
}

function validateProviderData(data: ProviderData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // General Info validation
  if (!data.firstName?.trim()) errors.push('First name is required');
  if (!data.lastName?.trim()) errors.push('Last name is required');
  if (!data.npi?.trim()) errors.push('NPI is required');
  if (data.npi && !/^\d{10}$/.test(data.npi)) {
    errors.push('NPI must be 10 digits');
  }
  if (!data.email?.trim()) errors.push('Email is required');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push('Invalid email format');
  }

  // Specialties validation
  if (!data.specialties || data.specialties.length === 0) {
    errors.push('At least one specialty is required');
  }
  const primarySpecialties = data.specialties?.filter(s => s.isPrimary) || [];
  if (primarySpecialties.length === 0 && data.specialties?.length > 0) {
    errors.push('One specialty must be marked as primary');
  }

  // Licenses validation
  if (!data.licenses || data.licenses.length === 0) {
    errors.push('At least one license is required');
  }
  data.licenses?.forEach((license, idx) => {
    if (!license.state) errors.push(`License #${idx + 1}: State is required`);
    if (!license.licenseNumber?.trim()) errors.push(`License #${idx + 1}: License number is required`);
    if (!license.expirationDate) errors.push(`License #${idx + 1}: Expiration date is required`);
  });

  // Practice Locations validation
  if (!data.practiceLocations || data.practiceLocations.length === 0) {
    errors.push('At least one practice location is required');
  }
  const primaryLocations = data.practiceLocations?.filter(loc => loc.isPrimary) || [];
  if (primaryLocations.length === 0 && data.practiceLocations?.length > 0) {
    errors.push('One location must be marked as primary');
  }
  if (primaryLocations.length > 1) {
    errors.push('Only one location can be marked as primary');
  }
  data.practiceLocations?.forEach((location, idx) => {
    if (!location.name?.trim()) errors.push(`Location #${idx + 1}: Name is required`);
    if (!location.addressLine1?.trim()) errors.push(`Location #${idx + 1}: Address is required`);
    if (!location.city?.trim()) errors.push(`Location #${idx + 1}: City is required`);
    if (!location.state) errors.push(`Location #${idx + 1}: State is required`);
    if (!location.zipCode?.trim()) errors.push(`Location #${idx + 1}: ZIP code is required`);
    if (!location.phone?.trim()) errors.push(`Location #${idx + 1}: Phone is required`);
  });

  // Insurance Plans validation (optional, but if provided must be valid)
  data.insurancePlans?.forEach((plan, idx) => {
    if (!plan.carrier?.trim()) errors.push(`Plan #${idx + 1}: Carrier is required`);
    if (!plan.planName?.trim()) errors.push(`Plan #${idx + 1}: Plan name is required`);
  });

  return { valid: errors.length === 0, errors };
}

export async function POST(request: NextRequest) {
  try {
    const data: ProviderData = await request.json();

    // Validate the data
    const validation = validateProviderData(data);
    if (!validation.valid) {
      return NextResponse.json(
        {
          success: false,
          message: 'Validation failed',
          errors: validation.errors,
        },
        { status: 400 }
      );
    }

    // In a real implementation, this would:
    // 1. Save to database
    // 2. Trigger webhook notifications
    // 3. Update FHIR resources
    // For demo purposes, we'll simulate success

    console.log('Saving provider:', {
      npi: data.npi,
      name: `${data.firstName} ${data.lastName}`,
      specialties: data.specialties.length,
      licenses: data.licenses.length,
      locations: data.practiceLocations.length,
    });

    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 500));

    return NextResponse.json(
      {
        success: true,
        message: 'Provider saved successfully',
        data: {
          id: `provider-${Date.now()}`,
          npi: data.npi,
          name: {
            firstName: data.firstName,
            lastName: data.lastName,
            middleName: data.middleName,
          },
          createdAt: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error saving provider:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // This could be used to fetch providers list
  return NextResponse.json(
    {
      success: true,
      providers: [
        {
          id: 'demo-001',
          npi: '1234567890',
          name: 'Dr. Sarah Johnson',
          specialties: ['Cardiovascular Disease'],
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    { status: 200 }
  );
}
