import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserIdFromToken } from '@/lib/auth';
import { calculateCompleteness } from '@/lib/fhirUtils';

export async function GET(request: NextRequest) {
  try {
    console.log('[API] GET /api/practitioners/me - Request received');
    console.log('[API] Authorization header:', request.headers.get('authorization') ? 'Present' : 'Missing');
    console.log('[API] JWT_SECRET configured:', process.env.JWT_SECRET ? 'Yes' : 'No');

    const userId = getUserIdFromToken(request);
    console.log('[API] User ID from token:', userId);

    if (!userId) {
      console.log('[API] Unauthorized - no valid user ID from token');
      return NextResponse.json(
        { detail: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get practitioner from database
    const practitioner = await prisma.practitioner.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fhirId: true,
        npi: true,
        deaNumber: true,
        taxId: true,
        firstName: true,
        middleName: true,
        lastName: true,
        suffix: true,
        gender: true,
        email: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        status: true,
        completeness: true,
        verified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!practitioner) {
      return NextResponse.json(
        { detail: 'Practitioner not found' },
        { status: 404 }
      );
    }

    // Convert to frontend format
    const response = {
      id: practitioner.id,
      fhir_id: practitioner.fhirId,
      npi: practitioner.npi,
      dea_number: practitioner.deaNumber,
      tax_id: practitioner.taxId,
      first_name: practitioner.firstName,
      middle_name: practitioner.middleName,
      last_name: practitioner.lastName,
      suffix: practitioner.suffix,
      gender: practitioner.gender,
      email: practitioner.email,
      phone: practitioner.phone,
      address_line1: practitioner.addressLine1,
      address_line2: practitioner.addressLine2,
      city: practitioner.city,
      state: practitioner.state,
      postal_code: practitioner.postalCode,
      country: practitioner.country,
      status: practitioner.status,
      completeness: practitioner.completeness,
      verified: practitioner.verified,
      created_at: practitioner.createdAt.toISOString(),
      updated_at: practitioner.updatedAt.toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching practitioner:', error);
    return NextResponse.json(
      { detail: 'Failed to fetch practitioner data' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = getUserIdFromToken(request);

    if (!userId) {
      return NextResponse.json(
        { detail: 'Unauthorized' },
        { status: 401 }
      );
    }

    const data = await request.json();

    // Update practitioner in database
    const practitioner = await prisma.practitioner.update({
      where: { id: userId },
      data: {
        firstName: data.first_name,
        middleName: data.middle_name,
        lastName: data.last_name,
        suffix: data.suffix,
        gender: data.gender,
        phone: data.phone,
        addressLine1: data.address_line1,
        addressLine2: data.address_line2,
        city: data.city,
        state: data.state,
        postalCode: data.postal_code,
        country: data.country,
        npi: data.npi,
        deaNumber: data.dea_number,
        taxId: data.tax_id,
      },
    });

    // Recalculate completeness
    const completeness = calculateCompleteness(practitioner);
    await prisma.practitioner.update({
      where: { id: userId },
      data: { completeness },
    });

    // Get updated practitioner
    const updated = await prisma.practitioner.findUnique({
      where: { id: userId },
    });

    if (!updated) {
      return NextResponse.json(
        { detail: 'Practitioner not found' },
        { status: 404 }
      );
    }

    // Convert to frontend format
    const response = {
      id: updated.id,
      fhir_id: updated.fhirId,
      npi: updated.npi,
      dea_number: updated.deaNumber,
      tax_id: updated.taxId,
      first_name: updated.firstName,
      middle_name: updated.middleName,
      last_name: updated.lastName,
      suffix: updated.suffix,
      gender: updated.gender,
      email: updated.email,
      phone: updated.phone,
      address_line1: updated.addressLine1,
      address_line2: updated.addressLine2,
      city: updated.city,
      state: updated.state,
      postal_code: updated.postalCode,
      country: updated.country,
      status: updated.status,
      completeness: updated.completeness,
      verified: updated.verified,
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error updating practitioner:', error);
    return NextResponse.json(
      { detail: 'Failed to update practitioner data' },
      { status: 500 }
    );
  }
}
