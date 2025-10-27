# ProviderCard - Unified Healthcare Provider Management Platform

> **Complete FHIR-compliant provider data management with real-time sync, credential management, and comprehensive forms**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/FHIR-IQ/AINPI&root-directory=frontend)

## 🎯 Overview

ProviderCard is the complete unified platform combining:
- ✅ **Full Provider Profile Forms** - Create new providers with NUCC autocomplete, multi-state licenses, practice locations, insurance plans
- ✅ **Demo Dashboard** - 5 mock integrations, NPPES comparison, FHIR export, time savings calculator
- ✅ **Profile Management** - View and update existing provider information
- ✅ **Audit Logging** - Complete sync history tracking
- ✅ **Authentication** - Secure login with JWT + Bcrypt
- ✅ **Database Integration** - Prisma ORM + Vercel Postgres

---

## ✨ All Features

### 1. Create New Providers (`/providers/new`)
Complete multi-section form with:
- **General Info**: NPI (validated 10 digits), Name, Email, Phone
- **Specialties**: NUCC autocomplete (900+ codes), primary designation
- **Licenses**: Multi-state tracking, add/remove rows, expiration dates
- **Practice Locations**: Multiple addresses, primary flag (exactly one required)
- **Insurance Plans**: Carrier dropdowns, plan names, LOB, network status
- **Real-time Validation**: Clear error messages, form-level validation
- **Database Save**: Persists to Postgres via Prisma

### 2. Demo Dashboard (`/demo`)
Interactive demonstration featuring:
- Provider info card with completeness tracking
- 5 connected organizations (BCBS MA, Medicare, Medicaid, MA Health Connector, State Medical Board)
- NPPES comparison with discrepancy detection
- FHIR R4 bundle export (download JSON)
- Time savings calculator (3-step interactive)
- Mock sync functionality

### 3. Profile Dashboard (`/dashboard`)
Current user profile management:
- Personal information display
- Specialty and credential tracking
- Practice location management
- Edit and update functionality

### 4. Audit Log (`/audit-log`)
Complete synchronization history:
- Target system tracking
- Sync status and timestamps
- Performance metrics (duration)
- Request/response logging

### 5. Authentication
- Registration with NPI validation
- Secure login (Bcrypt + JWT)
- Password hashing
- Token-based sessions
- Demo account: `demo@demo.com` / `demo`

---

## 🏗️ Tech Stack

- **Framework**: Next.js 14 (App Router, React 18)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database**: Vercel Postgres
- **ORM**: Prisma
- **Auth**: JWT + Bcrypt
- **Deployment**: Vercel (serverless)
- **Standards**: FHIR R4, NUCC Taxonomy

---

## 🚀 Quick Start

### Local Development

```bash
# Clone and navigate
git clone https://github.com/FHIR-IQ/AINPI.git
cd AINPI/frontend

# Install
npm install

# Setup environment
cp .env.local.example .env.local
# Edit .env.local with your Postgres URLs and JWT_SECRET

# Push schema
npx prisma db push

# Optional: Seed data
npm run db:seed

# Run
npm run dev

# Open http://localhost:3000
```

### Environment Variables

```env
POSTGRES_PRISMA_URL="postgresql://..."          # Connection pooling
POSTGRES_URL_NON_POOLING="postgresql://..."    # Direct connection
JWT_SECRET="your-secret-key"                    # JWT signing
NEXT_PUBLIC_NPPES_API_URL="https://..."        # Optional: NPPES API
```

---

## 📦 Deploy to Vercel

1. **Push to GitHub**
2. **Import on Vercel** (root: `frontend`)
3. **Add Storage** → Create Postgres database
4. **Set Environment Variables** → JWT_SECRET
5. **Deploy** → Vercel runs `prisma generate` automatically
6. **Done!** → Your app is live

---

## 📋 Complete Usage Guide

### Creating a Provider (Step-by-Step)

1. **Navigate**: Click "New Provider" in navbar or visit `/providers/new`

2. **General Info Tab**:
   - Enter NPI (must be 10 digits)
   - First Name, Last Name (required)
   - Email (must be unique)
   - Phone number

3. **Specialties Tab**:
   - Click in search box
   - Type specialty (e.g., "cardio")
   - Select from autocomplete results
   - Click "Set as Primary" for main specialty
   - Add multiple specialties as needed

4. **Licenses Tab**:
   - Click "Add License"
   - Select State from dropdown (all 50 states)
   - Enter License Number
   - Choose Type (MD, DO, NP, PA, etc.)
   - Select Status (Active, Inactive, etc.)
   - Set Expiration Date
   - Repeat for additional states

5. **Practice Locations Tab**:
   - Click "Add Location"
   - Enter Location Name (e.g., "Boston Medical Plaza")
   - Complete address (Line 1, Line 2, City, State, ZIP)
   - Enter phone number
   - Click "Set as Primary" for main location
   - One location MUST be primary
   - Add additional locations as needed

