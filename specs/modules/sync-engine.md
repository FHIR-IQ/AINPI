# Sync Engine Module Specification

## Overview

The Sync Engine orchestrates bidirectional data synchronization between ProviderCard and external healthcare directories, ensuring provider information remains current across all integrated systems.

## Module Metadata

| Field | Value |
|-------|-------|
| **Module ID** | sync-engine |
| **Version** | 0.1.0 |
| **Status** | Planning |
| **Dependencies** | Provider Profile, Integrations, Notifications |
| **Owners** | Integration Team |

## Requirements

### SE-001: FHIR Practitioner Endpoint

**As a** System
**I want to** expose a FHIR Practitioner endpoint for data retrieval
**So that** external organizations can pull my information

**Acceptance Criteria**:
- [ ] FHIR R4 compliant Practitioner endpoint
- [ ] FHIR R4 compliant PractitionerRole endpoint
- [ ] OAuth 2.0 / SMART on FHIR authentication
- [ ] Search parameters: identifier, name, specialty
- [ ] Response includes all verified profile data
- [ ] Supports _include and _revinclude for related resources
- [ ] Rate limiting per organization (1000 requests/hour)

**Technical Details**:
- **Base URL**: `https://api.providercard.io/fhir`
- **Endpoints**:
  - `GET /fhir/Practitioner/{id}`
  - `GET /fhir/Practitioner?identifier={npi}`
  - `GET /fhir/PractitionerRole?practitioner={id}`
- **Auth**: SMART on FHIR with scopes `system/Practitioner.read`
- **Format**: JSON or XML (via Accept header)

### SE-002: Authorization Management

**As a** Provider
**I want to** authorize selected organizations for data access
**So that** updates are sent only to approved entities

**Acceptance Criteria**:
- [ ] Provider can view list of requesting organizations
- [ ] Provider can approve/deny access requests
- [ ] Provider can revoke access at any time
- [ ] System supports granular permissions (read-only vs sync)
- [ ] Audit trail of all authorization changes
- [ ] Webhooks notify organizations of authorization changes

**Authorization Levels**:
- **None**: No access
- **Read-Only**: Can query FHIR endpoints
- **Sync**: Receives webhook notifications on changes
- **Bidirectional**: Can push updates back to ProviderCard (future)

## Architecture

### Sync Flow Diagram

```
┌──────────────┐
│  Provider    │
│  Updates     │──┐
│  Profile     │  │
└──────────────┘  │
                  ▼
         ┌────────────────┐
         │  Change Event  │
         │   Detection    │
         └────────────────┘
                  │
                  ▼
         ┌────────────────┐
         │  Sync Queue    │
         │  (RabbitMQ)    │
         └────────────────┘
                  │
         ┌────────┴────────┬────────────┬──────────┐
         ▼                 ▼            ▼          ▼
    ┌─────────┐      ┌─────────┐  ┌─────────┐ ┌────────┐
    │Webhook  │      │ NPPES   │  │ CAQH    │ │ Payer  │
    │Delivery │      │ Adapter │  │ Adapter │ │Adapters│
    └─────────┘      └─────────┘  └─────────┘ └────────┘
         │                │            │           │
         ▼                ▼            ▼           ▼
    ┌─────────┐      ┌─────────┐  ┌─────────┐ ┌────────┐
    │External │      │  NPPES  │  │ ProView │ │ Payer  │
    │ Org API │      │   API   │  │   API   │ │  APIs  │
    └─────────┘      └─────────┘  └─────────┘ └────────┘
         │                │            │           │
         ▼                ▼            ▼           ▼
    ┌──────────────────────────────────────────────────┐
    │           Sync Status Tracking                   │
    │  (Success, Failure, Retry, Timestamp)            │
    └──────────────────────────────────────────────────┘
```

### Change Detection

Uses database triggers and event sourcing:

