# Provider Profile Module Specification

## Overview

The Provider Profile module serves as the core data management system for healthcare provider information. It maintains a canonical, verified source of truth for provider identities, credentials, specialties, and affiliations.

## Module Metadata

| Field | Value |
|-------|-------|
| **Module ID** | provider-profile |
| **Version** | 0.1.0 |
| **Status** | Planning |
| **Dependencies** | Auth service, Document storage |
| **Owners** | Core Platform Team |

## Requirements

### PP-001: Create Verified Provider Profile

**As a** Provider
**I want to** create a single verified profile with my identifiers, licenses, specialties, and affiliations
**So that** I can reuse this data everywhere

**Acceptance Criteria**:
- [ ] Provider can register with email/phone verification
- [ ] System captures all required identifiers (NPI, State License, DEA, TIN)
- [ ] Provider can add multiple specialties and board certifications
- [ ] Provider can associate with multiple organizations
- [ ] Profile data validated against NPPES registry
- [ ] Profile marked as "verified" only after credential document review

**Technical Details**:
- **Endpoint**: `POST /api/v1/providers`
- **Data Model**: FHIR Practitioner + custom extensions
- **Validation**:
  - NPI: 10-digit validation + NPPES lookup
  - State License: Format validation per state
  - DEA: Format validation (2 letters + 7 digits)
- **Storage**: PostgreSQL + full audit trail

### PP-002: Upload and Verify Documents

**As a** Provider
**I want to** upload and verify documents (license, DEA, insurance)
**So that** my information remains validated

**Acceptance Criteria**:
- [ ] Provider can upload multiple document types (PDF, JPG, PNG)
- [ ] System validates file types and sizes (max 10MB)
- [ ] Documents automatically linked to profile fields
- [ ] Expiration dates tracked and monitored
- [ ] Verification workflow triggers for admin review
- [ ] Document status visible to provider (pending, verified, expired, rejected)

**Document Types**:
- Medical License (per state)
- DEA Certificate
- Board Certification
- Malpractice Insurance
- Hospital Privileges
- CV/Resume
- Government ID (for identity verification)

**Technical Details**:
- **Endpoint**: `POST /api/v1/providers/{id}/credentials`
- **Storage**: S3/Azure Blob with encryption
- **Metadata**: FHIR DocumentReference resource
- **Virus Scanning**: ClamAV or AWS GuardDuty
- **OCR**: Extract key fields (license number, expiration) using Textract/OCR.space

## Data Model

### Practitioner Resource (FHIR R4)

```json
{
  "resourceType": "Practitioner",
  "id": "example-provider-123",
  "identifier": [
    {
      "system": "http://hl7.org/fhir/sid/us-npi",
      "value": "1234567890"
    },
    {
      "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
      "type": {
        "coding": [{"code": "DEA", "display": "DEA Number"}]
      },
      "value": "AB1234563"
    },
    {
      "system": "urn:oid:2.16.840.1.113883.4.6",
      "type": {
        "coding": [{"code": "TAX", "display": "Tax ID"}]
      },
      "value": "123456789"
    }
  ],
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
    },
    {
      "code": {
        "coding": [
          {
            "system": "http://nucc.org/provider-taxonomy",
            "code": "207R00000X",
            "display": "Internal Medicine"
          }
        ]
      },
      "period": {
        "start": "2013-01-01"
      },
      "issuer": {
        "display": "American Board of Internal Medicine"
      }
    }
  ],
  "communication": [
    {
      "coding": [
        {
          "system": "urn:ietf:bcp:47",
          "code": "en",
          "display": "English"
        }
      ]
    },
    {
      "coding": [
        {
          "system": "urn:ietf:bcp:47",
          "code": "es",
          "display": "Spanish"
        }
      ]
    }
  ],
  "extension": [
    {
      "url": "http://providercard.io/fhir/StructureDefinition/verification-status",
      "valueCode": "verified"
    },
    {
      "url": "http://providercard.io/fhir/StructureDefinition/profile-completeness",
      "valueInteger": 95
    }
  ]
}
```

