# ProviderCard-v2

> A comprehensive FHIR-based provider directory and synchronization system

## 📋 Overview

ProviderCard-v2 is a modular system for managing healthcare provider information using FHIR R4 standards. It supports multi-address practices, licensing, taxonomy lookups, insurance plan management, and real-time synchronization via webhooks.

## 🎯 Key Features

- **FHIR R4 Compliant**: Full support for Practitioner, PractitionerRole, Organization, and Endpoint resources
- **Multi-Address Support**: Handle providers with multiple practice locations
- **License Management**: Track multiple state licenses with validation and expiration
- **NUCC Taxonomy Lookup**: Autocomplete provider specialties with code ↔ name mapping
- **Insurance Plan Management**: Structured data for Carrier, Plan Name, and Line of Business (LOB)
- **Real-time Sync**: FHIR Subscription and webhook support for data updates
- **Modular Architecture**: Clean separation of concerns across provider-profile, sync-engine, integrations, and validation modules

## 🏗️ Architecture

```
ProviderCard-v2/
├── modules/
│   ├── provider-profile/     # Core provider CRUD operations
│   ├── sync-engine/          # Real-time synchronization logic
│   ├── integrations/         # External system connectors
│   └── validation/           # FHIR & business rule validation
├── models/                   # FHIR resource definitions
├── sample-data/              # Mock providers and subscribers
├── config/                   # Configuration files
└── docs/                     # API documentation
```

## 📦 Modules

### 1. Provider Profile Module
Manages core provider data including:
- Practitioner demographics
- Multiple practice addresses
- State licenses and credentials
- NUCC taxonomy codes
- Insurance plan participation

### 2. Sync Engine Module
Handles real-time data synchronization:
- FHIR Subscription management
- Webhook event dispatching
- Change detection and notification
- Retry logic and error handling

### 3. Integrations Module
External system connections:
- NUCC taxonomy service
- State license verification APIs
- Insurance carrier directories
- Credentialing systems

### 4. Validation Module
Data integrity and compliance:
- FHIR resource validation
- NPI validation
- License expiration checks
- Required field validation
- Business rule enforcement

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- TypeScript 5+
- Understanding of FHIR R4

### Installation

```bash
git clone https://github.com/your-org/ProviderCard-v2.git
cd ProviderCard-v2
npm install
```

### Quick Start

```typescript
import { ProviderProfile } from './modules/provider-profile';
import { SyncEngine } from './modules/sync-engine';

// Create a provider profile
const profile = new ProviderProfile({
  npi: '1234567890',
  name: {
    family: 'Smith',
    given: ['John', 'Michael']
  },
  specialties: ['208D00000X'], // General Practice
  addresses: [
    {
      line: ['123 Main St'],
      city: 'Boston',
      state: 'MA',
      postalCode: '02101'
    }
  ]
});

// Subscribe to changes
const syncEngine = new SyncEngine();
syncEngine.subscribe('http://subscriber-system.com/webhook', {
  resourceTypes: ['Practitioner', 'PractitionerRole']
});
```

## 📚 FHIR Resources

### Practitioner
Core provider demographics, identifiers, and qualifications.

### PractitionerRole
Provider roles, specialties, locations, and availability.

### Organization
Practice groups, hospitals, and healthcare facilities.

### Endpoint
Technical endpoints for data exchange and webhooks.

## 🔍 NUCC Taxonomy

The system includes a complete NUCC Healthcare Provider Taxonomy lookup with:
- Autocomplete search by specialty name
- Code → Name resolution
- Name → Code resolution
- Hierarchical taxonomy navigation

Example:
```typescript
import { taxonomyLookup } from './modules/integrations/nucc-taxonomy';

// Search by name
const results = taxonomyLookup.search('cardiology');
// Returns: [{ code: '207RC0000X', name: 'Cardiovascular Disease' }, ...]

// Get by code
const specialty = taxonomyLookup.getByCode('207RC0000X');
// Returns: { code: '207RC0000X', name: 'Cardiovascular Disease', ... }
```

## 💳 Insurance Plans

Structured insurance plan data:

```typescript
interface InsurancePlan {
  carrier: string;           // Aetna, Blue Cross, etc.
  planName: string;          // PPO Gold, HMO Silver, etc.
  lob: 'Commercial' | 'Medicare' | 'Medicaid' | 'Exchange';
  networkStatus: 'In-Network' | 'Out-of-Network';
  effectiveDate: string;
  terminationDate?: string;
}
```

## 🔔 Webhooks & Subscriptions

The sync engine supports FHIR Subscriptions and custom webhooks:

```typescript
// FHIR Subscription
{
  "resourceType": "Subscription",
  "status": "active",
  "criteria": "Practitioner?active=true",
  "channel": {
    "type": "rest-hook",
    "endpoint": "https://example.com/webhook",
    "payload": "application/fhir+json"
  }
}

// Webhook payload example
{
  "eventType": "practitioner.updated",
  "timestamp": "2025-10-24T15:30:00Z",
  "resource": {
    "resourceType": "Practitioner",
    "id": "123",
    ...
  }
}
```

## 📊 Sample Data

The project includes sample data for:
- 2 complete provider profiles with multiple addresses and licenses
- 2 mock subscriber systems configured for different event types
- NUCC taxonomy reference data
- Insurance carrier and plan examples

See `/sample-data` directory for details.

## 🧪 Testing

```bash
npm test                 # Run all tests
npm run test:unit       # Unit tests only
npm run test:integration # Integration tests
npm run test:validation # FHIR validation tests
```

## 📖 API Documentation

Detailed API documentation is available in the `/docs` directory:
- [Provider Profile API](docs/provider-profile-api.md)
- [Sync Engine API](docs/sync-engine-api.md)
- [Webhook Events](docs/webhook-events.md)
- [FHIR Resources](docs/fhir-resources.md)

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🔗 Related Resources

- [FHIR R4 Specification](https://hl7.org/fhir/R4/)
- [NUCC Healthcare Provider Taxonomy](https://www.nucc.org/index.php/code-sets-mainmenu-41/provider-taxonomy-mainmenu-40)
- [NPI Registry](https://npiregistry.cms.hhs.gov/)

## 📞 Support

For questions or issues, please [open an issue](https://github.com/your-org/ProviderCard-v2/issues) on GitHub.

---

Built with ❤️ for better healthcare provider data management
