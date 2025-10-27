"""Webhook notification service with ngrok support."""
import httpx
import json
import uuid
import hmac
import hashlib
import time
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from .models import Consent, WebhookDelivery, Practitioner
from .fhir_utils import practitioner_to_fhir, practitioner_role_to_fhir
import logging

logger = logging.getLogger(__name__)


class WebhookService:
    """Service for delivering webhook notifications."""

    @staticmethod
    def generate_signature(payload: str, secret: str = "default-secret") -> str:
        """
        Generate HMAC signature for webhook payload.

        Args:
            payload: JSON string of the payload
            secret: Secret key for HMAC

        Returns:
            Hex digest of the signature
        """
        return hmac.new(
            secret.encode(),
            payload.encode(),
            hashlib.sha256
        ).hexdigest()

    @staticmethod
    async def deliver_webhook(
        db: Session,
        webhook_url: str,
        event_type: str,
        payload: Dict[str, Any],
        consent_id: Optional[str] = None,
        sync_log_id: Optional[str] = None
    ) -> WebhookDelivery:
        """
        Deliver a webhook notification.

        Args:
            db: Database session
            webhook_url: URL to send webhook to
            event_type: Type of event (e.g., 'provider.updated')
            payload: Webhook payload
            consent_id: Optional consent ID
            sync_log_id: Optional sync log ID

        Returns:
            WebhookDelivery record
        """
        delivery_id = str(uuid.uuid4())

        # Create delivery record
        delivery = WebhookDelivery(
            id=delivery_id,
            consent_id=consent_id,
            sync_log_id=sync_log_id,
            webhook_url=webhook_url,
            event_type=event_type,
            payload=payload,
            status="pending",
            attempts=0
        )

        db.add(delivery)
        db.commit()

        # Attempt delivery
        try:
            # Prepare payload with signature
            payload_str = json.dumps(payload)
            signature = WebhookService.generate_signature(payload_str)
            timestamp = int(time.time())

            headers = {
                "Content-Type": "application/json",
                "X-ProviderCard-Signature": signature,
                "X-ProviderCard-Timestamp": str(timestamp),
                "X-ProviderCard-Event": event_type,
                "X-ProviderCard-Delivery": delivery_id,
            }

            # Send webhook
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    webhook_url,
                    json=payload,
                    headers=headers
                )

                # Update delivery record
                delivery.attempts += 1
                delivery.status = "delivered" if response.status_code < 400 else "failed"
                delivery.response_status = response.status_code
                delivery.response_body = response.text[:1000]  # Limit size
                delivery.delivered_at = datetime.utcnow()

                logger.info(
                    f"Webhook delivered to {webhook_url}: "
                    f"status={response.status_code}, event={event_type}"
                )

        except Exception as e:
            # Handle errors
            delivery.attempts += 1
            delivery.status = "failed"
            delivery.error_message = str(e)[:500]

            logger.error(f"Webhook delivery failed to {webhook_url}: {str(e)}")

        db.commit()
        db.refresh(delivery)

        return delivery

    @staticmethod
    async def notify_consented_recipients(
        db: Session,
        practitioner: Practitioner,
        event_type: str = "provider.updated"
    ) -> List[WebhookDelivery]:
        """
        Notify all consented recipients about provider updates.

        Args:
            db: Database session
            practitioner: Practitioner who was updated
            event_type: Type of event

        Returns:
            List of webhook deliveries
        """
        deliveries = []

        # Get active consents with webhook URLs
        consents = (
            db.query(Consent)
            .filter(
                Consent.practitioner_id == practitioner.id,
                Consent.status == "active",
                Consent.recipient_webhook_url.isnot(None)
            )
            .all()
        )

        logger.info(f"Found {len(consents)} active consents with webhooks for practitioner {practitioner.id}")

        # Prepare FHIR payload
        fhir_practitioner = practitioner_to_fhir(practitioner)

        # Add roles if present
        if practitioner.roles:
            fhir_roles = [practitioner_role_to_fhir(role) for role in practitioner.roles]
        else:
            fhir_roles = []

        for consent in consents:
            # Build payload
            payload = {
                "event": {
                    "id": str(uuid.uuid4()),
                    "type": event_type,
                    "timestamp": datetime.utcnow().isoformat(),
                },
                "consent": {
                    "id": consent.id,
                    "recipient": consent.recipient_name,
                    "scope": consent.scope or [],
                },
                "practitioner": fhir_practitioner,
                "roles": fhir_roles,
            }

            # Deliver webhook
            try:
                delivery = await WebhookService.deliver_webhook(
                    db=db,
                    webhook_url=consent.recipient_webhook_url,
                    event_type=event_type,
                    payload=payload,
                    consent_id=consent.id
                )
                deliveries.append(delivery)
            except Exception as e:
                logger.error(
                    f"Failed to deliver webhook to {consent.recipient_name}: {str(e)}"
                )

        return deliveries

    @staticmethod
    def verify_webhook_signature(
        payload: str,
        signature: str,
        timestamp: str,
        secret: str = "default-secret",
        tolerance: int = 300  # 5 minutes
    ) -> bool:
        """
        Verify webhook signature (for receivers to use).

        Args:
            payload: JSON string of payload
            signature: Signature from header
            timestamp: Timestamp from header
            secret: Secret key
            tolerance: Max age in seconds

        Returns:
            True if valid
        """
        # Check timestamp freshness
        try:
            ts = int(timestamp)
            now = int(time.time())
            if abs(now - ts) > tolerance:
                return False
        except (ValueError, TypeError):
            return False

        # Verify signature
        expected_signature = WebhookService.generate_signature(payload, secret)
        return hmac.compare_digest(signature, expected_signature)


async def send_test_webhook(webhook_url: str) -> Dict[str, Any]:
    """
    Send a test webhook to verify URL is reachable.

    Args:
        webhook_url: URL to test

    Returns:
        Dict with status and message
    """
    test_payload = {
        "event": {
            "id": str(uuid.uuid4()),
            "type": "test.ping",
            "timestamp": datetime.utcnow().isoformat(),
        },
        "message": "This is a test webhook from ProviderCard",
    }

    payload_str = json.dumps(test_payload)
    signature = WebhookService.generate_signature(payload_str)
    timestamp = int(time.time())

    headers = {
        "Content-Type": "application/json",
        "X-ProviderCard-Signature": signature,
        "X-ProviderCard-Timestamp": str(timestamp),
        "X-ProviderCard-Event": "test.ping",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                webhook_url,
                json=test_payload,
                headers=headers
            )

            return {
                "success": response.status_code < 400,
                "status_code": response.status_code,
                "message": f"Test webhook delivered successfully" if response.status_code < 400 else f"Webhook returned {response.status_code}",
            }
    except httpx.TimeoutException:
        return {
            "success": False,
            "status_code": None,
            "message": "Webhook delivery timed out (10s)",
        }
    except httpx.ConnectError:
        return {
            "success": False,
            "status_code": None,
            "message": "Could not connect to webhook URL",
        }
    except Exception as e:
        return {
            "success": False,
            "status_code": None,
            "message": f"Error: {str(e)}",
        }
