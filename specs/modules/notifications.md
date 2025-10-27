# Notifications Module Specification

## Overview

The Notifications module delivers timely alerts to providers and organizations about profile changes, credential expirations, sync status, and other critical events.

## Module Metadata

| Field | Value |
|-------|-------|
| **Module ID** | notifications |
| **Version** | 0.1.0 |
| **Status** | Planning |
| **Dependencies** | Sync Engine, Provider Profile |
| **Owners** | Platform Team |

## Requirements

### NF-001: Organization Notifications

**As an** Organization
**I want to** receive webhook or email when a provider record changes
**So that** my directory remains current

**Acceptance Criteria**:
- [ ] Organizations can subscribe to provider events via webhook
- [ ] Email fallback if webhook fails after retries
- [ ] Event types: profile.updated, credential.verified, credential.expiring, credential.expired
- [ ] Configurable event filters (only specific types)
- [ ] Delivery confirmation tracking
- [ ] Webhook signature verification
- [ ] Retry with exponential backoff (up to 24 hours)

## Notification Channels

### 1. Webhooks

**Primary channel for B2B integrations**

#### Configuration

```typescript
interface WebhookSubscription {
  id: string;
  organizationId: string;
  providerId?: string; // Optional: specific provider or all authorized
  url: string;
  secret: string; // For HMAC signature
  events: NotificationEventType[];
  enabled: boolean;
  filters?: {
    fieldChanges?: string[]; // Only notify if these fields change
    minSeverity?: 'low' | 'medium' | 'high';
  };
  metadata: {
    createdAt: Date;
    createdBy: string;
    lastDeliveryAt?: Date;
    totalDeliveries: number;
    failedDeliveries: number;
  };
}
```

#### Event Payload

```json
{
  "id": "evt_4kM8NpQsUxW6qZ",
  "type": "provider.updated",
  "createdAt": "2025-10-20T12:00:00Z",
  "provider": {
    "id": "prov_2gQ8ZjKYXKdN5rP",
    "npi": "1234567890",
    "name": "Dr. Jane Smith",
    "fhirUrl": "https://api.providercard.io/fhir/Practitioner/example-provider-123"
  },
  "changes": {
    "fields": ["specialties", "licenses"],
    "summary": "Updated primary specialty and added MA license",
    "details": [
      {
        "field": "specialties",
        "oldValue": "Internal Medicine",
        "newValue": "Internal Medicine, Geriatrics"
      },
      {
        "field": "licenses",
        "action": "added",
        "value": {
          "state": "MA",
          "number": "MD123456",
          "expirationDate": "2026-06-01"
        }
      }
    ]
  }
}
```

#### Delivery

1. **Immediate**: Send within 1 second of event
2. **Retry Logic**:
   - Attempt 1: Immediate
   - Attempt 2: 1 min
   - Attempt 3: 10 min
   - Attempt 4: 1 hour
   - Attempt 5: 6 hours
   - Attempt 6: 24 hours
3. **Circuit Breaker**: Disable webhook after 10 consecutive failures
4. **Fallback**: Send email summary to organization contacts

### 2. Email Notifications

**Secondary channel and direct provider communication**

#### Provider Emails

| Event | Trigger | Recipient | Urgency |
|-------|---------|-----------|---------|
| `credential.expiring` | 90/60/30 days before expiration | Provider | Medium |
| `credential.expired` | Day of expiration | Provider | High |
| `authorization.requested` | New org requests access | Provider | Medium |
| `sync.failed` | Sync fails after all retries | Provider | High |
| `profile.incomplete` | 7 days after registration, <50% complete | Provider | Low |
| `weekly.summary` | Every Monday 9am | Provider | Low |

#### Email Template Example

