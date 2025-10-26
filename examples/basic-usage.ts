/**
 * ProviderCard-v2 Basic Usage Example
 * Demonstrates core functionality of the provider profile and sync engine
 */

import { ProviderProfile } from '../modules/provider-profile';
import { SyncEngine } from '../modules/sync-engine';
import { Validator } from '../modules/validation';
import { taxonomyLookup } from '../modules/integrations/nucc-taxonomy';
import { createPractitioner } from '../models/Practitioner';
import { createPractitionerRole } from '../models/PractitionerRole';
import { createOrganization } from '../models/Organization';

console.log('=== ProviderCard-v2 Example Usage ===\n');

// ============================================
// 1. Create a Provider Profile
// ============================================
console.log('1. Creating Provider Profile...\n');

const practitioner = createPractitioner({
  id: 'example-001',
  npi: '1234567890',
  name: [{
    use: 'official',
    family: 'Smith',
    given: ['John', 'Michael'],
    prefix: ['Dr.'],
    suffix: ['MD']
  }],
  gender: 'male',
  birthDate: '1975-03-15',
  active: true
});

const profile = new ProviderProfile({
  practitioner
});

// Add addresses
console.log('Adding practice addresses...');
profile.addAddress({
  use: 'work',
  type: 'physical',
  line: ['123 Main Street', 'Suite 100'],
  city: 'Boston',
  state: 'MA',
  postalCode: '02101',
  country: 'USA'
});

profile.addAddress({
  use: 'work',
  type: 'physical',
  line: ['456 Healthcare Plaza'],
  city: 'Cambridge',
  state: 'MA',
  postalCode: '02138',
  country: 'USA'
});

console.log(`✓ Added ${profile.getAddresses().length} addresses\n`);

// Add licenses
console.log('Adding medical licenses...');
profile.addLicense({
  code: {
    coding: [{
      system: 'http://terminology.hl7.org/CodeSystem/v2-0360',
      code: 'MD'
    }]
  },
  state: 'MA',
  licenseNumber: 'MD123456',
  licenseType: 'MD',
  status: 'active',
  issueDate: '2005-06-01',
  expirationDate: '2026-05-31'
});

profile.addLicense({
  code: {
    coding: [{
      system: 'http://terminology.hl7.org/CodeSystem/v2-0360',
      code: 'MD'
    }]
  },
  state: 'NH',
  licenseNumber: 'NH789012',
  licenseType: 'MD',
  status: 'active',
  issueDate: '2010-01-15',
  expirationDate: '2026-01-14'
});

console.log(`✓ Added ${profile.getLicenses().length} licenses\n`);

// ============================================
// 2. NUCC Taxonomy Lookup
// ============================================
console.log('2. NUCC Taxonomy Lookup...\n');

console.log('Searching for "cardiology":');
const cardiologyResults = taxonomyLookup.search('cardiology', 3);
cardiologyResults.forEach(result => {
  console.log(`  - ${result.code}: ${taxonomyLookup.getDisplayName(result.code)}`);
});

console.log('\nSearching for "pediatrics":');
const pediatricsResults = taxonomyLookup.search('pediatrics', 3);
pediatricsResults.forEach(result => {
  console.log(`  - ${result.code}: ${taxonomyLookup.getDisplayName(result.code)}`);
});

console.log('\nAutocomplete suggestions for "internal med":');
const suggestions = taxonomyLookup.autocomplete('internal med');
suggestions.forEach(s => {
  console.log(`  - ${s.code}: ${s.name}`);
});
console.log();

// Add role with taxonomy
console.log('Adding practitioner role with taxonomy...');
const role = createPractitionerRole({
  id: 'role-001',
  practitioner: {
    reference: 'Practitioner/example-001',
    display: 'Dr. John Smith'
  },
  organization: {
    reference: 'Organization/example-org',
    display: 'Example Medical Group'
  },
  taxonomyCodes: [
    {
      code: '207R00000X',
      classification: 'Internal Medicine',
      display: 'Internal Medicine',
      isPrimary: true
    },
    {
      code: '207RC0000X',
      classification: 'Internal Medicine',
      specialization: 'Cardiovascular Disease',
      display: 'Internal Medicine - Cardiovascular Disease',
      isPrimary: false
    }
  ]
});

