import { NextResponse } from 'next/server';
import { createFHIRBundle, getDefaultPractitioner } from '@/lib/mockData';

export async function GET() {
  try {
    // Get practitioner from localStorage (client will provide this)
    // For POC, we'll use the default practitioner
    const practitioner = getDefaultPractitioner();

    // Create FHIR bundle
    const bundle = createFHIRBundle(practitioner);

    return NextResponse.json(bundle);
  } catch (error) {
    console.error('Error exporting FHIR bundle:', error);
    return NextResponse.json(
      { detail: 'Failed to export FHIR bundle' },
      { status: 500 }
    );
  }
}
