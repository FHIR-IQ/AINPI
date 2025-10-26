/**
 * Validation Module
 * FHIR resource validation and business rule enforcement
 */

import { Practitioner, MedicalLicense, validateNPI } from '../../models/Practitioner';
import { PractitionerRole } from '../../models/PractitionerRole';
import { Organization } from '../../models/Organization';
import { Endpoint, validateEndpointUrl } from '../../models/Endpoint';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
}

export class Validator {
  /**
   * Validate Practitioner resource
   */
  validatePractitioner(practitioner: Practitioner): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Required fields
    if (!practitioner.resourceType || practitioner.resourceType !== 'Practitioner') {
      errors.push({
        field: 'resourceType',
        message: 'Resource type must be "Practitioner"',
        code: 'INVALID_RESOURCE_TYPE'
      });
    }

    // NPI validation
    if (practitioner.npi && !validateNPI(practitioner.npi)) {
      errors.push({
        field: 'npi',
        message: 'NPI must be a 10-digit number',
        code: 'INVALID_NPI_FORMAT'
      });
    }

    // Name validation
    if (!practitioner.name || practitioner.name.length === 0) {
      errors.push({
        field: 'name',
        message: 'At least one name is required',
        code: 'MISSING_NAME'
      });
    } else {
      const primaryName = practitioner.name[0];
      if (!primaryName.family) {
        errors.push({
          field: 'name[0].family',
          message: 'Family name is required',
          code: 'MISSING_FAMILY_NAME'
        });
      }
    }

    // License validation
    if (practitioner.licenses) {
      practitioner.licenses.forEach((license, index) => {
        const licenseErrors = this.validateLicense(license, index);
        errors.push(...licenseErrors.errors);
        warnings.push(...licenseErrors.warnings);
      });
    }

    // Address validation
    if (practitioner.address) {
      practitioner.address.forEach((address, index) => {
        if (!address.state) {
          warnings.push({
            field: `address[${index}].state`,
            message: 'State is recommended for US addresses',
            code: 'MISSING_STATE'
          });
        }
        if (!address.postalCode) {
          warnings.push({
            field: `address[${index}].postalCode`,
            message: 'Postal code is recommended',
            code: 'MISSING_POSTAL_CODE'
          });
        }
      });
    }

