# Perplexity AI Integration - Magic Scanner

## Overview

The Magic Scanner now uses **Perplexity AI** instead of Claude AI. Perplexity has built-in web search capabilities, which means it can actually search provider directories, health systems, and insurance networks across the web in real-time.

## Why Perplexity?

### Advantages over Claude API:
1. **Built-in Web Search** - No need for custom tool calling
2. **Real-time Data** - Searches the web as it responds
3. **Citations Included** - Returns URLs of sources used
4. **Lower Cost** - ~$0.005 per search (vs ~$0.04 with Claude)
5. **Simpler Integration** - Works out of the box

### How It Works:
- Uses `llama-3.1-sonar-large-128k-online` model
- Performs actual web searches during response generation
- Returns both analysis and source citations
- Searches current, live data from the web

## Setup

### 1. Get Perplexity API Key

Go to: https://www.perplexity.ai/settings/api

- Sign up for an account
- Navigate to API settings
- Generate an API key
- Copy the key (starts with `pplx-...`)

### 2. Add to Vercel Environment Variables

In Vercel Dashboard → Project Settings → Environment Variables:

```bash
PERPLEXITY_API_KEY=pplx-your-api-key-here
```

Add to all environments (Production, Preview, Development)

### 3. Local Development

Create/update `.env.local`:

```bash
PERPLEXITY_API_KEY=pplx-your-api-key-here
```

## Implementation Details

### API Call

```typescript
const perplexity = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: 'https://api.perplexity.ai',
});

const response = await perplexity.chat.completions.create({
  model: 'llama-3.1-sonar-large-128k-online', // Online model with web search
  messages: [
    {
      role: 'system',
      content: 'You are a healthcare provider directory search assistant with web search capabilities.'
    },
    {
      role: 'user',
      content: searchPrompt
    }
  ],
  temperature: 0.2,
  max_tokens: 4000,
});
```

### Response Structure

```json
{
  "choices": [{
    "message": {
      "content": "AI analysis text with real search results..."
    }
  }],
  "citations": [
    "https://provider-directory-url-1.com",
    "https://health-system-url-2.com",
    "https://insurance-payer-url-3.com"
  ]
}
```

## What Gets Searched

Perplexity AI will perform real web searches for:

### 1. Health Systems by State
- Major hospital systems
- University medical centers
- Regional health networks

### 2. Insurance Payers by State
- Blue Cross Blue Shield variants
- UnitedHealthcare networks
- Anthem/Elevance providers
- Aetna networks
- Cigna directories
- Regional/local payers

### 3. Provider Directories
For each system/payer found:
- Searches their "Find a Doctor" pages
- Looks up provider by NPI
- Cross-references with last name
- Extracts contact info, specialties, locations

### 4. Public Databases
- NPPES NPI Registry (also queried directly via API)
- State medical board license lookups
- Hospital affiliations

## Features

### Real Web Search
✅ Actually visits and searches provider directories
✅ Finds current, up-to-date information
✅ Discovers providers in multiple networks
✅ Identifies discrepancies across sources

### Source Citations
✅ Returns URLs of all sources consulted
✅ Clickable links to verify information
✅ Transparent about where data comes from

### Comparison Analysis
✅ Compares found data with current profile
✅ Flags discrepancies by severity
✅ Provides recommendations

## Cost Analysis

### Perplexity Pricing
- Model: Llama 3.1 Sonar Large (128k) Online
- Input: $1 per million tokens
- Output: $1 per million tokens
- Request: ~1500 input + 2000 output tokens
- **Cost per scan: ~$0.0035** (less than 1 cent!)

### Comparison
| Provider | Cost per Scan | Has Web Search |
|----------|--------------|----------------|
| Perplexity AI | $0.0035 | ✅ Built-in |
| Claude API | $0.04 | ❌ Requires tools |
| GPT-4 + Bing | $0.06 | ⚠️ Complex setup |

## Example Search Flow

1. **User enters**: NPI `1234567890`, Last Name `Smith`, State `VA`

2. **NPPES API**: Direct query returns baseline data

3. **Perplexity searches**:
   - "Virginia health systems"
   - Finds: VCU Health, Sentara, Inova, UVA Health
   - Searches each directory for NPI 1234567890

4. **Insurance payers**:
   - "Virginia health insurance companies"
   - Finds: Anthem BCBS VA, UnitedHealthcare, Aetna
   - Searches provider networks

5. **Results**:
   - Found in 3 health systems
   - Found in 5 insurance networks
   - 2 discrepancies detected (phone, address)
   - 8 citation URLs provided

## Testing

### Test with Real NPI

Try scanning with a real provider:
- NPI: `1467560190` (Example public NPI)
- Last Name: `Smith`
- State: `CA`

### Expected Results
- NPPES data returned immediately
- Perplexity searches CA health systems
- Finds Kaiser, Sutter Health, UCLA Health, etc.
- Searches their directories
- Returns citations to actual directory pages
- Compares data across sources

## Troubleshooting

### "Unauthorized" or "Invalid API Key"
- Check PERPLEXITY_API_KEY is set in Vercel
- Verify key is correct (starts with `pplx-`)
- Ensure key has credits/active subscription

### No Results Found
- Perplexity may not find provider in all directories
- Some directories require authentication
- Not all providers are listed publicly
- Results depend on web-accessible data

### Slow Response
- Web searches take 10-30 seconds (normal)
- Depends on Perplexity API speed
- Multiple directory searches increase time

### Citations Empty
- Model may not always return citations
- Check response format in logs
- Citations are extracted from `response.citations`

## Rate Limits

### Perplexity Rate Limits
- Free tier: 20 requests/day
- Standard: 5,000 requests/month
- Pro: 10,000 requests/month
- Enterprise: Custom limits

### Recommendations
- Implement caching (24-hour cache for same NPI)
- Rate limit users (10 scans/day per user)
- Monitor usage in Perplexity dashboard

## Security

### API Key Protection
- ✅ Stored as environment variable
- ✅ Not exposed to frontend
- ✅ Server-side only
- ❌ Never commit to git

### Data Privacy
- Perplexity processes search queries
- No PHI should be sent (NPI and name are public)
- Review Perplexity's privacy policy
- Consider BAA if needed for compliance

## Migration from Claude

### Changes Made
1. Replaced `@anthropic-ai/sdk` with `openai` SDK
2. Changed API endpoint to `https://api.perplexity.ai`
3. Updated model to `llama-3.1-sonar-large-128k-online`
4. Added citations display in frontend
5. Updated documentation

### Backward Compatibility
- API response format unchanged
- Frontend displays citations if available
- Falls back gracefully if no citations

## Future Enhancements

### Planned Features
1. **Cache search results** - Store for 24 hours
2. **Batch scanning** - Multiple providers at once
3. **Scheduled scans** - Automatic weekly checks
4. **Alert system** - Email when discrepancies found
5. **Custom directories** - Add user-specific sources

### Advanced Integration
- Combine with direct API access to directories
- Build database of all provider directories
- Implement intelligent result merging
- Add confidence scores to findings

## Support Resources

- Perplexity API Docs: https://docs.perplexity.ai/
- API Dashboard: https://www.perplexity.ai/settings/api
- Pricing: https://www.perplexity.ai/api
- Status Page: https://status.perplexity.ai/

## Getting Help

1. Check Vercel function logs for errors
2. Verify PERPLEXITY_API_KEY is set
3. Test with known good NPI numbers
4. Review Perplexity API dashboard for usage/errors
5. Check citation URLs are being returned
