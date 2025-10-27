# Integrations Module Specification

## Overview

The Integrations module provides adapters and connectors for external healthcare directories, registries, and credentialing systems. Each integration follows a plugin architecture for maintainability and extensibility.

## Module Metadata

| Field | Value |
|-------|-------|
| **Module ID** | integrations |
| **Version** | 0.1.0 |
| **Status** | Planning |
| **Dependencies** | Sync Engine, Provider Profile |
| **Owners** | Integration Team |

## Requirements

### IN-001: CMS NPPES Integration

**Integrate with**: CMS NPPES via NPI Registry API and FHIR Directory API

**Purpose**: Validate provider NPI and enrich profile data with official registry information

**Data Flow**: Unidirectional (NPPES → ProviderCard)

**Acceptance Criteria**:
- [ ] NPI lookup and validation
- [ ] Provider data enrichment (name, specialties, addresses)
- [ ] Taxonomy code translation
- [ ] Weekly validation checks for existing profiles
- [ ] Deactivation detection and alerting

### IN-002: Payer Directory Integration

**Integrate with**: Payer directories via FHIR Payer Network API and Blue Button 2.0

**Purpose**: Synchronize provider information to insurance payer networks

**Data Flow**: ProviderCard → Payer directories (with read-back for validation)

**Acceptance Criteria**:
- [ ] Support for top 10 US payers (BCBS, UHC, Aetna, Cigna, Humana, etc.)
- [ ] FHIR-based data submission
- [ ] Status tracking (submitted, accepted, rejected)
- [ ] Network affiliation management
- [ ] Accepting patients flag synchronization

### IN-003: CAQH ProView Integration

**Integrate with**: CAQH ProView DirectAssure API

**Purpose**: Import credentialing data and export updates for provider re-credentialing

**Data Flow**: Bidirectional (ProviderCard ↔ ProView)

**Acceptance Criteria**:
- [ ] Import existing CAQH profiles
- [ ] Export ProviderCard profiles to CAQH
- [ ] Document synchronization
- [ ] Attestation status tracking
- [ ] Re-credentialing notification forwarding

## Integration Architecture

### Plugin Interface

All integrations implement a common interface:

```typescript
interface IntegrationAdapter {
  // Metadata
  readonly name: string;
  readonly version: string;
  readonly type: 'registry' | 'payer' | 'credentialing' | 'directory';
  readonly capabilities: IntegrationCapabilities;

  // Lifecycle
  initialize(config: IntegrationConfig): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  shutdown(): Promise<void>;

  // Data operations
  fetchProvider(identifier: string): Promise<ExternalProvider | null>;
  pushProvider(provider: Provider): Promise<SyncResult>;
  syncProvider(provider: Provider): Promise<SyncResult>;
  validateProvider(provider: Provider): Promise<ValidationResult>;

  // Webhook/Event handling
  handleWebhook(payload: any, signature: string): Promise<WebhookResult>;
}

interface IntegrationCapabilities {
  supportsRead: boolean;
  supportsWrite: boolean;
  supportsBidirectional: boolean;
  supportsWebhooks: boolean;
  supportsBatch: boolean;
  requiresAuth: boolean;
  authType: 'oauth2' | 'api-key' | 'mutual-tls' | 'smart-on-fhir';
}
```

### Adapter Registry

```typescript
class IntegrationRegistry {
  private adapters: Map<string, IntegrationAdapter> = new Map();

  register(adapter: IntegrationAdapter): void;
  get(name: string): IntegrationAdapter | undefined;
  getByType(type: string): IntegrationAdapter[];
  executeSync(providerId: string, adapterNames: string[]): Promise<SyncResult[]>;
}
```

## Integration Specifications

---

## IN-001: CMS NPPES Integration

### Overview

The National Plan and Provider Enumeration System (NPPES) is the official registry for NPI assignments in the United States.

### API Endpoints

**Base URL**: `https://npiregistry.cms.hhs.gov/api`

#### NPI Lookup

```
GET https://npiregistry.cms.hhs.gov/api/?number={npi}&version=2.1

Response:
{
  "result_count": 1,
  "results": [
    {
      "number": "1234567890",
      "enumeration_type": "NPI-1",
      "basic": {
        "first_name": "Jane",
        "last_name": "Smith",
        "credential": "MD",
        "sole_proprietor": "YES",
        "gender": "F",
        "enumeration_date": "2005-05-23",
        "last_updated": "2020-09-15",
        "status": "A"
      },
      "taxonomies": [
        {
          "code": "207R00000X",
          "desc": "Internal Medicine",
          "primary": true,
          "state": "MA",
          "license": "MD123456"
        }
      ],
      "addresses": [
        {
          "country_code": "US",
          "country_name": "United States",
          "address_purpose": "LOCATION",
          "address_type": "DOM",
          "address_1": "123 Medical Plaza",
          "city": "Boston",
          "state": "MA",
          "postal_code": "02101",
          "telephone_number": "555-123-4567"
        }
      ]
    }
  ]
}
```

