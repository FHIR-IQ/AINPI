/**
 * Single source of truth for the HealthcareService survey vocabulary.
 *
 * Cite the published NDH STU1 (v1.0.0), NOT the CI build at build.fhir.org.
 * Thanks to Ming Dunajick (NDH STU1 co-author) for catching the earlier
 * draft pointing at the ballot/STU2 CI URLs.
 *
 * Categories: NDH STU1 HealthcareServiceCategoryVS, 15 codes
 *   https://hl7.org/fhir/us/ndh/STU1/ValueSet-HealthcareServiceCategoryVS.html
 *
 * Must-support fields: NDH STU1 HealthcareService profile S-flagged elements
 *   https://hl7.org/fhir/us/ndh/STU1/StructureDefinition-ndh-HealthcareService.html
 *
 * STU2 CI build (tracked but not authoritative):
 *   https://build.fhir.org/ig/HL7/fhir-us-ndh/
 *
 * Edit here; both the form and the public results page read from these.
 */

export interface CodeDisplay {
  code: string;
  display: string;
}

/** HealthcareServiceCategoryVS — all 15 codes. */
export const HCS_CATEGORIES: CodeDisplay[] = [
  { code: 'behav', display: 'Behavioral Health' },
  { code: 'dent', display: 'Dental' },
  { code: 'dme', display: 'DME / Medical Supplies' },
  { code: 'emerg', display: 'Emergency Care' },
  { code: 'group', display: 'Medical Group' },
  { code: 'home', display: 'Home Health' },
  { code: 'hosp', display: 'Hospital' },
  { code: 'lab', display: 'Laboratory' },
  { code: 'other', display: 'Other' },
  { code: 'outpat', display: 'Clinic or Outpatient Facility' },
  { code: 'prov', display: 'Medical Provider' },
  { code: 'pharm', display: 'Pharmacy' },
  { code: 'trans', display: 'Transportation' },
  { code: 'urg', display: 'Urgent Care' },
  { code: 'vis', display: 'Vision' },
];

/** NDH HealthcareService must-support elements. */
export const HCS_MUST_SUPPORT_FIELDS: CodeDisplay[] = [
  { code: 'active', display: 'active (must be true)' },
  { code: 'category', display: 'category (HSC binding)' },
  { code: 'type', display: 'type' },
  { code: 'specialty', display: 'specialty (NUCC taxonomy)' },
  { code: 'name', display: 'name' },
  { code: 'location', display: 'location (reference)' },
  { code: 'coverageArea', display: 'coverageArea (reference)' },
  { code: 'providedBy', display: 'providedBy (Organization ref)' },
  { code: 'endpoint', display: 'endpoint (reference)' },
  { code: 'ext-newpatients', display: 'extension: newpatients' },
  { code: 'ext-deliverymethod', display: 'extension: deliverymethod' },
  { code: 'ext-rating', display: 'extension: rating' },
  { code: 'ext-verification-status', display: 'extension: verification-status' },
  { code: 'ext-identifier-status', display: 'identifier: status slice' },
];

/** Common FHIR profile choices payers + integrators publish against. */
export const HCS_FHIR_PROFILES: CodeDisplay[] = [
  { code: 'ndh-stu1', display: 'HL7 NDH STU1 (hl7.org/fhir/us/ndh/STU1, v1.0.0)' },
  { code: 'ndh-stu2', display: 'HL7 NDH STU2 CI build (build.fhir.org, pre-publication)' },
  { code: 'davinci-plan-net', display: 'Da Vinci PDex Plan-Net' },
  { code: 'us-core', display: 'US Core 6.x (baseline only)' },
  { code: 'custom', display: 'Custom internal profile' },
  { code: 'none', display: 'No HealthcareService published today' },
  { code: 'unknown', display: 'Not sure / depends on the line of business' },
];

/** Publishing cadence options. */
export const HCS_CADENCES: CodeDisplay[] = [
  { code: 'realtime', display: 'Real-time / on-change' },
  { code: 'daily', display: 'Daily' },
  { code: 'weekly', display: 'Weekly' },
  { code: 'monthly', display: 'Monthly' },
  { code: 'quarterly', display: 'Quarterly' },
  { code: 'on-demand', display: 'On-demand only' },
  { code: 'unknown', display: 'Unknown / varies by line of business' },
];

/** Upstream sources the respondent ingests for HealthcareService data. */
export const HCS_UPSTREAM_SOURCES: CodeDisplay[] = [
  { code: 'cms-ndh', display: 'CMS National Provider Directory (NDH) bulk export' },
  { code: 'nppes', display: 'NPPES NPI Registry' },
  { code: 'pecos', display: 'PECOS' },
  { code: 'caqh', display: 'CAQH Provider Data Portal' },
  { code: 'lexisnexis-pdm', display: 'LexisNexis Provider Data Masterfile' },
  { code: 'iqvia', display: 'IQVIA MDM for Healthcare Providers' },
  { code: 'kyruus', display: 'Kyruus Health' },
  { code: 'internal-provider-data-mgmt', display: 'Internal provider data management platform' },
  { code: 'self-attested', display: 'Self-attested by providers in our portal' },
  { code: 'state-license-boards', display: 'State licensure boards' },
  { code: 'other', display: 'Other (please describe)' },
];

/** Respondent role categories. Keep aligned with /developer audience labels. */
export const HCS_ROLE_TYPES: CodeDisplay[] = [
  { code: 'payer-ops', display: 'Payer — directory operations' },
  { code: 'payer-data', display: 'Payer — provider data team' },
  { code: 'payer-compliance', display: 'Payer — compliance / regulatory' },
  { code: 'health-system', display: 'Health system / hospital provider data' },
  { code: 'provider-individual', display: 'Individual provider' },
  { code: 'state-medicaid', display: 'State Medicaid program' },
  { code: 'cms-publisher', display: 'CMS / NDH operations' },
  { code: 'ehr-vendor', display: 'EHR / CEHRT vendor' },
  { code: 'directory-vendor', display: 'Directory / data-quality vendor' },
  { code: 'startup-integrator', display: 'Startup / digital-health integrator' },
  { code: 'research', display: 'Research / academia' },
  { code: 'other', display: 'Other' },
];
