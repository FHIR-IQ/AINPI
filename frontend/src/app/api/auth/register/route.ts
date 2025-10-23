import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { email, password, first_name, last_name, npi } = await request.json();

    // For POC, accept any registration data
    // In a real app, this would create a user in a database
    if (!email || !password || !first_name || !last_name) {
      return NextResponse.json(
        { detail: 'Email, password, first name, and last name are required' },
        { status: 400 }
      );
    }

    // Generate a mock JWT token
    const token = `poc-token-${Date.now()}-${Math.random().toString(36).substring(7)}`;

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
