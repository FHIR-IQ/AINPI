# ProviderCard Extended Features

This document describes the extended features added to the ProviderCard backend.

## Overview

Three major features have been added:
1. **FHIR Resource Validation** - Validates Practitioner resources against FHIR R4 spec
2. **Consent Management** - Manage authorized recipients for data sharing
3. **Webhook Notifications** - Real-time notifications to consented recipients

## 1. FHIR Resource Validation

### Purpose
Ensures all FHIR Practitioner resources comply with FHIR R4 specifications before storage or transmission.

### Implementation

**File**: `app/fhir_validator.py`

**Features**:
- Validates required fields (resourceType, id)
- Checks data types (strings, booleans, arrays)
- Validates code systems (gender, name.use, telecom.system, etc.)
- Validates array structures (identifier, name, telecom, address, qualification)
- Returns detailed error messages for debugging

### API Endpoint

```http
POST /fhir/validate/Practitioner
Content-Type: application/json
Authorization: Bearer {token}

{
  "resourceType": "Practitioner",
  "id": "example-123",
  "identifier": [
    {
      "system": "http://hl7.org/fhir/sid/us-npi",
      "value": "1234567890"
    }
  ],
  "name": [
    {
      "use": "official",
      "family": "Smith",
      "given": ["Jane"]
    }
  ],
  "gender": "female"
}
```

**Success Response** (200):
```json
{
  "message": "FHIR Practitioner resource is valid",
  "resource_id": "example-123"
}
```

**Error Response** (400):
```json
{
  "detail": {
    "message": "FHIR validation failed",
    "errors": [
      "gender must be one of: male, female, other, unknown",
      "telecom[0].system must be one of: phone, fax, email, pager, url, sms, other"
    ]
  }
}
```

### Automatic Validation

Profile updates automatically validate FHIR resources:

```python
# In PUT /api/practitioners/me
current_user.fhir_resource = practitioner_to_fhir(current_user)

# Validate FHIR resource
try:
    FHIRValidator.validate_and_raise(current_user.fhir_resource)
except Exception as e:
    raise HTTPException(status_code=400, detail=f"FHIR validation failed: {str(e)}")
```

### Usage Examples

**Python**:
```python
from app.fhir_validator import validate_fhir_practitioner, FHIRValidator

# Method 1: Get validation result
result = validate_fhir_practitioner(fhir_resource)
if result['valid']:
    print("Valid!")
else:
    print("Errors:", result['errors'])

# Method 2: Validate and raise exception
try:
    FHIRValidator.validate_and_raise(fhir_resource)
except FHIRValidationError as e:
    print(str(e))
```

---

## 2. Consent Management

### Purpose
Allows providers to explicitly authorize organizations to receive their data via webhooks.

### Database Schema

**Table**: `consents`

| Field | Type | Description |
|-------|------|-------------|
| id | String(36) | Primary key |
| practitioner_id | String(36) | Foreign key to practitioners |
| recipient_name | String(255) | Organization name |
| recipient_type | String(50) | payer, hospital, state_board, lab, etc. |
| recipient_id | String(100) | External organization ID |
| recipient_webhook_url | String(500) | Webhook URL to notify |
| status | String(50) | active, revoked, expired |
| scope | JSON | Array of scopes (e.g., ["Practitioner.read"]) |
| purpose | Text | Why consent was granted |
| granted_at | DateTime | When consent was created |
| expires_at | DateTime | Optional expiration date |
| revoked_at | DateTime | When consent was revoked |

### API Endpoints

#### List All Consents

```http
GET /auth/consents
Authorization: Bearer {token}
```

**Response**:
```json
[
  {
    "id": "consent_abc123",
    "practitioner_id": "prov_xyz789",
    "recipient_name": "Blue Cross Blue Shield MA",
    "recipient_type": "payer",
    "recipient_webhook_url": "https://webhook.bcbs.com/providercard",
    "status": "active",
    "scope": ["Practitioner.read", "PractitionerRole.read"],
    "purpose": "Include in provider directory",
    "granted_at": "2025-10-20T10:00:00Z",
    "expires_at": null,
    "revoked_at": null
  }
]
```

