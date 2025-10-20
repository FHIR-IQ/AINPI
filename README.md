# ProviderCard - Unified Provider Identity Hub

A FHIR-backed POC web application for managing provider identities and synchronizing data with external healthcare systems (payers, state boards).

## Project Overview

ProviderCard addresses the challenge of healthcare providers maintaining profiles across multiple directories (payers, state medical boards, hospital systems) by providing:

- **Single Source of Truth**: One canonical provider profile
- **FHIR Compliance**: Standards-based data exchange (FHIR R4)
- **Automated Sync**: Push updates to external systems
- **Audit Trail**: Complete history of sync events

## Demo Features

✅ Provider registration and login
✅ Editable profile form (NPI, name, specialty, license, address, insurances)
✅ FHIR Practitioner and PractitionerRole resources
✅ Mock sync to two external systems (payer + state board)
✅ Audit log showing sync events with status and timestamps
✅ Profile completeness scoring
✅ SQLite database for data persistence

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                    │
│  - Provider login/registration                           │
│  - Profile editor                                        │
│  - Audit log viewer                                      │
└────────────────────┬────────────────────────────────────┘
                     │ REST API (JWT Auth)
                     │
┌────────────────────▼────────────────────────────────────┐
│               Backend (FastAPI)                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │  REST API Endpoints                                 ││
│  │  - /auth (login, register)                          ││
│  │  - /api/practitioners (CRUD)                        ││
│  │  - /api/practitioner-roles (CRUD)                   ││
│  │  - /api/sync (trigger sync)                         ││
│  │  - /api/sync-logs (audit log)                       ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  FHIR API Endpoints (R4)                            ││
│  │  - GET /fhir/Practitioner/{id}                      ││
│  │  - GET /fhir/PractitionerRole/{id}                  ││
│  │  - GET /fhir/PractitionerRole?practitioner={id}     ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  Sync Engine                                        ││
│  │  - Mock sync to payer API                           ││
│  │  - Mock sync to state board API                     ││
│  │  - Audit logging                                    ││
│  └─────────────────────────────────────────────────────┘│
└────────────────────┬────────────────────────────────────┘
                     │
                     │ SQLAlchemy ORM
                     ▼
             ┌───────────────┐
             │    SQLite     │
             │   Database    │
             └───────────────┘
```

## Tech Stack

### Backend
- **FastAPI** - Modern Python web framework
- **SQLAlchemy** - ORM for database
- **SQLite** - Lightweight database (for POC)
- **Pydantic** - Data validation
- **JWT** - Authentication
- **Python 3.9+**

### Frontend
- **Next.js 14** - React framework (App Router)
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Axios** - HTTP client
- **Lucide React** - Icons

## Quick Start

### Prerequisites

- Python 3.9+
- Node.js 18+
- npm or yarn

### 1. Clone Repository

```bash
git clone https://github.com/yourorg/providercard.git
cd AINPI
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and set SECRET_KEY

# Run server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend runs at: `http://localhost:8000`
API Docs (Swagger): `http://localhost:8000/docs`

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local if backend URL is different

# Run development server
npm run dev
```

Frontend runs at: `http://localhost:3000`

### 4. Try It Out

1. Open browser to `http://localhost:3000`
2. Register a new provider account (use any 10-digit NPI)
3. Fill out your profile information
4. Click "Sync to External Systems"
5. View sync results in the Audit Log

## API Documentation

### Authentication

**Register**
```http
POST /auth/register
Content-Type: application/json

{
  "email": "doctor@example.com",
  "password": "password123",
  "first_name": "Jane",
  "last_name": "Smith",
  "npi": "1234567890"
}
```

**Login**
```http
POST /auth/login
Content-Type: application/json

{
  "email": "doctor@example.com",
  "password": "password123"
}

Response:
{
  "access_token": "eyJhbGciOiJIUzI1...",
  "token_type": "bearer"
}
```

### Practitioner Endpoints

**Get Profile**
```http
GET /api/practitioners/me
Authorization: Bearer {token}
```

**Update Profile**
```http
PUT /api/practitioners/me
Authorization: Bearer {token}
Content-Type: application/json

{
  "phone": "+1-555-123-4567",
  "city": "Boston",
  "state": "MA"
}
```

### FHIR Endpoints

**Get FHIR Practitioner**
```http
GET /fhir/Practitioner/{fhir_id}
Authorization: Bearer {token}
```

**Search PractitionerRoles**
```http
GET /fhir/PractitionerRole?practitioner={fhir_id}
Authorization: Bearer {token}
```

### Sync Endpoints

**Trigger Sync**
```http
POST /api/sync
Authorization: Bearer {token}
Content-Type: application/json

{
  "target_systems": ["payer", "state_board"]
}
```