profile.addRole(role);
console.log('✓ Role added with taxonomies\n');

// ============================================
// 3. Insurance Plans
// ============================================
console.log('3. Adding Insurance Plans...\n');

profile.addInsurancePlan('role-001', {
  carrier: 'Aetna',
  planName: 'Aetna PPO',
  lob: 'Commercial',
  networkStatus: 'In-Network',
  planId: 'AETNA-PPO-001',
  effectiveDate: '2024-01-01',
  acceptingNewPatients: true,
  participationLevel: 'Full'
});

profile.addInsurancePlan('role-001', {
  carrier: 'Medicare',
  planName: 'Traditional Medicare',
  lob: 'Medicare',
  networkStatus: 'In-Network',
  planId: 'MEDICARE-TRAD',
  effectiveDate: '2020-01-01',
  acceptingNewPatients: true,
  participationLevel: 'Full'
});

profile.addInsurancePlan('role-001', {
  carrier: 'Blue Cross Blue Shield',
  planName: 'BCBS HMO Blue',
  lob: 'Commercial',
  networkStatus: 'In-Network',
  planId: 'BCBS-HMO-001',
  effectiveDate: '2024-01-01',
  acceptingNewPatients: false,
  participationLevel: 'Limited'
});

const activePlans = profile.getActiveInsurancePlans();
console.log(`✓ Added ${activePlans.length} active insurance plans`);
activePlans.forEach(plan => {
  console.log(`  - ${plan.carrier} (${plan.planName}) - ${plan.networkStatus}`);
});
console.log();

// ============================================
// 4. Validation
// ============================================
console.log('4. Validating Provider Data...\n');

const validator = new Validator();
const validationResult = validator.validatePractitioner(profile.getPractitioner());

console.log(validator.formatValidationResult(validationResult));
console.log();

// ============================================
// 5. Sync Engine & Webhooks
// ============================================
console.log('5. Setting up Sync Engine...\n');

const syncEngine = new SyncEngine();

// Register subscribers
const credentialingSystemId = syncEngine.subscribe(
  'https://credentialing-system.example.com/webhooks/updates',
  {
    name: 'Credentialing System',
    eventTypes: [
      'practitioner.created',
      'practitioner.updated',
      'license.expiring',
      'license.expired'
    ],
    retryAttempts: 5
  }
);

const directoryServiceId = syncEngine.subscribe(
  'https://provider-directory.example.com/api/webhooks',
  {
    name: 'Provider Directory',
    eventTypes: [
      'practitioner.created',
      'practitioner.updated',
      'practitioner.deleted',
      'practitionerRole.updated'
    ],
    retryAttempts: 3
  }
);

console.log(`✓ Registered ${syncEngine.getSubscribers().length} subscribers\n`);

// ============================================
// 6. Emit Events
// ============================================
console.log('6. Emitting events...\n');

// Notify about practitioner creation
await syncEngine.notifyPractitionerCreated(profile.getPractitioner());

// Simulate a profile update
console.log('\nUpdating practitioner email...');
const previousVersion = { ...profile.getPractitioner() };
profile.updateDemographics({
  telecom: [
    {
      system: 'email',
      value: 'john.smith.new@example.com',
      use: 'work'
    }
  ]
});

await syncEngine.notifyPractitionerUpdated(
  profile.getPractitioner(),
  previousVersion
);

// Check queue status
const queueStatus = syncEngine.getQueueStatus();
console.log(`\n✓ Queue status: ${queueStatus.queueLength} events, ${queueStatus.subscribers} subscribers`);

// Wait for events to process
console.log('\nWaiting for events to process...');
await new Promise(resolve => setTimeout(resolve, 2000));

// ============================================
// 7. Profile Summary
// ============================================
console.log('\n7. Profile Summary:\n');

const summary = profile.getSummary();
console.log(`Provider: ${summary.name}`);
console.log(`NPI: ${summary.npi}`);
console.log(`Active Roles: ${summary.activeRoles}`);
console.log(`Active Licenses: ${summary.activeLicenses}`);
console.log(`Insurance Plans: ${summary.insurancePlans}`);
console.log(`Practice Addresses: ${summary.addresses}`);

console.log('\n=== Example Complete ===');
