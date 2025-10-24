import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { practitionerToFHIR, calculateCompleteness } from '@/lib/fhirUtils';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export async function POST(request: Request) {
  try {
    const { email, password, first_name, last_name, npi } = await request.json();

    if (!email || !password || !first_name || !last_name) {
      return NextResponse.json(
        { detail: 'Email, password, first name, and last name are required' },
        { status: 400 }
      );
    }

    // Check if email already exists
    const existing = await prisma.practitioner.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existing) {
      return NextResponse.json(
        { detail: 'Email already registered' },
        { status: 400 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate FHIR ID
    const fhirId = `prac-${Math.random().toString(36).substring(7)}`;

    // Create temporary practitioner object for FHIR generation
    const tempPractitioner: any = {
      fhirId,
      firstName: first_name,
      lastName: last_name,
      npi: npi || null,
      email: email.toLowerCase(),
      phone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: 'US',
      gender: null,
      status: 'pending_verification',
    };

    // Generate FHIR resource
    const fhirResource = practitionerToFHIR(tempPractitioner);

    // Calculate completeness
    const completeness = calculateCompleteness(tempPractitioner);

    // Create practitioner in database
    const practitioner = await prisma.practitioner.create({
      data: {
        fhirId,
        firstName: first_name,
        lastName: last_name,
        npi: npi || null,
        email: email.toLowerCase(),
        passwordHash,
        fhirResource: fhirResource as any,
        status: 'pending_verification',
        completeness,
        verified: false,
      },
    });

    // Generate JWT token
    const token = jwt.sign(
      {
        id: practitioner.id,
        email: practitioner.email,
        fhirId: practitioner.fhirId,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return NextResponse.json({
      access_token: token,
      token_type: 'bearer',
    });
  } catch (error) {
    console.error('Error during registration:', error);
    return NextResponse.json(
      { detail: 'Registration failed' },
      { status: 500 }
    );
  }
}
