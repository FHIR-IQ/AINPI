# Database Setup Guide - Vercel Postgres + Prisma

This guide walks you through setting up a real Postgres database for ProviderCard using Vercel Postgres and Prisma ORM.

## Overview

**What Changed:**
- ❌ Mock data in memory → ✅ Real Postgres database
- ❌ No persistence → ✅ Data persists across sessions  
- ❌ Shared demo data → ✅ Per-user accounts and data
- ✅ Still 100% serverless on Vercel

## Architecture

```
┌───────────────────────────────┐
│      Vercel Deployment        │
│  ┌─────────────────────────┐  │
│  │   Next.js Frontend      │  │
│  │   + API Routes          │  │
│  │   + Prisma Client       │  │
│  └──────────┬──────────────┘  │
│             │                  │
│             │ Prisma ORM       │
│             ▼                  │
│  ┌─────────────────────────┐  │
│  │   Vercel Postgres DB    │  │
│  │   (Managed by Vercel)   │  │
│  └─────────────────────────┘  │
└───────────────────────────────┘
```

## Prerequisites

1. **Vercel Account** - [Sign up](https://vercel.com/signup) (free tier works)
2. **Vercel CLI** - `npm install -g vercel`
3. **Node.js 18+** - For running Prisma locally

## Step-by-Step Setup

### 1. Create Vercel Postgres Database

**Option A: Via Vercel Dashboard (Recommended)**

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **Storage** in the sidebar
3. Click **Create Database**
4. Select **Postgres**
5. Choose a name (e.g., `providercard-db`)
6. Select a region (choose one close to you)
7. Click **Create**

**Option B: Via Vercel CLI**

```bash
cd frontend
vercel
# Follow prompts to link/create project
vercel postgres create providercard-db
```

### 2. Connect Database to Your Project

1. In Vercel Dashboard, go to your project
2. Go to **Settings** → **Environment Variables**
3. Go back to **Storage** tab
4. Find your Postgres database
5. Click **Connect Project**
6. Select your project
7. This auto-adds these environment variables:
   - `POSTGRES_PRISMA_URL` (for connection pooling)
   - `POSTGRES_URL_NON_POOLING` (for migrations)
   - `POSTGRES_URL` (direct connection)

### 3. Pull Environment Variables Locally

```bash
cd frontend
vercel env pull .env.local
```

This creates a `.env.local` file with your database credentials.

### 4. Push Database Schema

```bash
cd frontend
npm run db:push
```

This creates all tables in your Postgres database based on the Prisma schema.

**Expected Output:**
```
✔ Generated Prisma Client
✔ Successfully created all tables
```

### 5. Seed Demo Data

```bash
npm run db:seed
```

This creates 3 demo practitioners you can log in with.

**Expected Output:**
```
🌱 Starting database seed...
  ✓ Created Sarah Smith
    ✓ Added Internal Medicine role
  ✓ Created James Chen
    ✓ Added Cardiovascular Disease role
  ✓ Created Maria Garcia
    ✓ Added Pediatrics role
✅ Seed completed successfully!

📋 Demo Logins:
  Email: dr.sarah.smith@example.com | Password: Demo123!
  Email: dr.james.chen@example.com | Password: Demo123!
  Email: dr.maria.garcia@example.com | Password: Demo123!
```

### 6. Test Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with one of the demo accounts.

### 7. Deploy to Vercel

```bash
vercel --prod
```

The environment variables are already set, so it should just work!

## Database Schema

### Tables Created

1. **practitioners** - Provider information
   - Core identifiers (NPI, DEA, Tax ID)
   - Personal info (name, gender, contact)
   - Address
   - FHIR resource (JSON)
   - Status and verification

2. **practitioner_roles** - Specialties and practice locations
   - Specialty (NUCC taxonomy codes)
   - Practice location
   - License information
   - Accepted insurances (JSON)
   - FHIR resource (JSON)

3. **sync_logs** - Audit trail of all sync events
   - Target system
   - Status and timestamps
   - Request/response data
   - Performance metrics

4. **consents** - Data sharing authorizations
   - Recipient organization
   - Scope and purpose
   - Validity period
   - Status tracking

### Relationships

```
Practitioner (1) ──→ (N) PractitionerRole
Practitioner (1) ──→ (N) SyncLog
Practitioner (1) ──→ (N) Consent
```

## Prisma Commands

### Generate Client
```bash
npm run db:generate
# or
npx prisma generate
```

### Push Schema Changes
```bash
npm run db:push
# or
npx prisma db push
```

### Create Migration
```bash
npm run db:migrate
# or
npx prisma migrate dev --name description_of_change
```

### Open Prisma Studio (Database GUI)
```bash
npm run db:studio
# or
npx prisma studio
```

Opens a web interface at http://localhost:5555 to view/edit data.

### Seed Database
```bash
npm run db:seed
# or
tsx prisma/seed.ts
```

## Environment Variables

### Required

```bash
# Connection pooling URL (for API routes)
POSTGRES_PRISMA_URL="postgresql://..."

# Direct connection URL (for migrations)
POSTGRES_URL_NON_POOLING="postgresql://..."
```

### Optional

```bash
# Legacy support
DATABASE_URL="postgresql://..."
```

These are automatically set when you connect Vercel Postgres to your project.

## File Structure

```
frontend/
├── prisma/
│   ├── schema.prisma          # Database schema
│   ├── seed.ts                # Seed script
│   └── migrations/            # Migration history
├── src/
│   ├── lib/
│   │   ├── prisma.ts          # Prisma client singleton
│   │   └── fhirUtils.ts       # FHIR conversion utilities
│   └── app/
│       └── api/               # API routes (use Prisma)
├── .env.local                 # Local env vars (gitignored)
└── .env.example               # Example env vars
```

## Updating the Database Schema

1. **Edit** `prisma/schema.prisma`
2. **Push changes**: `npm run db:push` (for dev)
3. **Or create migration**: `npm run db:migrate` (for production)
4. **Regenerate client**: `npx prisma generate` (auto-runs)

Example: Adding a field to Practitioner

```prisma
model Practitioner {
  // ... existing fields ...
  dateOfBirth DateTime? @map("date_of_birth")  // Add this
}
```

Then run:
```bash
npx prisma db push
```

## Costs

### Vercel Postgres Pricing

**Hobby (Free Tier):**
- ✅ 256 MB storage
- ✅ 60 hours compute/month  
- ✅ Perfect for POC/demo
- ✅ Includes connection pooling

**Pro Tier ($20/month):**
- 512 MB storage
- 100 hours compute/month
- Higher connection limits

**For production, consider:**
- Supabase (has free tier, more storage)
- PlanetScale (MySQL, generous free tier)
- Neon (Postgres, serverless, free tier)

## Troubleshooting

### "Environment variable not found: POSTGRES_PRISMA_URL"

**Solution:**
```bash
cd frontend
vercel env pull .env.local
```

### "Can't reach database server"

**Solution:**
1. Check your internet connection
2. Verify database is running in Vercel Dashboard
3. Ensure environment variables are set correctly

### Migrations fail

**Solution:**
Use `prisma db push` instead of migrations for development:
```bash
npx prisma db push --accept-data-loss
```

For production, use migrations:
```bash
npx prisma migrate deploy
```

### Seed script fails

**Solution:**
Check the error message. Common issues:
- Database not created yet → Run `npm run db:push` first
- Old data exists → Seed script clears it automatically
- Connection issue → Check `.env.local`

### Type errors after schema changes

**Solution:**
```bash
npx prisma generate
npm run build
```

## Monitoring & Management

### View Database in Vercel

1. Go to Vercel Dashboard
2. Click **Storage**
3. Click your database
4. View usage, connection pooling, query performance

### View Data with Prisma Studio

```bash
npm run db:studio
```

Opens GUI at http://localhost:5555

### Check Connection

```bash
npx prisma db execute --stdin <<< "SELECT NOW();"
```

## Security Best Practices

1. **Never commit `.env.local`** - It's in `.gitignore`
2. **Use environment variables** - Never hardcode credentials
3. **Use connection pooling** - `POSTGRES_PRISMA_URL` for API routes
4. **Hash passwords** - Use `bcrypt` (already implemented)
5. **Sanitize inputs** - Prisma handles this automatically

## Migration from Mock Data

If you were using the mock data version:

1. **API routes already support Prisma** - Just need env vars
2. **Seed creates same demo accounts**
3. **FHIR utilities work the same**
4. **No frontend changes needed**

The database version is a drop-in replacement!

## Next Steps

1. ✅ Set up Vercel Postgres
2. ✅ Push schema and seed data
3. ✅ Test locally
4. ✅ Deploy to Vercel
5. 🎯 Start building real features!

---

**Need help?**
- Prisma Docs: https://www.prisma.io/docs
- Vercel Postgres Docs: https://vercel.com/docs/storage/vercel-postgres
- Open an issue in this repo
