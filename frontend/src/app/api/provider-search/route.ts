import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Real-Time Provider Search API
 *
 * Searches connected payer APIs in real-time for provider data by NPI.
 * Does NOT store full provider directories - queries on-demand for fresh data.
 *
 * Endpoint: POST /api/provider-search
 * Body: { npi: string, include_inactive?: boolean }
 */

interface ProviderSearchResult {
  payer: string;
  found: boolean;
  status: 'success' | 'error' | 'not_found' | 'auth_required';
  data?: {
    npi: string;
    name: {
      first: string;
      last: string;
      middle?: string;
      prefix?: string;
      suffix?: string;
    };
    gender?: string;
    specialties?: Array<{
      code: string;
      display: string;
      system?: string;
    }>;
    locations?: Array<{
      name?: string;
      address: {
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        zip?: string;
      };
      phone?: string;
      fax?: string;
    }>;
    networks?: string[];
    accepting_patients?: boolean;
    languages?: string[];
    board_certifications?: string[];
    last_updated?: string;
  };
  response_time_ms: number;
  error_message?: string;
  raw_fhir?: any; // Optional: include raw FHIR response
}

export async function POST(request: NextRequest) {
  try {
    console.log('[Provider Search] Request received');

    const userId = getUserIdFromToken(request);
    if (!userId) {
      return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
    }

    const { npi, include_inactive = false } = await request.json();

    if (!npi) {
      return NextResponse.json(
        { detail: 'NPI is required' },
        { status: 400 }
      );
    }

    // Validate NPI format
    if (!/^\d{10}$/.test(npi)) {
      return NextResponse.json(
        { detail: 'Invalid NPI format. Must be 10 digits.' },
        { status: 400 }
      );
    }

    console.log(`[Provider Search] Searching for NPI: ${npi}`);

    // Get connected payer APIs (public endpoints only - verified working)
    const connectedAPIs = await prisma.providerDirectoryAPI.findMany({
      where: {
        organizationType: 'insurance_payer',
        requiresAuth: false, // Only public endpoints
        status: 'verified', // Only verified working endpoints
      },
      orderBy: {
        organizationName: 'asc',
      },
    });

    console.log(`[Provider Search] Found ${connectedAPIs.length} connected APIs to search`);

    // Search each API in parallel
    const searchPromises = connectedAPIs.map(api =>
      searchPayerAPI(api, npi, include_inactive)
    );

    const results = await Promise.allSettled(searchPromises);

    // Process results
    const providerSearchResults: ProviderSearchResult[] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        // Handle rejected promise
        return {
          payer: connectedAPIs[index].organizationName,
          found: false,
          status: 'error' as const,
          error_message: result.reason?.message || 'Unknown error',
          response_time_ms: 0,
        };
      }
    });

    // Aggregate results
    const foundResults = providerSearchResults.filter(r => r.found);
    const totalSearched = providerSearchResults.length;
    const totalFound = foundResults.length;

    console.log(`[Provider Search] Complete: Found in ${totalFound}/${totalSearched} payers`);

    // Return aggregated results
    return NextResponse.json({
      success: true,
      npi,
      summary: {
        total_payers_searched: totalSearched,
        found_in_payers: totalFound,
        not_found_in_payers: totalSearched - totalFound,
        total_search_time_ms: providerSearchResults.reduce((sum, r) => sum + r.response_time_ms, 0),
        average_response_time_ms: Math.round(
          providerSearchResults.reduce((sum, r) => sum + r.response_time_ms, 0) / totalSearched
        ),
      },
      results: providerSearchResults,
      searched_at: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('[Provider Search] Error:', error);
    return NextResponse.json(
      {
        success: false,
        detail: error.message || 'Failed to search provider directories',
      },
      { status: 500 }
    );
  }
}

/**
 * Search a single payer API for provider data
 */