6. **Insurance Plans Tab**:
   - Click "Add Insurance Plan"
   - Select Carrier (Aetna, BCBS, Cigna, Medicare, etc.)
   - Choose Plan Name (dynamically populated based on carrier)
   - Select Line of Business (Commercial, Medicare, Medicaid, Exchange)
   - Choose Network Status (In-Network, Out-of-Network, Pending)
   - Toggle "Accepting New Patients"
   - Add multiple plans as needed

7. **Save**:
   - Click "Save Provider" at bottom
   - Form validates all fields
   - Shows errors if validation fails
   - Success message appears
   - Auto-redirect to dashboard

### Demo Dashboard Walkthrough

1. **View Provider Info**:
   - Profile completeness percentage
   - Quick stats (licenses, locations, specialties)
   - Last updated timestamp

2. **Connected Organizations**:
   - See all 5 integrated systems
   - Status indicators (connected/syncing)
   - Last sync timestamps

3. **Compare with NPPES**:
   - Click "Compare with NPPES Database"
   - View side-by-side comparison
   - Identify discrepancies
   - Update as needed

4. **Export FHIR Bundle**:
   - Click "Export FHIR Bundle"
   - Downloads JSON file
   - FHIR R4 compliant format
   - Includes all provider data

5. **Calculate Time Savings**:
   - Interactive 3-step calculator
   - Estimates hours saved per year
   - ROI calculation
   - Cost savings projection

### Authentication Flow

**Register**:
```
1. Visit /login
2. Click "Register"
3. Enter: NPI, First Name, Last Name, Email, Password
4. Submit → Account created
5. Auto-login and redirect
```

**Login**:
```
1. Visit /login (or any protected page redirects here)
2. Enter email and password
3. Submit → JWT token issued
4. Redirect to /dashboard
```

**Logout**:
```
1. Click "Logout" in navbar
2. Token cleared from localStorage
3. Redirect to /login
```

---

## 🗄️ Database Schema

### Practitioner Model

```prisma
model Practitioner {
  id                String    @id @default(uuid())
  fhirId            String    @unique
  npi               String?   @unique
  firstName         String
  lastName          String
  middleName        String?
  email             String    @unique
  phone             String?
  passwordHash      String?

  // Extended JSON fields
  specialties       Json?     // [{code, display, isPrimary}]
  licenses          Json?     // [{state, licenseNumber, type, status, expirationDate}]
  practiceLocations Json?     // [{name, addressLine1, city, state, zipCode, phone, isPrimary}]
  insurancePlans    Json?     // [{carrier, planName, lob, networkStatus, acceptingNewPatients}]

  active            Boolean   @default(true)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}
```

### Commands

```bash
npm run db:generate    # Generate Prisma Client
npm run db:push        # Push schema to database
npm run db:migrate     # Create migration
npm run db:studio      # Open Prisma Studio GUI
npm run db:seed        # Seed demo data
```

---

## 🔌 API Endpoints

### POST /api/providers
Create new provider with full form data.

**Request**:
```json
{
  "npi": "1234567890",
  "firstName": "Sarah",
  "lastName": "Johnson",
  "email": "sarah@example.com",
  "phone": "617-555-0100",
  "specialties": [
    {"code": "207RC0000X", "display": "Cardiovascular Disease", "isPrimary": true},
    {"code": "207R00000X", "display": "Internal Medicine", "isPrimary": false}
  ],
  "licenses": [
    {"state": "MA", "licenseNumber": "MD123456", "type": "MD", "status": "Active", "expirationDate": "2026-12-31"},
    {"state": "NH", "licenseNumber": "NH789012", "type": "MD", "status": "Active", "expirationDate": "2026-06-30"}
  ],
  "practiceLocations": [
    {
      "name": "Boston Medical Plaza",
      "addressLine1": "123 Medical Plaza",
      "addressLine2": "Suite 200",
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
    "id": "uuid",
    "npi": "1234567890",
    "name": {
      "firstName": "Sarah",
      "lastName": "Johnson"
    },
    "createdAt": "2025-10-27T..."
  }
}
```

### GET /api/providers
List all providers.

### POST /api/auth/login
Authenticate user.

### POST /api/auth/register
Create new account.

### GET /api/practitioners/me
Get current user profile.

---

## 🎨 Page Routes

| Route | Description | Auth Required |
|-------|-------------|---------------|
| `/` | Landing page | No |
| `/login` | Login/Register | No |
| `/dashboard` | Profile dashboard | Yes |
| `/providers/new` | Create provider | Yes |
| `/demo` | Demo dashboard | Yes |
| `/audit-log` | Sync history | Yes |

---

## ✅ Validation Rules

### General Info
- NPI: Required, must be exactly 10 digits
- First Name: Required, cannot be empty
- Last Name: Required, cannot be empty
- Email: Required, must be valid format, must be unique
- Phone: Optional

### Specialties
- At least 1 specialty required
- Exactly 1 must be marked as primary