#### Create Consent

```http
POST /auth/consents
Content-Type: application/json
Authorization: Bearer {token}

{
  "recipient_name": "Blue Cross Blue Shield MA",
  "recipient_type": "payer",
  "recipient_id": "BCBS-MA-001",
  "recipient_webhook_url": "https://webhook.bcbs.com/providercard",
  "scope": ["Practitioner.read", "PractitionerRole.read"],
  "purpose": "Include in provider directory",
  "expires_at": "2026-12-31T23:59:59Z"
}
```

**Response** (201):
```json
{
  "id": "consent_abc123",
  "status": "active",
  "granted_at": "2025-10-20T10:00:00Z",
  ...
}
```

#### Update Consent

```http
PUT /auth/consents/{consent_id}
Content-Type: application/json
Authorization: Bearer {token}

{
  "recipient_webhook_url": "https://new-webhook.bcbs.com/providercard",
  "scope": ["Practitioner.read", "PractitionerRole.read", "Location.read"]
}
```

#### Revoke Consent

```http
POST /auth/consents/{consent_id}/revoke
Content-Type: application/json
Authorization: Bearer {token}

{
  "reason": "No longer participating in network"
}
```

#### Test Webhook

Send a test ping to verify webhook URL is reachable:

```http
POST /auth/consents/{consent_id}/test-webhook
Authorization: Bearer {token}
```

**Response**:
```json
{
  "success": true,
  "status_code": 200,
  "message": "Test webhook delivered successfully"
}
```

---

## 3. Webhook Notifications

### Purpose
Automatically notify consented organizations when provider data is updated.

### How It Works

1. Provider updates their profile
2. System regenerates FHIR resource
3. System validates FHIR resource
4. System finds all active consents with webhook URLs
5. System sends webhook POST requests to each URL
6. System logs delivery status

### Webhook Payload

```json
{
  "event": {
    "id": "evt_unique_id",
    "type": "provider.updated",
    "timestamp": "2025-10-20T15:30:00Z"
  },
  "consent": {
    "id": "consent_abc123",
    "recipient": "Blue Cross Blue Shield MA",
    "scope": ["Practitioner.read", "PractitionerRole.read"]
  },
  "practitioner": {
    "resourceType": "Practitioner",
    "id": "prac-abc123def456",
    "identifier": [
      {
        "system": "http://hl7.org/fhir/sid/us-npi",
        "value": "1234567890"
      }
    ],
    "name": [
      {
        "use": "official",
        "family": "Smith",
        "given": ["Jane"]
      }
    ],
    ...
  },
  "roles": [
    {
      "resourceType": "PractitionerRole",
      "id": "role-xyz789",
      "practitioner": {
        "reference": "Practitioner/prac-abc123def456"
      },
      "specialty": [...]
    }
  ]
}
```

### Webhook Headers

All webhooks include security and metadata headers:

```
Content-Type: application/json
X-ProviderCard-Signature: <HMAC-SHA256 signature>
X-ProviderCard-Timestamp: <Unix timestamp>
X-ProviderCard-Event: provider.updated
X-ProviderCard-Delivery: <delivery_id>
```

### Webhook Security

#### Signature Verification (Recipients)

Recipients should verify the signature to ensure authenticity:

```python
import hmac
import hashlib
import time

def verify_webhook(payload, signature, timestamp, secret):
    # Check timestamp freshness (prevent replay attacks)
    if abs(time.time() - int(timestamp)) > 300:  # 5 minutes
        return False

    # Verify HMAC signature
    expected = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(signature, expected)
```

