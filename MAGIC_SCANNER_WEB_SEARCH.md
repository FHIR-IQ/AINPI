# Magic Scanner - Web Search Implementation

## Current Status

The Magic Scanner is now structured to perform **actual web searches** for provider directories, but there's an important limitation to understand:

### Claude API Web Search Capability

**Important Note**: The base Claude API (Anthropic Messages API) does **NOT** have built-in web browsing or real-time search capabilities by default. The current implementation sends detailed instructions to Claude, but Claude will respond that it cannot perform real-time searches.

## Solution Options

### Option 1: Use Claude with Tool Calling (RECOMMENDED)

Anthropic supports tool calling where you can give Claude access to custom tools, including a web search tool. Here's how:

```typescript
// Add a web search tool
const tools = [
  {
    name: "web_search",
    description: "Search the web for information. Returns search results with titles, URLs, and snippets.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query"
        }
      },
      required: ["query"]
    }
  }
];

// When calling Claude
const message = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 8000,
  tools: tools,
  messages: [{ role: 'user', content: searchPrompt }],
});

// Handle tool use requests from Claude
if (message.stop_reason === 'tool_use') {
  // Execute the web search tool
  // Return results to Claude
  // Continue conversation
}
```

### Option 2: Integrate with Perplexity AI (ALTERNATIVE)

Perplexity AI has built-in web search and can be used as an alternative:

```typescript
import Perplexity from 'perplexity-sdk';

const perplexity = new Perplexity({
  apiKey: process.env.PERPLEXITY_API_KEY
});

const response = await perplexity.query({
  query: `Find provider directories for NPI ${npi} and last name ${last_name} in ${state}`,
  searchRecency: 'month'
});
```

### Option 3: Implement Manual Web Scraping

Build a web scraping service that Claude can call:

```typescript
// Custom web search implementation
async function searchProviderDirectories(npi: string, lastName: string, state: string) {
  const results = [];

  // 1. Search NPPES
  const nppesData = await fetch(`https://npiregistry.cms.hhs.gov/api/?number=${npi}`);
  results.push({ source: 'NPPES', data: nppesData });

  // 2. Search state medical boards
  // 3. Search health system directories
  // 4. Search insurance payer directories

  return results;
}
```

### Option 4: Use Pre-Built Directory APIs

Eventually integrate with existing provider directory APIs:

- **NPPES API**: https://npiregistry.cms.hhs.gov/api/
- **State Medical Board APIs**: Varies by state
- **Insurance Payer APIs**: Requires partnerships
- **Health System APIs**: Usually require credentials

## Implementation Plan

### Phase 1: NPPES Integration (Immediate)

The NPPES database has a public API we can use right now:

```typescript
// Add to magic-scanner/route.ts
async function searchNPPES(npi: string) {
  const response = await fetch(
    `https://npiregistry.cms.hhs.gov/api/?version=2.1&number=${npi}`
  );
  const data = await response.json();

  if (data.result_count > 0) {
    const provider = data.results[0];
    return {
      source: 'NPPES NPI Registry',
      type: 'nppes',
      found_in_directory: true,
      provider_details: {
        name: `${provider.basic.first_name} ${provider.basic.last_name}`,
        npi: provider.number,
        address: provider.addresses[0],
        specialty: provider.taxonomies[0]?.desc,
        last_updated: provider.basic.last_updated
      },
      directory_url: `https://npiregistry.cms.hhs.gov/search?number=${npi}`
    };
  }

  return null;
}
```

### Phase 2: State Medical Board Integration

Many state medical boards offer APIs or structured data:

```typescript
async function searchStateMedicalBoard(state: string, lastName: string) {
  // Example for Virginia
  if (state === 'VA') {
    const response = await fetch(
      `https://www.dhp.virginia.gov/api/lookup?name=${lastName}`
    );
    // Parse response
  }

  // Map of state board APIs
  const stateBoardAPIs = {
    'CA': 'https://mbc.ca.gov/...',
    'NY': 'https://health.ny.gov/...',
    // etc
  };
}
```

### Phase 3: Web Scraping Service

Build a dedicated scraping service for directories:

```typescript
// services/directory-scraper.ts
export async function scrapeProviderDirectory(url: string, npi: string, lastName: string) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto(url);
  await page.type('#npi-input', npi);
  await page.type('#lastname-input', lastName);
  await page.click('#search-button');

  const results = await page.evaluate(() => {
    // Extract provider data from search results
  });

  await browser.close();
  return results;
}
```

### Phase 4: Directory Database (Long-term)

Build a database of all provider directories:

```sql
CREATE TABLE provider_directories (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  type VARCHAR(50), -- 'insurance', 'hospital', 'state_board'
  state VARCHAR(2),
  search_url VARCHAR(500),
  api_endpoint VARCHAR(500),
  requires_auth BOOLEAN,
  scraping_config JSONB,
  last_updated TIMESTAMP
);
```

## Recommended Immediate Action

1. **Add NPPES API integration** (can be done now, no special access needed)
2. **Set up web search tool calling** with Anthropic
3. **Add a few state medical board APIs** for pilot states
4. **Build out gradually** as you get access to more directories

## Updated Prompt Strategy

Even without web search, we can make Claude more useful by:

1. **Providing known directory URLs** in the prompt
2. **Giving Claude instructions** on what to look for
3. **Having Claude generate search URLs** that can be visited
4. **Parsing structured data** from pre-fetched directory pages

## Example Enhanced Implementation

```typescript
// Fetch NPPES data first
const nppesData = await searchNPPES(npi);

// Provide to Claude for analysis
const prompt = `
I have pre-fetched some directory data. Analyze and compare:

NPPES Data:
${JSON.stringify(nppesData, null, 2)}

Current Provider Data:
${JSON.stringify(current_data, null, 2)}

Analyze for discrepancies and provide recommendations.

Also, generate search URLs for these directories:
1. ${state} Medical Board: [construct URL]
2. Blue Cross ${state}: [construct URL]
3. Major health systems in ${state}: [list with URLs]
`;
```

## Next Steps

1. ✅ Restructured prompt for web search execution
2. 🔄 Add NPPES API integration
3. ⏳ Implement tool calling for web search
4. ⏳ Add state medical board lookups
5. ⏳ Build directory database
6. ⏳ Implement web scraping service

## Cost Estimates

### With Web Search Tools
- Claude API: ~$0.04 per scan
- Perplexity API: ~$0.005 per query (cheaper!)
- Web scraping: Infrastructure costs

### Without Web Search (Using Direct APIs)
- NPPES API: Free
- State board APIs: Usually free
- Insurance APIs: Varies (often requires partnership)
- Scraping: Infrastructure only

## Testing

To test the current implementation:

1. Add ANTHROPIC_API_KEY to Vercel
2. Try a scan - Claude will explain it can't search
3. Review the structured prompt - it's ready for tool calling
4. When you add web search tools, results will be real

## Documentation

See [MAGIC_SCANNER.md](MAGIC_SCANNER.md) for user-facing documentation.
