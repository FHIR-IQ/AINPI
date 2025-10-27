"""Main FastAPI application."""
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
import uuid
from datetime import timedelta
import os
from dotenv import load_dotenv

from .database import get_db, init_db
from .models import Practitioner, PractitionerRole, SyncLog, Consent, WebhookDelivery
from .schemas import (
    Token,
    UserLogin,
    UserRegister,
    PractitionerResponse,
    PractitionerUpdate,
    PractitionerRoleCreate,
    PractitionerRoleUpdate,
    PractitionerRoleResponse,
    SyncRequest,
    SyncLogResponse,
    FHIRPractitioner,
    FHIRPractitionerRole,
    ConsentCreate,
    ConsentUpdate,
    ConsentRevoke,
    ConsentResponse,
    WebhookDeliveryResponse,
)
from .auth import (
    authenticate_user,
    create_access_token,
    get_current_user,
    get_password_hash,
    ACCESS_TOKEN_EXPIRE_MINUTES,
)
from .fhir_utils import practitioner_to_fhir, practitioner_role_to_fhir, create_fhir_bundle
from .fhir_validator import validate_fhir_practitioner, FHIRValidator
from .sync import trigger_sync, get_sync_logs
from .webhook_service import WebhookService, send_test_webhook
from .nppes_mock import get_mock_nppes_data, compare_provider_data, get_mock_integrations

load_dotenv()

# Create FastAPI app
app = FastAPI(
    title="ProviderCard API",
    description="FHIR-backed provider identity and information hub",
    version="0.1.0"
)

# CORS configuration
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Initialize database on startup
@app.on_event("startup")
def startup_event():
    """Initialize database tables on startup."""
    init_db()


# Health check
@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "providercard-api"}


# ============================================================================
# Authentication Endpoints
# ============================================================================