### DocumentReference for Credentials

```json
{
  "resourceType": "DocumentReference",
  "id": "license-doc-123",
  "status": "current",
  "type": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "83005-9",
        "display": "Medical license Document"
      }
    ]
  },
  "subject": {
    "reference": "Practitioner/example-provider-123"
  },
  "date": "2025-10-20T10:30:00Z",
  "author": [
    {
      "reference": "Practitioner/example-provider-123"
    }
  ],
  "content": [
    {
      "attachment": {
        "contentType": "application/pdf",
        "url": "https://storage.providercard.io/docs/abc123.pdf",
        "size": 2048576,
        "hash": "2jmj7l5rSw0yVb/vlWAYkK/YBwk="
      }
    }
  ],
  "context": {
    "related": [
      {
        "reference": "Practitioner/example-provider-123",
        "identifier": {
          "system": "https://mass.gov/medical-license",
          "value": "MD123456"
        }
      }
    ]
  },
  "extension": [
    {
      "url": "http://providercard.io/fhir/StructureDefinition/verification-status",
      "valueCode": "verified"
    },
    {
      "url": "http://providercard.io/fhir/StructureDefinition/expiration-date",
      "valueDate": "2026-06-01"
    },
    {
      "url": "http://providercard.io/fhir/StructureDefinition/verified-by",
      "valueReference": {
        "reference": "Practitioner/admin-verifier-456"
      }
    }
  ]
}
```

## API Endpoints

### Create Provider Profile

```
POST /api/v1/providers
Content-Type: application/json
Authorization: Bearer {token}

Request:
{
  "npi": "1234567890",
  "firstName": "Jane",
  "middleName": "Marie",
  "lastName": "Smith",
  "suffix": ["MD", "FACP"],
  "email": "jane.smith@example.com",
  "phone": "+1-555-123-4567",
  "specialties": [
    {
      "code": "207R00000X",
      "display": "Internal Medicine",
      "isPrimary": true
    }
  ],
  "licenses": [
    {
      "state": "MA",
      "number": "MD123456",
      "issueDate": "2010-06-01",
      "expirationDate": "2026-06-01"
    }
  ],
  "deaNumber": "AB1234563",
  "taxId": "123456789"
}

Response (201 Created):
{
  "id": "prov_2gQ8ZjKYXKdN5rP",
  "fhirId": "example-provider-123",
  "status": "pending_verification",
  "completeness": 65,
  "createdAt": "2025-10-20T10:30:00Z",
  "updatedAt": "2025-10-20T10:30:00Z",
  "_links": {
    "self": "/api/v1/providers/prov_2gQ8ZjKYXKdN5rP",
    "fhir": "/fhir/Practitioner/example-provider-123",
    "credentials": "/api/v1/providers/prov_2gQ8ZjKYXKdN5rP/credentials"
  }
}
```

### Upload Credential Document

```
POST /api/v1/providers/{id}/credentials
Content-Type: multipart/form-data
Authorization: Bearer {token}

Request:
{
  "file": <binary>,
  "type": "medical_license",
  "state": "MA",
  "licenseNumber": "MD123456",
  "expirationDate": "2026-06-01"
}

Response (201 Created):
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
    "self": "/api/v1/providers/prov_2gQ8ZjKYXKdN5rP/credentials/cred_7tR3MnBvWpL2kQ",
    "download": "/api/v1/providers/prov_2gQ8ZjKYXKdN5rP/credentials/cred_7tR3MnBvWpL2kQ/download"
  }
}
```

### Get Provider Profile

```
GET /api/v1/providers/{id}
Authorization: Bearer {token}

Response (200 OK):
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
  "specialties": [...],
  "licenses": [...],
  "credentials": [...],
  "affiliations": [...],
  "syncedOrganizations": [...],
  "createdAt": "2025-10-20T10:30:00Z",
  "updatedAt": "2025-10-20T11:00:00Z"
}
```