**Get Sync Logs**
```http
GET /api/sync-logs?limit=50
Authorization: Bearer {token}
```

## Database Schema

### practitioners
- id, fhir_id, npi, first_name, last_name, email, phone
- address_line1, address_line2, city, state, postal_code
- fhir_resource (JSON), status, completeness
- created_at, updated_at

### practitioner_roles
- id, fhir_id, practitioner_id
- specialty_code, specialty_display
- practice_name, practice_address...
- license_state, license_number, license_expiration
- accepted_insurances (JSON)
- fhir_resource (JSON), active

### sync_logs
- id, practitioner_id
- target_system, target_url, sync_type, event_type
- status, response_status, error_message
- request_payload (JSON), response_body
- duration_ms, created_at

## Deployment

### Backend - Render.com

1. Create account at [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: providercard-api
   - **Root Directory**: backend
   - **Environment**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add environment variables (from `.env.example`)
6. Click "Create Web Service"

Backend URL: `https://providercard-api.onrender.com`

### Frontend - Vercel

1. Create account at [vercel.com](https://vercel.com)
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. Configure:
   - **Root Directory**: frontend
   - **Framework Preset**: Next.js
5. Add environment variable:
   - `NEXT_PUBLIC_API_URL`: `https://providercard-api.onrender.com`
6. Click "Deploy"

Frontend URL: `https://providercard-poc.vercel.app`

## Development

### Project Structure

```
AINPI/
├── backend/              # FastAPI backend
│   ├── app/
│   │   ├── main.py       # FastAPI app and routes
│   │   ├── models.py     # SQLAlchemy models
│   │   ├── schemas.py    # Pydantic schemas
│   │   ├── database.py   # DB configuration
│   │   ├── auth.py       # JWT authentication
│   │   ├── fhir_utils.py # FHIR resource mapping
│   │   └── sync.py       # Sync engine
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── render.yaml
│   └── README.md
│
├── frontend/             # Next.js frontend
│   ├── src/
│   │   ├── app/          # Pages (App Router)
│   │   ├── components/   # React components
│   │   └── lib/          # API client
│   ├── package.json
│   ├── vercel.json
│   └── README.md
│
├── specs/                # Technical specifications
│   ├── PROJECT_SPEC.md   # Main spec (5000+ lines)
│   ├── modules/          # Module specs
│   ├── api/              # API documentation
│   └── data-models/      # Data models
│
├── SPECIFICATION_SUMMARY.md
└── README.md             # This file
```

### Running Tests

Backend:
```bash
cd backend
pytest
```

Frontend:
```bash
cd frontend
npm run lint
```

## Specifications

This project includes comprehensive technical specifications (5,255+ lines):

- **[PROJECT_SPEC.md](./specs/PROJECT_SPEC.md)** - Main project specification
- **[Module Specs](./specs/modules/)** - Detailed module documentation
  - Provider Profile
  - Sync Engine
  - Integrations (NPPES, CAQH, Payers)
  - Notifications
  - Analytics
- **[API Documentation](./specs/api/README.md)** - Complete API reference
- **[Data Models](./specs/data-models/README.md)** - Database schemas

See [SPECIFICATION_SUMMARY.md](./SPECIFICATION_SUMMARY.md) for an overview.

## Roadmap

### Current (POC)
- [x] Provider profile management
- [x] FHIR R4 resources
- [x] Mock sync to 2 systems
- [x] Audit logging
- [x] SQLite database

### Phase 1 (MVP)
- [ ] Real NPPES integration
- [ ] Document upload (licenses, certificates)
- [ ] Profile verification workflow
- [ ] PostgreSQL database
- [ ] Email notifications

### Phase 2
- [ ] CAQH ProView integration
- [ ] Multiple payer integrations
- [ ] Advanced conflict resolution
- [ ] Organization authorization management

### Phase 3
- [ ] Analytics dashboard
- [ ] Mobile app (React Native)
- [ ] HIPAA compliance certification

## Contributing

This is a proof-of-concept application for demonstration purposes.

For production deployment:
1. Replace SQLite with PostgreSQL
2. Implement real integrations (NPPES, CAQH, payers)
3. Add document upload and verification
4. Implement proper secrets management
5. Add comprehensive testing
6. Perform security audit
7. Obtain HIPAA compliance certification

## License

Proprietary - Copyright © 2025 fhiriq. All rights reserved.

## Support

For questions or issues:
- **Email**: dev@providercard.io
- **Documentation**: See `/specs` directory for detailed specifications
- **API Docs**: Visit `http://localhost:8000/docs` when backend is running

---

**Built with comprehensive specifications** - 5,255+ lines of technical documentation in `/specs`
