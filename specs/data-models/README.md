# ProviderCard Data Models

## Overview

ProviderCard uses a hybrid data model approach:
1. **FHIR Resources** for healthcare data interoperability
2. **Custom Models** for application-specific data

## Entity Relationship Diagram

```
┌─────────────────┐
│   Provider      │
│   (Practitioner)│
└────────┬────────┘
         │
         ├──────────────┬──────────────┬──────────────┬─────────────┐
         │              │              │              │             │
         ▼              ▼              ▼              ▼             ▼
┌────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────┐  ┌─────────────┐
│ Credential │  │PractitionerRole│ │Authorization│  │SyncEvent │  │Notification │
│ (Document  │  │(Affiliation)  │  │             │  │          │  │             │
│ Reference) │  │               │  │             │  │          │  │             │
└────────────┘  └───────┬───────┘  └──────┬──────┘  └────┬─────┘  └──────┬──────┘
                        │                  │              │                │
                        ▼                  ▼              ▼                ▼
                ┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────────┐
                │ Organization │  │ Organization │  │ SyncLog  │  │ DeliveryLog  │
                │              │  │              │  │          │  │              │
                └──────────────┘  └──────────────┘  └──────────┘  └──────────────┘
```

## Core Entities

### 1. Provider (Practitioner)

**FHIR Resource**: [Practitioner (R4)](http://hl7.org/fhir/R4/practitioner.html)

**Schema** (PostgreSQL):
```sql
CREATE TABLE practitioners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fhir_id VARCHAR(64) UNIQUE NOT NULL,

  -- Core identifiers
  npi VARCHAR(10) UNIQUE,
  dea_number VARCHAR(9),
  tax_id VARCHAR(20),

  -- Personal info
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100) NOT NULL,
  suffix VARCHAR(50)[], -- array of suffixes (MD, PhD, etc.)
  gender VARCHAR(20),
  birth_date DATE,

  -- Contact
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(30),

  -- FHIR representation
  fhir_resource JSONB NOT NULL,

  -- Metadata
  status VARCHAR(50) DEFAULT 'pending_verification', -- pending_verification, verified, suspended
  completeness INTEGER DEFAULT 0, -- 0-100
  verification_status VARCHAR(50),
  verified_at TIMESTAMP,
  verified_by UUID REFERENCES users(id),

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP,

  -- Indexes
  CONSTRAINT valid_npi CHECK (npi ~ '^\d{10}$'),
  CONSTRAINT valid_completeness CHECK (completeness >= 0 AND completeness <= 100)
);

CREATE INDEX idx_practitioners_npi ON practitioners(npi) WHERE deleted_at IS NULL;
CREATE INDEX idx_practitioners_email ON practitioners(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_practitioners_status ON practitioners(status);
CREATE INDEX idx_practitioners_fhir_resource ON practitioners USING GIN(fhir_resource);
```

**TypeScript Interface**:
```typescript
interface Practitioner {
  id: string;
  fhirId: string;

  // Identifiers
  npi?: string;
  deaNumber?: string;
  taxId?: string;

  // Personal info
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: Date;

  // Contact
  email: string;
  phone?: string;

  // FHIR
  fhirResource: FHIRPractitioner;

  // Metadata
  status: 'pending_verification' | 'verified' | 'suspended';
  completeness: number; // 0-100
  verificationStatus?: string;
  verifiedAt?: Date;
  verifiedBy?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}
```

### 2. Credential (DocumentReference)

**FHIR Resource**: [DocumentReference (R4)](http://hl7.org/fhir/R4/documentreference.html)

**Schema**:
```sql
CREATE TABLE credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  fhir_document_id VARCHAR(64) UNIQUE NOT NULL,

  -- Credential details
  type VARCHAR(50) NOT NULL, -- medical_license, dea, board_cert, malpractice, etc.
  state VARCHAR(2), -- For state-specific credentials
  credential_number VARCHAR(100),
  issue_date DATE,
  expiration_date DATE,

  -- Document storage
  storage_url TEXT NOT NULL, -- S3/Azure Blob URL
  file_name VARCHAR(255),
  file_size INTEGER, -- bytes
  content_type VARCHAR(100),
  file_hash VARCHAR(64), -- SHA-256

  -- Verification
  status VARCHAR(50) DEFAULT 'pending_verification', -- pending, verified, rejected, expired
  verified_at TIMESTAMP,
  verified_by UUID REFERENCES users(id),
  rejection_reason TEXT,

  -- OCR extracted data
  ocr_data JSONB,

  -- Metadata
  uploaded_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP,

  CONSTRAINT valid_expiration CHECK (expiration_date IS NULL OR expiration_date > issue_date)
);

CREATE INDEX idx_credentials_practitioner ON credentials(practitioner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_credentials_type ON credentials(type);
CREATE INDEX idx_credentials_status ON credentials(status);
CREATE INDEX idx_credentials_expiration ON credentials(expiration_date) WHERE status = 'verified';
CREATE INDEX idx_credentials_ocr_data ON credentials USING GIN(ocr_data);
```

**TypeScript Interface**:
```typescript
interface Credential {
  id: string;
  practitionerId: string;
  fhirDocumentId: string;

  // Details
  type: CredentialType;
  state?: string;
  credentialNumber?: string;
  issueDate?: Date;
  expirationDate?: Date;

  // Storage
  storageUrl: string;
  fileName?: string;
  fileSize?: number;
  contentType?: string;
  fileHash?: string;

  // Verification
  status: 'pending_verification' | 'verified' | 'rejected' | 'expired';
  verifiedAt?: Date;
  verifiedBy?: string;
  rejectionReason?: string;

  // OCR
  ocrData?: Record<string, any>;

  // Timestamps
  uploadedAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

type CredentialType =
  | 'medical_license'
  | 'dea_certificate'
  | 'board_certification'
  | 'malpractice_insurance'
  | 'hospital_privileges'
  | 'cv_resume'
  | 'government_id';
```

### 3. PractitionerRole (Affiliation)

**FHIR Resource**: [PractitionerRole (R4)](http://hl7.org/fhir/R4/practitionerrole.html)

**Schema**:
```sql
CREATE TABLE practitioner_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fhir_id VARCHAR(64) UNIQUE NOT NULL,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),

  -- Role details
  role_code VARCHAR(50), -- SNOMED CT code
  role_display VARCHAR(255),
  specialty_codes VARCHAR(50)[], -- NUCC taxonomy codes

  -- Period
  start_date DATE,
  end_date DATE,
  active BOOLEAN DEFAULT TRUE,

  -- Contact
  phone VARCHAR(30),
  email VARCHAR(255),

  -- Locations
  location_ids UUID[], -- references locations table

  -- FHIR representation
  fhir_resource JSONB NOT NULL,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX idx_practitioner_roles_practitioner ON practitioner_roles(practitioner_id);
CREATE INDEX idx_practitioner_roles_organization ON practitioner_roles(organization_id);
CREATE INDEX idx_practitioner_roles_active ON practitioner_roles(active) WHERE deleted_at IS NULL;
```

### 4. Organization

**FHIR Resource**: [Organization (R4)](http://hl7.org/fhir/R4/organization.html)

**Schema**:
```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fhir_id VARCHAR(64) UNIQUE NOT NULL,

  -- Core info
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50), -- hospital_system, payer, medical_group, etc.

  -- Identifiers
  npi VARCHAR(10),
  tin VARCHAR(20),

  -- Contact
  email VARCHAR(255),
  phone VARCHAR(30),
  website TEXT,

  -- API credentials (for integrations)
  api_client_id VARCHAR(255) UNIQUE,
  api_client_secret_hash VARCHAR(255), -- bcrypt hashed
  webhook_url TEXT,
  webhook_secret VARCHAR(255),

  -- FHIR representation
  fhir_resource JSONB NOT NULL,

  -- Metadata
  active BOOLEAN DEFAULT TRUE,
  verified BOOLEAN DEFAULT FALSE,
  integration_type VARCHAR(50), -- nppes, caqh, payer, custom

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX idx_organizations_name ON organizations(name) WHERE deleted_at IS NULL;
CREATE INDEX idx_organizations_type ON organizations(type);
CREATE INDEX idx_organizations_api_client_id ON organizations(api_client_id) WHERE api_client_id IS NOT NULL;
```

### 5. SyncAuthorization

**Custom Model** (not FHIR)

**Schema**:
```sql
CREATE TABLE sync_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Authorization details
  authorization_level VARCHAR(50) NOT NULL, -- read-only, sync, bidirectional
  status VARCHAR(50) DEFAULT 'pending', -- pending, active, revoked, expired

  -- Scopes
  requested_scopes TEXT[] NOT NULL,
  granted_scopes TEXT[],

  -- Request metadata
  request_reason TEXT,
  provider_notes TEXT,

  -- Dates
  requested_at TIMESTAMP DEFAULT NOW(),
  granted_at TIMESTAMP,
  revoked_at TIMESTAMP,
  expires_at TIMESTAMP,

  -- Sync metadata
  last_sync_at TIMESTAMP,
  sync_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(practitioner_id, organization_id)
);

CREATE INDEX idx_sync_auth_practitioner ON sync_authorizations(practitioner_id);
CREATE INDEX idx_sync_auth_organization ON sync_authorizations(organization_id);
CREATE INDEX idx_sync_auth_status ON sync_authorizations(status);
CREATE INDEX idx_sync_auth_expires ON sync_authorizations(expires_at) WHERE status = 'active';
```

**TypeScript Interface**:
```typescript
interface SyncAuthorization {
  id: string;
  practitionerId: string;
  organizationId: string;

  // Authorization
  authorizationLevel: 'read-only' | 'sync' | 'bidirectional';
  status: 'pending' | 'active' | 'revoked' | 'expired';

  // Scopes
  requestedScopes: string[];
  grantedScopes?: string[];

  // Metadata
  requestReason?: string;
  providerNotes?: string;

  // Dates
  requestedAt: Date;
  grantedAt?: Date;
  revokedAt?: Date;
  expiresAt?: Date;

  // Sync
  lastSyncAt?: Date;
  syncCount: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

### 6. SyncEvent

**Schema**:
```sql
CREATE TABLE sync_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,

  -- Event details
  event_type VARCHAR(100) NOT NULL, -- provider.updated, credential.verified, etc.
  payload JSONB NOT NULL,

  -- Processing
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  target_organization_ids UUID[],

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sync_events_practitioner ON sync_events(practitioner_id);
CREATE INDEX idx_sync_events_processed ON sync_events(processed, created_at);
CREATE INDEX idx_sync_events_type ON sync_events(event_type);
```

### 7. SyncLog

**Schema**:
```sql
CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id UUID REFERENCES sync_events(id) ON DELETE SET NULL,

  -- Sync details
  sync_type VARCHAR(50) NOT NULL, -- webhook, fhir-push, fhir-pull
  status VARCHAR(50) DEFAULT 'pending', -- pending, success, failed, retrying

  -- Attempts
  attempt_count INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMP,
  next_retry_at TIMESTAMP,

  -- Error
  error_code VARCHAR(100),
  error_message TEXT,
  error_stack TEXT,

  -- Performance
  duration_ms INTEGER, -- milliseconds

  -- Request/Response
  request_payload JSONB,
  response_status INTEGER,
  response_body JSONB,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sync_logs_practitioner ON sync_logs(practitioner_id);
CREATE INDEX idx_sync_logs_organization ON sync_logs(organization_id);
CREATE INDEX idx_sync_logs_event ON sync_logs(event_id);
CREATE INDEX idx_sync_logs_status ON sync_logs(status, next_retry_at);
CREATE INDEX idx_sync_logs_created ON sync_logs(created_at DESC);
```

### 8. Notification

**Schema**:
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Recipient
  recipient_type VARCHAR(50) NOT NULL, -- provider, organization, admin
  recipient_id UUID NOT NULL,

  -- Notification details
  type VARCHAR(100) NOT NULL, -- credential.expiring, sync.failed, etc.
  severity VARCHAR(20) DEFAULT 'info', -- info, warning, error
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,

  -- Action
  action_url TEXT,
  action_label VARCHAR(100),

  -- Status
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  expires_at TIMESTAMP,

  -- Delivery tracking
  channels_sent VARCHAR(50)[], -- email, webhook, inapp, sms
  delivery_status JSONB, -- per-channel delivery status

  -- Related entities
  related_entity_type VARCHAR(50), -- practitioner, credential, sync_log, etc.
  related_entity_id UUID,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_type, recipient_id, read);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_expires ON notifications(expires_at) WHERE expires_at IS NOT NULL;
```

### 9. AuditLog

**FHIR Resource**: [AuditEvent (R4)](http://hl7.org/fhir/R4/auditevent.html)

**Schema**:
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fhir_id VARCHAR(64) UNIQUE,

  -- Event details
  event_type VARCHAR(100) NOT NULL, -- read, create, update, delete, access, etc.
  event_action VARCHAR(50) NOT NULL, -- C (create), R (read), U (update), D (delete)
  event_outcome VARCHAR(20) NOT NULL, -- success, failure

  -- Actor (who)
  actor_type VARCHAR(50) NOT NULL, -- provider, organization, admin, system
  actor_id UUID NOT NULL,
  actor_name VARCHAR(255),
  actor_ip VARCHAR(45), -- IPv4 or IPv6
  actor_user_agent TEXT,

  -- Entity (what)
  entity_type VARCHAR(50) NOT NULL, -- practitioner, credential, organization, etc.
  entity_id UUID NOT NULL,
  entity_name VARCHAR(255),

  -- Context
  description TEXT,
  request_id VARCHAR(100),
  session_id VARCHAR(100),

  -- Changes (for updates)
  changes JSONB, -- {field: {old: value, new: value}}

  -- FHIR representation
  fhir_resource JSONB,

  -- Timestamp (immutable)
  recorded_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_type, actor_id, recorded_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id, recorded_at DESC);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type, recorded_at DESC);
CREATE INDEX idx_audit_logs_recorded ON audit_logs(recorded_at DESC);

-- Make audit logs append-only (no updates/deletes)
CREATE RULE audit_logs_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
```

## Data Validation Rules

### NPI Validation

```typescript
function validateNPI(npi: string): boolean {
  // 1. Must be 10 digits
  if (!/^\d{10}$/.test(npi)) return false;

  // 2. Luhn checksum algorithm
  const digits = npi.split('').map(Number);
  const checkDigit = digits.pop()!;

  // Add constant 80840 prefix
  const fullNumber = [8, 0, 8, 4, 0, ...digits];

  let sum = 0;
  for (let i = fullNumber.length - 1; i >= 0; i--) {
    let digit = fullNumber[i];
    if ((fullNumber.length - i) % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }

  const calculatedCheck = (10 - (sum % 10)) % 10;
  return calculatedCheck === checkDigit;
}
```

### DEA Number Validation

```typescript
function validateDEA(dea: string): boolean {
  // Format: 2 letters + 7 digits
  if (!/^[A-Z]{2}\d{7}$/.test(dea)) return false;

  // First letter: registrant type (A, B, C, D, E, F, G, H, J, K, L, M, P, R, S, T, U, X)
  const validFirstLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'P', 'R', 'S', 'T', 'U', 'X'];
  if (!validFirstLetters.includes(dea[0])) return false;

  // Checksum validation
  const digits = dea.substring(2).split('').map(Number);
  const checkDigit = digits[6];

  const sum = digits[0] + digits[2] + digits[4] + 2 * (digits[1] + digits[3] + digits[5]);
  const calculatedCheck = sum % 10;

  return calculatedCheck === checkDigit;
}
```

## Database Migrations

Migrations managed with [Flyway](https://flywaydb.org/) or [Liquibase](https://www.liquibase.org/).

**Example Migration** (V001__initial_schema.sql):
```sql
-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create users table (for auth)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  role VARCHAR(50) NOT NULL, -- provider, admin, verifier
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create practitioners table
CREATE TABLE practitioners (
  -- ... (see schema above)
);

-- ... (other tables)
```

## Data Seeding (Development)

**Example Seed Data** (TypeScript):
```typescript
async function seedDatabase() {
  // Create test provider
  const provider = await db.practitioners.create({
    npi: '1234567890',
    firstName: 'Jane',
    lastName: 'Smith',
    email: 'jane.smith@example.com',
    status: 'verified',
    fhirResource: { /* FHIR Practitioner resource */ }
  });

  // Create test credential
  await db.credentials.create({
    practitionerId: provider.id,
    type: 'medical_license',
    state: 'MA',
    credentialNumber: 'MD123456',
    expirationDate: new Date('2026-06-01'),
    status: 'verified',
    storageUrl: 'https://example.com/doc.pdf'
  });

  // Create test organization
  const org = await db.organizations.create({
    name: 'Acme Health Network',
    type: 'hospital_system',
    email: 'api@acme.health',
    fhirResource: { /* FHIR Organization resource */ }
  });

  // Create authorization
  await db.syncAuthorizations.create({
    practitionerId: provider.id,
    organizationId: org.id,
    authorizationLevel: 'sync',
    status: 'active',
    requestedScopes: ['system/Practitioner.read'],
    grantedScopes: ['system/Practitioner.read'],
    grantedAt: new Date()
  });
}
```

## Performance Optimization

### Indexes

All critical queries have supporting indexes (see schemas above).

### Partitioning

Partition large tables by time:

```sql
-- Partition audit_logs by month
CREATE TABLE audit_logs_2025_10 PARTITION OF audit_logs
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE audit_logs_2025_11 PARTITION OF audit_logs
  FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
```

### Caching Strategy

- **Redis**: Cache frequently accessed provider profiles (TTL: 5 minutes)
- **CDN**: Cache static documents (credentials) with signed URLs
- **Database Query Cache**: Enable for read-heavy queries

## Backup & Recovery

- **Full Backup**: Daily at 2 AM UTC
- **Incremental Backup**: Every 6 hours
- **Transaction Log Backup**: Continuous (for point-in-time recovery)
- **Retention**: 30 days full, 90 days for compliance data
- **Disaster Recovery**: RTO = 1 hour, RPO = 15 minutes

---

**Version**: 0.1.0
**Last Updated**: 2025-10-20
**Maintained By**: Data Team