```sql
CREATE TABLE provider_events (
  id SERIAL PRIMARY KEY,
  provider_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(50) NOT NULL, -- profile.updated, credential.verified, etc.
  payload JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE
);

CREATE TRIGGER provider_change_event
AFTER UPDATE ON practitioners
FOR EACH ROW
EXECUTE FUNCTION emit_provider_change_event();
```

## Data Model

### SyncAuthorization

```typescript
interface SyncAuthorization {
  id: string;
  providerId: string;
  organizationId: string;
  organizationName: string;
  authorizationLevel: 'read-only' | 'sync' | 'bidirectional';
  status: 'pending' | 'active' | 'revoked';
  grantedAt?: Date;
  revokedAt?: Date;
  expiresAt?: Date;
  requestedScopes: string[];
  grantedScopes: string[];
  webhookUrl?: string;
  webhookSecret?: string;
  metadata: {
    requestReason?: string;
    providerNotes?: string;
  };
}
```

### SyncEvent

```typescript
interface SyncEvent {
  id: string;
  providerId: string;
  eventType: 'provider.created' | 'provider.updated' | 'credential.verified' | 'credential.expiring';
  payload: object;
  createdAt: Date;
  processed: boolean;
  processedAt?: Date;
  targetOrganizations: string[];
}
```

### SyncLog

```typescript
interface SyncLog {
  id: string;
  providerId: string;
  organizationId: string;
  eventId: string;
  syncType: 'webhook' | 'fhir-push' | 'fhir-pull';
  status: 'pending' | 'success' | 'failed' | 'retrying';
  attemptCount: number;
  lastAttemptAt: Date;
  nextRetryAt?: Date;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  duration?: number; // milliseconds
  requestPayload?: object;
  responseStatus?: number;
  responseBody?: object;
}
```

## API Endpoints

### FHIR Endpoints

#### Get Practitioner by ID

```
GET /fhir/Practitioner/{id}
Authorization: Bearer {token}
Accept: application/fhir+json

Response (200 OK):
{
  "resourceType": "Practitioner",
  "id": "example-provider-123",
  "meta": {
    "versionId": "2",
    "lastUpdated": "2025-10-20T11:00:00Z"
  },
  "identifier": [...],
  "name": [...],
  "telecom": [...],
  "qualification": [...]
}
```

#### Search Practitioners

```
GET /fhir/Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|1234567890
Authorization: Bearer {token}

Response (200 OK):
{
  "resourceType": "Bundle",
  "type": "searchset",
  "total": 1,
  "entry": [
    {
      "fullUrl": "https://api.providercard.io/fhir/Practitioner/example-provider-123",
      "resource": {...}
    }
  ]
}
```

### Authorization Management

#### List Organization Access Requests

```
GET /api/v1/providers/{id}/authorizations
Authorization: Bearer {token}

Response (200 OK):
{
  "data": [
    {
      "id": "auth_3kL9MnQrTxW5pZ",
      "organization": {
        "id": "org_7hP2BvLqNmK8sR",
        "name": "Acme Health Network",
        "type": "hospital_system"
      },
      "status": "pending",
      "requestedAt": "2025-10-15T14:30:00Z",
      "requestedScopes": ["system/Practitioner.read"],
      "requestReason": "To include you in our provider directory"
    },
    {
      "id": "auth_8rT4VxKpLmN9qW",
      "organization": {
        "id": "org_5jQ1CzMwRxL3tY",
        "name": "Blue Cross Blue Shield MA"
      },
      "status": "active",
      "authorizationLevel": "sync",
      "grantedAt": "2025-10-10T09:00:00Z",
      "expiresAt": "2026-10-10T09:00:00Z"
    }
  ],
  "pagination": {
    "total": 2,
    "page": 1,
    "perPage": 20
  }
}
```

#### Grant Authorization

