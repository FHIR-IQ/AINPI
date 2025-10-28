# Real-Time Provider Search

## Overview

The **Real-Time Provider Search** feature queries major payer APIs on-demand for fresh provider data, eliminating the need to store and maintain massive provider directories.

## The Problem We're Solving

**Bad Approach:** Download and store full provider directories
- ❌ Massive data storage (millions of providers)
- ❌ Constant updates needed (data changes daily)
- ❌ Stale data (becomes outdated quickly)
- ❌ Maintenance burden (syncing, deduplication)

**Our Approach:** Query payer APIs in real-time on-demand
- ✅ Always current data (directly from source)
- ✅ Zero storage (no database bloat)
- ✅ No maintenance (payers manage their own data)
- ✅ Compare across multiple payers instantly

## How It Works

### Architecture

```
User enters NPI
     ↓
/api/provider-search
     ↓
Queries 6 payer APIs in parallel
     ↓
Aggregates results in 5-10 seconds
     ↓
Returns fresh provider data
```

### Connected Payers (Public APIs)

1. **Elevance Health (Anthem)** - 47M+ covered lives
2. **Centene Corporation** - 27M+ (Medicaid/Marketplace)
3. **Humana** - 17M+ (Medicare Advantage)
4. **Kaiser Permanente** - 12M+ (Integrated system)
5. **HCSC (BCBS)** - 15M+ (5-state Blue Cross)
6. **Molina Healthcare** - 5M+ (Government plans)

**Total Coverage:** 123M+ Americans across 6 payers

### FHIR Standard

All searches use **HL7 FHIR R4** Practitioner resources:
```
GET {endpoint}/Practitioner?identifier={npi}
```

## API Endpoint

### POST /api/provider-search

**Request:**
```json
{
  "npi": "1234567890",
  "include_inactive": false  // optional
}
```

**Response:**
```json
{
  "success": true,
  "npi": "1234567890",
  "summary": {
    "total_payers_searched": 6,
    "found_in_payers": 3,
    "not_found_in_payers": 3,
    "average_response_time_ms": 245
  },
  "results": [
    {
      "payer": "Humana",
      "found": true,
      "status": "success",
      "data": {
        "npi": "1234567890",
        "name": {
          "first": "John",
          "last": "Smith",
          "middle": "Robert",
          "prefix": "Dr.",
          "suffix": "MD"
        },
        "gender": "male",
        "specialties": [
          {
            "code": "207R00000X",
            "display": "Internal Medicine"
          }
        ],
        "languages": ["English", "Spanish"],
        "last_updated": "2025-10-15T10:30:00Z"
      },
      "response_time_ms": 189
    },
    {
      "payer": "Kaiser Permanente",
      "found": false,
      "status": "not_found",
      "response_time_ms": 267
    }
  ],
  "searched_at": "2025-10-28T01:15:30Z"
}
```

### Status Codes

- `success` - Provider found, data returned
- `not_found` - Provider not in this payer's network
- `auth_required` - API requires OAuth (UnitedHealthcare, Aetna, Cigna)
- `error` - API timeout or other error

## Frontend Page

### Location: /provider-search

**Features:**
- Simple NPI search input (10-digit validation)
- Real-time search across 6 payers
- Summary statistics
- Results by payer with status badges
- Provider details display
- Response time tracking

### UI Components

**Search Form:**
- NPI input with validation
- "Search Payer Directories" button
- Loading state with spinner

**Summary Stats:**
- Payers Searched: 6
- Found In: 3
- Avg Response: 245ms

**Results by Payer:**
- Color-coded by status (green=found, gray=not found)
- Provider name and NPI
- Specialties (if available)
- Languages spoken
- Last updated timestamp
- Response time per payer

## Data Extracted

From FHIR Practitioner resource:

### Always Available:
- NPI (identifier)
- Name (first, last, middle, prefix, suffix)
- Gender

### Often Available:
- Specialties (code + display)
- Languages spoken
- Last updated date

### Requires PractitionerRole:
- Practice locations
- Phone numbers
- Networks/insurance plans
- Accepting new patients status

**Note:** Current version extracts Practitioner data only. Future enhancement will query PractitionerRole for location/network details.

## Performance

### Typical Response Times

| Payer | Avg Response Time |
|-------|-------------------|
| Humana | 150-250ms |
| Anthem | 200-400ms |
| Centene | 180-350ms |
| Kaiser | 200-300ms |
| HCSC | 150-250ms |
| Molina | 180-320ms |

**Total Search Time:** 5-10 seconds (parallel execution)

### Optimizations

- **Parallel Requests:** All 6 APIs searched simultaneously
- **10s Timeout:** Prevents hanging on slow APIs
- **Early Returns:** Fast APIs return immediately
- **No Data Storage:** Zero database overhead

## Use Cases

### 1. Network Verification

Check if provider is in specific payer networks:

