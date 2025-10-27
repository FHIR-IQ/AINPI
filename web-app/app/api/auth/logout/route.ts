import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // In a real app, you'd invalidate the token here
  return NextResponse.json(
    { success: true, message: 'Logged out successfully' },
    { status: 200 }
  );
}
