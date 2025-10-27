# ProviderCard v2 Web Application

A Next.js 14 web application for managing healthcare provider profiles with FHIR R4 compliance, featuring dynamic forms, NUCC taxonomy autocomplete, and real-time webhook synchronization.

## Features

### Provider Profile Management
- **General Information**: NPI, name, contact details
- **Specialties with NUCC Autocomplete**: Intelligent search of 900+ NUCC taxonomy codes
- **Multi-State Licensing**: Add/remove licenses with expiration tracking
- **Practice Locations**: Multiple addresses with primary location designation
- **Insurance Plans**: Carrier, plan name, line of business, and network status

### Dynamic Form Sections
- **Add/Remove Rows**: Dynamically manage licenses, locations, and insurance plans
- **Primary Flags**: Designate primary specialty and location
- **Real-time Validation**: Comprehensive form validation with clear error messages
- **Tabbed Interface**: Easy navigation between form sections

### Dashboard & Sync
- **Connected Systems**: Monitor status of subscriber systems
- **Sync Now Button**: Manually trigger synchronization
- **Webhook Deliveries**: View recent webhook delivery logs with payloads
- **Status Monitoring**: Real-time status indicators and timestamps

## Tech Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Runtime**: React 18

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run development server**:
   ```bash
   npm run dev
   ```

3. **Open in browser**:
   ```
   http://localhost:3000
   ```

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
web-app/
├── app/
│   ├── layout.tsx                 # Root layout with navigation
│   ├── page.tsx                   # Home page
│   ├── dashboard/
│   │   └── page.tsx               # System dashboard with sync status
│   ├── providers/
│   │   └── new/
│   │       └── page.tsx           # Create provider page
│   └── api/
│       └── providers/
│           └── route.ts           # Provider API endpoint
├── components/
│   └── forms/
│       ├── ProviderForm.tsx       # Main form component
│       └── sections/
│           ├── GeneralInfoSection.tsx
│           ├── SpecialtiesSection.tsx
│           ├── LicensesSection.tsx
│           ├── PracticeLocationsSection.tsx
│           └── InsurancePlansSection.tsx
└── lib/
    └── nucc-taxonomy.ts           # NUCC taxonomy data and search
```

## Usage

### Creating a Provider Profile

1. **Navigate to "New Provider"** from the navigation bar
2. **Fill in General Info**: NPI, name, contact details
3. **Add Specialties**:
   - Type to search (e.g., "cardio")
   - Select from autocomplete dropdown
   - Mark one as primary
4. **Add Licenses**:
   - Click "Add License"
   - Fill in state, number, type, status, expiration
   - Add multiple licenses as needed
5. **Add Practice Locations**:
   - Click "Add Location"
   - Fill in name, address, city, state, ZIP, phone
   - Mark one as primary
6. **Add Insurance Plans**:
   - Click "Add Insurance Plan"
   - Select carrier, plan name, line of business
   - Set network status and accepting new patients flag
7. **Save**: Click "Save Provider" - validation runs automatically

### Dashboard

1. **Navigate to "Dashboard"** from the navigation bar
2. **View connected systems** with status indicators
3. **Click "Sync Now"** to trigger manual synchronization
4. **View webhook deliveries** with timestamps and response codes
5. **Expand payloads** to see FHIR-compliant JSON data

## API Endpoints

### POST /api/providers

Create or update a provider profile.

**Request Body**:
```json
{
  "npi": "1234567890",
  "firstName": "Sarah",
  "lastName": "Johnson",
  "email": "sarah.johnson@example.com",
  "phone": "617-555-0100",
  "specialties": [
    {
      "code": "207RC0000X",
      "display": "Cardiovascular Disease",
      "isPrimary": true
    }
  ],
  "licenses": [
    {
      "state": "MA",
      "licenseNumber": "MD123456",
      "type": "MD",
      "status": "Active",
      "expirationDate": "2026-12-31"
    }
  ],
  "practiceLocations": [
    {
      "name": "Boston Medical Plaza",
      "addressLine1": "123 Medical Plaza",
      "city": "Boston",
      "state": "MA",
      "zipCode": "02101",
      "phone": "617-555-0100",
      "isPrimary": true
    }
  ],
  "insurancePlans": [
    {
      "carrier": "Aetna",
      "planName": "Aetna PPO",
      "lob": "Commercial",
      "networkStatus": "In-Network",
      "acceptingNewPatients": true
    }
  ]
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Provider saved successfully",
  "data": {
    "id": "provider-1234567890",
    "npi": "1234567890",
    "name": {
      "firstName": "Sarah",
      "lastName": "Johnson"
    },
    "createdAt": "2025-10-24T16:30:45Z"
  }
}
```

**Response** (400 Bad Request):
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    "First name is required",
    "One location must be marked as primary"
  ]
}
```

## Validation Rules

### General Info
- ✓ First name required
- ✓ Last name required
- ✓ NPI required (must be 10 digits)
- ✓ Email required (valid format)

### Specialties
- ✓ At least one specialty required
- ✓ Exactly one specialty must be primary

### Licenses
- ✓ At least one license required
- ✓ State, number, type, status, expiration required for each

### Practice Locations
- ✓ At least one location required
- ✓ Exactly one location must be primary
- ✓ Name, address, city, state, ZIP, phone required for each

### Insurance Plans
- ✓ Optional, but if provided must have carrier and plan name

## Demo Data

Sample data for testing is available in `/demo-data/`:
- `demo-provider.json` - Complete provider profile
- `webhook-logs.json` - Mock webhook delivery logs
- `DEMO-SCRIPT.md` - 3-minute demo presentation script
- `DEMO-WALKTHROUGH.md` - Detailed presenter guide

## Key Features Demo

### NUCC Autocomplete
Type "cardio" in the specialty search to see:
- Cardiovascular Disease (207RC0000X)
- Cardiology specializations
- Related internal medicine subspecialties

### Multi-State Licensing
Add licenses for multiple jurisdictions:
- Massachusetts: MD123456
- New Hampshire: NH789012
- Connecticut: CT345678

### Primary Location
Only one location can be primary:
- Setting a new primary automatically unsets the previous one
- Validation ensures at least one primary location exists

### Insurance Plan Management
Track carrier relationships:
- Commercial plans (Aetna, BCBS, Cigna)
- Medicare/Medicaid acceptance
- Panel status (accepting new patients or full)

## Development

### Run Development Server
```bash
npm run dev
```

### Build
```bash
npm run build
```

### Lint
```bash
npm run lint
```

### Type Check
```bash
npx tsc --noEmit
```

## Environment Variables

No environment variables required for basic functionality. For production deployment with real FHIR server integration, add:

```env
NEXT_PUBLIC_FHIR_SERVER_URL=https://your-fhir-server.com
WEBHOOK_SECRET=your-webhook-secret
```

## Deployment

### Vercel (Recommended)
```bash
npm install -g vercel
vercel
```

### Docker
```bash
docker build -t providercard-v2 .
docker run -p 3000:3000 providercard-v2
```

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari 14+

## License

MIT

## Related Projects

- [ProviderCard-v2 Core](../) - FHIR models and modules
- [FHIR R4 Specification](https://hl7.org/fhir/R4/)
- [NUCC Provider Taxonomy](https://www.nucc.org/)

## Support

For issues or questions:
1. Check [DEMO-WALKTHROUGH.md](../demo-data/DEMO-WALKTHROUGH.md)
2. Review [API documentation](#api-endpoints)
3. Open an issue on GitHub