### Licenses
- At least 1 license required
- State: Required (from dropdown)
- License Number: Required, non-empty
- Type: Required (from dropdown)
- Status: Required (from dropdown)
- Expiration Date: Required, valid date format

### Practice Locations
- At least 1 location required
- Exactly 1 must be marked as primary
- Name: Required
- Address Line 1: Required
- City: Required
- State: Required (from dropdown)
- ZIP Code: Required
- Phone: Required

### Insurance Plans
- Optional (can have 0 or more)
- If provided, Carrier and Plan Name are required

---

## 🧪 Testing Checklist

**Provider Creation Form:**
- [ ] Submit empty form → See validation errors
- [ ] Add 1 specialty → Save fails (need primary)
- [ ] Mark specialty as primary → Can proceed
- [ ] Add 2 licenses (MA, NH) → Both save correctly
- [ ] Add 2 locations → Save fails (need exactly 1 primary)
- [ ] Mark 1 location primary → Can proceed
- [ ] Add 3 insurance plans → All save with details
- [ ] Submit complete form → Success message → Redirect

**NUCC Autocomplete:**
- [ ] Type "card" → See cardiovascular options
- [ ] Type "internal" → See internal medicine options
- [ ] Select specialty → Adds to list with code
- [ ] Can remove specialty
- [ ] Can change primary designation

**Authentication:**
- [ ] Register with new NPI/email → Account created
- [ ] Login with valid credentials → JWT issued → Redirect
- [ ] Login with invalid credentials → Error message
- [ ] Access protected page without login → Redirect to /login
- [ ] Logout → Token cleared → Redirect to /login

**Demo Dashboard:**
- [ ] See provider info card
- [ ] All 5 organizations display
- [ ] NPPES comparison works
- [ ] FHIR export downloads JSON
- [ ] Time savings calculator functions

**Database:**
- [ ] Provider saves to Postgres
- [ ] Can query with Prisma Studio
- [ ] JSON fields parse correctly
- [ ] Relationships work (PractitionerRoles, SyncLogs)

---

## 🐛 Troubleshooting

**Build fails:**
```bash
rm -rf .next node_modules
npm install
npx prisma generate
npm run build
```

**Database connection issues:**
- Verify `POSTGRES_PRISMA_URL` is correct
- Check Vercel Postgres is active
- Run `npx prisma db push` to sync schema

**Authentication not working:**
- Check `JWT_SECRET` is set
- Verify token in localStorage (DevTools → Application)
- Try logout and login again

**Form validation errors:**
- Ensure all required fields filled
- Check exactly 1 primary specialty
- Check exactly 1 primary location
- Verify NPI is 10 digits

---

## 📊 Project Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── providers/new/         # Provider creation form
│   │   ├── dashboard/             # Profile dashboard
│   │   ├── demo/                  # Demo dashboard
│   │   ├── audit-log/             # Sync history
│   │   ├── login/                 # Auth pages
│   │   └── api/
│   │       ├── providers/         # Provider CRUD
│   │       ├── auth/              # Login/Register
│   │       ├── practitioners/     # Current user
│   │       └── demo/              # Demo endpoints
│   ├── components/
│   │   ├── forms/
│   │   │   ├── ProviderForm.tsx           # Main form wrapper
│   │   │   └── sections/
│   │   │       ├── GeneralInfoSection.tsx
│   │   │       ├── SpecialtiesSection.tsx (NUCC autocomplete)
│   │   │       ├── LicensesSection.tsx    (add/remove)
│   │   │       ├── PracticeLocationsSection.tsx (primary flag)
│   │   │       └── InsurancePlansSection.tsx (carrier/LOB)
│   │   └── Navbar.tsx             # Navigation
│   └── lib/
│       ├── prisma.ts              # Prisma client
│       ├── auth.ts                # JWT utils
│       └── nucc-taxonomy.ts       # Specialty codes
├── prisma/
│   ├── schema.prisma              # Database schema
│   └── seed.ts                    # Seed data
├── .env.local                     # Environment vars
└── package.json
```

---

## 🚀 Next Steps

**Immediate:**
1. Deploy to Vercel ✅
2. Test all functionality ✅
3. Share with stakeholders ✅

**Future Enhancements:**
- [ ] Real webhook integration
- [ ] License verification APIs
- [ ] Email notifications (expiring licenses)
- [ ] Bulk import/export
- [ ] Advanced search/filtering
- [ ] RBAC (role-based access)
- [ ] Multi-organization support
- [ ] Mobile app

---

## 🤝 Contributing

1. Fork repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

---

## 📄 License

MIT

---

## 🔗 Links

- **Live App**: https://ainpi.vercel.app
- **GitHub**: https://github.com/FHIR-IQ/AINPI
- **FHIR R4**: https://hl7.org/fhir/R4/
- **NUCC**: https://www.nucc.org/

---

**Built with ❤️ by the FHIR-IQ team using Next.js 14, Prisma, and FHIR R4 standards**
