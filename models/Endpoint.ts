/**
 * FHIR R4 Endpoint Resource
 * Technical details of an endpoint for electronic services, webhooks, or FHIR APIs
 */

import { Reference, Identifier, CodeableConcept, ContactPoint, Period, Coding } from './Practitioner';

export interface EndpointHeader {
  key: string;
  value: string;
}

/**
 * Main Endpoint Resource
 */
export interface Endpoint {
  resourceType: 'Endpoint';
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

  // Core Endpoint Fields
  identifier?: Identifier[];
  status: 'active' | 'suspended' | 'error' | 'off' | 'entered-in-error' | 'test';
  connectionType: Coding; // Type of endpoint (HL7 FHIR, Direct, etc.)
  name?: string;
  managingOrganization?: Reference;
  contact?: ContactPoint[];
  period?: Period;
  payloadType: CodeableConcept[]; // Data types supported
  payloadMimeType?: string[];
  address: string; // URL or connection address
  header?: string[]; // HTTP headers

  // Extended fields for ProviderCard-v2
  webhookConfig?: WebhookConfiguration;
  subscriptionCriteria?: SubscriptionCriteria[];
  authentication?: AuthenticationConfig;
  rateLimit?: RateLimit;
  monitoring?: MonitoringConfig;
}

export interface WebhookConfiguration {
  eventTypes: WebhookEventType[];
  retryPolicy: RetryPolicy;
  timeout: number; // milliseconds
  includeFullResource: boolean;
  signatureAlgorithm?: 'HMAC-SHA256' | 'HMAC-SHA512';
  secret?: string;
  batchingEnabled: boolean;
  batchSize?: number;
  batchWindowMs?: number;
}

export type WebhookEventType =
  | 'practitioner.created'
  | 'practitioner.updated'
  | 'practitioner.deleted'
  | 'practitionerRole.created'
  | 'practitionerRole.updated'
  | 'practitionerRole.deleted'
  | 'organization.created'
  | 'organization.updated'
  | 'organization.deleted'
  | 'license.expiring'
  | 'license.expired'
  | 'credentialing.statusChange';

export interface RetryPolicy {
  maxAttempts: number;
  backoffStrategy: 'linear' | 'exponential' | 'fixed';
  initialDelayMs: number;
  maxDelayMs: number;
  retryableStatusCodes: number[];
}

export interface SubscriptionCriteria {
  resourceType: 'Practitioner' | 'PractitionerRole' | 'Organization';
  query?: string; // FHIR search parameters
  eventType: 'create' | 'update' | 'delete';
}

export interface AuthenticationConfig {
  type: 'none' | 'api-key' | 'oauth2' | 'basic' | 'bearer' | 'mutual-tls';
  credentials?: {
    apiKey?: string;
    username?: string;
    password?: string;
    token?: string;
    clientId?: string;
    clientSecret?: string;
    tokenUrl?: string;
  };
  headers?: EndpointHeader[];
}

export interface RateLimit {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  burstLimit: number;
}

export interface MonitoringConfig {
  enabled: boolean;
  healthCheckUrl?: string;
  healthCheckIntervalMs: number;
  alertOnFailure: boolean;
  alertEmail?: string[];
  successRate?: {
    threshold: number; // percentage
    windowMinutes: number;
  };
}

/**
 * Helper function to create a new Endpoint resource
 */
export function createEndpoint(data: Partial<Endpoint>): Endpoint {
  return {
    resourceType: 'Endpoint',
    status: 'active',
    connectionType: {
      system: 'http://terminology.hl7.org/CodeSystem/endpoint-connection-type',
      code: 'hl7-fhir-rest'
    },
    payloadType: [{
      coding: [{
        system: 'http://hl7.org/fhir/resource-types',
        code: 'Practitioner'
      }]
    }],
    address: '',
    ...data,
    meta: {
      lastUpdated: new Date().toISOString(),
      ...data.meta
    }
  };
}

/**
 * Create a webhook endpoint
 */
export function createWebhookEndpoint(
  url: string,
  eventTypes: WebhookEventType[],
  options?: Partial<WebhookConfiguration>
): Endpoint {
  return createEndpoint({
    name: 'Webhook Endpoint',
    address: url,
    connectionType: {
      system: 'http://terminology.hl7.org/CodeSystem/endpoint-connection-type',
      code: 'rest-hook'
    },
    webhookConfig: {
      eventTypes,
      retryPolicy: {
        maxAttempts: 3,
        backoffStrategy: 'exponential',
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        retryableStatusCodes: [408, 429, 500, 502, 503, 504]
      },
      timeout: 30000,
      includeFullResource: true,
      batchingEnabled: false,
      ...options
    }
  });
}

/**
 * Create a FHIR subscription endpoint
 */
export function createSubscriptionEndpoint(
  url: string,
  criteria: SubscriptionCriteria[]
): Endpoint {
  return createEndpoint({
    name: 'FHIR Subscription Endpoint',
    address: url,
    connectionType: {
      system: 'http://terminology.hl7.org/CodeSystem/endpoint-connection-type',
      code: 'hl7-fhir-rest'
    },
    subscriptionCriteria: criteria,
    payloadMimeType: ['application/fhir+json']
  });
}

/**
 * Validate endpoint URL
 */
export function validateEndpointUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Check if endpoint is active and healthy
 */
export function isEndpointHealthy(endpoint: Endpoint): boolean {
  if (endpoint.status !== 'active') return false;

  // Check if period is valid
  if (endpoint.period) {
    const now = new Date();
    if (endpoint.period.start && new Date(endpoint.period.start) > now) return false;
    if (endpoint.period.end && new Date(endpoint.period.end) < now) return false;
  }

  return true;
}

/**
 * Get supported event types for webhook
 */
export function getSupportedEvents(endpoint: Endpoint): WebhookEventType[] {
  return endpoint.webhookConfig?.eventTypes || [];
}

/**
 * Check if endpoint supports event type
 */
export function supportsEventType(endpoint: Endpoint, eventType: WebhookEventType): boolean {
  return getSupportedEvents(endpoint).includes(eventType);
}

/**
 * Format endpoint for display
 */
export function formatEndpointDisplay(endpoint: Endpoint): string {
  const name = endpoint.name || 'Unnamed Endpoint';
  const type = endpoint.connectionType.code || 'unknown';
  return `${name} (${type})`;
}

/**
 * Create default monitoring config
 */
export function createDefaultMonitoring(): MonitoringConfig {
  return {
    enabled: true,
    healthCheckIntervalMs: 300000, // 5 minutes
    alertOnFailure: true,
    successRate: {
      threshold: 95,
      windowMinutes: 60
    }
  };
}

export default Endpoint;
