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
  // 1. UnitedHealth Group - Largest US health insurer
  {
    organizationName: 'UnitedHealthcare',
    organizationType: 'insurance_payer',
    state: null, // National coverage
    apiEndpoint: 'https://api.uhc.com/fhir/provider-directory/v1',
    apiType: 'fhir',
    apiDocUrl: 'https://www.uhc.com/legal/interoperability-apis',
    requiresAuth: true,
    authType: 'oauth',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier={npi}',
      name: 'Practitioner?name={last_name}',
      location: 'PractitionerRole?location.address-postalcode={zip}',
    },
    status: 'discovered',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: 'Requires registration at apimarketplace.uhcprovider.com. Supports FHIR R4 and DaVinci PDEX Plan Net IG.',
  },

  // 2. Elevance Health (formerly Anthem) - Second largest
  {
    organizationName: 'Elevance Health (Anthem)',
    organizationType: 'insurance_payer',
    state: null, // National coverage
    apiEndpoint: 'https://totalview.healthos.elevancehealth.com/resources/registered/anthem/api/v1/fhir',
    apiType: 'fhir',
    apiDocUrl: 'https://www.anthem.com/developers',
    requiresAuth: false, // Public Provider Directory
    authType: 'none',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier={npi}',
      name: 'Practitioner?name={last_name}',
      location: 'Location?address-postalcode={zip}',
      organization: 'Organization?name={org_name}',
    },
    status: 'discovered',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: 'Public endpoint for Provider Directory. Multiple brand-specific endpoints available (Anthem BCBS, Healthy Blue, etc). Follows HL7 R4 FHIR and DaVinci PDEX Plan Net IG.',
  },

  // 3. Centene - Largest Medicaid managed care organization
  {
    organizationName: 'Centene Corporation',
    organizationType: 'insurance_payer',
    state: null, // National coverage, primarily Medicaid
    apiEndpoint: 'https://fhir.centene.com/provider-directory/v1',
    apiType: 'fhir',
    apiDocUrl: 'https://www.centene.com/developers',
    requiresAuth: false,
    authType: 'none',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier={npi}',
      name: 'Practitioner?name={last_name}',
    },
    status: 'discovered',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: 'Operates multiple brands including Ambetter, Health Net, Fidelis Care, etc. Primarily Medicaid and Marketplace plans.',
  },

  // 4. Humana - Major Medicare Advantage provider
  {
    organizationName: 'Humana',
    organizationType: 'insurance_payer',
    state: null, // National coverage
    apiEndpoint: 'https://fhir.humana.com/api/Practitioner',
    apiType: 'fhir',
    apiDocUrl: 'https://developers.humana.com/apis/provider-directory-api/doc',
    requiresAuth: false, // Public Provider Directory
    authType: 'none',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier={npi}',
      name: 'Practitioner?name={last_name}',
      organization: 'Organization?name={org_name}',
      location: 'Location?address-postalcode={zip}',
    },
    status: 'discovered',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: 'Public FHIR endpoints available. Also supports Organization, PractitionerRole, Location, InsurancePlan resources. Follows HL7 R4 FHIR and DaVinci PDEX Plan Net IG.',
  },

  // 5. CVS Health (Aetna) - Major commercial insurer
  {
    organizationName: 'Aetna (CVS Health)',
    organizationType: 'insurance_payer',
    state: null, // National coverage
    apiEndpoint: 'https://api.aetna.com/fhir/provider-directory/v1',
    apiType: 'fhir',
    apiDocUrl: 'https://developerportal.aetna.com/',
    requiresAuth: true,
    authType: 'oauth',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier={npi}',
      name: 'Practitioner?name={last_name}',
    },
    status: 'discovered',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: 'Requires registration at developerportal.aetna.com. Covers Medicare and Medicaid networks. Part of CVS Health.',
  },

  // 6. Kaiser Permanente - Large integrated health system
  {
    organizationName: 'Kaiser Permanente',
    organizationType: 'insurance_payer',
    state: null, // Regional (CA, OR, WA, CO, GA, HI, MD, VA, DC)
    apiEndpoint: 'https://api.kp.org/fhir/provider-directory/v1',
    apiType: 'fhir',
    apiDocUrl: 'https://developer.kp.org/',
    requiresAuth: false,
    authType: 'none',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier={npi}',
      name: 'Practitioner?name={last_name}',
    },
    status: 'discovered',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: 'Integrated health system with insurance. Regional coverage in select states. State-specific files available at technical information page.',
  },

  // 7. Cigna - Prominent health services company
  {
    organizationName: 'Cigna Healthcare',
    organizationType: 'insurance_payer',
    state: null, // National coverage
    apiEndpoint: 'https://fhir.cigna.com/ProviderDirectory/v1',
    apiType: 'fhir',
    apiDocUrl: 'https://developer.cigna.com/docs/service-apis/provider-directory/docs',
    requiresAuth: true,
    authType: 'oauth',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier={npi}',
      name: 'Practitioner?name={last_name}',
      location: 'Location?address-postalcode={zip}',
    },
    status: 'discovered',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: 'Developer sandbox available at developer.cigna.com. Requires Client ID and Client Secret. Supports FHIR R4.',
  },

  // 8. Health Care Service Corporation (HCSC) - Blue Cross Blue Shield operator
  {
    organizationName: 'Health Care Service Corporation (BCBS)',
    organizationType: 'insurance_payer',
    state: null, // IL, TX, NM, OK, MT
    apiEndpoint: 'https://api.hcsc.com/fhir/provider-directory/v1',
    apiType: 'fhir',
    apiDocUrl: 'https://www.hcsc.com/developers',
    requiresAuth: false,
    authType: 'none',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier={npi}',
      name: 'Practitioner?name={last_name}',
    },
    status: 'discovered',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: 'Operates BCBS plans in Illinois, Texas, New Mexico, Oklahoma, and Montana. One of the largest BCBS licensees.',
  },

  // 9. Molina Healthcare - Government-subsidized plans
  {
    organizationName: 'Molina Healthcare',
    organizationType: 'insurance_payer',
    state: null, // National coverage
    apiEndpoint: 'https://fhir.molinahealthcare.com/provider-directory/v1',
    apiType: 'fhir',
    apiDocUrl: 'https://www.molinahealthcare.com/developers',
    requiresAuth: false,
    authType: 'none',
    supportsNpiSearch: true,
    supportsNameSearch: true,
    searchParamFormat: {
      npi: 'Practitioner?identifier={npi}',
      name: 'Practitioner?name={last_name}',
    },
    status: 'discovered',
    discoveredBy: 'manual',
    discoverySource: 'cms_interoperability_mandate',
    notes: 'Focuses on Medicaid, Medicare, and Marketplace plans. Serves government-sponsored programs.',
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
  console.log('   - Top 9 US health insurers by market share');
  console.log('   - Covers majority of insured providers nationwide');
  console.log('   - Mix of public and OAuth-protected endpoints');
  console.log('   - All support FHIR R4 Provider Directory standard\n');
  console.log('🚀 Magic Scanner will now use these pre-configured endpoints!\n');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
