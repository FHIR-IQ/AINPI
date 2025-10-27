# Analytics Module Specification

## Overview

The Analytics module provides comprehensive monitoring, reporting, and insights into system health, data quality, user adoption, and integration performance.

## Module Metadata

| Field | Value |
|-------|-------|
| **Module ID** | analytics |
| **Version** | 0.1.0 |
| **Status** | Planning |
| **Dependencies** | All modules |
| **Owners** | Data & Platform Teams |

## Requirements

### AN-001: Admin Dashboard

**As an** Admin
**I want to** view integration status, error logs, and last update timestamps
**So that** I can track adoption and data quality

**Acceptance Criteria**:
- [ ] Real-time dashboard showing system health metrics
- [ ] Integration status per provider and organization
- [ ] Error logs with filtering and search
- [ ] Data quality scores per provider
- [ ] Adoption metrics (active users, synced orgs)
- [ ] Export capabilities (CSV, PDF reports)

## Dashboard Categories

### 1. System Health Dashboard

**Purpose**: Monitor overall platform health and performance

**Metrics**:
- **Uptime**: Overall system availability (target: 99.9%)
- **API Response Times**: p50, p95, p99 for key endpoints
- **Error Rates**: 4xx and 5xx errors per hour
- **Active Users**: Current logged-in providers and admins
- **Background Job Queue**: Length and processing rate
- **Database Performance**: Query times, connection pool usage

**Visualization**:
```
┌─────────────────────────────────────────────────────────────┐
│ System Health                            🟢 All Systems OK  │
├─────────────────────────────────────────────────────────────┤
│ Uptime (30d): 99.94%        API Latency (p95): 342ms       │
│ Error Rate: 0.12%           Active Users: 1,247             │
├─────────────────────────────────────────────────────────────┤
│ Component Status:                                           │
│ ✅ API Gateway        ✅ Auth Service      ✅ Database      │
│ ✅ Sync Engine        ⚠️  Email Service    ✅ File Storage  │
│ ✅ FHIR Server        ✅ Cache (Redis)     ✅ Message Queue │
├─────────────────────────────────────────────────────────────┤
│ Recent Incidents:                                           │
│ • [Resolved] Email delays - 2025-10-19 14:23                │
│   Duration: 12 minutes, Impact: Low                         │
└─────────────────────────────────────────────────────────────┘
```

### 2. Integration Health Dashboard

**Purpose**: Monitor external integration performance

**Metrics Per Integration**:
- **Availability**: % uptime over last 30 days
- **Response Time**: p50, p95, p99
- **Sync Success Rate**: % successful sync operations
- **Last Successful Sync**: Timestamp
- **Active Circuit Breakers**: Count
- **Error Breakdown**: By error type

**Visualization**:
```
┌──────────────────────────────────────────────────────────────┐
│ Integration Health                                           │
├──────────────────────────────────────────────────────────────┤
│ Integration         Availability  Sync Rate   Last Sync      │
├──────────────────────────────────────────────────────────────┤
│ 🟢 NPPES            99.98%        100%        2 min ago      │
│ 🟢 CAQH ProView     99.12%        98.5%       5 min ago      │
│ 🟡 BCBS MA          96.45%        93.2%       15 min ago     │
│ 🟢 UnitedHealth     99.87%        99.1%       1 min ago      │
│ 🔴 Aetna            85.23%        78.9%       2 hours ago    │
│    └─ Circuit breaker: OPEN (5xx errors)                    │
├──────────────────────────────────────────────────────────────┤
│ Failed Syncs (Last 24h): 23                                  │
│ Top Errors:                                                  │
│   1. Timeout (12 occurrences) - Aetna                        │
│   2. Auth expired (7 occurrences) - BCBS MA                  │
│   3. Invalid data (4 occurrences) - Multiple                 │
└──────────────────────────────────────────────────────────────┘
```

### 3. Data Quality Dashboard

**Purpose**: Monitor provider profile completeness and accuracy

**Metrics**:
- **Average Profile Completeness**: % across all providers
- **Completeness Distribution**: Histogram
- **Missing Fields**: Most commonly missing data
- **Verification Status**: % verified vs. pending
- **Credential Expiration**: Upcoming and overdue
- **Data Discrepancies**: NPPES vs. ProviderCard differences

