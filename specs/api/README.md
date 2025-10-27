# ProviderCard API Documentation

## Overview

ProviderCard exposes two primary APIs:
1. **RESTful API**: For application-level operations
2. **FHIR API**: Standards-based healthcare data exchange

## Base URLs

| Environment | RESTful API | FHIR API |
|-------------|-------------|----------|
| Production | `https://api.providercard.io/v1` | `https://api.providercard.io/fhir` |
| Staging | `https://api.staging.providercard.io/v1` | `https://api.staging.providercard.io/fhir` |
| Development | `http://localhost:8000/v1` | `http://localhost:8000/fhir` |

## Authentication

### RESTful API

Uses **OAuth 2.0 / OpenID Connect** for provider and organization authentication.

#### Authorization Code Flow (Providers)

```bash
# 1. Redirect user to authorization endpoint
GET https://auth.providercard.io/authorize?
  response_type=code&
  client_id=YOUR_CLIENT_ID&
  redirect_uri=YOUR_REDIRECT_URI&
  scope=provider:read provider:write&
  state=RANDOM_STATE

# 2. Exchange authorization code for tokens
POST https://auth.providercard.io/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=AUTHORIZATION_CODE&
client_id=YOUR_CLIENT_ID&
client_secret=YOUR_CLIENT_SECRET&
redirect_uri=YOUR_REDIRECT_URI

Response:
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "def50200e3b...",
  "scope": "provider:read provider:write"
}

# 3. Use access token in API requests
GET https://api.providercard.io/v1/providers/me
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Client Credentials Flow (Organizations)

```bash
POST https://auth.providercard.io/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&
client_id=YOUR_CLIENT_ID&
client_secret=YOUR_CLIENT_SECRET&
scope=system/Practitioner.read

Response:
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "system/Practitioner.read"
}
```

### FHIR API

Uses **SMART on FHIR** for authorization.

#### SMART Scopes

| Scope | Description |
|-------|-------------|
| `user/Practitioner.read` | Read practitioner data (user context) |
| `user/Practitioner.write` | Write practitioner data (user context) |
| `user/PractitionerRole.read` | Read practitioner roles |
| `system/Practitioner.read` | Read practitioner data (system context) |
| `system/PractitionerRole.read` | Read practitioner roles (system context) |

## RESTful API Endpoints

### Providers

#### Create Provider Profile

```http
POST /v1/providers
Content-Type: application/json
Authorization: Bearer {token}

{
  "npi": "1234567890",
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane.smith@example.com",
  "phone": "+1-555-123-4567",
  "specialties": [
    {
      "code": "207R00000X",
      "display": "Internal Medicine",
      "isPrimary": true
    }
  ]
}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /v1/providers/prov_2gQ8ZjKYXKdN5rP

{
  "id": "prov_2gQ8ZjKYXKdN5rP",
  "fhirId": "example-provider-123",
  "status": "pending_verification",
  "npi": "1234567890",
  "name": {
    "firstName": "Jane",
    "lastName": "Smith"
  },
  "email": "jane.smith@example.com",
  "completeness": 65,
  "createdAt": "2025-10-20T12:00:00Z",
  "_links": {
    "self": "/v1/providers/prov_2gQ8ZjKYXKdN5rP",
    "fhir": "/fhir/Practitioner/example-provider-123",
    "credentials": "/v1/providers/prov_2gQ8ZjKYXKdN5rP/credentials"
  }
}
```

#### Get Provider Profile

```http
GET /v1/providers/{id}
Authorization: Bearer {token}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "prov_2gQ8ZjKYXKdN5rP",
  "fhirId": "example-provider-123",
  "status": "verified",
  "completeness": 95,
  "npi": "1234567890",
  "name": {
    "firstName": "Jane",
    "middleName": "Marie",
    "lastName": "Smith",
    "suffix": ["MD", "FACP"]
  },
  "contact": {
    "email": "jane.smith@example.com",
    "phone": "+1-555-123-4567"
  },
  "specialties": [
    {
      "code": "207R00000X",
      "display": "Internal Medicine",
      "isPrimary": true,
      "boardCertified": true,
      "certificationDate": "2013-01-01"
    }
  ],
  "licenses": [
    {
      "id": "lic_8tS4NxMvWqL3pR",
      "state": "MA",
      "number": "MD123456",
      "issueDate": "2010-06-01",
      "expirationDate": "2026-06-01",
      "status": "active",
      "verified": true
    }
  ],
  "credentials": [
    {
      "id": "cred_7tR3MnBvWpL2kQ",
      "type": "medical_license",
      "status": "verified",
      "expirationDate": "2026-06-01",
      "uploadedAt": "2025-10-20T10:35:00Z",
      "verifiedAt": "2025-10-20T14:20:00Z"
    }
  ],
  "affiliations": [
    {
      "organizationId": "org_5jQ1CzMwRxL3tY",
      "organizationName": "Mass General Brigham",
      "role": "Attending Physician",
      "startDate": "2015-07-01",
      "active": true
    }
  ],
  "syncedOrganizations": [
    {
      "organizationId": "org_7hP2BvLqNmK8sR",
      "organizationName": "Blue Cross Blue Shield MA",
      "authorizationLevel": "sync",
      "lastSyncAt": "2025-10-20T11:30:00Z",
      "syncStatus": "success"
    }
  ],
  "createdAt": "2025-10-20T10:30:00Z",
  "updatedAt": "2025-10-20T14:25:00Z",
  "_links": {
    "self": "/v1/providers/prov_2gQ8ZjKYXKdN5rP",
    "fhir": "/fhir/Practitioner/example-provider-123",
    "credentials": "/v1/providers/prov_2gQ8ZjKYXKdN5rP/credentials",
    "authorizations": "/v1/providers/prov_2gQ8ZjKYXKdN5rP/authorizations",
    "sync": "/v1/providers/prov_2gQ8ZjKYXKdN5rP/sync"
  }
}
```

#### Update Provider Profile

```http
PUT /v1/providers/{id}
Content-Type: application/json
Authorization: Bearer {token}