@app.post("/auth/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(user: UserRegister, db: Session = Depends(get_db)):
    """Register a new provider."""
    # Check if user already exists
    existing_user = db.query(Practitioner).filter(Practitioner.email == user.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Check if NPI already exists
    if user.npi:
        existing_npi = db.query(Practitioner).filter(Practitioner.npi == user.npi).first()
        if existing_npi:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="NPI already registered"
            )

    # Create practitioner
    practitioner_id = str(uuid.uuid4())
    fhir_id = f"prac-{uuid.uuid4().hex[:12]}"

    new_practitioner = Practitioner(
        id=practitioner_id,
        fhir_id=fhir_id,
        email=user.email,
        password_hash=get_password_hash(user.password),
        first_name=user.first_name,
        last_name=user.last_name,
        npi=user.npi,
        fhir_resource={},
        status="pending_verification",
        completeness=30
    )

    # Generate FHIR resource
    new_practitioner.fhir_resource = practitioner_to_fhir(new_practitioner)

    db.add(new_practitioner)
    db.commit()
    db.refresh(new_practitioner)

    # Create access token
    access_token = create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/auth/login", response_model=Token)
def login(user: UserLogin, db: Session = Depends(get_db)):
    """Login and get access token."""
    practitioner = authenticate_user(db, user.email, user.password)
    if not practitioner:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    return {"access_token": access_token, "token_type": "bearer"}


# ============================================================================
# Practitioner Endpoints
# ============================================================================

@app.get("/api/practitioners/me", response_model=PractitionerResponse)
def get_current_practitioner(current_user: Practitioner = Depends(get_current_user)):
    """Get current practitioner profile."""
    return current_user


@app.put("/api/practitioners/me", response_model=PractitionerResponse)
async def update_current_practitioner(
    update: PractitionerUpdate,
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update current practitioner profile."""
    # Update fields
    update_data = update.dict(exclude_unset=True)

    for field, value in update_data.items():
        setattr(current_user, field, value)

    # Regenerate FHIR resource
    current_user.fhir_resource = practitioner_to_fhir(current_user)

    # Validate FHIR resource
    try:
        FHIRValidator.validate_and_raise(current_user.fhir_resource)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"FHIR validation failed: {str(e)}"
        )

    # Update completeness score
    current_user.completeness = calculate_completeness(current_user)

    db.commit()
    db.refresh(current_user)

    # Trigger webhook notifications to consented recipients
    try:
        await WebhookService.notify_consented_recipients(
            db=db,
            practitioner=current_user,
            event_type="provider.updated"
        )
    except Exception as e:
        # Log error but don't fail the update
        print(f"Webhook notification failed: {str(e)}")

    return current_user


# ============================================================================
# PractitionerRole Endpoints
# ============================================================================

@app.get("/api/practitioner-roles", response_model=List[PractitionerRoleResponse])
def get_practitioner_roles(
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all roles for current practitioner."""
    return current_user.roles


@app.post("/api/practitioner-roles", response_model=PractitionerRoleResponse, status_code=status.HTTP_201_CREATED)
def create_practitioner_role(
    role: PractitionerRoleCreate,
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new practitioner role."""
    role_id = str(uuid.uuid4())
    fhir_id = f"role-{uuid.uuid4().hex[:12]}"

    # Convert accepted insurances to JSON-serializable format
    accepted_insurances = None
    if role.accepted_insurances:
        accepted_insurances = [ins.dict() for ins in role.accepted_insurances]

    new_role = PractitionerRole(
        id=role_id,
        fhir_id=fhir_id,
        practitioner_id=current_user.id,
        specialty_code=role.specialty_code,
        specialty_display=role.specialty_display,
        practice_name=role.practice_name,
        practice_address_line1=role.practice_address_line1,
        practice_address_line2=role.practice_address_line2,
        practice_city=role.practice_city,
        practice_state=role.practice_state,
        practice_postal_code=role.practice_postal_code,
        license_state=role.license_state,
        license_number=role.license_number,
        license_expiration=role.license_expiration,
        accepted_insurances=accepted_insurances,
        fhir_resource={},
        active=True
    )

    # Generate FHIR resource
    new_role.fhir_resource = practitioner_role_to_fhir(new_role)

    db.add(new_role)

    # Update practitioner completeness
    current_user.completeness = calculate_completeness(current_user)

    db.commit()
    db.refresh(new_role)

    return new_role


@app.put("/api/practitioner-roles/{role_id}", response_model=PractitionerRoleResponse)
def update_practitioner_role(
    role_id: str,
    role_update: PractitionerRoleUpdate,
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a practitioner role."""
    role = db.query(PractitionerRole).filter(
        PractitionerRole.id == role_id,
        PractitionerRole.practitioner_id == current_user.id
    ).first()

    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    # Update fields
    update_data = role_update.dict(exclude_unset=True)

    for field, value in update_data.items():
        if field == "accepted_insurances" and value is not None:
            # Convert to JSON-serializable format
            setattr(role, field, [ins.dict() for ins in value])
        else:
            setattr(role, field, value)

    # Regenerate FHIR resource
    role.fhir_resource = practitioner_role_to_fhir(role)

    db.commit()
    db.refresh(role)

    return role


# ============================================================================
# FHIR Endpoints
# ============================================================================

@app.get("/fhir/Practitioner/{fhir_id}", response_model=FHIRPractitioner)
def get_fhir_practitioner(fhir_id: str, db: Session = Depends(get_db)):
    """Get FHIR Practitioner resource by ID."""
    practitioner = db.query(Practitioner).filter(Practitioner.fhir_id == fhir_id).first()

    if not practitioner:
        raise HTTPException(status_code=404, detail="Practitioner not found")

    return practitioner.fhir_resource


@app.get("/fhir/PractitionerRole/{fhir_id}", response_model=FHIRPractitionerRole)
def get_fhir_practitioner_role(fhir_id: str, db: Session = Depends(get_db)):
    """Get FHIR PractitionerRole resource by ID."""
    role = db.query(PractitionerRole).filter(PractitionerRole.fhir_id == fhir_id).first()

    if not role:
        raise HTTPException(status_code=404, detail="PractitionerRole not found")

    return role.fhir_resource


@app.get("/fhir/PractitionerRole")
def search_practitioner_roles(
    practitioner: str = None,
    db: Session = Depends(get_db)
):
    """Search PractitionerRole resources."""
    query = db.query(PractitionerRole)

    if practitioner:
        # Search by practitioner FHIR ID
        prac = db.query(Practitioner).filter(Practitioner.fhir_id == practitioner).first()
        if prac:
            query = query.filter(PractitionerRole.practitioner_id == prac.id)

    roles = query.all()
    fhir_roles = [role.fhir_resource for role in roles]

    return create_fhir_bundle(fhir_roles)


# ============================================================================
# Sync Endpoints
# ============================================================================

@app.post("/api/sync", response_model=List[SyncLogResponse])
async def sync_provider(
    sync_request: SyncRequest,
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Trigger sync to external systems."""
    sync_logs = await trigger_sync(db, current_user, sync_request.target_systems)
    return sync_logs


@app.get("/api/sync-logs", response_model=List[SyncLogResponse])
def get_sync_history(
    limit: int = 50,
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get sync history for current practitioner."""
    logs = get_sync_logs(db, current_user.id, limit)
    return logs


# ============================================================================
# Consent Management Endpoints
# ============================================================================

@app.get("/auth/consents", response_model=List[ConsentResponse])
def list_consents(
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all consents for current practitioner."""
    consents = db.query(Consent).filter(Consent.practitioner_id == current_user.id).all()
    return consents


@app.post("/auth/consents", response_model=ConsentResponse, status_code=status.HTTP_201_CREATED)
def create_consent(
    consent: ConsentCreate,
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new consent for data sharing."""
    consent_id = str(uuid.uuid4())

    new_consent = Consent(
        id=consent_id,
        practitioner_id=current_user.id,
        recipient_name=consent.recipient_name,
        recipient_type=consent.recipient_type,
        recipient_id=consent.recipient_id,
        recipient_webhook_url=consent.recipient_webhook_url,
        scope=consent.scope,
        purpose=consent.purpose,
        expires_at=consent.expires_at,
        status="active"
    )

    db.add(new_consent)
    db.commit()
    db.refresh(new_consent)

    return new_consent


@app.get("/auth/consents/{consent_id}", response_model=ConsentResponse)
def get_consent(
    consent_id: str,
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific consent."""
    consent = db.query(Consent).filter(
        Consent.id == consent_id,
        Consent.practitioner_id == current_user.id
    ).first()

    if not consent:
        raise HTTPException(status_code=404, detail="Consent not found")

    return consent


@app.put("/auth/consents/{consent_id}", response_model=ConsentResponse)
def update_consent(
    consent_id: str,
    consent_update: ConsentUpdate,
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a consent."""
    consent = db.query(Consent).filter(
        Consent.id == consent_id,
        Consent.practitioner_id == current_user.id
    ).first()

    if not consent:
        raise HTTPException(status_code=404, detail="Consent not found")

    # Update fields
    update_data = consent_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(consent, field, value)

    db.commit()
    db.refresh(consent)

    return consent


@app.post("/auth/consents/{consent_id}/revoke", response_model=ConsentResponse)
def revoke_consent(
    consent_id: str,
    revoke_data: ConsentRevoke,
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke a consent."""
    from datetime import datetime

    consent = db.query(Consent).filter(
        Consent.id == consent_id,
        Consent.practitioner_id == current_user.id
    ).first()

    if not consent:
        raise HTTPException(status_code=404, detail="Consent not found")

    if consent.status == "revoked":
        raise HTTPException(status_code=400, detail="Consent already revoked")

    consent.status = "revoked"
    consent.revoked_at = datetime.utcnow()

    db.commit()
    db.refresh(consent)

    return consent


@app.post("/auth/consents/{consent_id}/test-webhook")
async def test_consent_webhook(
    consent_id: str,
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Test webhook delivery for a consent."""
    consent = db.query(Consent).filter(
        Consent.id == consent_id,
        Consent.practitioner_id == current_user.id
    ).first()

    if not consent:
        raise HTTPException(status_code=404, detail="Consent not found")

    if not consent.recipient_webhook_url:
        raise HTTPException(status_code=400, detail="No webhook URL configured")

    result = await send_test_webhook(consent.recipient_webhook_url)
    return result


@app.get("/auth/webhook-deliveries", response_model=List[WebhookDeliveryResponse])
def list_webhook_deliveries(
    limit: int = 50,
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List webhook deliveries for current practitioner's consents."""
    # Get consent IDs for this practitioner
    consent_ids = [c.id for c in current_user.consents]

    deliveries = (
        db.query(WebhookDelivery)
        .filter(WebhookDelivery.consent_id.in_(consent_ids))
        .order_by(WebhookDelivery.created_at.desc())
        .limit(limit)
        .all()
    )

    return deliveries


# ============================================================================
# FHIR Validation Endpoint
# ============================================================================

@app.post("/fhir/validate/Practitioner")
def validate_practitioner_resource(resource: FHIRPractitioner):
    """Validate a FHIR Practitioner resource."""
    result = validate_fhir_practitioner(resource.dict())

    if not result["valid"]:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "FHIR validation failed",
                "errors": result["errors"]
            }
        )

    return {
        "message": "FHIR Practitioner resource is valid",
        "resource_id": result["resource_id"]
    }


# ============================================================================
# Helper Functions
# ============================================================================

def calculate_completeness(practitioner: Practitioner) -> int:
    """Calculate profile completeness percentage."""
    score = 0

    # Core identifiers (25%)
    if practitioner.npi:
        score += 15
    if practitioner.first_name and practitioner.last_name:
        score += 10

    # Contact info (15%)
    if practitioner.email:
        score += 10
    if practitioner.phone:
        score += 5

    # Address (15%)
    if practitioner.address_line1 and practitioner.city and practitioner.state:
        score += 15

    # Roles and specialties (45%)
    if practitioner.roles:
        score += 20
        # Check for specialty
        if any(role.specialty_code for role in practitioner.roles):
            score += 10
        # Check for license
        if any(role.license_number for role in practitioner.roles):
            score += 10
        # Check for insurances
        if any(role.accepted_insurances for role in practitioner.roles):
            score += 5

    return min(score, 100)


# ============================================================================
# Demo Dashboard Endpoints
# ============================================================================

@app.get("/api/demo/integrations")
def get_integrations(
    current_user: Practitioner = Depends(get_current_user)
):
    """Get list of connected organizations/integrations."""
    return get_mock_integrations(current_user.id)


@app.get("/api/demo/nppes-comparison")
def compare_with_nppes(
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Compare ProviderCard data with NPPES mock data."""
    if not current_user.npi:
        raise HTTPException(
            status_code=400,
            detail="NPI is required to compare with NPPES"
        )

    # Get mock NPPES data
    nppes_data = get_mock_nppes_data(current_user.npi)
    if not nppes_data:
        raise HTTPException(
            status_code=404,
            detail="No NPPES data found for this NPI"
        )

    # Get current ProviderCard FHIR data
    providercard_data = current_user.fhir_resource

    # Compare the two datasets
    comparison_result = compare_provider_data(nppes_data, providercard_data)

    return comparison_result


@app.get("/api/demo/export-fhir-bundle")
def export_fhir_bundle(
    current_user: Practitioner = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Export complete FHIR bundle with Practitioner and all PractitionerRoles."""
    # Get all roles for this practitioner
    roles = db.query(PractitionerRole).filter(
        PractitionerRole.practitioner_id == current_user.id
    ).all()

    # Create FHIR bundle
    entries = []

    # Add Practitioner resource
    entries.append({
        "fullUrl": f"urn:uuid:{current_user.fhir_id}",
        "resource": current_user.fhir_resource,
        "request": {
            "method": "PUT",
            "url": f"Practitioner/{current_user.fhir_id}"
        }
    })

    # Add PractitionerRole resources
    for role in roles:
        role_resource = practitioner_role_to_fhir(role)
        entries.append({
            "fullUrl": f"urn:uuid:{role.fhir_id}",
            "resource": role_resource,
            "request": {
                "method": "PUT",
                "url": f"PractitionerRole/{role.fhir_id}"
            }
        })

    # Create bundle
    bundle = create_fhir_bundle(entries)

    return bundle
