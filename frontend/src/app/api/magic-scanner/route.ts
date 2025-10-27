import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromToken } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
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

    const { npi, last_name, state, current_data } = await request.json();

    if (!npi || !last_name) {
      return NextResponse.json(
        { detail: 'NPI and last name are required' },
        { status: 400 }
      );
    }

    console.log('[Magic Scanner] Scanning for NPI:', npi, 'Last Name:', last_name);

    // Build the prompt for Claude to search provider directories
    const searchPrompt = `You are an AI assistant helping to scan healthcare provider directories and insurance networks.

Task: Search for information about a healthcare provider with the following details:
- NPI: ${npi}
- Last Name: ${last_name}
${state ? `- State: ${state}` : ''}

Search these types of sources:
1. Major insurance provider directories (UnitedHealthcare, Anthem, Blue Cross Blue Shield, Aetna, Cigna)
2. State medical board directories
3. Hospital and health system directories
4. CMS NPPES database
5. State-specific provider directories

For each source where you find information, provide:
- Source name
- Type of directory (insurance, provider, state_board, etc)
- What data fields are available (name, address, phone, specialties, etc)
- Any discrepancies compared to current data
- Last update date if available
- URL if applicable

Current provider data for comparison:
${JSON.stringify(current_data, null, 2)}

Format your response as a JSON array of findings. Each finding should include:
{
  "source": "Source Name",
  "type": "insurance_directory|provider_directory|hospital_network|state_board|nppes",
  "data_found": ["field1", "field2", ...],
  "discrepancies": [
    {
      "field": "field_name",
      "found_value": "value in directory",
      "current_value": "value in our system",
      "severity": "high|medium|low"
    }
  ],
  "last_updated": "YYYY-MM-DD or description",
  "url": "https://..."
}

IMPORTANT: Be factual and only report what you can reasonably find or infer. If you cannot find information, say so. Focus on publicly accessible information.`;

    console.log('[Magic Scanner] Calling Claude API...');

    // Call Claude API for web search and analysis
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: searchPrompt,
        },
      ],
    });

    console.log('[Magic Scanner] Claude API response received');

    // Extract text content from Claude's response
    const responseText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as any).text)
      .join('\n');

    // Try to parse JSON from the response
    let scanResults: ScanResult[] = [];
    try {
      // Look for JSON array in the response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        scanResults = JSON.parse(jsonMatch[0]);
      } else {
        // If no JSON found, create a summary result
        scanResults = [
          {
            source: 'AI Analysis',
            type: 'provider_directory',
            data_found: ['analysis_summary'],
            discrepancies: [],
            last_updated: new Date().toISOString().split('T')[0],
          },
        ];
      }
    } catch (parseError) {
      console.log('[Magic Scanner] Could not parse JSON, using raw response');
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
    const response = {
      success: true,
      npi,
      last_name,
      state,
      scan_results: scanResults,
      nppes_stale_check: nppesStaleCheck,
      ai_summary: responseText,
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
      'sources'
    );

    return NextResponse.json(response);
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
