/**
 * Provider Profile Module
 * Core CRUD operations for managing provider data
 */

import { Practitioner, MedicalLicense } from '../../models/Practitioner';
import { PractitionerRole, InsurancePlan, NUCCTaxonomy } from '../../models/PractitionerRole';
import { Organization } from '../../models/Organization';
import { Address } from '../../models/Practitioner';

export interface ProviderProfileData {
  practitioner: Practitioner;
  roles: PractitionerRole[];
  organizations: Organization[];
}

export class ProviderProfile {
  private practitioner: Practitioner;
  private roles: PractitionerRole[] = [];
  private organizations: Organization[] = [];

  constructor(data: Partial<ProviderProfileData>) {
    this.practitioner = data.practitioner || this.createEmptyPractitioner();
    this.roles = data.roles || [];
    this.organizations = data.organizations || [];
  }

  private createEmptyPractitioner(): Practitioner {
    return {
      resourceType: 'Practitioner',
      active: true,
      meta: {
        lastUpdated: new Date().toISOString()
      }
    };
  }

  // ============ Practitioner Methods ============

  /**
   * Get the practitioner resource
   */
  getPractitioner(): Practitioner {
    return this.practitioner;
  }

  /**
   * Update practitioner demographics
   */
  updateDemographics(updates: Partial<Practitioner>): void {
    this.practitioner = {
      ...this.practitioner,
      ...updates,
      resourceType: 'Practitioner',
      meta: {
        ...this.practitioner.meta,
        lastUpdated: new Date().toISOString()
      }
    };
  }

  /**
   * Add a practice address
   */
  addAddress(address: Address): void {
    if (!this.practitioner.address) {
      this.practitioner.address = [];
    }
    this.practitioner.address.push(address);
    this.updateLastModified();
  }

  /**
   * Update an existing address by index
   */
  updateAddress(index: number, address: Address): void {
    if (this.practitioner.address && index < this.practitioner.address.length) {
      this.practitioner.address[index] = address;
      this.updateLastModified();
    }
  }

  /**
   * Remove an address by index
   */
  removeAddress(index: number): void {
    if (this.practitioner.address && index < this.practitioner.address.length) {
      this.practitioner.address.splice(index, 1);
      this.updateLastModified();
    }
  }

  /**
   * Get all addresses
   */
  getAddresses(): Address[] {
    return this.practitioner.address || [];
  }

  // ============ License Methods ============

  /**
   * Add a medical license
   */
  addLicense(license: MedicalLicense): void {
    if (!this.practitioner.licenses) {
      this.practitioner.licenses = [];
    }
    this.practitioner.licenses.push(license);
    this.updateLastModified();
  }

  /**
   * Update an existing license
   */
  updateLicense(state: string, updates: Partial<MedicalLicense>): void {
    const license = this.practitioner.licenses?.find(l => l.state === state);
    if (license) {
      Object.assign(license, updates);
      this.updateLastModified();
    }
  }

  /**
   * Remove a license by state
   */
  removeLicense(state: string): void {
    if (this.practitioner.licenses) {
      this.practitioner.licenses = this.practitioner.licenses.filter(l => l.state !== state);
      this.updateLastModified();
    }
  }

  /**
   * Get all licenses
   */
  getLicenses(): MedicalLicense[] {
    return this.practitioner.licenses || [];
  }

  /**
   * Get active licenses only
   */
  getActiveLicenses(): MedicalLicense[] {
    const now = new Date();
    return this.getLicenses().filter(license =>
      license.status === 'active' &&
      new Date(license.expirationDate) > now
    );
  }

  /**
   * Get expiring licenses (within 90 days)
   */
  getExpiringLicenses(daysThreshold: number = 90): MedicalLicense[] {
    const now = new Date();
    const threshold = new Date(now.getTime() + daysThreshold * 24 * 60 * 60 * 1000);

    return this.getLicenses().filter(license => {
      const expDate = new Date(license.expirationDate);
      return license.status === 'active' && expDate > now && expDate <= threshold;
    });
  }

  // ============ Role Methods ============

  /**
   * Add a practitioner role
   */
  addRole(role: PractitionerRole): void {
    this.roles.push(role);
  }

  /**
   * Update a role by ID
   */
  updateRole(roleId: string, updates: Partial<PractitionerRole>): void {
    const role = this.roles.find(r => r.id === roleId);
    if (role) {
      Object.assign(role, updates);
      if (role.meta) {
        role.meta.lastUpdated = new Date().toISOString();
      }
    }
  }

