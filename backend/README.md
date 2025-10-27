# ProviderCard Backend API

FastAPI backend for the ProviderCard FHIR-based provider management system.

## Features

- **FHIR R4 Compliant**: Practitioner and PractitionerRole resources
- **Authentication**: JWT-based authentication
- **Sync Engine**: Mock sync to external systems (payers, state boards)
- **Audit Logging**: Complete sync history
- **SQLite Database**: Lightweight for POC/demo

## Quick Start

### Prerequisites

- Python 3.9+
- pip

### Installation

```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### Configuration

```bash
# Copy example env file
cp .env.example .env

# Edit .env and update SECRET_KEY
nano .env
```

### Run Development Server

```bash
# Run with uvicorn
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API will be available at: `http://localhost:8000`

API Documentation (Swagger): `http://localhost:8000/docs`

## API Endpoints

### Authentication

- `POST /auth/register` - Register new provider
- `POST /auth/login` - Login and get JWT token

### Practitioner

- `GET /api/practitioners/me` - Get current practitioner profile
- `PUT /api/practitioners/me` - Update practitioner profile

### PractitionerRole

- `GET /api/practitioner-roles` - List all roles
- `POST /api/practitioner-roles` - Create new role
- `PUT /api/practitioner-roles/{id}` - Update role

### FHIR Endpoints

- `GET /fhir/Practitioner/{id}` - Get FHIR Practitioner resource
- `GET /fhir/PractitionerRole/{id}` - Get FHIR PractitionerRole resource
- `GET /fhir/PractitionerRole?practitioner={id}` - Search roles

### Sync

- `POST /api/sync` - Trigger sync to external systems
- `GET /api/sync-logs` - Get sync history

## Database Schema

The application uses SQLite with the following tables:

- **practitioners**: Provider core data
- **practitioner_roles**: Specialties, locations, licenses
- **sync_logs**: Sync event audit trail

## Deployment

### Render.com

1. Create new Web Service
2. Connect your GitHub repository
3. Configure:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Add environment variables from `.env.example`

### Docker (Optional)

```bash
# Build image
docker build -t providercard-api .

# Run container
docker run -p 8000:8000 -v $(pwd)/data:/app/data providercard-api
```

## Development

### Running Tests

```bash
pytest
```

### Code Formatting

```bash
black app/
```

### Type Checking

```bash
mypy app/
```

## License

Proprietary - Copyright © 2025 fhiriq
