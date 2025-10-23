import { NextResponse } from 'next/server';
import { getDefaultPractitioner } from '@/lib/mockData';

export async function GET() {
  try {
    // For POC, return the default practitioner
    // In a real app, this would get data from a database based on auth token
    const practitioner = getDefaultPractitioner();

    return NextResponse.json(practitioner);
  } catch (error) {
    console.error('Error fetching practitioner:', error);
    return NextResponse.json(
      { detail: 'Failed to fetch practitioner data' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const data = await request.json();

    // For POC, just echo back the data with some defaults
    // In a real app, this would update the database
    const practitioner = {
      ...getDefaultPractitioner(),
      ...data,
      updated_at: new Date().toISOString(),
    };

    return NextResponse.json(practitioner);
  } catch (error) {
    console.error('Error updating practitioner:', error);
    return NextResponse.json(
      { detail: 'Failed to update practitioner data' },
      { status: 500 }
    );
  }
}