async function searchPayerAPI(
  api: any,
  npi: string,
  includeInactive: boolean
): Promise<ProviderSearchResult> {
  const startTime = Date.now();

  try {
    console.log(`[Provider Search] Searching ${api.organizationName}...`);

    // Build search URL based on API endpoint and NPI
    // FHIR standard uses: {base}/Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|{npi}
    let searchUrl: string;
    const npiIdentifier = `http://hl7.org/fhir/sid/us-npi|${npi}`;

    // Special handling for verified endpoints
    if (api.organizationName === 'Humana') {
      // Humana: https://fhir.humana.com/api + /Practitioner?identifier=...
      searchUrl = `${api.apiEndpoint}/Practitioner?identifier=${encodeURIComponent(npiIdentifier)}`;
    } else if (api.organizationName.includes('BlueCross') || api.organizationName.includes('BCBS')) {
      // BCBS SC: https://fhir.bcbssc.com/r4/providerlisting + /Practitioner?identifier=...
      searchUrl = `${api.apiEndpoint}/Practitioner?identifier=${encodeURIComponent(npiIdentifier)}`;
    } else {
      // Default FHIR pattern: append /Practitioner?identifier=
      const baseUrl = api.apiEndpoint.replace(/\/$/, ''); // Remove trailing slash
      searchUrl = `${baseUrl}/Practitioner?identifier=${encodeURIComponent(npiIdentifier)}`;
    }

    console.log(`[Provider Search] ${api.organizationName}: ${searchUrl}`);

    // Make request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(searchUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/fhir+json, application/json',
        'User-Agent': 'ProviderCard-Search/1.0',
      },
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      if (response.status === 404) {
        return {
          payer: api.organizationName,
          found: false,
          status: 'not_found',
          response_time_ms: responseTime,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          payer: api.organizationName,
          found: false,
          status: 'auth_required',
          error_message: 'Authentication required',
          response_time_ms: responseTime,
        };
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Parse FHIR response
    const fhirData = await response.json();

    // Check if we got results
    if (fhirData.resourceType === 'Bundle') {
      const entries = fhirData.entry || [];

      if (entries.length === 0) {
        return {
          payer: api.organizationName,
          found: false,
          status: 'not_found',
          response_time_ms: responseTime,
        };
      }

      // Extract practitioner data from FHIR Bundle
      const practitioner = entries[0].resource;

      // Get the practitioner ID for PractitionerRole lookup
      const practitionerId = practitioner.id;
      const practitionerFullUrl = entries[0].fullUrl;

      // Query PractitionerRole for complete provider data (locations, specialties, networks)
      let practitionerRoles: any[] = [];
      try {
        const roleUrl = `${api.apiEndpoint}/PractitionerRole?practitioner=${practitionerId}`;
        const roleResponse = await fetch(roleUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/fhir+json, application/json',
          },
          signal: AbortSignal.timeout(5000), // 5 second timeout for role lookup
        });

        if (roleResponse.ok) {
          const roleData = await roleResponse.json();
          if (roleData.resourceType === 'Bundle' && roleData.entry) {
            practitionerRoles = roleData.entry.map((e: any) => e.resource);
          }
        }
      } catch (error) {
        console.warn(`[Provider Search] Could not fetch PractitionerRole for ${api.organizationName}:`, error);
        // Continue without role data
      }

      const providerData = await parseFHIRPractitioner(practitioner, practitionerRoles, api);

      return {
        payer: api.organizationName,
        found: true,
        status: 'success',
        data: providerData,
        response_time_ms: responseTime,
        raw_fhir: { practitioner, roles: practitionerRoles }, // Include raw FHIR for reference
      };

    } else if (fhirData.resourceType === 'Practitioner') {
      // Direct Practitioner resource response
      const providerData = await parseFHIRPractitioner(fhirData, [], api);

      return {
        payer: api.organizationName,
        found: true,
        status: 'success',
        data: providerData,
        response_time_ms: responseTime,
        raw_fhir: fhirData,
      };

    } else {
      throw new Error(`Unexpected FHIR resource type: ${fhirData.resourceType}`);
    }

  } catch (error: any) {
    const responseTime = Date.now() - startTime;

    console.error(`[Provider Search] ${api.organizationName} error:`, error.message);

    if (error.name === 'AbortError') {
      return {
        payer: api.organizationName,
        found: false,
        status: 'error',
        error_message: 'Request timeout (10s)',
        response_time_ms: responseTime,
      };
    }

    // Provide more specific error messages
    let errorMessage = error.message;
    if (error.cause) {
      errorMessage += ` (${error.cause.code || error.cause})`;
    }

    return {
      payer: api.organizationName,
      found: false,
      status: 'error',
      error_message: errorMessage,
      response_time_ms: responseTime,
    };
  }
}

/**
 * Parse FHIR Practitioner resource to our standardized format
 * Enhanced to include PractitionerRole data for complete provider information
 */
