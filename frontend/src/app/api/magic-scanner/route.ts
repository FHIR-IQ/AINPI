import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromToken } from '@/lib/auth';
import OpenAI from 'openai';

// Use OpenAI SDK with Perplexity API
const perplexity = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY || '',
  baseURL: 'https://api.perplexity.ai',
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
}

interface NPPESStaleCheck {
  is_stale: boolean;
  last_update_date: string;
  days_since_update: number;
  needs_sync: boolean;
  recommendation: string;
}

export async function POST(request: NextRequest) {
  try {
    console.log('[Magic Scanner] Request received');

    const userId = getUserIdFromToken(request);
    if (!userId) {
      return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
    }

    // Check if Perplexity API key is configured
    if (!process.env.PERPLEXITY_API_KEY) {
      console.error('[Magic Scanner] PERPLEXITY_API_KEY not configured');
      return NextResponse.json(
        {
          success: false,
          detail: 'Magic Scanner is not configured. Please add PERPLEXITY_API_KEY environment variable.',
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

    console.log('[Magic Scanner] Scanning for NPI:', npi, 'Last Name:', last_name);

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

    // Build the structured prompt for Claude to perform actual web searches
    const searchPrompt = `You are a healthcare provider directory search assistant with web browsing capabilities.

TASK: Perform actual web searches to find real information about this healthcare provider:
- NPI Number: ${npi}
- Last Name: ${last_name}
${state ? `- State: ${state}` : ''}

STEP 1 - Find Health Systems in ${state || 'the state'}:
Search for: "${state || 'state'} health systems", "${state || 'state'} hospital systems", "major hospitals ${state || ''}"
Look for: Large health systems like [State] Health, University Medical Center, Regional Health System, etc.

STEP 2 - Find Health Insurance Payers in ${state || 'the state'}:
Search for: "${state || 'state'} health insurance companies", "major payers ${state || ''}", "${state || 'state'} medicaid managed care"
Look for: Blue Cross Blue Shield ${state || ''}, UnitedHealthcare, Anthem, Aetna, Cigna, Humana, local payers

STEP 3 - Search Provider Directories:
For EACH health system and payer found, search their provider directory:
- Search: "[Health System Name] provider directory" or "[Health System Name] find a doctor"
- Once on directory page, search by NPI: ${npi} AND last name: ${last_name}
- Insurance payer directories: "[Payer Name] provider search" or "[Payer Name] find a doctor"
- Search by NPI: ${npi} AND last name: ${last_name}

STEP 4 - Search NPPES:
- Go to https://npiregistry.cms.hhs.gov/
- Search for NPI: ${npi}
- Verify last name matches: ${last_name}
- Note last update date

STEP 5 - Search State Medical Board:
- Search: "${state || 'state'} medical board license lookup"
- Search by last name: ${last_name} and cross-reference with NPI if possible

CURRENT PROVIDER DATA (for comparison):
${JSON.stringify(current_data, null, 2)}

OUTPUT FORMAT - Return JSON array with your ACTUAL FINDINGS:
[
  {
    "source": "Exact name of health system/payer/board",
    "type": "insurance_directory|hospital_network|nppes|state_board",
    "search_performed": "Describe what you searched",
    "found_in_directory": true/false,
    "data_found": ["name", "address", "phone", "specialty", etc],
    "provider_details": {
      "name": "exact name found",
      "npi": "npi found",
      "address": "full address",
      "phone": "phone number",
      "specialty": "specialty found",
      "accepting_patients": true/false/unknown,
      "last_updated": "date if visible"
    },
    "discrepancies": [
      {
        "field": "field_name",
        "found_value": "value in their directory",
        "current_value": "value in our system",
        "severity": "high|medium|low"
      }
    ],
    "directory_url": "actual URL you found",
    "notes": "any additional observations"
  }
]

CRITICAL INSTRUCTIONS:
1. Actually perform web searches - do not say "I cannot search"
2. Visit actual health system and payer websites
3. Look for "Find a Doctor", "Provider Directory", "Provider Search" pages
4. Search each directory by NPI ${npi} and last name ${last_name}
5. Record EXACTLY what you find (or don't find)
6. Compare found data to current_data and flag discrepancies
7. Note if directories don't have the provider listed
8. Include actual URLs you visited
9. Be thorough - search at least 3-5 health systems and 3-5 payers in ${state || 'the state'}
10. If you can't find something, say "Not found" - don't make up data

START YOUR WEB SEARCH NOW.`;

    console.log('[Magic Scanner] Calling Perplexity AI with web search...');

    // Call Perplexity AI - it has built-in web search capabilities
    const response = await perplexity.chat.completions.create({
      model: 'llama-3.1-sonar-large-128k-online', // Online model with web search
      messages: [
        {
          role: 'system',
          content: 'You are a healthcare provider directory search assistant. You have web search capabilities and should use them to find real, current information about providers in directories, health systems, and insurance networks. Always search the web for actual data.'
        },
        {
          role: 'user',
          content: searchPrompt,
        },
      ],
      temperature: 0.2, // Lower temperature for more factual responses
      max_tokens: 4000,
    });

    console.log('[Magic Scanner] Perplexity AI response received');

    // Extract text content from Perplexity's response
    const responseText = response.choices[0]?.message?.content || '';
    const citations = (response as any).citations || [];

    // Try to parse JSON from the response
    let scanResults: ScanResult[] = [];

    // Add NPPES result first if we have it
    if (nppesResult) {
      scanResults.push(nppesResult);
    }
    try {
      // Look for JSON array in the response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsedResults = JSON.parse(jsonMatch[0]);

        // Transform the response to match our ScanResult interface and add to existing results
        const claudeResults = parsedResults.map((result: any) => ({
          source: result.source || 'Unknown Source',
          type: result.type || 'provider_directory',
          data_found: result.data_found || [],
          discrepancies: result.discrepancies || [],
          last_updated: result.provider_details?.last_updated || result.last_updated || 'Unknown',
          url: result.directory_url || result.url,
          search_performed: result.search_performed,
          found_in_directory: result.found_in_directory,
          provider_details: result.provider_details,
          notes: result.notes,
        }));

        scanResults.push(...claudeResults);
        console.log('[Magic Scanner] Successfully parsed', claudeResults.length, 'Claude results');
      } else if (scanResults.length === 0) {
        // If no JSON found and no NPPES result, create a summary result
        console.log('[Magic Scanner] No JSON found, creating summary result');
        scanResults.push({
          source: 'AI Web Search Analysis',
          type: 'provider_directory',
          data_found: ['search_summary'],
          discrepancies: [],
          last_updated: new Date().toISOString().split('T')[0],
        });
      }
    } catch (parseError) {
      console.error('[Magic Scanner] JSON parse error:', parseError);
      scanResults = [
        {
          source: 'AI Analysis Summary',
          type: 'provider_directory',
          data_found: ['raw_analysis'],
          discrepancies: [],
          last_updated: new Date().toISOString().split('T')[0],
        },
      ];
    }

    // Check NPPES staleness
    const nppesStaleCheck = checkNPPESStaleness(current_data?.updated_at);

    // Combine results
    const finalResponse = {
      success: true,
      npi,
      last_name,
      state,
      scan_results: scanResults,
      nppes_stale_check: nppesStaleCheck,
      ai_summary: responseText,
      citations: citations, // Include Perplexity's web citations
      scanned_at: new Date().toISOString(),
      total_sources_checked: scanResults.length,
      total_discrepancies: scanResults.reduce(
        (sum, r) => sum + r.discrepancies.length,
        0
      ),
    };

    console.log(
      '[Magic Scanner] Scan complete. Found',
      scanResults.length,
      'sources with',
      citations.length,
      'citations'
    );

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