{
  "phone": "+1-555-999-8888",
  "specialties": [
    {
      "code": "207R00000X",
      "display": "Internal Medicine",
      "isPrimary": true
    },
    {
      "code": "207RG0300X",
      "display": "Geriatric Medicine",
      "isPrimary": false
    }
  ]
}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "prov_2gQ8ZjKYXKdN5rP",
  "message": "Profile updated successfully",
  "changes": ["phone", "specialties"],
  "syncTriggered": true,
  "affectedOrganizations": 5,
  "updatedAt": "2025-10-20T15:00:00Z"
}
```

### Credentials

#### Upload Credential Document

```http
POST /v1/providers/{id}/credentials
Content-Type: multipart/form-data
Authorization: Bearer {token}

--boundary
Content-Disposition: form-data; name="file"; filename="ma_license.pdf"
Content-Type: application/pdf

<binary data>
--boundary
Content-Disposition: form-data; name="type"

medical_license
--boundary
Content-Disposition: form-data; name="state"

MA
--boundary
Content-Disposition: form-data; name="licenseNumber"

MD123456
--boundary
Content-Disposition: form-data; name="expirationDate"

2026-06-01
--boundary--
```

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "id": "cred_7tR3MnBvWpL2kQ",
  "documentId": "license-doc-123",
  "type": "medical_license",
  "status": "pending_verification",
  "uploadedAt": "2025-10-20T10:35:00Z",
  "expirationDate": "2026-06-01",
  "metadata": {
    "fileName": "ma_license.pdf",
    "fileSize": 2048576,
    "contentType": "application/pdf"
  },
  "_links": {
    "self": "/v1/providers/prov_2gQ8ZjKYXKdN5rP/credentials/cred_7tR3MnBvWpL2kQ",
    "download": "/v1/providers/prov_2gQ8ZjKYXKdN5rP/credentials/cred_7tR3MnBvWpL2kQ/download"
  }
}
```

### Authorizations

#### List Authorization Requests

```http
GET /v1/providers/{id}/authorizations?status=pending
Authorization: Bearer {token}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "data": [
    {
      "id": "auth_3kL9MnQrTxW5pZ",
      "organization": {
        "id": "org_7hP2BvLqNmK8sR",
        "name": "Acme Health Network",
        "type": "hospital_system",
        "logo": "https://cdn.providercard.io/logos/acme.png"
      },
      "status": "pending",
      "requestedAt": "2025-10-15T14:30:00Z",
      "requestedScopes": ["system/Practitioner.read", "system/PractitionerRole.read"],
      "requestReason": "To include you in our provider directory and enable patient appointment booking",
      "_links": {
        "grant": "/v1/providers/prov_2gQ8ZjKYXKdN5rP/authorizations/auth_3kL9MnQrTxW5pZ/grant",
        "deny": "/v1/providers/prov_2gQ8ZjKYXKdN5rP/authorizations/auth_3kL9MnQrTxW5pZ/deny"
      }
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "perPage": 20
  }
}
```

#### Grant Authorization

