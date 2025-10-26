/**
 * Sync Engine Module
 * Real-time synchronization via webhooks and FHIR Subscriptions
 */

import { Endpoint, WebhookEventType, createWebhookEndpoint } from '../../models/Endpoint';
import { Practitioner } from '../../models/Practitioner';
import { PractitionerRole } from '../../models/PractitionerRole';
import { Organization } from '../../models/Organization';

export interface WebhookPayload {
  eventType: WebhookEventType;
  timestamp: string;
  resource: Practitioner | PractitionerRole | Organization;
  previousResource?: Practitioner | PractitionerRole | Organization;
  changes?: Array<{
    field: string;
    oldValue: any;
    newValue: any;
  }>;
}

export interface SubscriberConfig {
  id: string;
  name: string;
  endpoint: Endpoint;
  active: boolean;
}

export class SyncEngine {
  private subscribers: Map<string, SubscriberConfig> = new Map();
  private eventQueue: WebhookPayload[] = [];
  private processing: boolean = false;

  constructor() {
    this.startProcessing();
  }

  /**
   * Register a new subscriber
   */
  subscribe(
    url: string,
    options: {
      name?: string;
      eventTypes: WebhookEventType[];
      retryAttempts?: number;
    }
  ): string {
    const id = this.generateSubscriberId();
    const endpoint = createWebhookEndpoint(url, options.eventTypes, {
      retryPolicy: {
        maxAttempts: options.retryAttempts || 3,
        backoffStrategy: 'exponential',
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        retryableStatusCodes: [408, 429, 500, 502, 503, 504]
      }
    });

    endpoint.id = id;

    this.subscribers.set(id, {
      id,
      name: options.name || `Subscriber ${id}`,
      endpoint,
      active: true
    });

    console.log(`✓ Subscriber registered: ${options.name || id}`);
    return id;
  }

  /**
   * Unsubscribe a subscriber
   */
  unsubscribe(subscriberId: string): boolean {
    const subscriber = this.subscribers.get(subscriberId);
    if (!subscriber) return false;

    this.subscribers.delete(subscriberId);
    console.log(`✓ Subscriber removed: ${subscriber.name}`);
    return true;
  }

  /**
   * Get all subscribers
   */
  getSubscribers(): SubscriberConfig[] {
    return Array.from(this.subscribers.values());
  }

  /**
   * Get active subscribers for an event type
   */
  getSubscribersForEvent(eventType: WebhookEventType): SubscriberConfig[] {
    return Array.from(this.subscribers.values()).filter(
      sub => sub.active && sub.endpoint.webhookConfig?.eventTypes.includes(eventType)
    );
  }

  /**
   * Emit an event
   */
  async emit(
    eventType: WebhookEventType,
    resource: Practitioner | PractitionerRole | Organization,
    previousResource?: Practitioner | PractitionerRole | Organization
  ): Promise<void> {
    const payload: WebhookPayload = {
      eventType,
      timestamp: new Date().toISOString(),
      resource,
      previousResource,
      changes: previousResource ? this.detectChanges(previousResource, resource) : undefined
    };

    this.eventQueue.push(payload);
    console.log(`📤 Event queued: ${eventType} for ${resource.resourceType}/${resource.id}`);

    // Process queue if not already processing
    if (!this.processing) {
      await this.processQueue();
    }
  }

  /**
   * Detect changes between two resources
   */
  private detectChanges(
    oldResource: any,
    newResource: any
  ): Array<{ field: string; oldValue: any; newValue: any }> {
    const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];

