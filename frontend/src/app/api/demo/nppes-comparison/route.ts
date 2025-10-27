import { NextResponse } from 'next/server';
import {
  getMockNPPESData,
  practitionerToFHIR,
  compareProviderData,
  getDefaultPractitioner,
} from '@/lib/mockData';

export async function GET() {
  try {
    // Get practitioner from localStorage (client will provide this)
    // For POC, we'll use the default practitioner
    const practitioner = getDefaultPractitioner();

    if (!practitioner.npi) {
      return NextResponse.json(
        { detail: 'NPI is required to compare with NPPES' },
        { status: 400 }
      );
    }

    // Get mock NPPES data
    const nppesData = getMockNPPESData(practitioner.npi);
    if (!nppesData) {
      return NextResponse.json(
        { detail: 'No NPPES data found for this NPI' },
        { status: 404 }
      );
    }

    // Convert practitioner to FHIR format
    const providerCardData = practitionerToFHIR(practitioner);

    // Compare the datasets
    const comparison = compareProviderData(nppesData, providerCardData);

    return NextResponse.json(comparison);
  } catch (error) {
    console.error('Error comparing with NPPES:', error);
    return NextResponse.json(
      { detail: 'Failed to compare with NPPES' },
      { status: 500 }
    );
  }
}
