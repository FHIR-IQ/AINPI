import { NextResponse } from 'next/server';
import { getMockIntegrations } from '@/lib/mockData';

export async function GET() {
  try {
    const integrations = getMockIntegrations();
    return NextResponse.json(integrations);
  } catch (error) {
    console.error('Error fetching integrations:', error);
    return NextResponse.json(
      { detail: 'Failed to fetch integrations' },
      { status: 500 }
    );
  }
}