### Data Mapping

| NPPES Field | ProviderCard Field | Notes |
|-------------|-------------------|-------|
| `number` | `practitioner.identifier[npi].value` | Primary key |
| `basic.first_name` | `practitioner.name.given[0]` | |
| `basic.last_name` | `practitioner.name.family` | |
| `basic.credential` | `practitioner.name.suffix` | e.g., MD, DO |
| `basic.gender` | `practitioner.gender` | Map F→female, M→male |
| `taxonomies[].code` | `practitionerRole.specialty` | NUCC taxonomy |
| `addresses[]` | `practitioner.address[]` | Map LOCATION→work |

### Operations

#### 1. NPI Validation

```typescript
async function validateNPI(npi: string): Promise<NPPESValidationResult> {
  // 1. Format validation (10 digits)
  if (!/^\d{10}$/.test(npi)) {
    return { valid: false, error: 'Invalid NPI format' };
  }

  // 2. Luhn checksum
  if (!luhnCheck(npi)) {
    return { valid: false, error: 'Invalid NPI checksum' };
  }

  // 3. NPPES lookup
  const response = await fetch(
    `https://npiregistry.cms.hhs.gov/api/?number=${npi}&version=2.1`
  );
  const data = await response.json();

  if (data.result_count === 0) {
    return { valid: false, error: 'NPI not found in NPPES' };
  }

  const result = data.results[0];
  if (result.basic.status !== 'A') {
    return { valid: false, error: `NPI status: ${result.basic.status}` };
  }

  return {
    valid: true,
    data: mapNPPESToFHIR(result)
  };
}
```

#### 2. Profile Enrichment

Automatically populate fields from NPPES:
- Name variations
- Primary specialty
- Practice locations
- Taxonomy codes

#### 3. Periodic Validation

Weekly job checks all providers:
- NPI still active
- Basic info matches (alert on discrepancies)
- Deactivation detection

### Rate Limits

- **Public API**: 200 requests per 5 minutes per IP
- **Mitigation**: Cache results for 7 days, batch lookups

### Error Handling

| Error | HTTP Status | Action |
|-------|-------------|--------|
| Invalid NPI format | - | Return validation error |
| NPI not found | 200 (but result_count=0) | Alert provider to verify NPI |
| Rate limit exceeded | 429 | Exponential backoff, queue for later |
| NPPES API down | 5xx | Retry with backoff, alert ops team |

---

## IN-002: Payer Directory Integration

### Overview

Payer directories allow insurance companies to list in-network providers. Integration follows the FHIR Payer Network API standard (Da Vinci PDex Plan Net IG).

### Supported Payers

#### Tier 1 (MVP)
1. **Blue Cross Blue Shield** (varies by state)
2. **UnitedHealthcare**
3. **Aetna**

#### Tier 2 (Phase 2)
4. Cigna
5. Humana
6. Anthem
7. Kaiser Permanente
8. Centene

### API Standards

**Standard**: FHIR R4 with Da Vinci Payer Data Exchange (PDex) Plan Net Implementation Guide

**Key Resources**:
- `Practitioner`
- `PractitionerRole`
- `Organization` (practice/group)
- `Location`
- `HealthcareService`
- `OrganizationAffiliation`

### Example: Submit Provider to Payer Directory

```
POST https://payer.example.com/fhir/Practitioner
Authorization: Bearer {access_token}
Content-Type: application/fhir+json

{
  "resourceType": "Practitioner",
  "meta": {
    "profile": ["http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/plannet-Practitioner"]
  },
  "identifier": [
    {
      "system": "http://hl7.org/fhir/sid/us-npi",
      "value": "1234567890"
    }
  ],
  "active": true,
  "name": [...],
  "qualification": [...]
}