```
Input: NPI 1234567890
Result: Found in Humana ✓, Anthem ✓, Kaiser ✗
Conclusion: Provider is in Humana and Anthem networks
```

### 2. Data Comparison

Compare provider data across payers:

```
Humana says: "John R. Smith, MD - Internal Medicine"
Anthem says: "John Smith, MD - Family Medicine"
→ Discrepancy detected: Specialty mismatch
```

### 3. Current Credentialing

Get latest provider information:

```
Last Updated:
- Humana: 2025-10-15 (13 days ago)
- Anthem: 2025-09-20 (38 days ago)
→ Humana has more recent data
```

### 4. Language Services

Find providers speaking specific languages:

```
Search: NPI 1234567890
Found: English, Spanish, Mandarin
→ Multilingual provider
```

### 5. Specialty Verification

Confirm provider's specialty:

```
Found in 3 payers:
- Humana: Internal Medicine
- Anthem: Internal Medicine
- Centene: Internal Medicine
→ Confirmed specialty across networks
```

## Example Usage

### Via API (cURL)

```bash
curl -X POST https://your-app.vercel.app/api/provider-search \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"npi": "1234567890"}'
```

### Via Frontend

1. Go to https://your-app.vercel.app/provider-search
2. Enter NPI: `1234567890`
3. Click "Search Payer Directories"
4. View results across 6 payers (5-10 seconds)

### Via JavaScript

```javascript
const response = await fetch('/api/provider-search', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ npi: '1234567890' }),
});

const data = await response.json();
console.log(`Found in ${data.summary.found_in_payers} payers`);
```

## Limitations

### Current Version

1. **Public Endpoints Only:** Only searches 6 payers with public APIs
   - Missing: UnitedHealthcare, Aetna, Cigna (require OAuth)

2. **Practitioner Data Only:** Extracts from Practitioner resource
   - Missing: Locations, phone numbers (requires PractitionerRole)

3. **No Caching:** Every search hits live APIs
   - Could add temporary cache for performance

4. **10s Timeout:** Some slow APIs may timeout
   - Could increase timeout or implement retries

### Future Enhancements

**Phase 2: OAuth Support**
- Add UnitedHealthcare, Aetna, Cigna
- Secure credential storage
- Automatic token refresh
- Total: 9 payers instead of 6

**Phase 3: PractitionerRole Lookup**
- Query for locations and networks
- Extract phone numbers and addresses
- Get "accepting patients" status
- Return insurance plan details

**Phase 4: Temporary Caching**
- Cache results for 1 hour
- Faster subsequent searches
- Reduce API load
- Clear cache on demand

**Phase 5: Bulk Search**
- Search multiple NPIs at once
- Export results to CSV/Excel
- Batch network verification
- Provider roster updates

## Comparison: Real-Time vs Stored

### Storing Full Directories

**Pros:**
- Fast queries (database lookup)
- No API dependency
- Works offline

**Cons:**
- Massive storage (millions of providers)
- Daily updates required
- Data becomes stale
- Sync complexity
- Deduplication needed
- Legal/compliance issues (data ownership)

### Real-Time Search (Our Approach)

**Pros:**
- Always current data
- Zero storage overhead
- No maintenance
- Payers own their data
- Compare across sources
- No compliance issues

**Cons:**
- Requires API calls (5-10s)
- Depends on payer API uptime
- API rate limits
- Some APIs require OAuth

## Best Practices

### When to Use Real-Time Search

✅ **Good for:**
- Individual provider lookups
- Network verification
- Data comparison across payers
- Current credentialing checks
- Ad-hoc queries

❌ **Not ideal for:**
- Searching entire provider database
- Autocomplete/type-ahead
- Batch processing thousands of NPIs
- Offline access requirements

### Performance Tips

1. **Search during off-peak hours** (early morning)
2. **Use specific NPIs** (not broad searches)
3. **Cache results locally** (browser storage)
4. **Monitor API limits** (rate throttling)

### Error Handling

```javascript
const result = results.find(r => r.payer === 'Humana');

if (result.status === 'success') {
  // Use result.data
} else if (result.status === 'not_found') {
  // Provider not in this network
} else if (result.status === 'auth_required') {
  // OAuth needed
} else {
  // API error - try again later
}
```

## Monitoring

Track these metrics:

- **Success Rate:** % of successful searches
- **Response Times:** Average per payer
- **Error Rate:** % of failed API calls
- **Timeout Rate:** % of searches timing out
- **Found Rate:** % of NPIs found across payers

## Conclusion

Real-time provider search eliminates the burden of storing and maintaining massive provider directories. By querying payer APIs on-demand, we get:

✅ **Always current data** from authoritative sources
✅ **Zero storage overhead** - no database bloat
✅ **Cross-payer comparison** - detect discrepancies
✅ **No maintenance** - payers manage their own data
✅ **Compliance friendly** - no data ownership issues

This is the scalable, maintainable approach to provider directory access!
