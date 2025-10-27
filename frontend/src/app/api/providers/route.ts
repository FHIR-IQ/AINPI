import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

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

  // Licenses validation
  if (!data.licenses || data.licenses.length === 0) {
    errors.push('At least one license is required');
  }

  // Practice Locations validation
  if (!data.practiceLocations || data.practiceLocations.length === 0) {
    errors.push('At least one practice location is required');
  }
  const primaryLocations = data.practiceLocations?.filter(loc => loc.isPrimary) || [];
  if (primaryLocations.length === 0 && data.practiceLocations?.length > 0) {
    errors.push('One location must be marked as primary');
  }

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

    // Create practitioner in database
    const fhirId = `Practitioner/${data.npi}`;

    // Generate a temporary password hash for providers added via form
    // They will need to reset password via email to login
    const tempPassword = Math.random().toString(36).slice(-12);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const practitioner = await prisma.practitioner.create({
      data: {
        fhirId,
        npi: data.npi,
        firstName: data.firstName,
        lastName: data.lastName,
        middleName: data.middleName,
        email: data.email,
        phone: data.phone,
        passwordHash, // Required for authentication system
        specialties: data.specialties as any, // Prisma expects JSON, not string
        licenses: data.licenses as any,
        practiceLocations: data.practiceLocations as any,
        insurancePlans: data.insurancePlans as any,
        active: true,
        status: 'active',
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Provider saved successfully',
        data: {
          id: practitioner.id,
          npi: practitioner.npi,
          name: {
            firstName: practitioner.firstName,
            lastName: practitioner.lastName,
            middleName: practitioner.middleName,
          },
          createdAt: practitioner.createdAt,
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
  try {
    const practitioners = await prisma.practitioner.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json(
      {
        success: true,
        practitioners: practitioners.map(p => ({
          id: p.id,
          npi: p.npi,
          name: `${p.firstName} ${p.lastName}`,
          email: p.email,
          phone: p.phone,
          active: p.active,
          updatedAt: p.updatedAt,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error fetching providers:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to fetch providers',
      },
      { status: 500 }
    );
  }
}
