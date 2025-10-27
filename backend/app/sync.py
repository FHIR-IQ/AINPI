"""Sync engine for sending provider updates to external systems."""
import httpx
import json
import time
import uuid
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from .models import Practitioner, SyncLog
from .fhir_utils import practitioner_to_fhir, practitioner_role_to_fhir
import os
from dotenv import load_dotenv

load_dotenv()

# Mock integration URLs
PAYER_API_URL = os.getenv("PAYER_API_URL", "https://mock-payer-api.example.com")
STATE_BOARD_API_URL = os.getenv("STATE_BOARD_API_URL", "https://mock-state-board.example.com")

# System configurations
SYNC_SYSTEMS = {
    "payer": {
        "name": "Blue Cross Blue Shield MA",
        "url": f"{PAYER_API_URL}/fhir/Practitioner",
        "method": "POST",
        "timeout": 30
    },
    "state_board": {
        "name": "Massachusetts Board of Registration in Medicine",
        "url": f"{STATE_BOARD_API_URL}/providers/update",
        "method": "POST",
        "timeout": 30
    }
}


async def sync_to_external_system(
    db: Session,
    practitioner: Practitioner,
    system_key: str
) -> SyncLog:
    """
    Sync practitioner data to an external system.
    Creates a mock sync since we don't have real endpoints.
    """
    system_config = SYNC_SYSTEMS.get(system_key)
    if not system_config:
        raise ValueError(f"Unknown system: {system_key}")

    # Create sync log entry
    sync_log = SyncLog(
        id=str(uuid.uuid4()),
        practitioner_id=practitioner.id,
        target_system=system_config["name"],
        target_url=system_config["url"],
        sync_type="manual",
        event_type="provider.updated",
        status="pending"
    )

    # Build FHIR payload
    fhir_practitioner = practitioner_to_fhir(practitioner)

    # Add roles if present
    if practitioner.roles:
        fhir_roles = [practitioner_role_to_fhir(role) for role in practitioner.roles]
        payload = {
            "practitioner": fhir_practitioner,
            "roles": fhir_roles
        }
    else:
        payload = {"practitioner": fhir_practitioner}

    sync_log.request_payload = payload

    start_time = time.time()

    try:
        # MOCK SYNC: Since we don't have real endpoints, simulate the call
        # In production, you would use:
        # async with httpx.AsyncClient() as client:
        #     response = await client.request(
        #         method=system_config["method"],
        #         url=system_config["url"],
        #         json=payload,
        #         timeout=system_config["timeout"]
        #     )

        # Simulate successful sync
        await simulate_sync_call(system_key, payload)

        # Mock successful response
        sync_log.status = "success"
        sync_log.response_status = 200
        sync_log.response_body = json.dumps({
            "status": "accepted",
            "message": f"Provider data synchronized successfully to {system_config['name']}",
            "provider_id": practitioner.fhir_id,
            "timestamp": time.time()
        })

    except Exception as e:
        # Handle errors
        sync_log.status = "failed"
        sync_log.error_message = str(e)
        sync_log.response_status = 500

    finally:
        # Calculate duration
        end_time = time.time()
        sync_log.duration_ms = int((end_time - start_time) * 1000)

        # Save sync log
        db.add(sync_log)
        db.commit()
        db.refresh(sync_log)

    return sync_log


async def simulate_sync_call(system_key: str, payload: Dict[str, Any]):
    """
    Simulate an external API call with realistic delay.
    In production, this would be replaced with actual httpx calls.
    """
    # Simulate network delay (200-800ms)
    import random
    import asyncio

    delay = random.uniform(0.2, 0.8)
    await asyncio.sleep(delay)

    # Simulate occasional failures (5% failure rate for demo purposes)
    if random.random() < 0.05:
        raise Exception(f"Connection timeout to {system_key}")

    # Success - no exception raised
    return True


async def trigger_sync(
    db: Session,
    practitioner: Practitioner,
    target_systems: List[str] = None
) -> List[SyncLog]:
    """
    Trigger sync to multiple external systems.

    Args:
        db: Database session
        practitioner: Practitioner to sync
        target_systems: List of system keys to sync to. Defaults to all systems.

    Returns:
        List of sync logs
    """
    if target_systems is None:
        target_systems = list(SYNC_SYSTEMS.keys())

    sync_logs = []

    for system_key in target_systems:
        if system_key in SYNC_SYSTEMS:
            sync_log = await sync_to_external_system(db, practitioner, system_key)
            sync_logs.append(sync_log)

    return sync_logs


def get_sync_logs(
    db: Session,
    practitioner_id: str,
    limit: int = 50
) -> List[SyncLog]:
    """Get sync logs for a practitioner."""
    return (
        db.query(SyncLog)
        .filter(SyncLog.practitioner_id == practitioner_id)
        .order_by(SyncLog.created_at.desc())
        .limit(limit)
        .all()
    )