**Profile Completeness Calculation**:
```typescript
interface CompletenessWeights {
  coreIdentifiers: 25;  // NPI, License, DEA
  contactInfo: 10;      // Email, Phone
  specialties: 15;      // Primary specialty required
  credentials: 30;      // Uploaded & verified documents
  affiliations: 10;     // Organization associations
  additionalInfo: 10;   // Languages, accepting patients, etc.
}

function calculateCompleteness(provider: Provider): number {
  let score = 0;

  // Core identifiers (25%)
  if (provider.npi) score += 15;
  if (provider.licenses.length > 0) score += 5;
  if (provider.deaNumber) score += 5;

  // Contact info (10%)
  if (provider.email) score += 5;
  if (provider.phone) score += 5;

  // Specialties (15%)
  if (provider.specialties.some(s => s.isPrimary)) score += 15;

  // Credentials (30%)
  const verifiedCreds = provider.credentials.filter(c => c.verified).length;
  score += Math.min(30, verifiedCreds * 7.5); // 4 docs = 30%

  // Affiliations (10%)
  if (provider.affiliations.length > 0) score += 10;

  // Additional info (10%)
  if (provider.languages.length > 0) score += 3;
  if (provider.acceptingPatients !== undefined) score += 3;
  if (provider.profilePhoto) score += 2;
  if (provider.bio) score += 2;

  return Math.round(score);
}
```

**Visualization**:
```
┌──────────────────────────────────────────────────────────────┐
│ Data Quality Overview                                        │
├──────────────────────────────────────────────────────────────┤
│ Average Profile Completeness: 78%                            │
│                                                              │
│ Distribution:                                                │
│ 90-100%: ████████████████░░░░  512 providers (41%)          │
│ 70-89%:  ████████████░░░░░░░░  384 providers (31%)          │
│ 50-69%:  ████████░░░░░░░░░░░░  256 providers (20%)          │
│ <50%:    ████░░░░░░░░░░░░░░░░  98 providers (8%)            │
│                                                              │
│ Most Missing Fields:                                         │
│ 1. Board Certifications (45% of profiles)                   │
│ 2. DEA Number (38%)                                          │
│ 3. Malpractice Insurance (32%)                              │
│ 4. Profile Bio (67%)                                         │
│                                                              │
│ Verification Status:                                         │
│ ✅ Fully Verified: 892 (71%)                                 │
│ ⏳ Pending Review: 156 (13%)                                 │
│ ⚠️  Incomplete: 202 (16%)                                    │
├──────────────────────────────────────────────────────────────┤
│ Credential Expirations:                                      │
│ Expiring in 30 days: 23 credentials                          │
│ Expiring in 60 days: 47 credentials                          │
│ Overdue: 5 credentials ⚠️                                     │
└──────────────────────────────────────────────────────────────┘
```

### 4. Adoption & Usage Dashboard

**Purpose**: Track user growth and engagement

**Metrics**:
- **Total Providers**: Count over time
- **Active Providers**: Logged in last 30 days
- **New Registrations**: Per day/week/month
- **Authorized Organizations**: Average per provider
- **Sync Activity**: Total syncs per day
- **Feature Usage**: Most/least used features
- **User Retention**: Cohort analysis

**Visualization**:
```
┌──────────────────────────────────────────────────────────────┐
│ Adoption Metrics                                             │
├──────────────────────────────────────────────────────────────┤
│ Total Providers: 1,250     Active (30d): 1,047 (84%)        │
│ New This Month: 87         Growth: +7.2% MoM                 │
│                                                              │
│ Registration Trend (Last 6 months):                          │
│     90│                                            ⬤         │
│     80│                                    ⬤                 │
│     70│                          ⬤                           │
│     60│                ⬤                                     │
│     50│      ⬤                                               │
│     40│⬤                                                     │
│       └──────────────────────────────────────────────────   │
│        May    Jun    Jul    Aug    Sep    Oct               │
│                                                              │
│ Organization Authorizations:                                 │
│ Average per provider: 3.2 orgs                               │
│ Distribution:                                                │
│   0 orgs: 125 providers (10%)                                │
│   1-2 orgs: 437 providers (35%)                              │
│   3-5 orgs: 563 providers (45%)                              │
│   6+ orgs: 125 providers (10%)                               │
│                                                              │
│ Most Connected Organizations:                                │
│ 1. Blue Cross Blue Shield (various states): 687 providers   │
│ 2. UnitedHealthcare: 542 providers                           │
│ 3. Mass General Brigham: 398 providers                       │
└──────────────────────────────────────────────────────────────┘
```

