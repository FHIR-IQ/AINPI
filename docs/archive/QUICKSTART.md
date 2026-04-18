# ProviderCard-v2 Quick Start Guide

## 🚀 Getting Started in 5 Minutes

### Installation

```bash
git clone https://github.com/your-org/ProviderCard-v2.git
cd ProviderCard-v2
npm install
```

### Basic Usage

```typescript
import { ProviderProfile } from './modules/provider-profile';
import { SyncEngine } from './modules/sync-engine';
import { taxonomyLookup } from './modules/integrations/nucc-taxonomy';

// 1. Create a provider profile
const profile = new ProviderProfile({
  practitioner: {
    resourceType: 'Practitioner',
    npi: '1234567890',
    name: [{
      family: 'Smith',
      given: ['John']
    }]
  }
});

// 2. Add practice addresses
profile.addAddress({
  line: ['123 Main St'],
  city: 'Boston',
  state: 'MA',
  postalCode: '02101'
});

// 3. Add licenses
profile.addLicense({
  state: 'MA',
  licenseNumber: 'MD123456',
  licenseType: 'MD',
  status: 'active',
  issueDate: '2020-01-01',
  expirationDate: '2026-12-31'
});

// 4. Search NUCC taxonomy
const results = taxonomyLookup.search('cardiology');
console.log(results); // Returns matching specialties

// 5. Subscribe to changes
const syncEngine = new SyncEngine();
syncEngine.subscribe('https://your-system.com/webhook', {
  eventTypes: ['practitioner.updated', 'license.expiring']
});
```

## 📂 Project Structure

```
ProviderCard-v2/
├── models/                    # FHIR R4 resource definitions
│   ├── Practitioner.ts       # Provider demographics & licenses
│   ├── PractitionerRole.ts   # Roles, specialties, insurance
│   ├── Organization.ts       # Practice groups & facilities
│   └── Endpoint.ts           # Webhook & subscription endpoints
│
├── modules/
│   ├── provider-profile/     # Core provider CRUD
│   ├── sync-engine/          # Real-time sync & webhooks
│   ├── integrations/         # NUCC taxonomy, external APIs
│   └── validation/           # FHIR & business validation
│
├── sample-data/              # Example providers & subscribers
│   ├── provider-1.json       # Dr. Sarah Johnson (Cardiologist)
│   ├── provider-2.json       # Dr. Michael Chen (Pediatrician)
│   └── subscribers.json      # 2 mock subscriber systems
│
└── examples/                 # Usage examples
    └── basic-usage.ts        # Complete working example
```

## 🎯 Key Features

### 1. Multiple Practice Addresses

```typescript
// Add multiple locations
profile.addAddress({ /* Boston office */ });
profile.addAddress({ /* Cambridge office */ });
profile.addAddress({ /* Worcester office */ });

// Get all addresses
const addresses = profile.getAddresses();
```

### 2. Multiple State Licenses

```typescript
// Add licenses in different states
profile.addLicense({
  state: 'MA',
  licenseNumber: 'MD123456',
  expirationDate: '2026-12-31'
});

profile.addLicense({
  state: 'NH',
  licenseNumber: 'NH789012',
  expirationDate: '2026-06-30'
});

// Check expiring licenses
const expiring = profile.getExpiringLicenses(90); // 90 days
```

### 3. NUCC Taxonomy Lookup

```typescript
// Search by name
const cardiology = taxonomyLookup.search('cardiology');
// Returns: [{ code: '207RC0000X', name: 'Cardiovascular Disease', ... }]

// Get by code
const specialty = taxonomyLookup.getByCode('207RC0000X');

// Autocomplete
const suggestions = taxonomyLookup.autocomplete('internal med');
```

### 4. Insurance Plans

```typescript
// Add insurance plan to a role
profile.addInsurancePlan('role-001', {
  carrier: 'Aetna',
  planName: 'Aetna PPO',
  lob: 'Commercial',
  networkStatus: 'In-Network',
  effectiveDate: '2024-01-01',
  acceptingNewPatients: true
});

// Get active plans
const activePlans = profile.getActiveInsurancePlans();
```

### 5. Webhooks & Subscriptions

```typescript
const syncEngine = new SyncEngine();

// Register webhook subscriber
syncEngine.subscribe('https://your-system.com/webhook', {
  name: 'Credentialing System',
  eventTypes: [
    'practitioner.created',
    'practitioner.updated',
    'license.expiring',
    'license.expired'
  ]
});

// Emit events
await syncEngine.notifyPractitionerUpdated(practitioner);
await syncEngine.notifyLicenseExpiring(practitioner);
```

## 📊 Sample Data

### Load Sample Providers

```typescript
import provider1 from './sample-data/provider-1.json';
import provider2 from './sample-data/provider-2.json';

// Provider 1: Dr. Sarah Johnson
// - Cardiologist in Boston, MA
// - Licenses in MA, NH, CT
// - 5 insurance plans
// - 2 practice locations

// Provider 2: Dr. Michael Chen
// - Pediatrician in San Francisco, CA
// - Licenses in CA, NV
// - 4 insurance plans
// - 3 practice locations
```

### Load Sample Subscribers

```typescript
import subscribers from './sample-data/subscribers.json';

// Subscriber 1: Credentialing Management System
// - Monitors credentials & licenses
// - Receives license expiring/expired events
// - HMAC-SHA256 webhook signing

// Subscriber 2: Provider Directory Service
// - Public provider directory
// - Receives all provider updates
// - Batch webhook delivery
```

## 🔍 Validation

```typescript
import { Validator } from './modules/validation';

const validator = new Validator();

// Validate practitioner
const result = validator.validatePractitioner(practitioner);

if (result.valid) {
  console.log('✓ Validation passed');
} else {
  result.errors.forEach(error => {
    console.log(`✗ ${error.field}: ${error.message}`);
  });
}

// Validate license
const licenseResult = validator.validateLicense(license);
```

## 🧪 Run Example

```bash
npm run example
```

This will run the complete example demonstrating all features:
1. Create provider profile
2. Add addresses and licenses
3. NUCC taxonomy lookup
4. Add insurance plans
5. Validation
6. Webhook subscriptions
7. Event emission

## 📚 Next Steps

- Read the [full README](README.md)
- Explore [sample data](sample-data/)
- Check [FHIR models](models/)
- Review [module documentation](docs/)

## 🆘 Need Help?

- [Open an issue](https://github.com/your-org/ProviderCard-v2/issues)
- Check [API documentation](docs/)
- Review [examples](examples/)

---

Built with ❤️ for better healthcare provider data management
