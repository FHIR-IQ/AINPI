"""SQLAlchemy ORM models for ProviderCard."""
from sqlalchemy import Column, String, Integer, DateTime, Boolean, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


class Practitioner(Base):
    """Provider/Practitioner table."""
    __tablename__ = "practitioners"

    id = Column(String(36), primary_key=True)
    fhir_id = Column(String(64), unique=True, nullable=False, index=True)

    # Core identifiers
    npi = Column(String(10), unique=True, index=True)
    dea_number = Column(String(9))
    tax_id = Column(String(20))

    # Personal info
    first_name = Column(String(100), nullable=False)
    middle_name = Column(String(100))
    last_name = Column(String(100), nullable=False)
    suffix = Column(String(50))
    gender = Column(String(20))

    # Contact
    email = Column(String(255), unique=True, nullable=False, index=True)
    phone = Column(String(30))
    password_hash = Column(String(255))

    # Address
    address_line1 = Column(String(255))
    address_line2 = Column(String(255))
    city = Column(String(100))
    state = Column(String(2))
    postal_code = Column(String(10))
    country = Column(String(2), default="US")

    # FHIR representation
    fhir_resource = Column(JSON, nullable=False)

    # Metadata
    status = Column(String(50), default="pending_verification")
    completeness = Column(Integer, default=0)
    verified = Column(Boolean, default=False)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    roles = relationship("PractitionerRole", back_populates="practitioner", cascade="all, delete-orphan")
    sync_logs = relationship("SyncLog", back_populates="practitioner", cascade="all, delete-orphan")
    consents = relationship("Consent", back_populates="practitioner", cascade="all, delete-orphan")


class PractitionerRole(Base):
    """Practitioner roles and specialties."""
    __tablename__ = "practitioner_roles"

    id = Column(String(36), primary_key=True)
    fhir_id = Column(String(64), unique=True, nullable=False)
    practitioner_id = Column(String(36), ForeignKey("practitioners.id"), nullable=False)

    # Role details
    specialty_code = Column(String(50))  # NUCC taxonomy code
    specialty_display = Column(String(255))

    # Practice location
    practice_name = Column(String(255))
    practice_address_line1 = Column(String(255))
    practice_address_line2 = Column(String(255))
    practice_city = Column(String(100))
    practice_state = Column(String(2))
    practice_postal_code = Column(String(10))

    # Accepted insurances (JSON array)
    accepted_insurances = Column(JSON)

    # License
    license_state = Column(String(2))
    license_number = Column(String(100))
    license_expiration = Column(DateTime)

    # FHIR representation
    fhir_resource = Column(JSON, nullable=False)

    # Status
    active = Column(Boolean, default=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    practitioner = relationship("Practitioner", back_populates="roles")


class SyncLog(Base):
    """Sync event audit log."""
    __tablename__ = "sync_logs"

    id = Column(String(36), primary_key=True)
    practitioner_id = Column(String(36), ForeignKey("practitioners.id"), nullable=False)

    # Sync details
    target_system = Column(String(100), nullable=False)  # payer, state_board, etc.
    target_url = Column(String(500))
    sync_type = Column(String(50), default="manual")  # manual, automatic, scheduled
    event_type = Column(String(100), default="provider.updated")

    # Status
    status = Column(String(50), default="pending")  # pending, success, failed

    # Request/Response
    request_payload = Column(JSON)
    response_status = Column(Integer)
    response_body = Column(Text)
    error_message = Column(Text)

    # Performance
    duration_ms = Column(Integer)

    # Timestamp
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    # Relationships
    practitioner = relationship("Practitioner", back_populates="sync_logs")


class Consent(Base):
    """Patient consent and authorization for data sharing."""
    __tablename__ = "consents"

    id = Column(String(36), primary_key=True)
    practitioner_id = Column(String(36), ForeignKey("practitioners.id"), nullable=False)

    # Recipient organization details
    recipient_name = Column(String(255), nullable=False)
    recipient_type = Column(String(50), nullable=False)  # payer, hospital, state_board, etc.
    recipient_id = Column(String(100))  # External organization ID
    recipient_webhook_url = Column(String(500))

    # Authorization details
    status = Column(String(50), default="active")  # active, revoked, expired
    scope = Column(JSON)  # Array of scopes: ["Practitioner.read", "PractitionerRole.read"]

    # Purpose
    purpose = Column(Text)  # Why the consent was granted

    # Dates
    granted_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime)  # Optional expiration
    revoked_at = Column(DateTime)

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    practitioner = relationship("Practitioner", back_populates="consents")


class WebhookDelivery(Base):
    """Webhook delivery tracking."""
    __tablename__ = "webhook_deliveries"

    id = Column(String(36), primary_key=True)
    consent_id = Column(String(36), ForeignKey("consents.id"))
    sync_log_id = Column(String(36), ForeignKey("sync_logs.id"))

    # Delivery details
    webhook_url = Column(String(500), nullable=False)
    event_type = Column(String(100), nullable=False)

    # Payload
    payload = Column(JSON, nullable=False)

    # Status
    status = Column(String(50), default="pending")  # pending, delivered, failed
    attempts = Column(Integer, default=0)

    # Response
    response_status = Column(Integer)
    response_body = Column(Text)
    error_message = Column(Text)

    # Timing
    created_at = Column(DateTime, default=datetime.utcnow)
    delivered_at = Column(DateTime)
    next_retry_at = Column(DateTime)
