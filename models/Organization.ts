/**
 * FHIR R4 Organization Resource
 * A formally or informally recognized grouping of people or organizations
 */

import { Reference, Identifier, CodeableConcept, ContactPoint, Address } from './Practitioner';

export interface OrganizationContact {
  purpose?: CodeableConcept;
  name?: {
    use?: string;
    text?: string;
    family?: string;
    given?: string[];
  };
  telecom?: ContactPoint[];
  address?: Address;
}

/**
 * Main Organization Resource
 */
export interface Organization {
  resourceType: 'Organization';
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

  // Core Organization Fields
  identifier?: Identifier[];
  active?: boolean;
  type?: CodeableConcept[];
  name?: string;
  alias?: string[];
  telecom?: ContactPoint[];
  address?: Address[];
  partOf?: Reference; // Parent organization
  contact?: OrganizationContact[];
  endpoint?: Reference[]; // Technical endpoints

  // Extended fields for ProviderCard-v2
  taxId?: string;
  npi?: string;
  accreditation?: Accreditation[];
  facilities?: Facility[];
  payerContracts?: PayerContract[];
}

export interface Accreditation {
  accreditingBody: string;
  status: 'accredited' | 'provisional' | 'denied' | 'expired';
  effectiveDate: string;
  expirationDate?: string;
  certificateNumber?: string;
  scope?: string[];
}

export interface Facility {
  id: string;
  name: string;
  type: 'Hospital' | 'Clinic' | 'Urgent Care' | 'Surgery Center' | 'Lab' | 'Imaging' | 'Other';
  address: Address;
  telecom?: ContactPoint[];
  operatingHours?: {
    monday?: string;
    tuesday?: string;
    wednesday?: string;
    thursday?: string;
    friday?: string;
    saturday?: string;
    sunday?: string;
  };
  services?: string[];
  wheelchair Accessible?: boolean;
  parking?: {
    available: boolean;
    type?: 'free' | 'paid' | 'valet';
    description?: string;
  };
}

export interface PayerContract {
  payerId: string;
  payerName: string;
  contractId: string;
  effectiveDate: string;
  terminationDate?: string;
  contractType: 'Direct' | 'Delegated' | 'Rental Network';
  reimbursementMethod: 'Fee-for-Service' | 'Capitation' | 'Case Rate' | 'Bundled Payment';
  status: 'active' | 'inactive' | 'pending' | 'terminated';
  lineOfBusiness?: ('Commercial' | 'Medicare' | 'Medicaid' | 'Exchange')[];
}

/**
 * Helper function to create a new Organization resource
 */
export function createOrganization(data: Partial<Organization>): Organization {
  return {
    resourceType: 'Organization',
    active: true,
    ...data,
    meta: {
      lastUpdated: new Date().toISOString(),
      ...data.meta
    }
  };
}

/**
 * Get primary address
 */
export function getPrimaryAddress(org: Organization): Address | undefined {
  return org.address?.find(addr => addr.use === 'work') || org.address?.[0];
}

/**
 * Get primary phone
 */
export function getPrimaryPhone(org: Organization): string | undefined {
  const phone = org.telecom?.find(
    t => t.system === 'phone' && (t.use === 'work' || !t.use)
  );
  return phone?.value;
}

/**
 * Get active accreditations
 */
export function getActiveAccreditations(org: Organization): Accreditation[] {
  const now = new Date();
  return org.accreditation?.filter(acc => {
    if (acc.status !== 'accredited') return false;
    if (!acc.expirationDate) return true;
    return new Date(acc.expirationDate) > now;
  }) || [];
}

/**
 * Get facilities by type
 */
export function getFacilitiesByType(org: Organization, type: Facility['type']): Facility[] {
  return org.facilities?.filter(f => f.type === type) || [];
}

/**
 * Check if has active payer contract
 */
export function hasActiveContract(org: Organization, payerName: string): boolean {
  const now = new Date();
  return org.payerContracts?.some(contract => {
    if (contract.status !== 'active') return false;
    if (contract.payerName.toLowerCase() !== payerName.toLowerCase()) return false;

    const effectiveDate = new Date(contract.effectiveDate);
    const terminationDate = contract.terminationDate ? new Date(contract.terminationDate) : null;

    return effectiveDate <= now && (!terminationDate || terminationDate > now);
  }) || false;
}

/**
 * Get all addresses (including facility addresses)
 */
export function getAllAddresses(org: Organization): Address[] {
  const orgAddresses = org.address || [];
  const facilityAddresses = org.facilities?.map(f => f.address) || [];
  return [...orgAddresses, ...facilityAddresses];
}

/**
 * Format organization display name
 */
export function formatDisplayName(org: Organization): string {
  return org.name || org.alias?.[0] || 'Unknown Organization';
}

export default Organization;
