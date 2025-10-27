import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserIdFromToken } from '@/lib/auth';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    console.log('[API] PUT /api/practitioner-roles/[id] - Request received');

    const userId = getUserIdFromToken(request);

    if (!userId) {
      console.log('[API] Unauthorized - no valid user ID');
      return NextResponse.json(
        { detail: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = params;
    const data = await request.json();

    console.log('[API] Updating role:', id, 'for user:', userId);

    // Verify the role belongs to the user
    const existingRole = await prisma.practitionerRole.findUnique({
      where: { id },
    });

    if (!existingRole || existingRole.practitionerId !== userId) {
      console.log('[API] Role not found or unauthorized');
      return NextResponse.json(
        { detail: 'Role not found or unauthorized' },
        { status: 404 }
      );
    }

    // Update role
    const role = await prisma.practitionerRole.update({
      where: { id },
      data: {
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
        acceptedInsurances: data.accepted_insurances || existingRole.acceptedInsurances,
      },
    });

    console.log('[API] Updated role:', role.id);

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

    return NextResponse.json(response);
  } catch (error) {
    console.error('[API] Error updating practitioner role:', error);
    return NextResponse.json(
      { detail: 'Failed to update practitioner role' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    console.log('[API] DELETE /api/practitioner-roles/[id] - Request received');

    const userId = getUserIdFromToken(request);

    if (!userId) {
      console.log('[API] Unauthorized - no valid user ID');
      return NextResponse.json(
        { detail: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = params;

    console.log('[API] Deleting role:', id, 'for user:', userId);

    // Verify the role belongs to the user
    const existingRole = await prisma.practitionerRole.findUnique({
      where: { id },
    });

    if (!existingRole || existingRole.practitionerId !== userId) {
      console.log('[API] Role not found or unauthorized');
      return NextResponse.json(
        { detail: 'Role not found or unauthorized' },
        { status: 404 }
      );
    }

    // Delete role
    await prisma.practitionerRole.delete({
      where: { id },
    });

    console.log('[API] Deleted role:', id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error deleting practitioner role:', error);
    return NextResponse.json(
      { detail: 'Failed to delete practitioner role' },
      { status: 500 }
    );
  }
}