```
POST /api/v1/providers/{id}/authorizations/{authId}/grant
Authorization: Bearer {token}

Request:
{
  "authorizationLevel": "sync",
  "scopes": ["system/Practitioner.read", "system/PractitionerRole.read"],
  "expiresAt": "2026-10-20T00:00:00Z"
}

Response (200 OK):
{
  "id": "auth_3kL9MnQrTxW5pZ",
  "status": "active",
  "grantedAt": "2025-10-20T12:00:00Z",
  "grantedScopes": ["system/Practitioner.read", "system/PractitionerRole.read"],
  "webhookUrl": "https://acme-health.com/webhooks/providercard",
  "message": "Authorization granted. Organization will receive sync notifications."
}
```

#### Revoke Authorization

```
POST /api/v1/providers/{id}/authorizations/{authId}/revoke
Authorization: Bearer {token}

Request:
{
  "reason": "No longer affiliated with this organization"
}

Response (200 OK):
{
  "id": "auth_3kL9MnQrTxW5pZ",
  "status": "revoked",
  "revokedAt": "2025-10-20T12:05:00Z",
  "message": "Authorization revoked. Organization will no longer receive updates."
}
```

### Sync Operations

#### Trigger Manual Sync

```
POST /api/v1/providers/{id}/sync
Authorization: Bearer {token}

Request:
{
  "targetOrganizations": ["org_7hP2BvLqNmK8sR", "org_5jQ1CzMwRxL3tY"],
  "syncType": "full" // or "delta"
}

Response (202 Accepted):
{
  "syncJobId": "sync_9tW4XvKqMnL8pR",
  "status": "queued",
  "targetOrganizations": 2,
  "estimatedCompletionTime": "2025-10-20T12:10:00Z",
  "_links": {
    "status": "/api/v1/sync-jobs/sync_9tW4XvKqMnL8pR"
  }
}
```

#### Get Sync Status

```
GET /api/v1/sync-jobs/{jobId}
Authorization: Bearer {token}

Response (200 OK):
{
  "id": "sync_9tW4XvKqMnL8pR",
  "providerId": "prov_2gQ8ZjKYXKdN5rP",
  "status": "completed",
  "startedAt": "2025-10-20T12:05:00Z",
  "completedAt": "2025-10-20T12:08:00Z",
  "results": [
    {
      "organizationId": "org_7hP2BvLqNmK8sR",
      "organizationName": "Acme Health Network",
      "status": "success",
      "syncedAt": "2025-10-20T12:07:00Z",
      "duration": 850
    },
    {
      "organizationId": "org_5jQ1CzMwRxL3tY",
      "organizationName": "Blue Cross Blue Shield MA",
      "status": "failed",
      "error": {
        "code": "TIMEOUT",
        "message": "Webhook delivery timeout after 30s"
      },
      "retryAt": "2025-10-20T12:20:00Z"
    }
  ]
}
```

## Webhook Notifications

### Webhook Payload Format

```json
{
  "event": {
    "id": "evt_4kM8NpQsUxW6qZ",
    "type": "provider.updated",
    "createdAt": "2025-10-20T12:00:00Z"
  },
  "provider": {
    "id": "prov_2gQ8ZjKYXKdN5rP",
    "npi": "1234567890",
    "fhirUrl": "https://api.providercard.io/fhir/Practitioner/example-provider-123"
  },
  "changes": {
    "fields": ["specialties", "licenses"],
    "summary": "Updated primary specialty and added MA license"
  }
}
```

### Webhook Security

- **Signature**: HMAC-SHA256 signature in `X-ProviderCard-Signature` header
- **Timestamp**: Unix timestamp in `X-ProviderCard-Timestamp` header
- **Replay Protection**: Reject requests older than 5 minutes
- **IP Allowlist**: Optional IP restriction per organization