**Example Request Handler** (Flask):
```python
from flask import Flask, request, jsonify

app = Flask(__name__)
SECRET = "your-webhook-secret"

@app.route('/webhook', methods=['POST'])
def handle_webhook():
    # Get headers
    signature = request.headers.get('X-ProviderCard-Signature')
    timestamp = request.headers.get('X-ProviderCard-Timestamp')

    # Get payload
    payload = request.get_data(as_text=True)

    # Verify signature
    if not verify_webhook(payload, signature, timestamp, SECRET):
        return jsonify({"error": "Invalid signature"}), 401

    # Process webhook
    data = request.json
    print(f"Received event: {data['event']['type']}")
    print(f"Provider NPI: {data['practitioner']['identifier'][0]['value']}")

    return jsonify({"status": "received"}), 200
```

### Webhook Delivery Tracking

View webhook delivery history:

```http
GET /auth/webhook-deliveries?limit=50
Authorization: Bearer {token}
```

**Response**:
```json
[
  {
    "id": "delivery_123",
    "webhook_url": "https://webhook.bcbs.com/providercard",
    "event_type": "provider.updated",
    "status": "delivered",
    "attempts": 1,
    "response_status": 200,
    "error_message": null,
    "created_at": "2025-10-20T15:30:00Z",
    "delivered_at": "2025-10-20T15:30:01Z"
  }
]
```

### Using ngrok for Testing

#### 1. Install ngrok

```bash
# macOS (Homebrew)
brew install ngrok

# Or download from https://ngrok.com/download
```

#### 2. Start ngrok tunnel

```bash
ngrok http 5000
```

This creates a public URL like: `https://abc123.ngrok.io`

#### 3. Create test webhook receiver

```python
from flask import Flask, request
import json

app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def receive_webhook():
    print("\n" + "="*60)
    print("WEBHOOK RECEIVED!")
    print("="*60)

    # Print headers
    print("\nHeaders:")
    for key, value in request.headers:
        if key.startswith('X-ProviderCard'):
            print(f"  {key}: {value}")

    # Print payload
    print("\nPayload:")
    data = request.json
    print(json.dumps(data, indent=2))

    return {"status": "received"}, 200

if __name__ == '__main__':
    app.run(port=5000)
```

#### 4. Create consent with ngrok URL

```bash
curl -X POST http://localhost:8000/auth/consents \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient_name": "Test Receiver",
    "recipient_type": "test",
    "recipient_webhook_url": "https://abc123.ngrok.io/webhook",
    "scope": ["Practitioner.read"],
    "purpose": "Testing webhooks"
  }'
```

#### 5. Update profile to trigger webhook

```bash
curl -X PUT http://localhost:8000/api/practitioners/me \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+1-555-NEW-PHONE"
  }'
```

You should see the webhook received in your Flask app!

---

## 4. Sample Data Seeding

### Purpose
Populate database with realistic sample provider profiles for testing and demonstration.

### Sample Providers

5 sample providers are included in `seed_data.json`:

| Name | Specialty | NPI | Email |
|------|-----------|-----|-------|
| Dr. Sarah Johnson | Internal Medicine | 1234567890 | dr.sarah.johnson@example.com |
| Dr. James Chen | Cardiovascular Disease | 2345678901 | dr.james.chen@example.com |
| Dr. Maria Garcia | General Practice | 3456789012 | dr.maria.garcia@example.com |
| Dr. Robert Williams | Surgery | 4567890123 | dr.robert.williams@example.com |
| Dr. Emily Patel | Pediatrics | 5678901234 | dr.emily.patel@example.com |

**All use password**: `Demo123!`

### Running the Seed Script

```bash
cd backend

# Ensure virtual environment is activated
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Run seeding script
python seed_db.py
```

**Output**:
```
Initializing database...
Loading seed data...

Seeding 5 providers...
  [1] Created: Sarah Johnson
      Email: dr.sarah.johnson@example.com
      NPI: 1234567890
      Specialty: Internal Medicine
      Completeness: 95%

  [2] Created: James Chen
      Email: dr.james.chen@example.com
      NPI: 2345678901
      Specialty: Cardiovascular Disease
      Completeness: 95%

  ...

✅ Database seeding completed successfully!

Total providers in database: 5

============================================================
SAMPLE LOGIN CREDENTIALS:
============================================================
Email: dr.sarah.johnson@example.com
Password: Demo123!
Name: Dr. Sarah Johnson
------------------------------------------------------------
...
```