```html
Subject: Your Massachusetts Medical License expires in 30 days

Hi Dr. Smith,

Your Massachusetts Medical License (MD123456) will expire on June 1, 2026.

To avoid interruptions to your practice:
1. Renew your license with the Massachusetts Board of Registration in Medicine
2. Upload the renewed license document to ProviderCard: [Upload Link]

This will automatically update all 5 organizations you've authorized:
- Acme Health Network
- Blue Cross Blue Shield MA
- UnitedHealthcare
- Mass General Brigham
- Tufts Medical Center

[Update License] [View Profile]

Need help? Reply to this email or visit our Help Center.

Best,
The ProviderCard Team
```

### 3. SMS Notifications (Future)

**High-urgency alerts only**
- Credential expired
- Sync failures affecting patient care
- Security alerts

### 4. In-App Notifications

**Real-time updates in provider portal**

```typescript
interface InAppNotification {
  id: string;
  providerId: string;
  type: NotificationEventType;
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
  read: boolean;
  createdAt: Date;
  expiresAt?: Date;
}
```

## Event Types

### Provider Events

| Event Type | Description | Default Recipients |
|------------|-------------|-------------------|
| `provider.created` | New provider profile registered | Orgs (if auto-approved) |
| `provider.updated` | Profile information changed | Authorized orgs |
| `provider.verified` | Profile verification completed | Provider, Authorized orgs |
| `provider.deleted` | Profile deleted by provider | Authorized orgs |

### Credential Events

| Event Type | Description | Default Recipients |
|------------|-------------|-------------------|
| `credential.uploaded` | New document uploaded | Provider |
| `credential.verified` | Document verified by admin | Provider, Authorized orgs |
| `credential.rejected` | Document rejected (invalid) | Provider |
| `credential.expiring` | Expires in 90/60/30 days | Provider, Authorized orgs |
| `credential.expired` | Expiration date passed | Provider, Authorized orgs |

### Sync Events

| Event Type | Description | Default Recipients |
|------------|-------------|-------------------|
| `sync.initiated` | Manual or auto sync started | Provider (if manual) |
| `sync.completed` | Sync successful | Provider, Organization |
| `sync.failed` | Sync failed after retries | Provider, Organization, Ops team |

### Authorization Events

| Event Type | Description | Default Recipients |
|------------|-------------|-------------------|
| `authorization.requested` | Org requests data access | Provider |
| `authorization.granted` | Provider approves access | Provider, Organization |
| `authorization.revoked` | Provider revokes access | Provider, Organization |
| `authorization.expired` | Time-limited auth expired | Provider, Organization |

## API Endpoints

### Create Webhook Subscription

```
POST /api/v1/organizations/{orgId}/webhooks
Authorization: Bearer {token}

Request:
{
  "url": "https://acme-health.com/webhooks/providercard",
  "events": ["provider.updated", "credential.verified", "credential.expiring"],
  "secret": "whsec_a1b2c3d4e5f6...", // Optional: system-generated if omitted
  "filters": {
    "fieldChanges": ["licenses", "specialties", "contact"],
    "minSeverity": "medium"
  }
}

Response (201 Created):
{
  "id": "webhook_7tR3MnBvWpL2kQ",
  "url": "https://acme-health.com/webhooks/providercard",
  "secret": "whsec_a1b2c3d4e5f6...",
  "events": ["provider.updated", "credential.verified", "credential.expiring"],
  "enabled": true,
  "createdAt": "2025-10-20T12:00:00Z"
}
```

### List Provider Notifications

```
GET /api/v1/providers/{id}/notifications?unread=true&limit=20
Authorization: Bearer {token}

Response (200 OK):
{
  "data": [
    {
      "id": "notif_9kP3QxLmRwN5sT",
      "type": "credential.expiring",
      "severity": "warning",
      "title": "License expiring soon",
      "message": "Your MA medical license expires in 30 days",
      "actionUrl": "/credentials/cred_7tR3MnBvWpL2kQ",
      "actionLabel": "Update License",
      "read": false,
      "createdAt": "2025-10-20T09:00:00Z"
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "perPage": 20
  }
}
```

### Mark Notification as Read

