"""Pydantic schemas for request/response validation."""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# Authentication schemas
class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    email: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    npi: str = Field(..., min_length=10, max_length=10, pattern=r'^\d{10}$')


# Practitioner schemas
class PractitionerBase(BaseModel):
    npi: Optional[str] = None
    first_name: str
    middle_name: Optional[str] = None
    last_name: str
    suffix: Optional[str] = None
    gender: Optional[str] = None
    email: EmailStr
    phone: Optional[str] = None

    # Address
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None


class PractitionerCreate(PractitionerBase):
    password: str


class PractitionerUpdate(BaseModel):
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None
    suffix: Optional[str] = None
    phone: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    npi: Optional[str] = None


class PractitionerResponse(PractitionerBase):
    id: str
    fhir_id: str
    status: str
    completeness: int
    verified: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# PractitionerRole schemas
class AcceptedInsurance(BaseModel):
    name: str
    plan_type: Optional[str] = None


class PractitionerRoleBase(BaseModel):
    specialty_code: Optional[str] = None
    specialty_display: Optional[str] = None
    practice_name: Optional[str] = None
    practice_address_line1: Optional[str] = None
    practice_address_line2: Optional[str] = None
    practice_city: Optional[str] = None
    practice_state: Optional[str] = None
    practice_postal_code: Optional[str] = None
    license_state: Optional[str] = None
    license_number: Optional[str] = None
    license_expiration: Optional[datetime] = None
    accepted_insurances: Optional[List[AcceptedInsurance]] = None


class PractitionerRoleCreate(PractitionerRoleBase):
    pass


class PractitionerRoleUpdate(PractitionerRoleBase):
    pass


class PractitionerRoleResponse(PractitionerRoleBase):
    id: str
    fhir_id: str
    practitioner_id: str
    active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Sync schemas
class SyncRequest(BaseModel):
    target_systems: List[str] = Field(default=["payer", "state_board"])


class SyncLogResponse(BaseModel):
    id: str
    practitioner_id: str
    target_system: str
    target_url: Optional[str]
    sync_type: str
    event_type: str
    status: str
    response_status: Optional[int]
    error_message: Optional[str]
    duration_ms: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


# FHIR schemas (simplified)
class FHIRPractitioner(BaseModel):
    """FHIR R4 Practitioner resource (simplified)."""
    resourceType: str = "Practitioner"
    id: str
    identifier: List[Dict[str, Any]]
    active: bool = True
    name: List[Dict[str, Any]]
    telecom: Optional[List[Dict[str, Any]]] = None
    address: Optional[List[Dict[str, Any]]] = None
    gender: Optional[str] = None
    qualification: Optional[List[Dict[str, Any]]] = None


class FHIRPractitionerRole(BaseModel):
    """FHIR R4 PractitionerRole resource (simplified)."""
    resourceType: str = "PractitionerRole"
    id: str
    active: bool = True
    practitioner: Dict[str, str]
    specialty: Optional[List[Dict[str, Any]]] = None
    location: Optional[List[Dict[str, Any]]] = None
    telecom: Optional[List[Dict[str, Any]]] = None


# Consent schemas
class ConsentCreate(BaseModel):
    recipient_name: str
    recipient_type: str  # payer, hospital, state_board, lab, etc.
    recipient_id: Optional[str] = None
    recipient_webhook_url: Optional[str] = None
    scope: List[str] = ["Practitioner.read", "PractitionerRole.read"]
    purpose: Optional[str] = None
    expires_at: Optional[datetime] = None


class ConsentUpdate(BaseModel):
    recipient_webhook_url: Optional[str] = None
    scope: Optional[List[str]] = None
    purpose: Optional[str] = None
    expires_at: Optional[datetime] = None


class ConsentRevoke(BaseModel):
    reason: Optional[str] = None


class ConsentResponse(BaseModel):
    id: str
    practitioner_id: str
    recipient_name: str
    recipient_type: str
    recipient_id: Optional[str]
    recipient_webhook_url: Optional[str]
    status: str
    scope: Optional[List[str]]
    purpose: Optional[str]
    granted_at: datetime
    expires_at: Optional[datetime]
    revoked_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Webhook delivery schemas
class WebhookDeliveryResponse(BaseModel):
    id: str
    webhook_url: str
    event_type: str
    status: str
    attempts: int
    response_status: Optional[int]
    error_message: Optional[str]
    created_at: datetime
    delivered_at: Optional[datetime]

    class Config:
        from_attributes = True
