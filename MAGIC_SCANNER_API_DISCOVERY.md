# Magic Scanner: 3-Step API Discovery & Connection Testing

## Overview

The Magic Scanner has been enhanced from a simple web search tool into an intelligent **API Discovery and Connection Testing System** that builds a growing registry of provider directory APIs.

## The 3-Step Process

### Step 1: Direct NPPES Search
- **Purpose:** Get baseline provider data from the official CMS registry
- **Method:** Direct API call to `https://npiregistry.cms.hhs.gov/api/`
- **Data Retrieved:** NPI, name, address, phone, taxonomy, last update date
- **Staleness Check:** Flags data >6 months old (stale) or >1 year old (needs sync)

### Step 2: AI-Powered API Discovery
- **Purpose:** Discover health systems, insurance payers, and their APIs
- **Method:** Perplexity AI web search with structured prompts
- **Discovers:**
  - Major health systems in the specified state
  - Major insurance payers in the specified state
  - Provider directory URLs for each organization
  - **Public API endpoints** (if available)
  - API documentation URLs
  - API capabilities (supports NPI search, name search, etc.)
  - Authentication requirements

**AI Prompt Structure:**
```
1. Search for health systems in [STATE]
2. Search for insurance payers in [STATE]
3. For each organization, find:
   - Provider directory website
   - Public API endpoint (e.g., https://api.example.com/v1/providers)
   - API documentation
   - Whether API supports NPI/name searches
   - Authentication requirements
```

### Step 3: Automated API Connection Testing
- **Purpose:** Test discovered APIs and build working registry
- **Method:** Direct HTTP requests with timeout and error handling
- **Tests Performed:**
  - Connection test (10 second timeout)
  - Response time measurement
  - Status code verification
  - Authentication detection (401/403 = endpoint exists but requires auth)

**Connection Statuses:**
- ✅ **Connected:** API responded successfully or requires auth (200, 401, 403)
- ⚠️ **Testing:** Currently testing connection
- ❌ **Failed:** Connection failed or timed out
- 📋 **No API Found:** Organization has web directory but no public API
- 🔍 **Discovered:** API found but not yet tested

## Database Schema

### ProviderDirectoryAPI Model
Stores discovered and tested API endpoints for future reuse.

```prisma
model ProviderDirectoryAPI {
  id                  String   @id @default(uuid())
  organizationName    String
  organizationType    String   // 'health_system' | 'insurance_payer' | 'state_board'
  state               String?
  apiEndpoint         String
  apiType             String   // 'rest' | 'fhir' | 'soap' | 'web_scrape'
  apiDocUrl           String?
  requiresAuth        Boolean
  authType            String?  // 'api_key' | 'oauth' | 'basic' | 'none'
  supportsNpiSearch   Boolean
  supportsNameSearch  Boolean
  status              String   // 'discovered' | 'tested' | 'active' | 'inactive'
  lastTestedAt        DateTime?
  lastSuccessAt       DateTime?
  consecutiveFailures Int
  avgResponseTimeMs   Int?
  successRate         Float?
  discoveredBy        String   // 'manual' | 'ai_scanner' | 'import'

  @@unique([organizationName, apiEndpoint])
}
```

### MagicScanResult Model
Stores complete scan history with AI analysis and API test results.

```prisma
model MagicScanResult {
  id                    String   @id @default(uuid())
  practitionerId        String?
  npi                   String
  lastName              String
  state                 String?
  totalSourcesChecked   Int
  totalSourcesFound     Int
  totalDiscrepancies    Int
  nppesIsStale          Boolean?
  nppesDaysSinceUpdate  Int?
  nppesNeedsSync        Boolean?
  scanResults           Json     // Full results from all sources
  aiSummary             String?
  citations             Json?    // Web sources used
  apiConnectionResults  Json?    // All API test results
  scannedAt             DateTime
}
```

## API Response Format

### Magic Scanner POST /api/magic-scanner

**Request:**
```json
{
  "npi": "1234567890",
  "last_name": "Smith",
  "state": "VA",
  "current_data": {
    "first_name": "John",
    "last_name": "Smith",
    // ... other fields
  }
}
```

**Response:**
```json
{
  "success": true,
  "scan_id": "uuid",
  "npi": "1234567890",
  "last_name": "Smith",
  "state": "VA",

  "nppes_stale_check": {
    "is_stale": false,
    "last_update_date": "2025-06-15",
    "days_since_update": 45,
    "needs_sync": false,
    "recommendation": "NPPES data is up to date. No action needed."
  },

  "api_discovery": {
    "total_organizations_found": 12,
    "organizations_with_apis": 8,
    "successful_connections": 5,
    "failed_connections": 3,
    "no_api_available": 4
  },

  "api_connection_results": [
    {
      "organization_name": "Sentara Healthcare",
      "organization_type": "health_system",
      "api_endpoint": "https://api.sentara.com/v1/providers",
      "api_type": "rest",
      "connection_status": "connected",
      "supports_npi_search": true,
      "supports_name_search": true,
      "response_time_ms": 245,
      "tested_at": "2025-10-27T23:50:15Z"
    },
    {
      "organization_name": "Anthem Blue Cross Blue Shield Virginia",
      "organization_type": "insurance_payer",
      "api_endpoint": "https://api.anthem.com/fhir/r4/Practitioner",
      "api_type": "fhir",
      "connection_status": "connected",
      "supports_npi_search": true,
      "supports_name_search": false,
      "response_time_ms": 412,
      "tested_at": "2025-10-27T23:50:18Z"
    },
    {
      "organization_name": "HCA Virginia Health System",
      "organization_type": "health_system",
      "connection_status": "no_api_found",
      "api_type": "web_scrape",
      "tested_at": "2025-10-27T23:50:20Z"
    }
  ],

  "scan_results": [
    {
      "source": "NPPES NPI Registry (CMS)",
      "type": "nppes",
      "data_found": ["npi", "name", "address"],
      "api_endpoint": "https://npiregistry.cms.hhs.gov/api/",
      "api_status": "active",
      "discrepancies": []
    }
  ],

  "ai_summary": "Detailed AI analysis of findings...",
  "citations": ["https://...", "https://..."],
  "scanned_at": "2025-10-27T23:50:25Z",
  "total_sources_checked": 12,
  "total_discrepancies": 2
}
```