### Webhook Verification (Receiver Side)

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret, timestamp) {
  const fiveMinutes = 5 * 60 * 1000;
  const now = Date.now();

  // Check timestamp freshness
  if (now - timestamp * 1000 > fiveMinutes) {
    throw new Error('Webhook timestamp too old');
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${JSON.stringify(payload)}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  // Constant-time comparison
  if (!crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )) {
    throw new Error('Invalid webhook signature');
  }

  return true;
}
```

## Sync Strategies

### Full Sync
- Sends complete provider profile
- Used for initial synchronization
- Triggered on new authorization

### Delta Sync
- Sends only changed fields
- More efficient for frequent updates
- Default for ongoing synchronization

### Conflict Resolution

| Scenario | Resolution Strategy |
|----------|---------------------|
| Provider updates locally | ProviderCard is source of truth → push to external |
| External system has newer data | Manual review or accept external (configurable) |
| Simultaneous updates | Last-write-wins with audit trail |
| Field-level conflicts | Provider chooses during merge UI |

## Retry Logic

### Exponential Backoff

```
Attempt 1: Immediate
Attempt 2: 1 minute delay
Attempt 3: 5 minutes delay
Attempt 4: 15 minutes delay
Attempt 5: 1 hour delay
Attempt 6+: 6 hours delay (max 3 days)
```

### Failure Handling

- **Transient Errors** (network, timeout): Auto-retry
- **Client Errors** (4xx): No retry, alert provider
- **Server Errors** (5xx): Retry with backoff
- **Authorization Errors**: Notify provider, suggest re-authorization

## Performance Considerations

### Rate Limiting

- **Per Organization**: 1000 FHIR API requests/hour
- **Per Provider**: 100 manual sync triggers/day
- **Webhook Delivery**: 10 concurrent per organization

### Caching

- FHIR resources cached for 5 minutes (configurable)
- Cache invalidated on provider updates
- ETags supported for conditional requests

### Scaling

- Sync queue partitioned by organization
- Horizontal scaling of webhook delivery workers
- Database read replicas for FHIR queries

## Monitoring & Alerting

### Key Metrics

- **Sync Success Rate**: Target >95%
- **Webhook Delivery Latency**: p95 <2s
- **FHIR API Response Time**: p95 <500ms
- **Retry Queue Length**: Alert if >100
- **Failed Syncs (>24h old)**: Alert if >10

### Dashboards

1. **Sync Health Dashboard**
   - Success/failure rate by organization
   - Average sync duration
   - Retry queue length

2. **FHIR API Dashboard**
   - Request volume
   - Response times (p50, p95, p99)
   - Error rates by endpoint

3. **Provider Sync Activity**
   - Number of authorized organizations
   - Last sync timestamp per organization
   - Pending authorization requests

## Security & Compliance

### Access Control

- SMART on FHIR scopes enforce read/write permissions
- Organization credentials rotated every 90 days
- Webhook secrets stored encrypted

### Audit Logging

All sync activities logged with:
- Provider ID
- Organization ID
- Timestamp
- Action (read, sync, authorize, revoke)
- Result (success/failure)
- IP address and user agent

### HIPAA Compliance

- All PHI transmitted over TLS 1.3
- Audit logs retained for 7 years
- Business Associate Agreements (BAAs) required
- Minimum necessary standard enforced via scopes

## Testing Strategy

### Unit Tests
- Change detection logic
- Webhook signature generation
- Retry backoff calculation

### Integration Tests
- FHIR endpoint compliance (FHIR validator)
- Webhook delivery and verification
- Authorization flow end-to-end

### E2E Tests
- Provider grants authorization → Organization receives webhook
- Provider updates profile → All authorized orgs receive notification
- Webhook delivery failure → Retry successful

### Performance Tests
- 1000 concurrent FHIR API requests
- 100 webhooks delivered simultaneously
- Sync queue with 10,000 pending events

## Future Enhancements

- [ ] GraphQL API for more flexible queries
- [ ] FHIR Subscriptions (R5) for real-time updates
- [ ] Batch sync operations for multiple providers
- [ ] Bidirectional sync (accept updates from external systems)
- [ ] Smart conflict resolution using ML
- [ ] Sync analytics and recommendations

---

**Version**: 0.1.0
**Last Updated**: 2025-10-20
**Maintained By**: Integration Team
