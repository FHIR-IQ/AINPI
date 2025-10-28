import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import OpenAI from 'openai';

// Determine which AI provider to use (defaults to Perplexity)
const AI_PROVIDER = process.env.AI_PROVIDER || 'perplexity'; // 'perplexity' or 'openai'

// Initialize Perplexity API client
const perplexity = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY || '',
  baseURL: 'https://api.perplexity.ai',
});

// Initialize OpenAI API client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

interface ScanResult {
  source: string;
  type: 'insurance_directory' | 'provider_directory' | 'hospital_network' | 'state_board' | 'nppes';
  data_found: string[];
  discrepancies: Array<{
    field: string;
    found_value: string;
    current_value: string;
    severity: 'high' | 'medium' | 'low';
  }>;
  last_updated?: string;
  url?: string;
  api_endpoint?: string;
  api_status?: 'discovered' | 'testing' | 'active' | 'inactive' | 'error';
}

interface NPPESStaleCheck {
  is_stale: boolean;
  last_update_date: string;
  days_since_update: number;
  needs_sync: boolean;
  recommendation: string;
}

interface APIConnectionResult {
  organization_name: string;
  organization_type: 'health_system' | 'insurance_payer' | 'state_board';
  api_endpoint?: string;
  api_type?: 'rest' | 'fhir' | 'soap' | 'web_scrape' | 'unknown';
  connection_status: 'discovered' | 'testing' | 'connected' | 'failed' | 'no_api_found';
  supports_npi_search?: boolean;
  supports_name_search?: boolean;
  response_time_ms?: number;
  error_message?: string;
  tested_at: string;
}

