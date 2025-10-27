# ProviderCard - Project Specification

## Project Metadata

| Field | Value |
|-------|-------|
| **Name** | ProviderCard |
| **Description** | Unified Provider Identity & Information Hub |
| **Owner** | fhiriq |
| **Version** | 0.1.0 |
| **Status** | Planning |
| **Created** | 2025-10-20 |
| **Tags** | fhir, healthcare, directory, credentialing, provider, api |

## Executive Summary

ProviderCard is a centralized provider identity and information management system designed to eliminate redundant data entry and synchronization issues across healthcare directories. The platform enables healthcare providers to maintain a single, verified profile that can be synchronized with external registries, payer directories, and credentialing systems through FHIR-compliant APIs.

## Problem Statement

Healthcare providers currently face:
- **Data Fragmentation**: Managing profiles across multiple directories (CMS NPPES, payer networks, hospital systems)
- **Manual Updates**: Updating credentials, licenses, and affiliations manually in each system
- **Verification Burden**: Re-verifying the same documents for different organizations
- **Synchronization Gaps**: Outdated information leading to patient care disruptions and billing issues

## Solution Overview

ProviderCard provides:
1. **Single Source of Truth**: Canonical provider profile with verified credentials
2. **Automated Synchronization**: Push/pull updates to authorized external systems
3. **FHIR Compliance**: Standards-based data exchange using Practitioner, PractitionerRole resources
4. **Credential Management**: Document upload, verification, and expiration tracking
5. **Access Control**: Provider-controlled authorization for data sharing

## Architecture Principles

- **Standards-Based**: FHIR R4/R5 for all external integrations
- **Privacy-First**: Provider controls all data sharing permissions
- **Audit Trail**: Complete history of data changes and access
- **Modular Design**: Pluggable integrations for new directories
- **API-First**: All functionality exposed via REST/FHIR APIs

## System Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                        ProviderCard                          │
├─────────────────────────────────────────────────────────────┤
│  Provider Portal (Web/Mobile)                                │
├─────────────────────────────────────────────────────────────┤
│  API Gateway + Auth (OAuth 2.0 / SMART on FHIR)             │
├─────────────────────────────────────────────────────────────┤
│  Core Services                                               │
│  ┌──────────────┬──────────────┬──────────────────────────┐ │
│  │ Provider     │ Sync Engine  │ Credential Verification  │ │
│  │ Profile      │              │                          │ │
│  └──────────────┴──────────────┴──────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  Integration Layer                                           │
│  ┌──────────┬──────────┬──────────┬──────────────────────┐ │
│  │ NPPES    │ CAQH     │ Payer    │ Custom Adapters      │ │
│  │ Adapter  │ Adapter  │ Adapters │                      │ │
│  └──────────┴──────────┴──────────┴──────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  Data Layer                                                  │
│  ┌────────────────────┬────────────────────────────────────┐│
│  │ PostgreSQL         │ Document Storage (S3/Azure Blob)   ││
│  │ (Profile, Audit)   │ (Licenses, Certificates)           ││
│  └────────────────────┴────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
          │                       │                      │
          ▼                       ▼                      ▼
    External Orgs          Payer Networks         CMS NPPES