```http
POST /v1/providers/{id}/authorizations/{authId}/grant
Content-Type: application/json
Authorization: Bearer {token}

{
  "authorizationLevel": "sync",
  "scopes": ["system/Practitioner.read", "system/PractitionerRole.read"],
  "expiresAt": "2026-10-20T00:00:00Z"
}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "auth_3kL9MnQrTxW5pZ",
  "status": "active",
  "grantedAt": "2025-10-20T12:00:00Z",
  "grantedScopes": ["system/Practitioner.read", "system/PractitionerRole.read"],
  "webhookUrl": "https://acme-health.com/webhooks/providercard",
  "message": "Authorization granted. Organization will receive sync notifications.",
  "initialSyncTriggered": true
}
```

### Sync Operations

#### Trigger Manual Sync

```http
POST /v1/providers/{id}/sync
Content-Type: application/json
Authorization: Bearer {token}

{
  "targetOrganizations": ["org_7hP2BvLqNmK8sR"],
  "syncType": "full"
}
```

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "syncJobId": "sync_9tW4XvKqMnL8pR",
  "status": "queued",
  "targetOrganizations": 1,
  "estimatedCompletionTime": "2025-10-20T12:10:00Z",
  "_links": {
    "status": "/v1/sync-jobs/sync_9tW4XvKqMnL8pR"
  }
}
```

## FHIR API Endpoints

### Practitioner Resource

#### Get Practitioner by ID

```http
GET /fhir/Practitioner/example-provider-123
Authorization: Bearer {token}
Accept: application/fhir+json
```

```http
HTTP/1.1 200 OK
Content-Type: application/fhir+json

{
  "resourceType": "Practitioner",
  "id": "example-provider-123",
  "meta": {
    "versionId": "2",
    "lastUpdated": "2025-10-20T14:25:00Z",
    "profile": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner"]
  },
  "identifier": [
    {
      "system": "http://hl7.org/fhir/sid/us-npi",
      "value": "1234567890"
    }
  ],
  "active": true,
  "name": [
    {
      "use": "official",
      "family": "Smith",
      "given": ["Jane", "Marie"],
      "prefix": ["Dr."],
      "suffix": ["MD", "FACP"]
    }
  ],
  "telecom": [
    {
      "system": "email",
      "value": "jane.smith@example.com",
      "use": "work"
    },
    {
      "system": "phone",
      "value": "+1-555-123-4567",
      "use": "work"
    }
  ],
  "address": [
    {
      "use": "work",
      "line": ["123 Medical Plaza", "Suite 400"],
      "city": "Boston",
      "state": "MA",
      "postalCode": "02101",
      "country": "US"
    }
  ],
  "gender": "female",
  "birthDate": "1980-05-15",
  "qualification": [
    {
      "identifier": [
        {
          "system": "https://mass.gov/medical-license",
          "value": "MD123456"
        }
      ],
      "code": {
        "coding": [
          {
            "system": "http://terminology.hl7.org/CodeSystem/v2-0360",
            "code": "MD",
            "display": "Doctor of Medicine"
          }
        ]
      },
      "period": {
        "start": "2010-06-01",
        "end": "2026-06-01"
      },
      "issuer": {
        "display": "Massachusetts Board of Registration in Medicine"
      }
    }
  ]
}
```

#### Search Practitioners

```http
GET /fhir/Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|1234567890
Authorization: Bearer {token}
Accept: application/fhir+json
```

```http
HTTP/1.1 200 OK
Content-Type: application/fhir+json

{
  "resourceType": "Bundle",
  "type": "searchset",
  "total": 1,
  "link": [
    {
      "relation": "self",
      "url": "https://api.providercard.io/fhir/Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|1234567890"
    }
  ],
  "entry": [
    {
      "fullUrl": "https://api.providercard.io/fhir/Practitioner/example-provider-123",
      "resource": {
        "resourceType": "Practitioner",
        "id": "example-provider-123",
        ...
      },
      "search": {
        "mode": "match"
      }
    }
  ]
}
```

### PractitionerRole Resource

#### Get PractitionerRole by ID

```http
GET /fhir/PractitionerRole/role-456
Authorization: Bearer {token}
Accept: application/fhir+json
```

```http
HTTP/1.1 200 OK
Content-Type: application/fhir+json