async function parseFHIRPractitioner(
  practitioner: any,
  practitionerRoles: any[] = [],
  api?: any
): Promise<ProviderSearchResult['data']> {
  // Extract name
  const nameObj = practitioner.name?.[0] || {};
  const name = {
    first: nameObj.given?.[0] || '',
    last: nameObj.family || '',
    middle: nameObj.given?.[1] || undefined,
    prefix: nameObj.prefix?.[0] || undefined,
    suffix: nameObj.suffix?.[0] || undefined,
  };

  // Extract NPI from identifier
  const npiIdentifier = practitioner.identifier?.find(
    (id: any) => id.system === 'http://hl7.org/fhir/sid/us-npi'
  );
  const npi = npiIdentifier?.value || '';

  // Extract gender
  const gender = practitioner.gender;

  // Extract phone/fax from practitioner telecom
  const practitionerTelecom = practitioner.telecom || [];
  const phones = practitionerTelecom
    .filter((t: any) => t.system === 'phone')
    .map((t: any) => t.value);
  const faxes = practitionerTelecom
    .filter((t: any) => t.system === 'fax')
    .map((t: any) => t.value);

  // Extract qualifications (specialties, board certifications) from Practitioner
  const qualifications = practitioner.qualification || [];
  const practitionerSpecialties = qualifications.map((qual: any) => ({
    code: qual.code?.coding?.[0]?.code || '',
    display: qual.code?.coding?.[0]?.display || qual.code?.text || '',
    system: qual.code?.coding?.[0]?.system || undefined,
  }));

  // Extract communication (languages)
  const languages = practitioner.communication?.map(
    (comm: any) => comm.coding?.[0]?.display || comm.text || ''
  ) || [];

  // Process PractitionerRole data for locations, specialties, networks
  let allSpecialties = [...practitionerSpecialties];
  let networks: string[] = [];
  let acceptingPatients: boolean | undefined = undefined;
  let locations: Array<{
    name?: string;
    address: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
    phone?: string;
    fax?: string;
  }> = [];

  // Process each PractitionerRole
  for (const role of practitionerRoles) {
    // Extract specialties from role
    if (role.specialty) {
      const roleSpecialties = role.specialty.map((spec: any) => ({
        code: spec.coding?.[0]?.code || '',
        display: spec.coding?.[0]?.display || '',
        system: spec.coding?.[0]?.system || undefined,
      }));
      allSpecialties = [...allSpecialties, ...roleSpecialties];
    }

    // Extract network information
    const networkExtension = role.extension?.find(
      (ext: any) => ext.url === 'http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/network-reference'
    );
    if (networkExtension?.valueReference?.display) {
      networks.push(networkExtension.valueReference.display);
    }

    // Extract accepting patients status
    const newPatientsExtension = role.extension?.find(
      (ext: any) => ext.url === 'http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/newpatients'
    );
    const acceptingCode = newPatientsExtension?.extension?.[0]?.valueCodeableConcept?.coding?.[0]?.code;
    if (acceptingCode === 'newpt' || acceptingCode === 'existptonly') {
      acceptingPatients = acceptingCode === 'newpt';
    }

    // Extract location references
    if (role.location && api) {
      for (const locRef of role.location) {
        try {
          // Location display often has useful info
          const locationDisplay = locRef.display || '';

          // Optionally fetch full location details (commented out to avoid too many requests)
          // In production, you might want to batch these or fetch on-demand
          /*
          const locationUrl = locRef.reference;
          if (locationUrl.startsWith('http')) {
            const locResponse = await fetch(locationUrl, {
              headers: { 'Accept': 'application/fhir+json' },
              signal: AbortSignal.timeout(3000),
            });
            if (locResponse.ok) {
              const locData = await locResponse.json();
              // Parse location address from locData.address
            }
          }
          */

          locations.push({
            name: locationDisplay,
            address: {}, // Would be populated from full Location resource
            phone: phones[0] || undefined,
            fax: faxes[0] || undefined,
          });
        } catch (error) {
          // Skip this location if fetch fails
          console.warn('Failed to fetch location:', error);
        }
      }
    }
  }

  // Deduplicate specialties
  const uniqueSpecialties = Array.from(
    new Map(allSpecialties.map(s => [s.code, s])).values()
  ).filter(s => s.code || s.display);

  // Deduplicate networks
  const uniqueNetworks = Array.from(new Set(networks));

  return {
    npi,
    name,
    gender,
    specialties: uniqueSpecialties.length > 0 ? uniqueSpecialties : undefined,
    languages: languages.length > 0 ? languages : undefined,
    locations: locations.length > 0 ? locations : undefined,
    networks: uniqueNetworks.length > 0 ? uniqueNetworks : undefined,
    accepting_patients: acceptingPatients,
    board_certifications: undefined, // Would need additional qualification data
    last_updated: practitioner.meta?.lastUpdated,
  };
}