```
POST /api/v1/providers/{id}/notifications/{notifId}/read
Authorization: Bearer {token}

Response (200 OK):
{
  "id": "notif_9kP3QxLmRwN5sT",
  "read": true,
  "readAt": "2025-10-20T12:30:00Z"
}
```

## Notification Preferences

### Provider Preferences

```typescript
interface NotificationPreferences {
  providerId: string;
  channels: {
    email: {
      enabled: boolean;
      address: string;
      frequency: 'realtime' | 'daily' | 'weekly';
    };
    sms: {
      enabled: boolean;
      phoneNumber?: string;
    };
    inApp: {
      enabled: boolean;
    };
  };
  events: {
    [key in NotificationEventType]: {
      enabled: boolean;
      channels: ('email' | 'sms' | 'inApp')[];
    };
  };
  quietHours?: {
    enabled: boolean;
    start: string; // HH:MM
    end: string; // HH:MM
    timezone: string;
  };
}
```

### API: Update Preferences

```
PUT /api/v1/providers/{id}/notification-preferences
Authorization: Bearer {token}

Request:
{
  "channels": {
    "email": {
      "enabled": true,
      "frequency": "daily"
    }
  },
  "events": {
    "credential.expiring": {
      "enabled": true,
      "channels": ["email", "inApp"]
    },
    "sync.completed": {
      "enabled": false
    }
  },
  "quietHours": {
    "enabled": true,
    "start": "22:00",
    "end": "08:00",
    "timezone": "America/New_York"
  }
}

Response (200 OK):
{
  "message": "Notification preferences updated",
  "preferences": {...}
}
```

## Delivery Tracking

### Webhook Delivery Logs

```typescript
interface WebhookDeliveryLog {
  id: string;
  webhookId: string;
  eventId: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attemptCount: number;
  lastAttemptAt: Date;
  nextRetryAt?: Date;
  httpStatus?: number;
  duration?: number; // ms
  error?: string;
  requestPayload: object;
  responseBody?: string;
}
```

### Dashboard Metrics

```
GET /api/v1/organizations/{orgId}/webhooks/{webhookId}/stats?period=7d

Response (200 OK):
{
  "webhookId": "webhook_7tR3MnBvWpL2kQ",
  "period": "7d",
  "stats": {
    "totalDeliveries": 1250,
    "successfulDeliveries": 1198,
    "failedDeliveries": 52,
    "successRate": 95.84,
    "avgDeliveryTime": 234, // ms
    "p95DeliveryTime": 890,
    "p99DeliveryTime": 2100
  },
  "recentFailures": [
    {
      "timestamp": "2025-10-20T11:45:00Z",
      "error": "Connection timeout",
      "httpStatus": null
    }
  ]
}
```

## Email Service Integration

### Provider: SendGrid / AWS SES

```typescript
interface EmailService {
  sendTransactional(params: {
    to: string;
    subject: string;
    templateId: string;
    templateData: object;
  }): Promise<void>;

  sendBatch(emails: Array<{
    to: string;
    subject: string;
    templateId: string;
    templateData: object;
  }>): Promise<void>;
}
```

### Email Templates

Stored in version control as Handlebars/Liquid templates:

```
/email-templates
  /credential-expiring.hbs
  /authorization-requested.hbs
  /sync-failed.hbs
  /weekly-summary.hbs
  /layouts
    /base.hbs
```

### Example Configuration

```yaml
# sendgrid.yml
sendgrid:
  api_key: "${SENDGRID_API_KEY}"
  from_email: "notifications@providercard.io"
  from_name: "ProviderCard"
  templates:
    credential_expiring: "d-abc123..."
    authorization_requested: "d-def456..."
    sync_failed: "d-ghi789..."
```

## Event Processing Pipeline

### Architecture