### 5. Error & Incident Dashboard

**Purpose**: Identify and troubleshoot issues quickly

**Features**:
- **Error Log Stream**: Real-time error monitoring
- **Error Frequency**: Top errors by occurrence
- **Error Impact**: Affected providers/organizations
- **Resolution Status**: Open, investigating, resolved
- **Root Cause Analysis**: Tagged and categorized

**Error Log Table**:
```
┌───────────────────────────────────────────────────────────────────────┐
│ Error Logs                                     🔍 Search  🔽 Filter   │
├───────────────────────────────────────────────────────────────────────┤
│ Time       Severity  Type           Provider        Message          │
├───────────────────────────────────────────────────────────────────────┤
│ 12:45:23   ERROR     SYNC_FAILED    Dr. J. Smith    Webhook timeout  │
│                                                      (Acme Health)    │
│ 12:44:15   WARN      AUTH_EXPIRING  Dr. K. Johnson  BCBS auth exp in│
│                                                      7 days           │
│ 12:43:08   ERROR     NPPES_LOOKUP   Dr. M. Brown    NPI not found    │
│ 12:42:51   ERROR     DOC_UPLOAD     Dr. P. Davis    File too large   │
│ 12:41:33   ERROR     SYNC_FAILED    Dr. A. Wilson   5xx from CAQH   │
├───────────────────────────────────────────────────────────────────────┤
│ Showing 5 of 234 errors (Last 24h)            [Load More]            │
└───────────────────────────────────────────────────────────────────────┘
```

**Top Errors**:
```
┌───────────────────────────────────────────────────────────┐
│ Most Frequent Errors (Last 7 Days)                       │
├───────────────────────────────────────────────────────────┤
│ 1. Webhook Timeout (SYNC_TIMEOUT)                        │
│    Occurrences: 156  Affected: 89 providers              │
│    Primary Integration: Aetna                            │
│    [View Details] [Create Ticket]                        │
│                                                           │
│ 2. Auth Token Expired (AUTH_EXPIRED)                     │
│    Occurrences: 87  Affected: 12 organizations           │
│    Primary Integration: BCBS (multiple states)           │
│    [View Details] [Notify Orgs]                          │
│                                                           │
│ 3. Invalid NPI Format (VALIDATION_ERROR)                 │
│    Occurrences: 34  Affected: 34 providers               │
│    Source: Manual entry                                  │
│    [View Details] [Improve Validation]                   │
└───────────────────────────────────────────────────────────┘
```

## API Endpoints

### Get System Health

```
GET /api/v1/analytics/health
Authorization: Bearer {admin_token}

Response (200 OK):
{
  "status": "healthy",
  "timestamp": "2025-10-20T12:00:00Z",
  "uptime": 99.94,
  "metrics": {
    "activeUsers": 1247,
    "apiLatencyP95": 342,
    "errorRate": 0.12,
    "queueLength": 23
  },
  "components": [
    {"name": "api-gateway", "status": "healthy"},
    {"name": "auth-service", "status": "healthy"},
    {"name": "database", "status": "healthy"},
    {"name": "sync-engine", "status": "healthy"},
    {"name": "email-service", "status": "degraded", "message": "Elevated response times"}
  ]
}
```

### Get Integration Statistics

```
GET /api/v1/analytics/integrations?period=30d
Authorization: Bearer {admin_token}

Response (200 OK):
{
  "period": "30d",
  "integrations": [
    {
      "name": "nppes",
      "availability": 99.98,
      "syncSuccessRate": 100.0,
      "avgResponseTime": 234,
      "p95ResponseTime": 456,
      "totalSyncs": 15234,
      "failedSyncs": 0,
      "lastSync": "2025-10-20T11:58:00Z"
    },
    {
      "name": "aetna",
      "availability": 85.23,
      "syncSuccessRate": 78.9,
      "avgResponseTime": 3421,
      "p95ResponseTime": 8900,
      "totalSyncs": 2341,
      "failedSyncs": 494,
      "lastSync": "2025-10-20T10:15:00Z",
      "status": "degraded",
      "issues": ["High error rate", "Circuit breaker: OPEN"]
    }
  ]
}
```