{
  "resourceType": "PractitionerRole",
  "id": "role-456",
  "active": true,
  "practitioner": {
    "reference": "Practitioner/example-provider-123",
    "display": "Dr. Jane Smith, MD"
  },
  "organization": {
    "reference": "Organization/org-789",
    "display": "Mass General Brigham"
  },
  "code": [
    {
      "coding": [
        {
          "system": "http://snomed.info/sct",
          "code": "309343006",
          "display": "Physician"
        }
      ]
    }
  ],
  "specialty": [
    {
      "coding": [
        {
          "system": "http://nucc.org/provider-taxonomy",
          "code": "207R00000X",
          "display": "Internal Medicine"
        }
      ]
    }
  ],
  "location": [
    {
      "reference": "Location/loc-101",
      "display": "Mass General Hospital"
    }
  ],
  "telecom": [
    {
      "system": "phone",
      "value": "+1-555-123-4567",
      "use": "work"
    }
  ],
  "availableTime": [
    {
      "daysOfWeek": ["mon", "tue", "wed", "thu", "fri"],
      "availableStartTime": "09:00:00",
      "availableEndTime": "17:00:00"
    }
  ]
}
```

## Error Responses

All API errors follow this format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid NPI format",
    "details": [
      {
        "field": "npi",
        "issue": "Must be 10 digits"
      }
    ],
    "requestId": "req_4kM8NpQsUxW6qZ",
    "timestamp": "2025-10-20T12:00:00Z"
  }
}
```

### Common Error Codes

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | VALIDATION_ERROR | Request validation failed |
| 401 | UNAUTHORIZED | Missing or invalid authentication |
| 403 | FORBIDDEN | Insufficient permissions |
| 404 | NOT_FOUND | Resource not found |
| 409 | CONFLICT | Resource already exists |
| 413 | PAYLOAD_TOO_LARGE | Request body too large |
| 415 | UNSUPPORTED_MEDIA_TYPE | Invalid Content-Type |
| 429 | RATE_LIMIT_EXCEEDED | Too many requests |
| 500 | INTERNAL_SERVER_ERROR | Server error |
| 502 | BAD_GATEWAY | Upstream service error |
| 503 | SERVICE_UNAVAILABLE | Service temporarily unavailable |

## Rate Limiting

### Limits

| Tier | Requests/Hour | Burst | Notes |
|------|---------------|-------|-------|
| Provider (Free) | 1,000 | 50 | Per access token |
| Organization (Basic) | 10,000 | 200 | Per client ID |
| Organization (Enterprise) | 100,000 | 1,000 | Per client ID |

### Rate Limit Headers

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 987
X-RateLimit-Reset: 1634745600
```

### Rate Limit Exceeded

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1634745600
Retry-After: 3600

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Try again in 3600 seconds.",
    "requestId": "req_4kM8NpQsUxW6qZ"
  }
}
```

## Webhooks

See [Notifications Module](../modules/notifications.md) for detailed webhook documentation.

## SDKs & Client Libraries

### Official SDKs

- **JavaScript/TypeScript**: `npm install @providercard/sdk`
- **Python**: `pip install providercard`
- **Ruby**: `gem install providercard`

### Example Usage (JavaScript)

```javascript
import { ProviderCard } from '@providercard/sdk';

const client = new ProviderCard({
  accessToken: 'your_access_token',
  environment: 'production'
});

// Get provider profile
const provider = await client.providers.get('prov_2gQ8ZjKYXKdN5rP');

// Upload credential
const credential = await client.credentials.upload('prov_2gQ8ZjKYXKdN5rP', {
  file: fs.createReadStream('license.pdf'),
  type: 'medical_license',
  state: 'MA',
  licenseNumber: 'MD123456',
  expirationDate: '2026-06-01'
});

// Trigger sync
const syncJob = await client.sync.trigger('prov_2gQ8ZjKYXKdN5rP', {
  targetOrganizations: ['org_7hP2BvLqNmK8sR']
});
```

## Pagination

List endpoints support cursor-based pagination:

```http
GET /v1/providers?limit=20&cursor=eyJpZCI6InByb3ZfMmdROFpq...
```

```json
{
  "data": [...],
  "pagination": {
    "hasMore": true,
    "nextCursor": "eyJpZCI6InByb3ZfOGJNMktr...",
    "prevCursor": "eyJpZCI6InByb3ZfMWFMN0pq..."
  }
}
```

## Versioning

API versions are specified in the URL path: `/v1`, `/v2`, etc.

- **Current Version**: v1
- **Deprecation Policy**: 12 months notice before deprecation
- **Sunset**: 6 months after deprecation announcement

## OpenAPI Specification

Download the complete OpenAPI 3.0 specification:
- [RESTful API OpenAPI Spec](./openapi.yaml)
- [FHIR API Capability Statement](./capability-statement.json)

---

**Version**: 0.1.0
**Last Updated**: 2025-10-20
**Maintained By**: API Team
