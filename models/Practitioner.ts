/**
 * FHIR R4 Practitioner Resource
 * Represents a person who is directly or indirectly involved in the provisioning of healthcare
 */

export interface HumanName {
  use?: 'usual' | 'official' | 'temp' | 'nickname' | 'anonymous' | 'old' | 'maiden';
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
}

export interface Identifier {
  use?: 'usual' | 'official' | 'temp' | 'secondary' | 'old';
  type?: CodeableConcept;
  system?: string;
  value?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Coding {
  system?: string;
  version?: string;
  code?: string;
  display?: string;
  userSelected?: boolean;
}

export interface Address {
  use?: 'home' | 'work' | 'temp' | 'old' | 'billing';
  type?: 'postal' | 'physical' | 'both';
  text?: string;
  line?: string[];
  city?: string;
  district?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  period?: Period;
}

export interface ContactPoint {
  system?: 'phone' | 'fax' | 'email' | 'pager' | 'url' | 'sms' | 'other';
  value?: string;
  use?: 'home' | 'work' | 'temp' | 'old' | 'mobile';
  rank?: number;
  period?: Period;
}

export interface Period {
  start?: string;
  end?: string;
}

export interface Attachment {
  contentType?: string;
  language?: string;
  data?: string;
  url?: string;
  size?: number;
  hash?: string;
  title?: string;
  creation?: string;
}

export interface Qualification {
  identifier?: Identifier[];
  code: CodeableConcept;
  period?: Period;
  issuer?: Reference;
}

export interface Reference {
  reference?: string;
  type?: string;
  identifier?: Identifier;
  display?: string;
}

export interface Communication {
  language: CodeableConcept;
  preferred?: boolean;
}

/**
 * State Medical License Information
 */
export interface MedicalLicense extends Qualification {
  state: string;
  licenseNumber: string;
  licenseType: 'MD' | 'DO' | 'NP' | 'PA' | 'DPM' | 'DC' | 'Other';
  status: 'active' | 'inactive' | 'suspended' | 'expired';
  issueDate: string;
  expirationDate: string;
  disciplinaryActions?: DisciplinaryAction[];
}

export interface DisciplinaryAction {
  date: string;
  type: string;
  description: string;
  status: 'pending' | 'resolved' | 'ongoing';
}

/**
 * Main Practitioner Resource
 */
export interface Practitioner {
  resourceType: 'Practitioner';
  id?: string;
  meta?: {
    versionId?: string;
    lastUpdated?: string;
    source?: string;
    profile?: string[];
    security?: Coding[];
    tag?: Coding[];
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

  // Core Practitioner Fields
  identifier?: Identifier[];
  active?: boolean;
  name?: HumanName[];
  telecom?: ContactPoint[];
  address?: Address[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  photo?: Attachment[];
  qualification?: Qualification[];
  communication?: Communication[];

  // Extended fields for ProviderCard-v2
  licenses?: MedicalLicense[];
  npi?: string;
  tin?: string; // Tax Identification Number
  caqhId?: string; // CAQH Provider ID
  medicalSchool?: string;
  residencyProgram?: string;
  boardCertifications?: BoardCertification[];
}

export interface BoardCertification {
  board: string;
  specialty: string;
  certificationDate: string;
  expirationDate?: string;
  status: 'active' | 'expired' | 'inactive';
  certificateNumber?: string;
}

/**
 * Helper function to create a new Practitioner resource
 */
export function createPractitioner(data: Partial<Practitioner>): Practitioner {
  return {
    resourceType: 'Practitioner',
    active: true,
    ...data,
    meta: {
      lastUpdated: new Date().toISOString(),
      ...data.meta
    }
  };
}

/**
 * Validate NPI format (10 digits)
 */
export function validateNPI(npi: string): boolean {
  return /^\d{10}$/.test(npi);
}

/**
 * Extract NPI from identifiers
 */
export function extractNPI(practitioner: Practitioner): string | undefined {
  if (practitioner.npi) return practitioner.npi;

  const npiIdentifier = practitioner.identifier?.find(
    id => id.system === 'http://hl7.org/fhir/sid/us-npi'
  );

  return npiIdentifier?.value;
}

/**
 * Get active licenses
 */
export function getActiveLicenses(practitioner: Practitioner): MedicalLicense[] {
  return practitioner.licenses?.filter(
    license => license.status === 'active' &&
    new Date(license.expirationDate) > new Date()
  ) || [];
}

/**
 * Check if provider has license in specific state
 */
export function hasStateLicense(practitioner: Practitioner, state: string): boolean {
  return getActiveLicenses(practitioner).some(license => license.state === state);
}

export default Practitioner;