Response (201 Created):
{
  "resourceType": "Practitioner",
  "id": "payer-prac-456",
  "meta": {
    "versionId": "1",
    "lastUpdated": "2025-10-20T12:00:00Z"
  }
}
```

### Sync Workflow

1. **Initial Submission**
   - Provider authorizes payer
   - ProviderCard submits Practitioner + PractitionerRole
   - Payer assigns internal ID

2. **Ongoing Updates**
   - ProviderCard sends FHIR Bundle with updates
   - Payer processes and returns OperationOutcome

3. **Status Checking**
   - Query payer directory for provider's current status
   - Detect discrepancies and alert provider

### Network Affiliation Management

```typescript
interface PayerNetworkAffiliation {
  payerId: string;
  payerName: string;
  networkIds: string[]; // e.g., ["PPO", "HMO", "Medicare Advantage"]
  acceptingNewPatients: boolean;
  effectiveDate: Date;
  terminationDate?: Date;
  status: 'pending' | 'active' | 'suspended' | 'terminated';
}
```

### Error Handling

| Scenario | Action |
|----------|--------|
| Payer rejects submission | Parse OperationOutcome, alert provider with details |
| Provider not credentialed | Notify provider to complete credentialing first |
| Network affiliation expired | Auto-update or prompt provider to renew |
| API authentication failure | Refresh OAuth token, retry |

---

## IN-003: CAQH ProView Integration

### Overview

CAQH ProView is a universal credentialing datasource used by healthcare organizations. Integration uses the DirectAssure API.

### API Authentication

**Type**: OAuth 2.0 Client Credentials
**Token Endpoint**: `https://proview-api.caqh.org/oauth2/token`

```bash
curl -X POST https://proview-api.caqh.org/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id={client_id}" \
  -d "client_secret={client_secret}"
```

### Operations

#### 1. Import CAQH Profile

```
GET https://proview-api.caqh.org/RosterAPI/api/Practitioner/{providerId}
Authorization: Bearer {access_token}

Response:
{
  "provider_id": "12345",
  "npi": "1234567890",
  "first_name": "Jane",
  "last_name": "Smith",
  "credentials": [...],
  "specialties": [...],
  "practice_locations": [...],
  "attestation_date": "2025-08-15",
  "status": "Active"
}
```

**Mapping to ProviderCard**:
- Extract all identifiers, licenses, certifications
- Import practice locations as addresses
- Link uploaded documents via DocumentReference

#### 2. Export to CAQH

```
POST https://proview-api.caqh.org/RosterAPI/api/Practitioner
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "organization_id": "{org_id}",
  "provider": {
    "npi": "1234567890",
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane.smith@example.com",
    "credentials": [...],
    "specialties": [...]
  }
}
```

#### 3. Document Synchronization

CAQH stores credentials (license, DEA, malpractice insurance). ProviderCard can:
- **Download**: Fetch documents from CAQH for local storage
- **Upload**: Push new documents to CAQH for organizations to access

#### 4. Attestation Tracking

- Monitor attestation status in CAQH
- Alert provider 90, 60, 30 days before re-attestation due
- Auto-submit attestation if profile hasn't changed

### Sync Frequency

- **Initial Import**: One-time on provider request
- **Ongoing**: Event-driven (when provider updates profile)
- **Attestation Check**: Daily batch job

### Error Handling

| Error | Action |
|-------|--------|
| Provider not found in CAQH | Offer to create new CAQH profile |
| Document upload failure | Retry 3 times, then alert provider |
| Attestation overdue | Email provider with urgency level |
| API rate limit | Queue and retry with exponential backoff |

---

## Integration Health Monitoring

### Health Check Endpoint

```
GET /api/v1/integrations/health

Response (200 OK):
{
  "status": "healthy",
  "timestamp": "2025-10-20T12:00:00Z",
  "integrations": [
    {
      "name": "nppes",
      "status": "healthy",
      "lastCheck": "2025-10-20T11:59:00Z",
      "responseTime": 234,
      "availability": 99.98
    },
    {
      "name": "caqh-proview",
      "status": "degraded",
      "lastCheck": "2025-10-20T11:58:00Z",
      "responseTime": 5600,
      "availability": 95.2,
      "message": "Elevated response times detected"
    },
    {
      "name": "bcbs-ma",
      "status": "down",
      "lastCheck": "2025-10-20T11:57:00Z",
      "lastError": "Connection timeout",
      "availability": 85.5
    }
  ]
}
```

### Monitoring Metrics

Per integration:
- **Uptime**: Percentage over last 30 days
- **Response Time**: p50, p95, p99
- **Error Rate**: Percentage of failed requests
- **Sync Success Rate**: Percentage of successful syncs
- **Last Successful Sync**: Timestamp

### Alerting Rules