### Get Data Quality Report

```
GET /api/v1/analytics/data-quality?format=summary
Authorization: Bearer {admin_token}

Response (200 OK):
{
  "timestamp": "2025-10-20T12:00:00Z",
  "summary": {
    "totalProviders": 1250,
    "avgCompleteness": 78.4,
    "fullyVerified": 892,
    "pendingVerification": 156,
    "incomplete": 202
  },
  "completenessDistribution": {
    "90-100": 512,
    "70-89": 384,
    "50-69": 256,
    "<50": 98
  },
  "mostMissingFields": [
    {"field": "boardCertifications", "missing": 563, "percentage": 45.0},
    {"field": "deaNumber", "missing": 475, "percentage": 38.0},
    {"field": "malpracticeInsurance", "missing": 400, "percentage": 32.0}
  ],
  "expiringCredentials": {
    "30days": 23,
    "60days": 47,
    "90days": 89,
    "overdue": 5
  }
}
```

### Get Adoption Metrics

```
GET /api/v1/analytics/adoption?period=6m
Authorization: Bearer {admin_token}

Response (200 OK):
{
  "period": "6m",
  "totalProviders": 1250,
  "activeProviders30d": 1047,
  "activeRate": 83.76,
  "newThisMonth": 87,
  "growthRateMoM": 7.2,
  "registrationTrend": [
    {"month": "2025-05", "count": 42},
    {"month": "2025-06", "count": 58},
    {"month": "2025-07", "count": 71},
    {"month": "2025-08", "count": 65},
    {"month": "2025-09", "count": 82},
    {"month": "2025-10", "count": 87}
  ],
  "avgAuthorizationsPerProvider": 3.2,
  "topOrganizations": [
    {"name": "Blue Cross Blue Shield", "providers": 687},
    {"name": "UnitedHealthcare", "providers": 542},
    {"name": "Mass General Brigham", "providers": 398}
  ]
}
```

### Search Error Logs

```
GET /api/v1/analytics/errors?severity=error&integration=aetna&limit=50
Authorization: Bearer {admin_token}

Response (200 OK):
{
  "total": 234,
  "page": 1,
  "perPage": 50,
  "data": [
    {
      "id": "err_9kP3QxLmRwN5sT",
      "timestamp": "2025-10-20T12:45:23Z",
      "severity": "error",
      "type": "SYNC_FAILED",
      "integration": "aetna",
      "providerId": "prov_2gQ8ZjKYXKdN5rP",
      "providerName": "Dr. Jane Smith",
      "message": "Webhook delivery timeout after 30s",
      "metadata": {
        "organizationId": "org_7hP2BvLqNmK8sR",
        "attemptCount": 5,
        "httpStatus": null
      },
      "resolution": null
    }
  ]
}
```

### Export Analytics Report

```
POST /api/v1/analytics/export
Authorization: Bearer {admin_token}

Request:
{
  "reportType": "monthly_summary",
  "period": "2025-10",
  "format": "pdf",
  "includeCharts": true,
  "sections": [
    "system_health",
    "integration_health",
    "data_quality",
    "adoption_metrics"
  ]
}

Response (202 Accepted):
{
  "jobId": "export_4kM8NpQsUxW6qZ",
  "status": "processing",
  "estimatedCompletion": "2025-10-20T12:05:00Z",
  "_links": {
    "status": "/api/v1/analytics/export/export_4kM8NpQsUxW6qZ"
  }
}

// Poll status endpoint
GET /api/v1/analytics/export/export_4kM8NpQsUxW6qZ

Response (200 OK):
{
  "jobId": "export_4kM8NpQsUxW6qZ",
  "status": "completed",
  "downloadUrl": "https://storage.providercard.io/reports/monthly_summary_2025-10.pdf",
  "expiresAt": "2025-10-27T12:05:00Z"
}
```

## Data Collection & Storage

### Metrics Collection

Use time-series database (InfluxDB, TimescaleDB, or Prometheus):

