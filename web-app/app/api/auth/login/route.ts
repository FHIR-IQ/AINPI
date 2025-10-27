import { NextRequest, NextResponse } from 'next/server';

// Demo account credentials
const DEMO_USER = {
  email: 'demo@demo.com',
  password: 'demo',
  user: {
    id: 'user-demo-001',
    email: 'demo@demo.com',
    name: 'Demo User',
    role: 'admin',
  },
};

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Check demo account
    if (email === DEMO_USER.email && password === DEMO_USER.password) {
      // Generate a simple token (in production, use JWT)
      const token = Buffer.from(`${email}:${Date.now()}`).toString('base64');

      return NextResponse.json(
        {
          success: true,
          message: 'Login successful',
          token,
          user: DEMO_USER.user,
        },
        { status: 200 }
      );
    }

    // Invalid credentials
    return NextResponse.json(
      { success: false, message: 'Invalid email or password' },
      { status: 401 }
    );
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, message: 'An error occurred during login' },
      { status: 500 }
    );
  }
}
