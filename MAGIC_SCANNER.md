# Magic Scanner - AI-Powered Provider Directory Search

## Overview

The Magic Scanner is an AI-powered feature that uses Claude AI to automatically scan healthcare provider directories, insurance networks, and state medical boards to find publicly available information about providers based on their NPI and last name.

## Features

### 1. **AI-Powered Directory Search**
- Scans major insurance provider directories (UnitedHealthcare, Anthem, BCBS, Aetna, Cigna)
- Searches state medical board directories
- Checks hospital and health system networks
- Reviews CMS NPPES database
- Searches state-specific provider directories

### 2. **Discrepancy Detection**
- Compares found information with current profile data
- Flags mismatches and inconsistencies
- Severity levels: High, Medium, Low
- Provides recommendations for resolution

### 3. **NPPES Staleness Detection**
- Automatically checks when NPPES data was last updated
- Flags entries with updates older than 6 months (stale)
- Recommends sync for entries older than 1 year
- Calculates days since last update

### 4. **Comprehensive Results**
Each scan provides:
- Source name and type
- Data fields available in each directory
- Discrepancies found
- Last update date (when available)
- Direct URL to directory (when applicable)
- AI-generated summary and analysis

## How It Works

### API Endpoint
`POST /api/magic-scanner`

**Request:**
```json
{
  "npi": "1234567890",
  "last_name": "Smith",
  "state": "NY",
  "current_data": { ... practitioner object ... }
}
```

**Response:**
```json
{
  "success": true,
  "npi": "1234567890",
  "last_name": "Smith",
  "state": "NY",
  "scan_results": [
    {
      "source": "UnitedHealthcare Provider Directory",
      "type": "insurance_directory",
      "data_found": ["name", "address", "phone", "specialty"],
      "discrepancies": [
        {
          "field": "phone",
          "found_value": "555-0123",
          "current_value": "555-0100",
          "severity": "medium"
        }
      ],
      "last_updated": "2024-09-15",
      "url": "https://..."
    }
  ],
  "nppes_stale_check": {
    "is_stale": true,
    "last_update_date": "2023-01-15",
    "days_since_update": 650,
    "needs_sync": true,
    "recommendation": "NPPES data is over 1 year old. Immediate sync recommended."
  },
  "ai_summary": "Full AI analysis text...",
  "scanned_at": "2025-10-27T21:30:00.000Z",
  "total_sources_checked": 8,
  "total_discrepancies": 3
}
```

### NPPES Staleness Rules

| Age | Status | Needs Sync | Recommendation |
|-----|--------|-----------|----------------|
| < 6 months | Fresh | No | Data is up to date |
| 6-12 months | Stale | No | Consider syncing |
| > 12 months | Very Stale | **Yes** | Immediate sync recommended |

## Frontend UI

### Scan Form
- Pre-populated with current user's data
- NPI (required, 10 digits)
- Last Name (required)
- State (optional, 2 letter code)

### Results Display
1. **NPPES Staleness Alert** - Prominent banner with color-coded severity
2. **Summary Stats** - Sources checked, discrepancies found, scan time
3. **Directory Findings** - Detailed results from each source
4. **AI Analysis Summary** - Full text analysis from Claude

### Visual Indicators
- 🔴 **Red** - High severity discrepancies, NPPES sync urgently needed
- 🟡 **Yellow** - Medium severity, NPPES data is stale
- 🔵 **Blue** - Low severity, minor issues
- 🟢 **Green** - NPPES data is current, no issues

## Setup

### Environment Variables

Add to Vercel environment variables:
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Get your API key from: https://console.anthropic.com/

### Local Development

1. Copy `.env.local.example` to `.env.local`
2. Add your Anthropic API key:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```
3. Run the development server
4. Navigate to `/magic-scanner`

## Usage

1. **Login** to your ProviderCard account
2. **Navigate** to "Magic Scanner" in the navigation menu
3. **Review** the pre-filled form (uses your profile data)
4. **Optional**: Modify NPI, last name, or state
5. **Click** "Start Magic Scan"
6. **Wait** 10-30 seconds for Claude AI to complete the scan
7. **Review** results, discrepancies, and recommendations
8. **Take action** if NPPES sync is recommended

## Technical Details

### Claude AI Integration
- Model: `claude-3-5-sonnet-20241022`
- Max tokens: 4096
- Structured prompt for directory search
- JSON response parsing

### Security
- JWT authentication required
- User can only scan their own data
- No sensitive data exposed in API responses
- Rate limiting recommended (not yet implemented)

### Performance
- Average scan time: 10-30 seconds
- Depends on Claude API response time
- Results cached in browser state (not persisted)

## Future Enhancements

### Planned Features
1. **Scan History** - Save scan results to database
2. **Automated Scans** - Schedule regular scans
3. **Email Alerts** - Notify when discrepancies found
4. **Bulk Scanning** - Scan multiple providers at once
5. **Custom Sources** - Add user-specific directories to scan
6. **Rate Limiting** - Prevent API abuse
7. **Caching** - Store results for 24 hours
8. **Export** - Download scan results as PDF/CSV

### Possible Integrations
- Automatic NPPES sync when staleness detected
- One-click discrepancy resolution
- Integration with credentialing systems
- Webhook notifications for new findings

## Cost Considerations

### Claude API Pricing
- Model: Claude 3.5 Sonnet
- Input: ~$3 per million tokens
- Output: ~$15 per million tokens
- Average scan: ~1000 input + 2000 output tokens
- Estimated cost per scan: **~$0.04**

### Recommendations
- Implement rate limiting (e.g., 10 scans per user per day)
- Cache results for repeat queries
- Consider batch processing for multiple providers
- Monitor API usage in production

## Troubleshooting

### "Unauthorized" Error
- Ensure you're logged in
- Check JWT token in localStorage
- Verify Authorization header is sent

### "Scan Failed" Error
- Check ANTHROPIC_API_KEY is set in Vercel
- Verify API key is valid
- Check Vercel function logs for detailed error

### No Results Found
- Claude may not find information for all providers
- Try different search parameters
- Results depend on publicly available data

### Slow Scans
- Claude API can take 10-30 seconds
- This is normal for comprehensive searches
- Consider showing progress indicator

## Support

For issues or questions:
1. Check Vercel function logs
2. Review Claude API console for errors
3. Verify environment variables are set
4. Test with known good NPI numbers
