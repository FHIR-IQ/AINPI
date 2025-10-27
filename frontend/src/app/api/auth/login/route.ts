import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { detail: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Find practitioner by email
    const practitioner = await prisma.practitioner.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!practitioner) {
      return NextResponse.json(
        { detail: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Verify password
    if (!practitioner.passwordHash) {
      return NextResponse.json(
        { detail: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const isValidPassword = await bcrypt.compare(password, practitioner.passwordHash);

    if (!isValidPassword) {
      return NextResponse.json(
        { detail: 'Invalid email or password' },
        { status: 401 }
      );
    }

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
    console.error('Error during login:', error);
    return NextResponse.json(
      { detail: 'Login failed' },
      { status: 500 }
    );
  }
}