```
Provider Update
      │
      ▼
┌─────────────┐
│  Event Bus  │ (EventBridge / RabbitMQ)
└─────────────┘
      │
      ├──────────────┬──────────────┬──────────────┐
      ▼              ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Webhook  │  │  Email   │  │  In-App  │  │ Audit    │
│ Handler  │  │ Handler  │  │ Handler  │  │ Logger   │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
      │              │              │
      ▼              ▼              ▼
   External       SendGrid      Database
     APIs
```

### Event Handler Example

```typescript
class NotificationEventHandler {
  async handle(event: NotificationEvent): Promise<void> {
    // 1. Determine recipients
    const recipients = await this.getRecipients(event);

    // 2. Apply user preferences
    const filtered = await this.applyPreferences(recipients, event);

    // 3. Render notification content
    const notifications = await Promise.all(
      filtered.map(r => this.renderNotification(event, r))
    );

    // 4. Dispatch to channels
    await Promise.all([
      this.sendWebhooks(notifications.filter(n => n.channel === 'webhook')),
      this.sendEmails(notifications.filter(n => n.channel === 'email')),
      this.createInAppNotifications(notifications.filter(n => n.channel === 'inApp'))
    ]);

    // 5. Log delivery attempts
    await this.logDeliveries(notifications);
  }
}
```

## Monitoring & Alerting

### Metrics

- **Webhook Delivery Rate**: % successful deliveries
- **Webhook Latency**: p50, p95, p99 delivery time
- **Email Delivery Rate**: % delivered (not bounced)
- **Email Open Rate**: % opened within 24h
- **Notification Volume**: Events per hour/day by type

### Alerts

- Webhook delivery rate < 90% (5-minute window) → Investigate
- Email bounce rate > 5% → Check sender reputation
- Event queue length > 1000 → Scale processors
- Circuit breaker triggered → Notify organization

### Dashboard

```
┌─────────────────────────────────────────────────────┐
│  Notification Health Dashboard                      │
├─────────────────────────────────────────────────────┤
│  Webhook Deliveries (Last 24h)                      │
│  ████████████████████░░  95.2% Success (1,234/1,296)│
│                                                      │
│  Email Deliveries (Last 24h)                        │
│  ███████████████████████  99.1% Delivered (890/898) │
│                                                      │
│  Event Processing Lag                               │
│  ▓▓▓░░░░░░░░░░░░░░░░  <1s (target: <5s)            │
│                                                      │
│  Active Circuit Breakers: 2                         │
│  - Acme Health Network (webhook timeout)            │
│  - Generic Hospital (5xx errors)                    │
└─────────────────────────────────────────────────────┘
```

## Security & Compliance

### Webhook Security

1. **HTTPS Only**: Reject non-HTTPS webhook URLs
2. **Signature Verification**: HMAC-SHA256 with secret
3. **IP Allowlisting**: Optional restriction per webhook
4. **Replay Protection**: Timestamp validation (5-minute window)

### Email Security

1. **SPF/DKIM/DMARC**: Properly configured sending domain
2. **Unsubscribe**: Honor unsubscribe requests per CAN-SPAM
3. **PII Protection**: Minimal PII in email body, use secure links

### Audit Trail

All notifications logged with:
- Recipient (provider or organization)
- Event type
- Delivery channel
- Timestamp
- Delivery status
- Content (for compliance review)

## Testing Strategy

### Unit Tests
- Event type filtering
- Preference application
- Retry logic
- Circuit breaker behavior

### Integration Tests
- Webhook delivery (mock server)
- Email sending (SendGrid sandbox)
- In-app notification creation

### E2E Tests
- Provider updates profile → Orgs receive webhook
- Credential expiring → Provider receives email
- Webhook fails → Email fallback sent

## Future Enhancements

- [ ] SMS notifications via Twilio
- [ ] Push notifications (mobile app)
- [ ] Slack/Teams integrations
- [ ] Notification templating UI (no-code editor)
- [ ] A/B testing for email content
- [ ] Notification scheduling (send at optimal time)
- [ ] Digest mode (batch multiple events)

---

**Version**: 0.1.0
**Last Updated**: 2025-10-20
**Maintained By**: Platform Team