    // Active status check
    if (practitioner.active === false) {
      warnings.push({
        field: 'active',
        message: 'Practitioner is marked as inactive',
        code: 'INACTIVE_PRACTITIONER'
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate Medical License
   */
  validateLicense(license: MedicalLicense, index?: number): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const fieldPrefix = index !== undefined ? `licenses[${index}]` : 'license';

    // Required fields
    if (!license.state) {
      errors.push({
        field: `${fieldPrefix}.state`,
        message: 'State is required for license',
        code: 'MISSING_LICENSE_STATE'
      });
    }

    if (!license.licenseNumber) {
      errors.push({
        field: `${fieldPrefix}.licenseNumber`,
        message: 'License number is required',
        code: 'MISSING_LICENSE_NUMBER'
      });
    }

    if (!license.expirationDate) {
      errors.push({
        field: `${fieldPrefix}.expirationDate`,
        message: 'Expiration date is required',
        code: 'MISSING_EXPIRATION_DATE'
      });
    } else {
      // Check if license is expired
      const expDate = new Date(license.expirationDate);
      const now = new Date();

      if (expDate < now && license.status === 'active') {
        errors.push({
          field: `${fieldPrefix}.status`,
          message: 'License is expired but marked as active',
          code: 'EXPIRED_LICENSE_ACTIVE'
        });
      }

      // Check if license is expiring soon (90 days)
      const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      if (expDate < ninetyDaysFromNow && expDate > now && license.status === 'active') {
        warnings.push({
          field: `${fieldPrefix}.expirationDate`,
          message: 'License expires within 90 days',
          code: 'LICENSE_EXPIRING_SOON'
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate PractitionerRole resource
   */
  validatePractitionerRole(role: PractitionerRole): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Required fields
    if (!role.resourceType || role.resourceType !== 'PractitionerRole') {
      errors.push({
        field: 'resourceType',
        message: 'Resource type must be "PractitionerRole"',
        code: 'INVALID_RESOURCE_TYPE'
      });
    }

    // Practitioner reference
    if (!role.practitioner) {
      errors.push({
        field: 'practitioner',
        message: 'Practitioner reference is required',
        code: 'MISSING_PRACTITIONER_REFERENCE'
      });
    }

    // Organization reference
    if (!role.organization) {
      warnings.push({
        field: 'organization',
        message: 'Organization reference is recommended',
        code: 'MISSING_ORGANIZATION_REFERENCE'
      });
    }

    // Taxonomy validation
    if (!role.taxonomyCodes || role.taxonomyCodes.length === 0) {
      warnings.push({
        field: 'taxonomyCodes',
        message: 'At least one NUCC taxonomy code is recommended',
        code: 'MISSING_TAXONOMY'
      });
    } else {
      // Check for primary taxonomy
      const hasPrimary = role.taxonomyCodes.some(t => t.isPrimary);
      if (!hasPrimary) {
        warnings.push({
          field: 'taxonomyCodes',
          message: 'One taxonomy code should be marked as primary',
          code: 'NO_PRIMARY_TAXONOMY'
        });
      }
    }

    // Insurance plans validation
    if (role.insurancePlans) {
      role.insurancePlans.forEach((plan, index) => {
        if (!plan.effectiveDate) {
          errors.push({
            field: `insurancePlans[${index}].effectiveDate`,
            message: 'Effective date is required for insurance plan',
            code: 'MISSING_EFFECTIVE_DATE'
          });
        }

        if (plan.terminationDate) {
          const effective = new Date(plan.effectiveDate);
          const termination = new Date(plan.terminationDate);

          if (termination < effective) {
            errors.push({
              field: `insurancePlans[${index}].terminationDate`,
              message: 'Termination date cannot be before effective date',
              code: 'INVALID_DATE_RANGE'
            });
          }
        }
      });
    }

    // Active status check
    if (role.active === false) {
      warnings.push({
        field: 'active',
        message: 'PractitionerRole is marked as inactive',
        code: 'INACTIVE_ROLE'
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate Organization resource
   */
  validateOrganization(org: Organization): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Required fields
    if (!org.resourceType || org.resourceType !== 'Organization') {
      errors.push({
        field: 'resourceType',
        message: 'Resource type must be "Organization"',
        code: 'INVALID_RESOURCE_TYPE'
      });
    }

    // Name is required
    if (!org.name) {
      errors.push({
        field: 'name',
        message: 'Organization name is required',
        code: 'MISSING_NAME'
      });
    }

    // NPI validation
    if (org.npi && !validateNPI(org.npi)) {
      errors.push({
        field: 'npi',
        message: 'NPI must be a 10-digit number',
        code: 'INVALID_NPI_FORMAT'
      });
    }

    // Address validation
    if (!org.address || org.address.length === 0) {
      warnings.push({
        field: 'address',
        message: 'At least one address is recommended',
        code: 'MISSING_ADDRESS'
      });
    }

    // Contact information
    if (!org.telecom || org.telecom.length === 0) {
      warnings.push({
        field: 'telecom',
        message: 'Contact information is recommended',
        code: 'MISSING_CONTACT'
      });
    }

    // Active status
    if (org.active === false) {
      warnings.push({
        field: 'active',
        message: 'Organization is marked as inactive',
        code: 'INACTIVE_ORGANIZATION'
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate Endpoint resource
   */
  validateEndpoint(endpoint: Endpoint): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Required fields
    if (!endpoint.resourceType || endpoint.resourceType !== 'Endpoint') {
      errors.push({
        field: 'resourceType',
        message: 'Resource type must be "Endpoint"',
        code: 'INVALID_RESOURCE_TYPE'
      });
    }

    // Status is required
    if (!endpoint.status) {
      errors.push({
        field: 'status',
        message: 'Status is required',
        code: 'MISSING_STATUS'
      });
    }

    // Address validation
    if (!endpoint.address) {
      errors.push({
        field: 'address',
        message: 'Endpoint address is required',
        code: 'MISSING_ADDRESS'
      });
    } else if (!validateEndpointUrl(endpoint.address)) {
      errors.push({
        field: 'address',
        message: 'Endpoint address must be a valid HTTP/HTTPS URL',
        code: 'INVALID_URL'
      });
    }

    // Connection type is required
    if (!endpoint.connectionType) {
      errors.push({
        field: 'connectionType',
        message: 'Connection type is required',
        code: 'MISSING_CONNECTION_TYPE'
      });
    }

    // Payload type is required
    if (!endpoint.payloadType || endpoint.payloadType.length === 0) {
      errors.push({
        field: 'payloadType',
        message: 'At least one payload type is required',
        code: 'MISSING_PAYLOAD_TYPE'
      });
    }

    // Webhook config validation
    if (endpoint.webhookConfig) {
      if (!endpoint.webhookConfig.eventTypes || endpoint.webhookConfig.eventTypes.length === 0) {
        errors.push({
          field: 'webhookConfig.eventTypes',
          message: 'At least one event type is required for webhooks',
          code: 'MISSING_EVENT_TYPES'
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Format validation result for display
   */
  formatValidationResult(result: ValidationResult): string {
    const lines: string[] = [];

    if (result.valid) {
      lines.push('✓ Validation passed');
    } else {
      lines.push('✗ Validation failed');
    }

    if (result.errors.length > 0) {
      lines.push('\nErrors:');
      result.errors.forEach(error => {
        lines.push(`  ✗ ${error.field}: ${error.message} [${error.code}]`);
      });
    }

    if (result.warnings.length > 0) {
      lines.push('\nWarnings:');
      result.warnings.forEach(warning => {
        lines.push(`  ⚠ ${warning.field}: ${warning.message} [${warning.code}]`);
      });
    }

    return lines.join('\n');
  }
}

export default Validator;