```sql
-- Example: Store API latency metrics
CREATE TABLE api_metrics (
  time TIMESTAMPTZ NOT NULL,
  endpoint VARCHAR(255),
  method VARCHAR(10),
  status_code INT,
  duration_ms INT,
  provider_id VARCHAR(255),
  organization_id VARCHAR(255)
);

SELECT create_hypertable('api_metrics', 'time');
```

### Aggregation Queries

```sql
-- Calculate p95 latency per endpoint (last 24h)
SELECT
  endpoint,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_latency
FROM api_metrics
WHERE time > NOW() - INTERVAL '24 hours'
GROUP BY endpoint
ORDER BY p95_latency DESC;
```

### Data Retention

| Metric Type | Raw Data | Aggregated | Total Retention |
|-------------|----------|------------|-----------------|
| API Metrics | 7 days | 90 days (1h intervals) | 1 year (daily) |
| Error Logs | 30 days | N/A | 1 year (archived) |
| Sync Events | 30 days | 1 year | 3 years |
| Audit Logs | N/A | N/A | 7 years (HIPAA) |

## Alerting Rules

### Critical Alerts (Page on-call)

- System uptime < 99.5% over 1 hour
- API error rate > 5% for 5 minutes
- Database connection pool exhausted
- Any integration down > 15 minutes
- Failed syncs > 100 in 1 hour

### Warning Alerts (Slack notification)

- API p95 latency > 1s for 10 minutes
- Integration error rate > 10%
- Verification queue > 50 items
- Credential expirations > 10 in next 7 days

### Info Alerts (Dashboard only)

- New provider registration
- New organization authorization
- Weekly summary stats

## Scheduled Reports

### Daily Reports (Sent at 9am)

**Recipients**: Operations team
**Content**:
- New registrations
- Syncs failed (requires attention)
- Credentials expiring soon
- System health summary

### Weekly Reports (Sent Monday 9am)

**Recipients**: Leadership team
**Content**:
- Growth metrics (providers, organizations)
- Integration performance
- Top errors and resolutions
- Data quality trends

### Monthly Reports (Sent 1st of month)

**Recipients**: Stakeholders, investors
**Content**:
- Executive summary
- User adoption and retention
- Revenue metrics (if applicable)
- Roadmap progress
- Incident postmortems

## Visualization Tools

### Internal Dashboards

**Tool**: Grafana / Datadog / New Relic

**Dashboards**:
1. **Operations Dashboard**: Real-time system health
2. **Integration Dashboard**: External API performance
3. **Business Metrics**: Growth, adoption, engagement
4. **Error Tracking**: Sentry / Bugsnag integration

### Provider-Facing Analytics (Future)

Providers can see:
- Profile views by organizations
- Sync history and success rates
- Most requested credentials
- Profile completeness over time

## Privacy & Security

### Access Control

| Role | System Health | Integrations | Data Quality | Error Logs | Provider Data |
|------|---------------|--------------|--------------|------------|---------------|
| Admin | ✓ | ✓ | ✓ | ✓ | ✓ (all) |
| Support | ✓ | ✓ | ✓ | ✓ | ✓ (with consent) |
| Provider | - | ✓ (own) | ✓ (own) | ✓ (own) | ✓ (own) |
| Org Admin | - | ✓ (own integrations) | - | ✓ (own) | ✓ (authorized only) |

### PII Protection

- Provider names/identifiers anonymized in aggregated metrics
- Detailed logs require admin authentication
- Export capabilities restricted to admins
- Audit trail for all analytics queries

## Testing Strategy

### Unit Tests
- Metrics calculation logic
- Aggregation queries
- Alert rule evaluation

### Integration Tests
- Time-series data insertion
- Dashboard API endpoints
- Report generation

### Load Tests
- High-volume metrics ingestion
- Concurrent dashboard users
- Large report exports

## Future Enhancements

- [ ] Predictive analytics (ML-based anomaly detection)
- [ ] Automated root cause analysis
- [ ] Provider engagement scoring
- [ ] Custom dashboard builder for organizations
- [ ] Real-time alerting via webhooks
- [ ] Integration with external BI tools (Looker, Tableau)
- [ ] Cost analytics (API usage, storage costs)

---

**Version**: 0.1.0
**Last Updated**: 2025-10-20
**Maintained By**: Data & Platform Teams
