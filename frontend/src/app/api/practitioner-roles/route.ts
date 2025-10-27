import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserIdFromToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    console.log('[API] GET /api/practitioner-roles - Request received');

    const userId = getUserIdFromToken(request);

    if (!userId) {
      console.log('[API] Unauthorized - no valid user ID');
      return NextResponse.json(
        { detail: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('[API] Fetching roles for user:', userId);

    // Get practitioner roles from database
    const roles = await prisma.practitionerRole.findMany({
      where: { practitionerId: userId },
      orderBy: { createdAt: 'desc' },
    });

    console.log('[API] Found', roles.length, 'roles');

    // Convert to frontend format
    const response = roles.map(role => ({
      id: role.id,
      fhir_id: role.fhirId,
      practitioner_id: role.practitionerId,
      specialty_code: role.specialtyCode,
      specialty_display: role.specialtyDisplay,
      practice_name: role.practiceName,
      practice_address_line1: role.practiceAddressLine1,
      practice_address_line2: role.practiceAddressLine2,
      practice_city: role.practiceCity,
      practice_state: role.practiceState,
      practice_postal_code: role.practicePostalCode,
      license_state: role.licenseState,
      license_number: role.licenseNumber,
      license_expiration: role.licenseExpiration?.toISOString(),
      accepted_insurances: role.acceptedInsurances,
      active: role.active,
      created_at: role.createdAt.toISOString(),
      updated_at: role.updatedAt.toISOString(),
    }));

    return NextResponse.json(response);
  } catch (error) {
    console.error('[API] Error fetching practitioner roles:', error);
    return NextResponse.json(
      { detail: 'Failed to fetch practitioner roles' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('[API] POST /api/practitioner-roles - Request received');

    const userId = getUserIdFromToken(request);

    if (!userId) {
      console.log('[API] Unauthorized - no valid user ID');
      return NextResponse.json(
        { detail: 'Unauthorized' },
        { status: 401 }
      );
    }

    const data = await request.json();
    console.log('[API] Creating role for user:', userId);

    // Create practitioner role in database
    const fhirId = `PractitionerRole/${Date.now()}`;

    const role = await prisma.practitionerRole.create({
      data: {
        fhirId,
        practitionerId: userId,
        specialtyCode: data.specialty_code,
        specialtyDisplay: data.specialty_display,
        practiceName: data.practice_name,
        practiceAddressLine1: data.practice_address_line1,
        practiceAddressLine2: data.practice_address_line2,
        practiceCity: data.practice_city,
        practiceState: data.practice_state,
        practicePostalCode: data.practice_postal_code,
        licenseState: data.license_state,
        licenseNumber: data.license_number,
        licenseExpiration: data.license_expiration ? new Date(data.license_expiration) : null,
        acceptedInsurances: data.accepted_insurances || [],
        fhirResource: {}, // Placeholder FHIR resource
        active: true,
      },
    });

    console.log('[API] Created role:', role.id);

    // Convert to frontend format
    const response = {
      id: role.id,
      fhir_id: role.fhirId,
      practitioner_id: role.practitionerId,
      specialty_code: role.specialtyCode,
      specialty_display: role.specialtyDisplay,
      practice_name: role.practiceName,
      practice_address_line1: role.practiceAddressLine1,
      practice_address_line2: role.practiceAddressLine2,
      practice_city: role.practiceCity,
      practice_state: role.practiceState,
      practice_postal_code: role.practicePostalCode,
      license_state: role.licenseState,
      license_number: role.licenseNumber,
      license_expiration: role.licenseExpiration?.toISOString(),
      accepted_insurances: role.acceptedInsurances,
      active: role.active,
      created_at: role.createdAt.toISOString(),
      updated_at: role.updatedAt.toISOString(),
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('[API] Error creating practitioner role:', error);
    return NextResponse.json(
      { detail: 'Failed to create practitioner role' },
      { status: 500 }
    );
  }
}