### Customizing Seed Data

Edit `seed_data.json` to add more providers or modify existing ones:

```json
{
  "email": "dr.new.provider@example.com",
  "password": "YourPassword123!",
  "first_name": "New",
  "last_name": "Provider",
  "npi": "9876543210",
  "role": {
    "specialty_code": "207R00000X",
    "specialty_display": "Internal Medicine",
    "accepted_insurances": [
      {"name": "Medicare", "plan_type": null}
    ]
  }
}
```

Then run `python seed_db.py` again.

---

## API Summary

### New Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/fhir/validate/Practitioner` | POST | Validate FHIR Practitioner resource |
| `/auth/consents` | GET | List all consents |
| `/auth/consents` | POST | Create new consent |
| `/auth/consents/{id}` | GET | Get specific consent |
| `/auth/consents/{id}` | PUT | Update consent |
| `/auth/consents/{id}/revoke` | POST | Revoke consent |
| `/auth/consents/{id}/test-webhook` | POST | Test webhook delivery |
| `/auth/webhook-deliveries` | GET | List webhook delivery history |

### Database Changes

**New Tables**:
- `consents` - Authorization records for data sharing
- `webhook_deliveries` - Webhook delivery tracking

**Modified Tables**:
- `practitioners` - Added `consents` relationship

---

## Testing Checklist

- [ ] FHIR validation rejects invalid resources
- [ ] FHIR validation accepts valid resources
- [ ] Can create consent with webhook URL
- [ ] Can revoke consent
- [ ] Test webhook delivers successfully (use ngrok)
- [ ] Profile update triggers webhooks to active consents
- [ ] Webhook includes correct HMAC signature
- [ ] Webhook delivery failures are logged
- [ ] Sample data seeds successfully
- [ ] Can login with sample provider credentials

---

## Production Considerations

### Security
- [ ] Use environment-specific webhook secrets
- [ ] Implement rate limiting on webhook endpoints
- [ ] Add retry logic for failed webhooks
- [ ] Monitor webhook delivery failures
- [ ] Rotate webhook secrets periodically

### Performance
- [ ] Queue webhook deliveries for async processing
- [ ] Implement circuit breaker for failing endpoints
- [ ] Add webhook delivery batching
- [ ] Cache active consents

### Compliance
- [ ] Log all webhook deliveries for audit
- [ ] Implement consent expiration monitoring
- [ ] Add consent withdrawal notification
- [ ] Document webhook data retention policies

---

## Troubleshooting

### Webhooks Not Delivered

1. **Check consent status**:
   ```sql
   SELECT * FROM consents WHERE status = 'active' AND recipient_webhook_url IS NOT NULL;
   ```

2. **Check webhook delivery logs**:
   ```http
   GET /auth/webhook-deliveries
   ```

3. **Test webhook URL**:
   ```http
   POST /auth/consents/{id}/test-webhook
   ```

### FHIR Validation Failing

1. **Check validation errors**:
   ```http
   POST /fhir/validate/Practitioner
   ```

2. **Review FHIR resource structure**:
   ```http
   GET /fhir/Practitioner/{id}
   ```

3. **Common issues**:
   - Invalid gender code (must be: male, female, other, unknown)
   - Missing required fields (resourceType, id)
   - Invalid array structures (identifier, name, telecom)

### Seed Data Issues

1. **Duplicate email errors**: Clear database first
   ```bash
   rm providercard.db
   python seed_db.py
   ```

2. **Invalid NPI**: Ensure 10 digits in seed_data.json

---

**Last Updated**: October 20, 2025
**Version**: 0.2.0