## Frontend UI Features

### Summary Dashboard
Shows key metrics at a glance:
- **Organizations Found:** Total discovered
- **APIs Connected:** Successfully tested
- **APIs Failed:** Connection failures
- **Discrepancies:** Data mismatches
- **Scan Time:** When scan completed

### API Discovery & Connection Tests Section
For each discovered organization:
- Organization name and type (health system/payer)
- Connection status badge with color coding
- API endpoint (formatted as code block)
- API type (REST, FHIR, SOAP, Web Scrape)
- Capabilities:
  - ✅ Supports NPI Search
  - ✅ Supports Name Search
  - ⏱️ Response time (milliseconds)
- Error messages for failed connections
- Success indicator when API is saved to registry

### Connection Status Badges

| Status | Badge | Meaning |
|--------|-------|---------|
| Connected | 🟢 Green | API endpoint is active and responding |
| Testing | 🔵 Blue | Currently testing the connection |
| Failed | 🔴 Red | Connection failed or timed out |
| No API | ⚫ Gray | Only web directory available (scraping needed) |
| Discovered | 🟡 Yellow | Found but not yet tested |

## Use Cases

### 1. Initial Provider Onboarding
- Scan new provider's NPI to discover all their directory listings
- Build initial API connection list for their health systems
- Identify which payers they're listed with

### 2. Data Quality Monitoring
- Periodic scans to detect when NPPES data becomes stale
- Automated alerts when data is >6 months old
- Quick sync recommendations

### 3. API Registry Building
- Over time, builds comprehensive list of working provider APIs
- Enables automated data sync in the future
- Tracks which APIs are most reliable

### 4. Competitive Intelligence
- Discover which health systems have public APIs
- Track which payers provide API access
- Identify opportunities for integration

## Future Enhancements

### Phase 2: Automated API Authentication
- Store API credentials securely
- Automatically authenticate for full data access
- Retry failed connections with authentication

### Phase 3: Automated Data Sync
- Use registry of working APIs for automated provider data updates
- Schedule regular syncs with connected APIs
- Compare data across sources automatically

### Phase 4: Provider Directory Search
- Use connected APIs to actually search for provider data
- Return real results from each directory
- Full discrepancy analysis with current data

### Phase 5: Bulk Operations
- Scan entire provider roster at once
- Build organization-wide API registry
- Batch data synchronization

## Configuration

### Environment Variables
```bash
PERPLEXITY_API_KEY=pplx-xxxxxxxxxxxx  # Required for AI discovery
```

### Cost Estimates
- **Perplexity API:** ~$0.005 per scan (sonar-pro model)
- **API Connection Tests:** Free (just HTTP requests)
- **Database Storage:** Minimal (~1-2 KB per scan result)

### Rate Limits
- **Perplexity API:** Varies by plan (typically 50-100 requests/minute)
- **NPPES API:** No published limit (public endpoint)
- **Connection Tests:** Limited to 10 second timeout each

## Security Considerations

1. **API Keys:** Never expose in frontend, only server-side
2. **Connection Tests:** Use User-Agent header to identify requests
3. **Timeouts:** Prevent hanging connections (10s max)
4. **Error Handling:** Don't expose internal error details to users
5. **Database:** Store API credentials encrypted (future feature)

## Troubleshooting

### No APIs Discovered
- Check if Perplexity API key is configured
- Try more specific state or region
- Some organizations may not have public APIs

### All Connections Failing
- Check network/firewall settings
- Verify timeout isn't too aggressive
- Some APIs may require authentication header

### Slow Scan Times
- Normal: 15-30 seconds for full scan
- AI discovery: 10-15 seconds
- Connection tests: 1-2 seconds per API
- Reduce organizations to scan for faster results

## Example Workflow

1. **Provider enters NPI** → Clicks "Start Magic Scan"
2. **Step 1 executes** → NPPES data retrieved in 1-2 seconds
3. **Step 2 executes** → AI discovers 10-15 organizations in 10-15 seconds
4. **Step 3 executes** → Tests 10-15 APIs in 10-20 seconds
5. **Results displayed:**
   - NPPES freshness check
   - 5-8 successful API connections saved to registry
   - 2-3 failed connections with error messages
   - 3-4 organizations with only web directories
   - Full AI analysis with citations
6. **Future scans use registry** → Faster, more targeted searches

## Conclusion

The 3-step Magic Scanner transforms provider directory searching from manual web browsing into an automated, intelligent system that:

✅ **Discovers** provider directories automatically
✅ **Tests** API connections in real-time
✅ **Builds** a reusable registry of working APIs
✅ **Enables** future automated data synchronization
✅ **Scales** across the entire platform

This foundation enables ProviderCard to become a true **data orchestration platform** that automatically keeps provider information up-to-date across hundreds of directories and payer networks.