## Business Logic

### Profile Completeness Score

Calculated based on:
- Core identifiers (25%): NPI, State License, DEA
- Contact info (10%): Email, Phone
- Specialties (15%): At least one primary specialty
- Credentials (30%): Uploaded and verified documents
- Affiliations (10%): At least one organization
- Additional info (10%): Languages, accepting patients, etc.

### Verification Workflow

1. **Document Upload** → Status: `pending_verification`
2. **Automated Checks**:
   - File integrity and virus scan
   - OCR extraction of key fields
   - NPPES validation (for NPI-related docs)
3. **Manual Review** (if needed) → Admin verifier
4. **Verification Complete** → Status: `verified`
5. **Expiration Monitoring** → Alert 90, 60, 30 days before

### NPI Validation

1. Format check: 10 digits
2. Luhn algorithm checksum
3. NPPES API lookup
4. Data enrichment (name, specialties, addresses)

## Security & Access Control

### Permissions

| Role | Create | Read Own | Read All | Update Own | Update All | Delete |
|------|--------|----------|----------|------------|------------|--------|
| Provider | ✓ | ✓ | - | ✓ | - | ✓ (own) |
| Verifier | - | ✓ | ✓ | - | - | - |
| Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| External Org | - | ✓ (authorized) | - | - | - | - |

### Data Privacy

- **PII Fields**: Encrypted at rest
- **PHI Handling**: HIPAA audit logs for all access
- **Consent Management**: Provider must authorize each organization
- **Data Export**: Provider can export all data (GDPR/CCPA compliance)

## Validation Rules

### Required Fields
- NPI (must be valid 10-digit)
- First Name
- Last Name
- Primary Email
- At least one specialty

### Optional but Recommended
- State License(s)
- DEA Number
- Board Certifications
- Malpractice Insurance
- CV/Resume

### Format Validations
- **Email**: RFC 5322 compliant
- **Phone**: E.164 format
- **NPI**: 10 digits, Luhn checksum valid
- **DEA**: 2 letters + 7 digits
- **State License**: Per-state regex patterns

## Error Handling

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| PROFILE_001 | 400 | Invalid NPI format |
| PROFILE_002 | 409 | NPI already registered |
| PROFILE_003 | 400 | Missing required fields |
| PROFILE_004 | 413 | Document too large (>10MB) |
| PROFILE_005 | 415 | Unsupported file type |
| PROFILE_006 | 404 | Provider not found |
| PROFILE_007 | 403 | Unauthorized to modify profile |

## Testing Strategy

### Unit Tests
- NPI validation logic
- Profile completeness calculation
- Document metadata extraction

### Integration Tests
- NPPES API integration
- Document upload to S3
- FHIR resource serialization

### E2E Tests
- Complete provider registration flow
- Document upload and verification workflow
- Profile update and sync notification

### Performance Tests
- Profile creation: <500ms
- Document upload: <2s for 5MB file
- Profile retrieval: <200ms

## Monitoring & Alerts

### Metrics
- Profile creation rate (per hour/day)
- Verification queue length
- Document upload failures
- NPI validation failures
- Profile completeness distribution

### Alerts
- Verification queue > 50 items
- Document upload failure rate > 5%
- NPPES API error rate > 10%
- Profile creation spike (anomaly detection)

## Future Enhancements

- [ ] Automated credential verification via API integrations
- [ ] ML-based OCR for document field extraction
- [ ] Provider profile suggestions based on NPPES data
- [ ] Bulk import from CAQH/other systems
- [ ] Profile versioning and change history UI
- [ ] Social verification (LinkedIn, Doximity)

---

**Version**: 0.1.0
**Last Updated**: 2025-10-20
**Maintained By**: Core Platform Team
