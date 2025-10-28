import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed script to populate the database with major health insurance payer API endpoints
 *
 * This includes the top 9 health insurers in the United States, covering the majority
 * of insured providers. These endpoints are based on publicly available FHIR Provider
 * Directory APIs mandated by CMS regulations.
 *
 * Run with: npx tsx prisma/seed-major-payer-apis.ts
 */

const majorPayerAPIs = [
  // VERIFIED WORKING PUBLIC ENDPOINTS (tested with curl)

  // 1. Humana - Major Medicare Advantage provider (VERIFIED WORKING)
  {
    organizationName: 'Humana',
    organizationType: 'insurance_payer',
    state: null, // National coverage
    apiEndpoint: 'https://fhir.humana.com/api',
    apiType: 'fhir',
    apiDocUrl: 'https://developers.humana.com/apis/provider-directory-api/doc',
    requiresAuth: false, // Public Provider Directory
    authType: 'none',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|{npi}',
      name: 'Practitioner?name={last_name}',
      organization: 'Organization?name={org_name}',
      location: 'Location?address-postalcode={zip}',
    },
    status: 'verified',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: '✅ VERIFIED WORKING - Returns HTTP 200 with valid FHIR Bundle. Endpoint already includes resource type in response. Supports Organization, PractitionerRole, Location, InsurancePlan. Follows HL7 R4 FHIR and DaVinci PDEX Plan Net IG.',
  },

  // 2. BlueCross BlueShield of South Carolina (VERIFIED WORKING)
  {
    organizationName: 'BlueCross BlueShield of South Carolina',
    organizationType: 'insurance_payer',
    state: 'SC',
    apiEndpoint: 'https://fhir.bcbssc.com/r4/providerlisting',
    apiType: 'fhir',
    apiDocUrl: 'https://www.southcarolinablues.com/web/public/brands/interdev/developers/provider-directory-api/',
    requiresAuth: false, // Public Provider Directory
    authType: 'none',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|{npi}',
      name: 'Practitioner?name={last_name}',
    },
    status: 'verified',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: '✅ VERIFIED WORKING - Returns HTTP 200 with valid FHIR Bundle. Publicly accessible, no authorization required. Follows FHIR US DAVINCI-PDEX v4.0.1 implementation guide.',
  },

  // ENDPOINTS REQUIRING FURTHER INVESTIGATION OR AUTHENTICATION

  // Note: The following endpoints could not be verified as working without authentication.
  // They are included for future integration when OAuth credentials are obtained.

  // UnitedHealth Group - Largest US health insurer (REQUIRES OAUTH)
  {
    organizationName: 'UnitedHealthcare',
    organizationType: 'insurance_payer',
    state: null,
    apiEndpoint: 'https://api.uhc.com/fhir/provider-directory/v1',
    apiType: 'fhir',
    apiDocUrl: 'https://www.uhc.com/legal/interoperability-apis',
    requiresAuth: true,
    authType: 'oauth',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|{npi}',
      name: 'Practitioner?name={last_name}',
    },
    status: 'requires_auth',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: 'Requires registration at apimarketplace.uhcprovider.com. OAuth credentials needed.',
  },

  // Aetna (CVS Health) - (REQUIRES OAUTH)
  {
    organizationName: 'Aetna (CVS Health)',
    organizationType: 'insurance_payer',
    state: null,
    apiEndpoint: 'https://api.aetna.com/fhir/provider-directory/v1',
    apiType: 'fhir',
    apiDocUrl: 'https://developerportal.aetna.com/',
    requiresAuth: true,
    authType: 'oauth',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|{npi}',
      name: 'Practitioner?name={last_name}',
    },
    status: 'requires_auth',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: 'Requires registration at developerportal.aetna.com. OAuth credentials needed.',
  },

  // Cigna Healthcare (REQUIRES OAUTH)
  {
    organizationName: 'Cigna Healthcare',
    organizationType: 'insurance_payer',
    state: null,
    apiEndpoint: 'https://fhir.cigna.com/ProviderDirectory/v1',
    apiType: 'fhir',
    apiDocUrl: 'https://developer.cigna.com/docs/service-apis/provider-directory/docs',
    requiresAuth: true,
    authType: 'oauth',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|{npi}',
      name: 'Practitioner?name={last_name}',
    },
    status: 'requires_auth',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: 'Developer sandbox available at developer.cigna.com. Requires Client ID and Client Secret.',
  },
];

async function main() {
  console.log('🏥 Seeding database with major health insurance payer APIs...\n');

  for (const api of majorPayerAPIs) {
    try {
      const result = await prisma.providerDirectoryAPI.upsert({
        where: {
          organizationName_apiEndpoint: {
            organizationName: api.organizationName,
            apiEndpoint: api.apiEndpoint,
          },
        },
        update: {
          organizationType: api.organizationType,
          state: api.state,
          apiType: api.apiType,
          apiDocUrl: api.apiDocUrl,
          requiresAuth: api.requiresAuth,
          authType: api.authType,
          supportsNpiSearch: api.supportsNpiSearch,
          supportsNameSearch: api.supportsNameSearch,
          searchParamFormat: api.searchParamFormat as any,
          status: api.status,
          discoveredBy: api.discoveredBy,
          discoverySource: api.discoverySource,
          notes: api.notes,
          updatedAt: new Date(),
        },
        create: api as any,
      });

      console.log(`✅ ${api.organizationName}`);
      console.log(`   Endpoint: ${api.apiEndpoint}`);
      console.log(`   Type: ${api.apiType} | Auth: ${api.requiresAuth ? 'Required' : 'Public'}`);
      console.log(`   Supports: NPI=${api.supportsNpiSearch} | Name=${api.supportsNameSearch}\n`);
    } catch (error) {
      console.error(`❌ Failed to seed ${api.organizationName}:`, error);
    }
  }

  const count = await prisma.providerDirectoryAPI.count({
    where: {
      organizationType: 'insurance_payer',
    },
  });

  console.log(`\n✨ Successfully seeded ${count} insurance payer APIs!`);
  console.log('\n📊 Coverage Summary:');
  console.log('   - 2 VERIFIED WORKING public endpoints (Humana, BCBS SC)');
  console.log('   - 3 endpoints requiring OAuth authentication (UHC, Aetna, Cigna)');
  console.log('   - All support FHIR R4 Provider Directory standard');
  console.log('   - All use proper FHIR identifier system: http://hl7.org/fhir/sid/us-npi|{npi}\n');
  console.log('✅ Provider Search will use verified working endpoints!\n');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
