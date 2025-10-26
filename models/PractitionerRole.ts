/**
 * FHIR R4 PractitionerRole Resource
 * A specific set of Roles/Locations/specialties/services that a practitioner may perform
 */

import { Reference, Period, CodeableConcept, ContactPoint, Identifier } from './Practitioner';

export interface AvailableTime {
  daysOfWeek?: ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[];
  allDay?: boolean;
  availableStartTime?: string;
  availableEndTime?: string;
}

export interface NotAvailable {
  description: string;
  during?: Period;
}

/**
 * Insurance Plan Acceptance
 */
export interface InsurancePlan {
  carrier: string;
  planName: string;
  lob: 'Commercial' | 'Medicare' | 'Medicaid' | 'Exchange' | 'Workers Comp' | 'Auto' | 'Other';
  networkStatus: 'In-Network' | 'Out-of-Network' | 'Pending';
  planId?: string;
  effectiveDate: string;
  terminationDate?: string;
  acceptingNewPatients?: boolean;
  participationLevel?: 'Full' | 'Limited' | 'Referral Only';
}

/**
 * NUCC Healthcare Provider Taxonomy
 */
export interface NUCCTaxonomy {
  code: string;
  classification: string;
  specialization?: string;
  display: string;
  isPrimary: boolean;
  licenseRequired?: boolean;
}

/**
 * Main PractitionerRole Resource
 */
export interface PractitionerRole {
  resourceType: 'PractitionerRole';
  id?: string;
  meta?: {
    versionId?: string;
    lastUpdated?: string;
    source?: string;
    profile?: string[];
  };
  implicitRules?: string;
  language?: string;
  text?: {
    status: 'generated' | 'extensions' | 'additional' | 'empty';
    div: string;
  };
  contained?: any[];
  extension?: any[];
  modifierExtension?: any[];

  // Core PractitionerRole Fields
  identifier?: Identifier[];
  active?: boolean;
  period?: Period;
  practitioner?: Reference; // Reference to Practitioner
  organization?: Reference; // Reference to Organization
  code?: CodeableConcept[]; // Roles (e.g., doctor, nurse)
  specialty?: CodeableConcept[]; // Specialties (using NUCC codes)
  location?: Reference[]; // Where the role is performed
  healthcareService?: Reference[];
  telecom?: ContactPoint[];
  availableTime?: AvailableTime[];
  notAvailable?: NotAvailable[];
  availabilityExceptions?: string;
  endpoint?: Reference[]; // Technical endpoints

  // Extended fields for ProviderCard-v2
  taxonomyCodes?: NUCCTaxonomy[];
  insurancePlans?: InsurancePlan[];
  credentialingStatus?: CredentialingStatus;
  clinicalPrivileges?: ClinicalPrivilege[];
}

export interface CredentialingStatus {
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'in-review';
  effectiveDate?: string;
  expirationDate?: string;
  lastVerifiedDate: string;
  verifiedBy?: string;
  notes?: string;
}

export interface ClinicalPrivilege {
  privilegeType: string;
  category: 'Admitting' | 'Surgical' | 'Procedural' | 'Diagnostic' | 'Prescriptive';
  granted: boolean;
  grantedDate?: string;
  expirationDate?: string;
  restrictions?: string[];
}

/**
 * Helper function to create a new PractitionerRole resource
 */
export function createPractitionerRole(data: Partial<PractitionerRole>): PractitionerRole {
  return {
    resourceType: 'PractitionerRole',
    active: true,
    ...data,
    meta: {
      lastUpdated: new Date().toISOString(),
      ...data.meta
    }
  };
}

/**
 * Get primary taxonomy code
 */
export function getPrimaryTaxonomy(role: PractitionerRole): NUCCTaxonomy | undefined {
  return role.taxonomyCodes?.find(t => t.isPrimary);
}

/**
 * Get active insurance plans
 */
export function getActiveInsurancePlans(role: PractitionerRole): InsurancePlan[] {
  const now = new Date();
  return role.insurancePlans?.filter(plan => {
    const effectiveDate = new Date(plan.effectiveDate);
    const terminationDate = plan.terminationDate ? new Date(plan.terminationDate) : null;

    return effectiveDate <= now && (!terminationDate || terminationDate > now);
  }) || [];
}

/**
 * Check if accepting specific insurance plan
 */
export function acceptsInsurance(role: PractitionerRole, carrier: string, planName?: string): boolean {
  const activePlans = getActiveInsurancePlans(role);

  return activePlans.some(plan =>
    plan.carrier.toLowerCase() === carrier.toLowerCase() &&
    plan.networkStatus === 'In-Network' &&
    (!planName || plan.planName.toLowerCase() === planName.toLowerCase())
  );
}

/**
 * Check if accepting new patients
 */
export function isAcceptingNewPatients(role: PractitionerRole): boolean {
  if (!role.active) return false;

  const activePlans = getActiveInsurancePlans(role);
  return activePlans.some(plan => plan.acceptingNewPatients !== false);
}

/**
 * Get available days and times
 */
export function getAvailability(role: PractitionerRole): {
  available: AvailableTime[];
  notAvailable: NotAvailable[];
} {
  return {
    available: role.availableTime || [],
    notAvailable: role.notAvailable || []
  };
}

/**
 * Format taxonomy for display
 */
export function formatTaxonomy(taxonomy: NUCCTaxonomy): string {
  const parts = [taxonomy.classification];
  if (taxonomy.specialization) {
    parts.push(taxonomy.specialization);
  }
  return parts.join(' - ');
}

export default PractitionerRole;