- Integration down > 5 minutes → Page on-call
- Error rate > 10% → Slack alert
- Response time p95 > 5s → Investigate
- Sync success rate < 90% → Review logs

---

## Common Integration Patterns

### 1. Idempotency

All push operations use idempotency keys:

```typescript
const idempotencyKey = `${providerId}-${eventId}-${integrationName}`;

async function syncWithIdempotency(provider: Provider, integration: string) {
  const cache = await redis.get(`idempotency:${idempotencyKey}`);
  if (cache) {
    return JSON.parse(cache); // Return cached result
  }

  const result = await performSync(provider, integration);

  await redis.setex(`idempotency:${idempotencyKey}`, 86400, JSON.stringify(result));
  return result;
}
```

### 2. Circuit Breaker

Prevent cascading failures:

```typescript
class CircuitBreaker {
  private failures = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private nextAttempt?: Date;

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() < this.nextAttempt!.getTime()) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'half-open';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure() {
    this.failures++;
    if (this.failures >= 5) {
      this.state = 'open';
      this.nextAttempt = new Date(Date.now() + 60000); // 1 minute
    }
  }
}
```

### 3. Data Transformation Pipeline

```typescript
interface DataTransformer {
  transform(input: Provider): Promise<ExternalFormat>;
  reverse(input: ExternalFormat): Promise<Provider>;
}

class NPPESTransformer implements DataTransformer {
  async transform(provider: Provider): Promise<NPPESFormat> {
    // ProviderCard → NPPES format
  }

  async reverse(nppes: NPPESFormat): Promise<Provider> {
    // NPPES → ProviderCard format
  }
}
```

---

## Configuration Management

### Integration Configuration Schema

```yaml
integrations:
  nppes:
    enabled: true
    base_url: "https://npiregistry.cms.hhs.gov/api"
    timeout: 10000
    cache_ttl: 604800 # 7 days
    rate_limit:
      requests: 200
      window: 300 # 5 minutes

  caqh:
    enabled: true
    base_url: "https://proview-api.caqh.org"
    auth:
      type: oauth2
      token_url: "https://proview-api.caqh.org/oauth2/token"
      client_id: "${CAQH_CLIENT_ID}"
      client_secret: "${CAQH_CLIENT_SECRET}"
    timeout: 30000
    retry:
      max_attempts: 3
      backoff: exponential

  payers:
    bcbs_ma:
      enabled: true
      name: "Blue Cross Blue Shield Massachusetts"
      base_url: "https://api.bluecrossma.com/fhir"
      auth:
        type: smart_on_fhir
        client_id: "${BCBS_MA_CLIENT_ID}"
        client_secret: "${BCBS_MA_CLIENT_SECRET}"
      sync_frequency: "on_change"
      webhook_url: "https://api.bluecrossma.com/webhooks/providercard"
```

### Environment-Specific Overrides

```bash
# .env.production
CAQH_CLIENT_ID=prod_client_12345
CAQH_CLIENT_SECRET=prod_secret_abcdef
BCBS_MA_CLIENT_ID=prod_bcbs_67890
BCBS_MA_CLIENT_SECRET=prod_bcbs_secret_xyz

# .env.staging
CAQH_CLIENT_ID=staging_client_12345
CAQH_CLIENT_SECRET=staging_secret_abcdef
BCBS_MA_CLIENT_ID=staging_bcbs_67890
BCBS_MA_CLIENT_SECRET=staging_bcbs_secret_xyz
```

---

## Testing Strategy

### Unit Tests
- Data transformers (NPPES, CAQH, Payer formats)
- Validation logic
- Error handling

### Integration Tests
- Mock external APIs
- Test retry logic
- Test circuit breaker behavior

### E2E Tests (Sandbox Environments)
- NPPES lookup with test NPIs
- CAQH staging environment
- Payer sandbox APIs

### Contract Testing
- FHIR resource validation (FHIR validator)
- API schema compliance (OpenAPI/Swagger)

---

## Future Integrations

### Planned
- [ ] State Medical Boards (license verification)
- [ ] Doximity (social verification)
- [ ] Experian Health (additional credentialing data)
- [ ] Epic Care Everywhere (EHR directory)
- [ ] Cerner HealtheIntent

### Under Evaluation
- Medicare Provider Enrollment, Chain, and Ownership System (PECOS)
- Federation of State Medical Boards (FSMB)
- American Board of Medical Specialties (ABMS)

---

**Version**: 0.1.0
**Last Updated**: 2025-10-20
**Maintained By**: Integration Team
