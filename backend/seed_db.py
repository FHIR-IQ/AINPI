"""Database seeding script to populate with sample provider data."""
import json
import uuid
from datetime import datetime
from sqlalchemy.orm import Session
from app.database import SessionLocal, init_db
from app.models import Practitioner, PractitionerRole
from app.auth import get_password_hash
from app.fhir_utils import practitioner_to_fhir, practitioner_role_to_fhir


def load_seed_data():
    """Load seed data from JSON file."""
    with open('seed_data.json', 'r') as f:
        return json.load(f)


def calculate_completeness_score(practitioner, role):
    """Calculate profile completeness score."""
    score = 0

    # Core identifiers (25%)
    if practitioner.get('npi'):
        score += 15
    if practitioner.get('first_name') and practitioner.get('last_name'):
        score += 10

    # Contact info (15%)
    if practitioner.get('email'):
        score += 10
    if practitioner.get('phone'):
        score += 5

    # Address (15%)
    if (practitioner.get('address_line1') and
        practitioner.get('city') and
        practitioner.get('state')):
        score += 15

    # Role and specialty (45%)
    if role:
        score += 20  # Has role
        if role.get('specialty_code'):
            score += 10
        if role.get('license_number'):
            score += 10
        if role.get('accepted_insurances'):
            score += 5

    return min(score, 100)


def create_practitioner(db: Session, data: dict):
    """Create a practitioner and role from seed data."""
    practitioner_id = str(uuid.uuid4())
    fhir_id = f"prac-{uuid.uuid4().hex[:12]}"

    # Create practitioner
    practitioner_model = Practitioner(
        id=practitioner_id,
        fhir_id=fhir_id,
        email=data['email'],
        password_hash=get_password_hash(data['password']),
        first_name=data['first_name'],
        middle_name=data.get('middle_name'),
        last_name=data['last_name'],
        suffix=data.get('suffix'),
        gender=data.get('gender'),
        npi=data['npi'],
        dea_number=data.get('dea_number'),
        phone=data.get('phone'),
        address_line1=data.get('address_line1'),
        address_line2=data.get('address_line2'),
        city=data.get('city'),
        state=data.get('state'),
        postal_code=data.get('postal_code'),
        fhir_resource={},  # Will be generated below
        status="verified",  # Mark as verified for demo
        verified=True,
        completeness=0  # Will be calculated below
    )

    # Generate FHIR resource
    practitioner_model.fhir_resource = practitioner_to_fhir(practitioner_model)

    # Add to session
    db.add(practitioner_model)
    db.flush()  # Get the ID

    # Create role if provided
    role_model = None
    if 'role' in data:
        role_data = data['role']
        role_id = str(uuid.uuid4())
        role_fhir_id = f"role-{uuid.uuid4().hex[:12]}"

        # Parse license expiration
        license_exp = None
        if role_data.get('license_expiration'):
            try:
                license_exp = datetime.strptime(role_data['license_expiration'], '%Y-%m-%d')
            except ValueError:
                pass

        role_model = PractitionerRole(
            id=role_id,
            fhir_id=role_fhir_id,
            practitioner_id=practitioner_id,
            specialty_code=role_data.get('specialty_code'),
            specialty_display=role_data.get('specialty_display'),
            practice_name=role_data.get('practice_name'),
            practice_address_line1=role_data.get('practice_address_line1'),
            practice_address_line2=role_data.get('practice_address_line2'),
            practice_city=role_data.get('practice_city'),
            practice_state=role_data.get('practice_state'),
            practice_postal_code=role_data.get('practice_postal_code'),
            license_state=role_data.get('license_state'),
            license_number=role_data.get('license_number'),
            license_expiration=license_exp,
            accepted_insurances=role_data.get('accepted_insurances', []),
            fhir_resource={},
            active=True
        )

        # Set the practitioner relationship manually
        role_model.practitioner = practitioner_model

        # Generate FHIR resource for role
        role_model.fhir_resource = practitioner_role_to_fhir(role_model)

        db.add(role_model)

    # Calculate and update completeness
    practitioner_model.completeness = calculate_completeness_score(data, data.get('role'))

    db.commit()

    return practitioner_model, role_model


def seed_database():
    """Seed the database with sample providers."""
    print("Initializing database...")
    init_db()

    print("Loading seed data...")
    seed_data = load_seed_data()

    db = SessionLocal()

    try:
        print(f"\nSeeding {len(seed_data)} providers...")

        for idx, provider_data in enumerate(seed_data, 1):
            # Check if provider already exists
            existing = db.query(Practitioner).filter(
                Practitioner.email == provider_data['email']
            ).first()

            if existing:
                print(f"  [{idx}] Skipping {provider_data['email']} - already exists")
                continue

            practitioner, role = create_practitioner(db, provider_data)

            print(f"  [{idx}] Created: {practitioner.first_name} {practitioner.last_name}")
            print(f"      Email: {practitioner.email}")
            print(f"      NPI: {practitioner.npi}")
            print(f"      Specialty: {role.specialty_display if role else 'N/A'}")
            print(f"      Completeness: {practitioner.completeness}%")
            print()

        print("✅ Database seeding completed successfully!")
        print(f"\nTotal providers in database: {db.query(Practitioner).count()}")

        print("\n" + "="*60)
        print("SAMPLE LOGIN CREDENTIALS:")
        print("="*60)
        for provider_data in seed_data:
            print(f"Email: {provider_data['email']}")
            print(f"Password: {provider_data['password']}")
            print(f"Name: Dr. {provider_data['first_name']} {provider_data['last_name']}")
            print("-" * 60)

    except Exception as e:
        print(f"\n❌ Error seeding database: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