// Helper function to call the appropriate AI provider
async function callAIProvider(prompt: string, systemPrompt: string) {
  if (AI_PROVIDER === 'openai') {
    console.log('[Magic Scanner] Using OpenAI GPT-4o for API discovery...');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o', // Latest GPT-4o model (was gpt-4-turbo)
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    });

    return {
      text: response.choices[0]?.message?.content || '',
      citations: [], // OpenAI doesn't provide citations like Perplexity
      provider: 'openai',
      model: 'gpt-4o',
    };
  } else {
    // Default to Perplexity
    console.log('[Magic Scanner] Using Perplexity Sonar Pro for API discovery...');
    const response = await perplexity.chat.completions.create({
      model: 'sonar-pro',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    });

    return {
      text: response.choices[0]?.message?.content || '',
      citations: (response as any).citations || [],
      provider: 'perplexity',
      model: 'sonar-pro',
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('[Magic Scanner Enhanced] Request received');

    const userId = getUserIdFromToken(request);
    if (!userId) {
      return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
    }

    // Check if AI provider API key is configured
    if (AI_PROVIDER === 'perplexity' && !process.env.PERPLEXITY_API_KEY) {
      console.error('[Magic Scanner] PERPLEXITY_API_KEY not configured');
      return NextResponse.json(
        {
          success: false,
          detail: 'Magic Scanner is not configured. Please add PERPLEXITY_API_KEY environment variable.',
        },
        { status: 500 }
      );
    }

    if (AI_PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) {
      console.error('[Magic Scanner] OPENAI_API_KEY not configured');
      return NextResponse.json(
        {
          success: false,
          detail: 'Magic Scanner is not configured. Please add OPENAI_API_KEY environment variable.',
        },
        { status: 500 }
      );
    }

    const { npi, last_name, state, current_data } = await request.json();

    if (!npi || !last_name) {
      return NextResponse.json(
        { detail: 'NPI and last name are required' },
        { status: 400 }
      );
    }

    console.log('[Magic Scanner] Step 1: Scanning for NPI:', npi, 'Last Name:', last_name);

    // STEP 1: Search NPPES database directly (this is a real API call)
    let nppesResult: ScanResult | null = null;
    try {
      console.log('[Magic Scanner] Querying NPPES API...');
      const nppesResponse = await fetch(
        `https://npiregistry.cms.hhs.gov/api/?version=2.1&number=${npi}`
      );
      const nppesData = await nppesResponse.json();

      if (nppesData.result_count > 0) {
        const provider = nppesData.results[0];
        const basicInfo = provider.basic;
        const address = provider.addresses?.find((a: any) => a.address_purpose === 'LOCATION') || provider.addresses?.[0];

        nppesResult = {
          source: 'NPPES NPI Registry (CMS)',
          type: 'nppes',
          data_found: ['npi', 'name', 'address', 'phone', 'taxonomy', 'last_updated'],
          discrepancies: [],
          last_updated: basicInfo.last_updated || 'Unknown',
          url: `https://npiregistry.cms.hhs.gov/search?number=${npi}`,
          api_endpoint: 'https://npiregistry.cms.hhs.gov/api/',
          api_status: 'active',
        };

        // Compare with current data and find discrepancies
        if (current_data) {
          const foundName = `${basicInfo.first_name} ${basicInfo.last_name}`;
          const currentName = `${current_data.first_name} ${current_data.last_name}`;

          if (foundName.toLowerCase() !== currentName.toLowerCase()) {
            nppesResult.discrepancies.push({
              field: 'name',
              found_value: foundName,
              current_value: currentName,
              severity: 'high',
            });
          }

          if (address && current_data.address_line1) {
            const foundAddress = address.address_1;
            if (foundAddress && foundAddress.toLowerCase() !== current_data.address_line1.toLowerCase()) {
              nppesResult.discrepancies.push({
                field: 'address',
                found_value: foundAddress,
                current_value: current_data.address_line1,
                severity: 'medium',
              });
            }
          }
        }

        console.log('[Magic Scanner] NPPES data found for NPI:', provider.number);
      } else {
        console.log('[Magic Scanner] No NPPES data found for NPI:', npi);
      }
    } catch (nppesError) {
      console.error('[Magic Scanner] NPPES API error:', nppesError);
    }

    // STEP 2A: Retrieve pre-seeded major payer APIs from database
    console.log('[Magic Scanner] Step 2A: Retrieving pre-seeded major payer APIs from database...');
    const preSeededAPIs = await prisma.providerDirectoryAPI.findMany({
      where: {
        organizationType: 'insurance_payer',
        status: {
          in: ['discovered', 'active', 'tested'],
        },
      },
      orderBy: {
        organizationName: 'asc',
      },
    });

    console.log(`[Magic Scanner] Step 2A: Found ${preSeededAPIs.length} pre-configured payer APIs`);

    // Convert pre-seeded APIs to discoveredAPIs format
    let discoveredAPIsFromDB: any[] = preSeededAPIs.map(api => ({
      organization_name: api.organizationName,
      organization_type: api.organizationType,
      state: api.state || 'US',
      directory_url: api.apiDocUrl || '',
      api_endpoint: api.apiEndpoint,
      api_type: api.apiType,
      api_doc_url: api.apiDocUrl,
      supports_npi_search: api.supportsNpiSearch,
      supports_name_search: api.supportsNameSearch,
      requires_auth: api.requiresAuth,
      notes: `Pre-seeded major payer API. ${api.notes || ''}`,
    }));

    // STEP 2B: Use AI to discover additional provider directories and their APIs
    console.log(`[Magic Scanner] Step 2B: Discovering additional APIs via ${AI_PROVIDER.toUpperCase()}...`);

    const apiDiscoveryPrompt = `You are an expert at finding provider directory APIs for healthcare organizations.

TASK: Find health systems, insurance payers, and their provider directory APIs in ${state || 'the United States'}.

SEARCH FOR:
1. Major health systems in ${state || 'the United States'}
2. Major insurance payers in ${state || 'the United States'}
3. Their provider directory websites
4. Their API endpoints (if publicly available)

FOR EACH ORGANIZATION FOUND:
- Organization name
- Type (health_system or insurance_payer)
- Provider directory URL
- API endpoint (if they have a public API)
- API documentation URL (if available)
- Does their API/directory support NPI search?
- Does their API/directory support name search?

RETURN JSON ARRAY:
[
  {
    "organization_name": "Exact organization name",
    "organization_type": "health_system" or "insurance_payer",
    "state": "${state || 'US'}",
    "directory_url": "https://...",
    "api_endpoint": "https://api.example.com/v1/providers" or null,
    "api_type": "rest" or "fhir" or "soap" or "web_scrape" or "unknown",
    "api_doc_url": "https://..." or null,
    "supports_npi_search": true or false,
    "supports_name_search": true or false,
    "requires_auth": true or false,
    "notes": "Additional information about the API"
  }
]

Focus on finding at least 5-10 major organizations with their directory information.
If an organization doesn't have a public API, note their web directory and mark api_type as "web_scrape".`;

    const systemPrompt = 'You are an expert at finding healthcare provider directory APIs. Search the web thoroughly for API documentation and provider directories.';

    const aiResponse = await callAIProvider(apiDiscoveryPrompt, systemPrompt);

    const apiDiscoveryText = aiResponse.text;
    const citations = aiResponse.citations;

    console.log(`[Magic Scanner] Step 2B Complete: API discovery response received from ${aiResponse.provider} (${aiResponse.model})`);

    // Parse AI-discovered APIs
    let discoveredAPIsFromAI: any[] = [];
    try {
      const jsonMatch = apiDiscoveryText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        discoveredAPIsFromAI = JSON.parse(jsonMatch[0]);
        console.log('[Magic Scanner] Step 2B: Discovered', discoveredAPIsFromAI.length, 'additional organizations via AI');
      }
    } catch (parseError) {
      console.error('[Magic Scanner] Failed to parse API discovery results:', parseError);
    }

    // Combine pre-seeded APIs with AI-discovered APIs (pre-seeded takes priority)
    const allDiscoveredAPIs = [...discoveredAPIsFromDB, ...discoveredAPIsFromAI];

    // Deduplicate by organization name (prefer pre-seeded)
    const discoveredAPIs = allDiscoveredAPIs.filter((api, index, self) =>
      index === self.findIndex((t) => t.organization_name === api.organization_name)
    );

    console.log(`[Magic Scanner] Step 2 Complete: ${discoveredAPIsFromDB.length} pre-seeded + ${discoveredAPIsFromAI.length} AI-discovered = ${discoveredAPIs.length} total unique organizations`);

    // STEP 3: Test API connections for discovered endpoints
    console.log('[Magic Scanner] Step 3: Testing API connections...');
    const apiConnectionResults: APIConnectionResult[] = [];

    for (const api of discoveredAPIs) {
      const connectionResult: APIConnectionResult = {
        organization_name: api.organization_name,
        organization_type: api.organization_type,
        api_endpoint: api.api_endpoint || undefined,
        api_type: api.api_type || 'unknown',
        connection_status: 'discovered',
        supports_npi_search: api.supports_npi_search,
        supports_name_search: api.supports_name_search,
        tested_at: new Date().toISOString(),
      };

      // If we have an API endpoint, test it
      if (api.api_endpoint && api.api_type !== 'web_scrape') {
        console.log(`[Magic Scanner] Testing connection to ${api.organization_name}...`);
        connectionResult.connection_status = 'testing';

        try {
          const startTime = Date.now();

          // Try to connect (with timeout)
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

          const testResponse = await fetch(api.api_endpoint, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'ProviderCard-MagicScanner/1.0',
            },
          });

          clearTimeout(timeoutId);
          const responseTime = Date.now() - startTime;

          connectionResult.response_time_ms = responseTime;

          if (testResponse.ok || testResponse.status === 401 || testResponse.status === 403) {
            // 401/403 means the endpoint exists but requires auth (that's good!)
            connectionResult.connection_status = 'connected';
            console.log(`[Magic Scanner] ✓ Connected to ${api.organization_name} (${responseTime}ms)`);

            // Save to database
            await prisma.providerDirectoryAPI.upsert({
              where: {
                organizationName_apiEndpoint: {
                  organizationName: api.organization_name,
                  apiEndpoint: api.api_endpoint,
                },
              },
              create: {
                organizationName: api.organization_name,
                organizationType: api.organization_type,
                state: api.state || state,
                apiEndpoint: api.api_endpoint,
                apiType: api.api_type,
                apiDocUrl: api.api_doc_url,
                requiresAuth: api.requires_auth || false,
                supportsNpiSearch: api.supports_npi_search || false,
                supportsNameSearch: api.supports_name_search || false,
                status: 'active',
                lastTestedAt: new Date(),
                lastSuccessAt: new Date(),
                consecutiveFailures: 0,
                avgResponseTimeMs: responseTime,
                discoveredBy: 'ai_scanner',
                discoverySource: 'perplexity_ai',
                notes: api.notes,
              },
              update: {
                status: 'active',
                lastTestedAt: new Date(),
                lastSuccessAt: new Date(),
                consecutiveFailures: 0,
                avgResponseTimeMs: responseTime,
              },
            });
          } else {
            connectionResult.connection_status = 'failed';
            connectionResult.error_message = `HTTP ${testResponse.status}: ${testResponse.statusText}`;
            console.log(`[Magic Scanner] ✗ Failed to connect to ${api.organization_name}: ${testResponse.status}`);
          }
        } catch (error: any) {
          connectionResult.connection_status = 'failed';
          connectionResult.error_message = error.message;
          console.log(`[Magic Scanner] ✗ Error connecting to ${api.organization_name}:`, error.message);
        }
      } else {
        connectionResult.connection_status = 'no_api_found';
        console.log(`[Magic Scanner] No API endpoint for ${api.organization_name} (web scraping required)`);
      }

      apiConnectionResults.push(connectionResult);
    }

    console.log('[Magic Scanner] Step 3 Complete: Tested', apiConnectionResults.length, 'API connections');

    // Build scan results from discovered APIs
    const scanResults: ScanResult[] = [];
    if (nppesResult) {
      scanResults.push(nppesResult);
    }

    for (const api of discoveredAPIs) {
      const connectionResult = apiConnectionResults.find(r => r.organization_name === api.organization_name);

      // Map connection_status to api_status
      let apiStatus: 'discovered' | 'testing' | 'active' | 'inactive' | 'error' = 'discovered';
      if (connectionResult) {
        switch (connectionResult.connection_status) {
          case 'connected':
            apiStatus = 'active';
            break;
          case 'testing':
            apiStatus = 'testing';
            break;
          case 'failed':
            apiStatus = 'error';
            break;
          case 'no_api_found':
            apiStatus = 'inactive';
            break;
          default:
            apiStatus = 'discovered';
        }
      }

      scanResults.push({
        source: api.organization_name,
        type: api.organization_type === 'health_system' ? 'hospital_network' : 'insurance_directory',
        data_found: api.api_endpoint ? ['api_endpoint', 'directory_url'] : ['directory_url'],
        discrepancies: [],
        url: api.directory_url,
        api_endpoint: api.api_endpoint,
        api_status: apiStatus,
      });
    }

    // Check NPPES staleness
    const nppesStaleCheck = checkNPPESStaleness(current_data?.updated_at);

    // Save scan results to database
    const scanRecord = await prisma.magicScanResult.create({
      data: {
        practitionerId: userId,
        npi,
        lastName: last_name,
        state: state || null,
        totalSourcesChecked: scanResults.length,
        totalSourcesFound: apiConnectionResults.filter(r => r.connection_status === 'connected').length,
        totalDiscrepancies: scanResults.reduce((sum, r) => sum + r.discrepancies.length, 0),
        nppesIsStale: nppesStaleCheck.is_stale,
        nppesDaysSinceUpdate: nppesStaleCheck.days_since_update,
        nppesNeedsSync: nppesStaleCheck.needs_sync,
        scanResults: scanResults as any,
        aiSummary: apiDiscoveryText,
        citations: citations || [],
        apiConnectionResults: apiConnectionResults as any,
      },
    });

    console.log('[Magic Scanner] Scan complete and saved to database. ID:', scanRecord.id);

    // Combine results
    const finalResponse = {
      success: true,
      scan_id: scanRecord.id,
      npi,
      last_name,
      state,
      scan_results: scanResults,
      nppes_stale_check: nppesStaleCheck,
      api_discovery: {
        total_organizations_found: discoveredAPIs.length,
        organizations_with_apis: apiConnectionResults.filter(r => r.api_endpoint).length,
        successful_connections: apiConnectionResults.filter(r => r.connection_status === 'connected').length,
        failed_connections: apiConnectionResults.filter(r => r.connection_status === 'failed').length,
        no_api_available: apiConnectionResults.filter(r => r.connection_status === 'no_api_found').length,
      },
      api_connection_results: apiConnectionResults,
      ai_summary: apiDiscoveryText,
      citations: citations,
      scanned_at: new Date().toISOString(),
      total_sources_checked: scanResults.length,
      total_discrepancies: scanResults.reduce((sum, r) => sum + r.discrepancies.length, 0),
    };

    return NextResponse.json(finalResponse);
  } catch (error: any) {
    console.error('[Magic Scanner] Error:', error);
    return NextResponse.json(
      {
        success: false,
        detail: error.message || 'Failed to complete magic scan',
      },
      { status: 500 }
    );
  }
}

function checkNPPESStaleness(lastUpdateDate?: string): NPPESStaleCheck {
  if (!lastUpdateDate) {
    return {
      is_stale: true,
      last_update_date: 'Unknown',
      days_since_update: -1,
      needs_sync: true,
      recommendation: 'Unable to determine last update date. Please verify NPPES data.',
    };
  }

  const updateDate = new Date(lastUpdateDate);
  const now = new Date();
  const daysSinceUpdate = Math.floor(
    (now.getTime() - updateDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const isStale = daysSinceUpdate > 180; // 6 months
  const needsSync = daysSinceUpdate > 365; // 1 year

  let recommendation = '';
  if (needsSync) {
    recommendation =
      'NPPES data is over 1 year old. Immediate sync recommended to ensure accuracy.';
  } else if (isStale) {
    recommendation =
      'NPPES data is over 6 months old. Consider syncing to keep information current.';
  } else {
    recommendation = 'NPPES data is up to date. No action needed.';
  }

  return {
    is_stale: isStale,
    last_update_date: updateDate.toISOString().split('T')[0],
    days_since_update: daysSinceUpdate,
    needs_sync: needsSync,
    recommendation,
  };
}