```

## Technology Stack

### Backend
- **Runtime**: Node.js 20+ or Python 3.11+
- **Framework**: Express.js / FastAPI
- **FHIR Server**: HAPI FHIR Server or Smile CDR
- **Database**: PostgreSQL 15+
- **Cache**: Redis 7+
- **Message Queue**: RabbitMQ / AWS SQS

### Frontend
- **Framework**: React 18+ / Next.js 14+
- **State Management**: React Query + Zustand
- **UI Components**: Tailwind CSS + shadcn/ui
- **FHIR Client**: fhir.js / @medplum/core

### Infrastructure
- **Container**: Docker + Docker Compose
- **Orchestration**: Kubernetes (production)
- **CI/CD**: GitHub Actions
- **Cloud**: AWS / Azure (HIPAA-compliant regions)
- **Monitoring**: Datadog / New Relic

### Security & Compliance
- **Authentication**: OAuth 2.0 / OpenID Connect
- **Authorization**: SMART on FHIR scopes
- **Encryption**: TLS 1.3, AES-256 at rest
- **Compliance**: HIPAA, SOC 2 Type II
- **Audit**: FHIR AuditEvent resources

## Core Modules

### 1. Provider Profile Module
[Detailed Spec](./modules/provider-profile.md)

**Purpose**: Canonical provider data management

**Key Features**:
- Identity management (NPI, State License Numbers, DEA, TIN)
- Specialty and board certification tracking
- Affiliation management (hospitals, groups, networks)
- Practice location management
- Language and accessibility information

### 2. Sync Engine Module
[Detailed Spec](./modules/sync-engine.md)

**Purpose**: Bidirectional data synchronization

**Key Features**:
- FHIR Practitioner/PractitionerRole endpoint exposure
- Webhook-based change notifications
- Authorization management for external systems
- Conflict resolution and merge strategies
- Sync status monitoring and retry logic

### 3. Integrations Module
[Detailed Spec](./modules/integrations.md)

**Purpose**: External directory adapters

**Integrations**:
- **CMS NPPES**: NPI Registry lookup and validation
- **CAQH ProView**: Credentialing data import/export
- **Payer Directories**: Blue Button 2.0, Plan Finder APIs
- **State Medical Boards**: License verification (where available)

### 4. Notifications Module
[Detailed Spec](./modules/notifications.md)

**Purpose**: Stakeholder alerting

**Features**:
- Webhook delivery to subscribed organizations
- Email/SMS notifications to providers
- Event-driven architecture (profile.updated, license.expiring)
- Delivery tracking and retry logic

### 5. Analytics Module
[Detailed Spec](./modules/analytics.md)

**Purpose**: System monitoring and data quality

**Dashboards**:
- Integration health (success rates, latency)
- Data quality metrics (completeness, freshness)
- Adoption metrics (active users, synced organizations)
- Error logs and alerting

## Data Models

See [Data Models Documentation](./data-models/README.md)

### Core Resources
- **Practitioner** (FHIR R4)
- **PractitionerRole** (FHIR R4)
- **Organization** (FHIR R4)
- **Location** (FHIR R4)
- **DocumentReference** (for credentials)
- **AuditEvent** (for change tracking)

### Custom Extensions
- Credential expiration tracking
- Sync authorization metadata
- Data quality scores

## API Specifications

See [API Documentation](./api/README.md)

### RESTful API
- `POST /api/v1/providers` - Create provider profile
- `GET /api/v1/providers/{id}` - Retrieve provider
- `PUT /api/v1/providers/{id}` - Update provider
- `POST /api/v1/providers/{id}/credentials` - Upload document

### FHIR API
- `GET /fhir/Practitioner/{id}`
- `GET /fhir/PractitionerRole?practitioner={id}`
- `POST /fhir/Practitioner/$sync` - Trigger sync operation

### Webhook Events
- `provider.created`
- `provider.updated`
- `credential.uploaded`
- `credential.verified`
- `credential.expiring`
- `sync.completed`
- `sync.failed`

## Security & Privacy

### Authentication
- OAuth 2.0 / OpenID Connect for provider login
- SMART on FHIR for external application access
- Multi-factor authentication (MFA) required

### Authorization
- Role-based access control (Provider, Admin, Verifier)
- SMART scopes: `user/Practitioner.read`, `user/Practitioner.write`
- Organization-level data sharing permissions

### Data Protection
- Encryption at rest (AES-256)
- Encryption in transit (TLS 1.3)
- PHI/PII handling per HIPAA requirements
- Document retention policies
- Right to deletion support

### Audit & Compliance
- All data access logged to FHIR AuditEvent
- Immutable audit trail
- Quarterly security reviews
- Penetration testing annually

## Integration Specifications

### CMS NPPES Integration
[Detailed Spec](./integrations/nppes.md)

**API**: NPPES NPI Registry API
**Frequency**: Weekly validation checks
**Data Flow**: Unidirectional (NPPES → ProviderCard)

### CAQH ProView Integration
[Detailed Spec](./integrations/caqh.md)

**API**: CAQH ProView DirectAssure API
**Frequency**: Event-driven + nightly batch
**Data Flow**: Bidirectional

### Payer Directory Integration
[Detailed Spec](./integrations/payer-directories.md)

**Standards**: FHIR Payer Network API, Blue Button 2.0
**Frequency**: Real-time + change events
**Data Flow**: ProviderCard → Payer directories

## Development Roadmap

### Phase 1: MVP (Months 1-3)
- [ ] Provider profile CRUD operations
- [ ] FHIR Practitioner/PractitionerRole endpoints
- [ ] NPPES integration (read-only)
- [ ] Basic web portal
- [ ] Document upload (no verification)

### Phase 2: Sync & Verification (Months 4-6)
- [ ] Sync engine with webhook notifications
- [ ] Credential verification workflow
- [ ] CAQH ProView integration
- [ ] Organization authorization management
- [ ] Audit logging

### Phase 3: Payer Integration (Months 7-9)
- [ ] Payer directory adapters (Top 3 payers)
- [ ] Advanced conflict resolution
- [ ] Analytics dashboard
- [ ] Mobile app (React Native)

### Phase 4: Scale & Compliance (Months 10-12)
- [ ] HIPAA compliance certification
- [ ] SOC 2 Type II audit
- [ ] Additional payer integrations
- [ ] State medical board integrations
- [ ] Advanced analytics and ML-based data quality

## Success Metrics

### User Metrics
- **Adoption**: 1,000+ active provider profiles in Year 1
- **Engagement**: 80% of providers sync to 3+ organizations
- **Satisfaction**: NPS > 50

### System Metrics
- **Uptime**: 99.9% availability
- **Sync Success**: >95% successful synchronizations
- **Latency**: <500ms API response time (p95)
- **Data Quality**: >90% profile completeness

### Business Metrics
- **Integrations**: 10+ payer/directory integrations by Year 1
- **Time Savings**: 10+ hours saved per provider annually
- **Error Reduction**: 50% reduction in directory discrepancies

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| NPPES API rate limits | High | Medium | Implement caching, batch operations |
| Payer API incompatibility | Medium | High | Build flexible adapter framework |
| Provider adoption resistance | High | Medium | Streamlined onboarding, clear ROI |
| HIPAA compliance costs | High | Low | Early compliance planning, use compliant infrastructure |
| Data quality issues | Medium | High | Validation rules, verification workflows |

## Open Questions

1. **Business Model**: Freemium vs. subscription vs. per-sync pricing?
2. **Credential Verification**: Manual review vs. automated vs. third-party service?
3. **FHIR Version**: R4 vs. R5 for future-proofing?
4. **Multi-tenancy**: Single vs. multi-tenant database architecture?
5. **International**: US-only or international provider support?

## References

- [FHIR R4 Practitioner Resource](http://hl7.org/fhir/R4/practitioner.html)
- [NPPES NPI Registry API](https://npiregistry.cms.hhs.gov/api-page)
- [CAQH ProView API Documentation](https://proview.caqh.org/DirectAssure)
- [SMART on FHIR Authorization Guide](http://www.hl7.org/fhir/smart-app-launch/)
- [Blue Button 2.0 Developer Documentation](https://bluebutton.cms.gov/)

## Appendices

- [A: User Stories](./appendices/user-stories.md)
- [B: API Reference](./api/README.md)
- [C: Data Dictionary](./data-models/data-dictionary.md)
- [D: Deployment Guide](./appendices/deployment.md)
- [E: Testing Strategy](./appendices/testing-strategy.md)

---

**Document Version**: 0.1.0
**Last Updated**: 2025-10-20
**Maintained By**: fhiriq team
**Review Cycle**: Bi-weekly during active development