  /**
   * Remove a role by ID
   */
  removeRole(roleId: string): void {
    this.roles = this.roles.filter(r => r.id !== roleId);
  }

  /**
   * Get all roles
   */
  getRoles(): PractitionerRole[] {
    return this.roles;
  }

  /**
   * Get active roles only
   */
  getActiveRoles(): PractitionerRole[] {
    return this.roles.filter(r => r.active !== false);
  }

  // ============ Insurance Plan Methods ============

  /**
   * Add insurance plan to a role
   */
  addInsurancePlan(roleId: string, plan: InsurancePlan): void {
    const role = this.roles.find(r => r.id === roleId);
    if (role) {
      if (!role.insurancePlans) {
        role.insurancePlans = [];
      }
      role.insurancePlans.push(plan);
    }
  }

  /**
   * Update insurance plan
   */
  updateInsurancePlan(roleId: string, planId: string, updates: Partial<InsurancePlan>): void {
    const role = this.roles.find(r => r.id === roleId);
    if (role && role.insurancePlans) {
      const plan = role.insurancePlans.find(p => p.planId === planId);
      if (plan) {
        Object.assign(plan, updates);
      }
    }
  }

  /**
   * Remove insurance plan
   */
  removeInsurancePlan(roleId: string, planId: string): void {
    const role = this.roles.find(r => r.id === roleId);
    if (role && role.insurancePlans) {
      role.insurancePlans = role.insurancePlans.filter(p => p.planId !== planId);
    }
  }

  /**
   * Get all insurance plans across all roles
   */
  getAllInsurancePlans(): InsurancePlan[] {
    return this.roles.flatMap(role => role.insurancePlans || []);
  }

  /**
   * Get active insurance plans
   */
  getActiveInsurancePlans(): InsurancePlan[] {
    const now = new Date();
    return this.getAllInsurancePlans().filter(plan => {
      const effectiveDate = new Date(plan.effectiveDate);
      const terminationDate = plan.terminationDate ? new Date(plan.terminationDate) : null;
      return effectiveDate <= now && (!terminationDate || terminationDate > now);
    });
  }

  // ============ Taxonomy Methods ============

  /**
   * Add NUCC taxonomy code to a role
   */
  addTaxonomy(roleId: string, taxonomy: NUCCTaxonomy): void {
    const role = this.roles.find(r => r.id === roleId);
    if (role) {
      if (!role.taxonomyCodes) {
        role.taxonomyCodes = [];
      }

      // If this is marked as primary, unmark others
      if (taxonomy.isPrimary) {
        role.taxonomyCodes.forEach(t => t.isPrimary = false);
      }

      role.taxonomyCodes.push(taxonomy);
    }
  }

  /**
   * Set primary taxonomy for a role
   */
  setPrimaryTaxonomy(roleId: string, taxonomyCode: string): void {
    const role = this.roles.find(r => r.id === roleId);
    if (role && role.taxonomyCodes) {
      role.taxonomyCodes.forEach(t => {
        t.isPrimary = t.code === taxonomyCode;
      });
    }
  }

  /**
   * Get all taxonomies across roles
   */
  getAllTaxonomies(): NUCCTaxonomy[] {
    return this.roles.flatMap(role => role.taxonomyCodes || []);
  }

  // ============ Organization Methods ============

  /**
   * Add an organization
   */
  addOrganization(org: Organization): void {
    this.organizations.push(org);
  }

  /**
   * Get all organizations
   */
  getOrganizations(): Organization[] {
    return this.organizations;
  }

  // ============ Utility Methods ============

  /**
   * Update last modified timestamp
   */
  private updateLastModified(): void {
    if (this.practitioner.meta) {
      this.practitioner.meta.lastUpdated = new Date().toISOString();
    }
  }

  /**
   * Export complete profile
   */
  toJSON(): ProviderProfileData {
    return {
      practitioner: this.practitioner,
      roles: this.roles,
      organizations: this.organizations
    };
  }

  /**
   * Get profile summary
   */
  getSummary(): {
    npi: string | undefined;
    name: string;
    activeRoles: number;
    activeLicenses: number;
    insurancePlans: number;
    addresses: number;
  } {
    const name = this.practitioner.name?.[0];
    const displayName = name
      ? `${name.given?.join(' ')} ${name.family}`
      : 'Unknown Provider';

    return {
      npi: this.practitioner.npi,
      name: displayName,
      activeRoles: this.getActiveRoles().length,
      activeLicenses: this.getActiveLicenses().length,
      insurancePlans: this.getActiveInsurancePlans().length,
      addresses: this.getAddresses().length
    };
  }
}

export default ProviderProfile;
