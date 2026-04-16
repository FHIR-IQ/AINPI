# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ProviderCard-v2 (AINPI) is a FHIR R4-compliant healthcare provider directory and synchronization system. It combines a TypeScript core library with a Next.js 14 frontend application featuring AI-powered provider search across major payer APIs.

## Repository Structure

This is a multi-application repository with three main parts:

- **`frontend/`** — Primary active application. Next.js 14 (App Router) with Prisma ORM, Vercel Postgres, Tailwind CSS, and AI integrations (Anthropic SDK, OpenAI, Perplexity). This is where most development happens.
- **`models/` + `modules/`** — Core TypeScript library defining FHIR R4 resources (Practitioner, PractitionerRole, Organization, Endpoint) and business logic (provider CRUD, sync engine, NUCC taxonomy, validation).
- **`backend/`** — Legacy Python FastAPI backend with SQLite/SQLAlchemy. Being replaced by serverless Next.js API routes in `frontend/`.
- **`web-app/`** — Alternative Next.js app, less actively developed.

## Common Commands

### Frontend (primary app)
```bash
cd frontend
npm run dev              # Start Next.js dev server
npm run build            # Build (runs prisma generate first)
npm run lint             # ESLint
npm run db:generate      # Generate Prisma client
npm run db:push          # Push schema to database (no migration)
npm run db:migrate       # Run Prisma migrations
npm run db:studio        # Open Prisma Studio GUI
npm run db:seed          # Seed database (tsx prisma/seed.ts)
```

### Root (core library)
```bash
npm run build            # TypeScript compilation (tsc)
```

## Architecture

### Frontend App (`frontend/src/app/`)

Uses Next.js App Router. Key route groups:

- **`api/`** — Server-side API routes: `auth/` (login/register with JWT + bcryptjs), `providers/`, `magic-scanner/` (AI-powered provider discovery), `provider-search/` (real-time payer API search), `practitioner-roles/`, `demo/` (NPPES comparison, FHIR export)
- **`dashboard/`**, **`providers/`**, **`magic-scanner/`**, **`provider-search/`** — Client-facing pages

### Database

- **Vercel Postgres** via Prisma ORM. Schema at `frontend/prisma/schema.prisma`.
- Connection pooling URL (`POSTGRES_PRISMA_URL`) for serverless, direct URL (`POSTGRES_URL_NON_POOLING`) for migrations.
- Key models: `Practitioner`, `PractitionerRole`, `SyncLog`, `Consent`, `ProviderDirectoryAPI`, `MagicScanResult`
- JSON columns store flexible FHIR data (specialties, licenses, practice locations, insurance plans, scan results).

### Authentication

JWT-based (7-day expiry). Passwords hashed with bcryptjs. Auth middleware extracts user ID from tokens for protected API routes.

### AI Integration

The Magic Scanner and provider search features use multiple AI providers:
- **Anthropic SDK** (`@anthropic-ai/sdk`) — Primary AI provider
- **OpenAI** — Alternative provider
- **Perplexity API** — Used for web-augmented provider discovery

### Provider Search

Real-time search across major payer FHIR directories (Humana, UnitedHealth, Aetna, BCBS, Cigna, Anthem). Results are parsed from FHIR Bundle responses.

## Environment Variables

The frontend requires these in `frontend/.env.local`:
- `POSTGRES_PRISMA_URL` — Pooled Postgres connection string
- `POSTGRES_URL_NON_POOLING` — Direct Postgres connection string
- `JWT_SECRET` — For authentication tokens
- `PERPLEXITY_API_KEY`, `OPENAI_API_KEY` — Optional, for AI features

## Deployment

Deployed to **Vercel**. The `vercel.json` at root points builds to the `frontend/` directory. Vercel Postgres provides the database with connection pooling for serverless functions.

## Domain Context

- **FHIR R4**: Healthcare interoperability standard. Resources follow HL7 FHIR specifications.
- **NPI**: National Provider Identifier — unique 10-digit ID for healthcare providers.
- **NUCC Taxonomy**: Classification system for healthcare provider specialties (900+ codes).
- **NPPES**: National Plan and Provider Enumeration System — CMS registry of all NPIs.