    const compareObjects = (obj1: any, obj2: any, path: string = '') => {
      for (const key in obj2) {
        const fullPath = path ? `${path}.${key}` : key;
        const oldValue = obj1?.[key];
        const newValue = obj2[key];

        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          changes.push({
            field: fullPath,
            oldValue,
            newValue
          });
        }
      }
    };

    compareObjects(oldResource, newResource);
    return changes;
  }

  /**
   * Process event queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.eventQueue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.eventQueue.length > 0) {
      const payload = this.eventQueue.shift();
      if (payload) {
        await this.deliverEvent(payload);
      }
    }

    this.processing = false;
  }

  /**
   * Deliver event to subscribers
   */
  private async deliverEvent(payload: WebhookPayload): Promise<void> {
    const subscribers = this.getSubscribersForEvent(payload.eventType);

    if (subscribers.length === 0) {
      console.log(`⚠️  No subscribers for event: ${payload.eventType}`);
      return;
    }

    const deliveryPromises = subscribers.map(sub =>
      this.sendWebhook(sub, payload)
    );

    await Promise.allSettled(deliveryPromises);
  }

  /**
   * Send webhook to subscriber
   */
  private async sendWebhook(
    subscriber: SubscriberConfig,
    payload: WebhookPayload
  ): Promise<void> {
    const endpoint = subscriber.endpoint;
    const config = endpoint.webhookConfig;

    if (!config) {
      console.error(`❌ No webhook config for subscriber: ${subscriber.name}`);
      return;
    }

    console.log(`📨 Sending webhook to ${subscriber.name}: ${payload.eventType}`);

    // Simulate webhook delivery
    await this.simulateWebhookDelivery(endpoint.address, payload);

    console.log(`✓ Webhook delivered to ${subscriber.name}`);
  }

  /**
   * Simulate webhook delivery (mock implementation)
   */
  private async simulateWebhookDelivery(
    url: string,
    payload: WebhookPayload
  ): Promise<void> {
    // In a real implementation, this would use fetch/axios to POST to the webhook URL
    // For now, we just simulate the delivery

    return new Promise((resolve) => {
      setTimeout(() => {
        console.log(`  → POST ${url}`);
        console.log(`  → Payload: ${payload.eventType} at ${payload.timestamp}`);
        resolve();
      }, 100);
    });
  }

  /**
   * Generate unique subscriber ID
   */
  private generateSubscriberId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start background processing
   */
  private startProcessing(): void {
    // In a real implementation, this might be a background worker
    setInterval(() => {
      if (this.eventQueue.length > 0 && !this.processing) {
        this.processQueue();
      }
    }, 1000);
  }

  /**
   * Notify when practitioner is created
   */
  async notifyPractitionerCreated(practitioner: Practitioner): Promise<void> {
    await this.emit('practitioner.created', practitioner);
  }

  /**
   * Notify when practitioner is updated
   */
  async notifyPractitionerUpdated(
    practitioner: Practitioner,
    previousVersion?: Practitioner
  ): Promise<void> {
    await this.emit('practitioner.updated', practitioner, previousVersion);
  }

  /**
   * Notify when practitioner is deleted
   */
  async notifyPractitionerDeleted(practitioner: Practitioner): Promise<void> {
    await this.emit('practitioner.deleted', practitioner);
  }

  /**
   * Notify when role is created
   */
  async notifyRoleCreated(role: PractitionerRole): Promise<void> {
    await this.emit('practitionerRole.created', role);
  }

  /**
   * Notify when role is updated
   */
  async notifyRoleUpdated(
    role: PractitionerRole,
    previousVersion?: PractitionerRole
  ): Promise<void> {
    await this.emit('practitionerRole.updated', role, previousVersion);
  }

  /**
   * Notify when organization is created
   */
  async notifyOrganizationCreated(org: Organization): Promise<void> {
    await this.emit('organization.created', org);
  }

  /**
   * Notify when organization is updated
   */
  async notifyOrganizationUpdated(
    org: Organization,
    previousVersion?: Organization
  ): Promise<void> {
    await this.emit('organization.updated', org, previousVersion);
  }

  /**
   * Notify when license is expiring
   */
  async notifyLicenseExpiring(practitioner: Practitioner): Promise<void> {
    await this.emit('license.expiring', practitioner);
  }

  /**
   * Notify when license has expired
   */
  async notifyLicenseExpired(practitioner: Practitioner): Promise<void> {
    await this.emit('license.expired', practitioner);
  }

  /**
   * Notify when credentialing status changes
   */
  async notifyCredentialingStatusChange(role: PractitionerRole): Promise<void> {
    await this.emit('credentialing.statusChange', role);
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    queueLength: number;
    processing: boolean;
    subscribers: number;
  } {
    return {
      queueLength: this.eventQueue.length,
      processing: this.processing,
      subscribers: this.subscribers.size
    };
  }
}

export default SyncEngine;
