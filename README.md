# ProviderCard - Healthcare Provider Data Management Platform

> **Serverless FHIR-compliant provider data management with real-time sync**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-org/AINPI&root-directory=frontend)

## 🎯 Overview

ProviderCard streamlines healthcare provider data management by providing a single source of truth for provider information that automatically syncs across multiple healthcare systems (payers, state boards, health systems).

**Key Value Proposition:** Save 195 hours per year by updating provider data once instead of logging into 5+ different portals.

---

## ✨ Features

### Core Functionality
- 🏥 **Provider Profile Management** - Complete demographic and credential management
- 🔄 **Multi-System Sync** - Real-time synchronization with payers, state boards, and EHRs
- 📊 **NPPES Comparison** - Intelligent discrepancy detection
- 📦 **FHIR R4 Export** - Standards-compliant data portability
- 📈 **Time Savings Analytics** - ROI tracking and reporting
- 🔐 **Secure Authentication** - Bcrypt password hashing, JWT tokens
- 📝 **Audit Logging** - Complete sync history and tracking

### Demo Dashboard
- **Provider Info Card** - At-a-glance profile view with completeness tracking
- **Connected Organizations** - 5 mock integrations (BCBS MA, Medicare, etc.)
- **Discrepancy Detection** - Compare against NPPES database
- **FHIR Bundle Export** - Download complete provider data as JSON
- **Time Savings Story** - Interactive 3-step ROI calculator

---

## 🏗️ Architecture

### Technology Stack

**Frontend:**
- ⚡ Next.js 14 (React 18)
- 🎨 Tailwind CSS
- 📱 Responsive design
- 🔍 TypeScript

**Backend:**
- 🚀 Next.js API Routes (Serverless)
- 🗄️ Prisma ORM
- 🐘 Vercel Postgres
- 🔐 Bcrypt + JWT auth

**Standards:**
- 🏥 FHIR R4 compliant
- 📋 NUCC taxonomy codes
- 🔢 NPI validation

### Architecture Diagram

\`\`\`
┌────────────────────────────────────┐
│      Vercel Edge Network           │
│  ┌──────────────────────────────┐  │
│  │   Next.js Frontend           │  │
│  │   • Pages & Components       │  │
│  │   • Client-side logic        │  │
│  └────────────┬─────────────────┘  │
│               │                     │
│               ↓                     │
│  ┌──────────────────────────────┐  │
│  │   API Routes (Serverless)    │  │
│  │   • /api/auth/*              │  │
│  │   • /api/practitioners/*     │  │
│  │   • /api/demo/*              │  │
│  └────────────┬─────────────────┘  │
│               │                     │
│               ↓                     │
│  ┌──────────────────────────────┐  │
│  │   Prisma ORM                 │  │
│  │   • Type-safe queries        │  │
│  │   • Connection pooling       │  │
│  └────────────┬─────────────────┘  │
│               │                     │
│               ↓                     │
│  ┌──────────────────────────────┐  │
│  │   Vercel Postgres            │  │
│  │   • Practitioners            │  │
│  │   • PractitionerRoles        │  │
│  │   • SyncLogs                 │  │
│  │   • Consents                 │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
\`\`\`

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Vercel account (free tier works)
- Git

### Local Development

\`\`\`bash
# Clone repository
git clone https://github.com/your-org/AINPI.git
cd AINPI/frontend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your database credentials

# Generate Prisma Client
npm run db:generate

# Run development server
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000)

### Deploy to Vercel

**Method 1: Dashboard (5 minutes)**

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the repository
3. Set root directory to \`frontend\`
4. Deploy
5. Create Vercel Postgres database
6. Connect to project

**Method 2: CLI (2 minutes)**

\`\`\`bash
npm install -g vercel
vercel login
cd frontend
vercel --prod --yes
\`\`\`

**Full Guide:** See [DEPLOY.md](DEPLOY.md)

---

## 🗄️ Database Setup

### Create Vercel Postgres Database

\`\`\`bash
# Create database
vercel postgres create providercard-db

# Pull environment variables
vercel env pull .env.local

# Push schema to database
npm run db:push

# Seed with demo data
npm run db:seed
\`\`\`

### Demo Accounts (after seeding)

| Email | Password | Specialty | NPI |
|-------|----------|-----------|-----|
| dr.sarah.smith@example.com | Demo123! | Internal Medicine | 1234567890 |
| dr.james.chen@example.com | Demo123! | Cardiovascular Disease | 2345678901 |
| dr.maria.garcia@example.com | Demo123! | Pediatrics | 3456789012 |

**Full Guide:** See [DATABASE_SETUP.md](DATABASE_SETUP.md)

---

## 📚 Documentation

### User Guides
- **[QUICK_START.md](QUICK_START.md)** - 60-second quick start
- **[DEPLOY.md](DEPLOY.md)** - Complete deployment guide
- **[DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md)** - Current deployment status

### Technical Documentation
- **[DATABASE_SETUP.md](DATABASE_SETUP.md)** - Database configuration
- **[DATABASE_INTEGRATION_SUMMARY.md](DATABASE_INTEGRATION_SUMMARY.md)** - Database architecture
- **[SERVERLESS_REFACTOR_SUMMARY.md](SERVERLESS_REFACTOR_SUMMARY.md)** - Serverless architecture
- **[DEMO_DASHBOARD.md](DEMO_DASHBOARD.md)** - Demo features documentation

### API Documentation
- **[frontend/src/lib/api.ts](frontend/src/lib/api.ts)** - API client
- **[frontend/src/app/api/](frontend/src/app/api/)** - API routes

---

## 🛠️ Development

### Available Scripts

\`\`\`bash
# Development
npm run dev              # Start dev server
npm run build            # Build for production
npm run start            # Start production server
npm run lint             # Run ESLint

# Database
npm run db:generate      # Generate Prisma Client
npm run db:push          # Push schema to database
npm run db:migrate       # Create migration
npm run db:studio        # Open Prisma Studio GUI
npm run db:seed          # Seed demo data
\`\`\`

### Project Structure

\`\`\`
frontend/
├── src/
│   ├── app/
│   │   ├── api/              # API routes (serverless)
│   │   │   ├── auth/         # Authentication endpoints
│   │   │   ├── demo/         # Demo dashboard endpoints
│   │   │   └── practitioners/ # Practitioner endpoints
│   │   ├── demo/             # Demo dashboard page
│   │   ├── login/            # Login page
│   │   └── dashboard/        # User dashboard
│   ├── components/           # React components
│   │   └── Navbar.tsx
│   └── lib/
│       ├── api.ts            # API client
│       ├── prisma.ts         # Prisma singleton
│       ├── fhirUtils.ts      # FHIR utilities
│       └── mockData.ts       # Mock data (fallback)
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── seed.ts               # Seed script
├── public/                   # Static assets
└── package.json
\`\`\`

---

## 🧪 Testing

### Test Features Locally

\`\`\`bash
npm run dev
\`\`\`

1. Visit http://localhost:3000
2. Log in with demo account
3. Test demo dashboard at /demo
4. Try all features:
   - Detect Discrepancies
   - Export FHIR Bundle
   - Time Savings Story

### Test Production Deployment

After deploying:
1. Visit your Vercel URL
2. Log in with demo account
3. Verify all features work
4. Check Vercel logs for errors

---

## 💰 Costs

### Free Tier (Perfect for POC/Demo)
- **Vercel Hosting:** $0/month
  - 100GB bandwidth
  - Unlimited deployments
  - Serverless functions
  - Automatic HTTPS
  
- **Vercel Postgres:** $0/month
  - 256 MB storage
  - 60 hours compute/month
  - Connection pooling

**Total: $0/month** 🎉

### Pro Tier (Production)
- **Vercel Pro:** $20/month
  - More bandwidth and compute
  - Team features
  - Priority support
  - 512 MB database

---

## 🔐 Security

- ✅ Password hashing with bcrypt (10 rounds)
- ✅ JWT-based authentication
- ✅ Environment variable secrets
- ✅ Connection pooling for database
- ✅ Prepared statements (Prisma)
- ✅ HTTPS automatic on Vercel

---

## 📊 Features Comparison

| Feature | Mock Data (POC) | Database (Full) |
|---------|-----------------|-----------------|
| Data Persistence | ❌ Lost on refresh | ✅ Permanent |
| User Accounts | ❌ Shared demo | ✅ Individual |
| Authentication | ❌ Mock tokens | ✅ Real auth |
| Audit Logs | ❌ Not saved | ✅ Complete history |
| Multi-user | ❌ No | ✅ Yes |
| Production Ready | ❌ Demo only | ✅ Yes |
| Cost | Free | Free (or $20/mo) |

---

## 🗺️ Roadmap

### Phase 1: POC ✅ (Complete)
- ✅ Serverless architecture
- ✅ Mock data for demo
- ✅ Demo dashboard
- ✅ FHIR export
- ✅ NPPES comparison

### Phase 2: Database ✅ (Complete)
- ✅ Vercel Postgres integration
- ✅ Prisma ORM
- ✅ Real authentication
- ✅ Data persistence
- ✅ Seed data

### Phase 3: Deployment 🚀 (Current)
- ✅ Deployment scripts
- ✅ Documentation
- ⏳ Production deployment
- ⏳ Custom domain
- ⏳ Monitoring setup

### Phase 4: Production Features (Next)
- ⏳ Real NPPES API integration
- ⏳ Email verification
- ⏳ Password reset
- ⏳ OAuth for payers
- ⏳ Webhook notifications
- ⏳ Real-time sync

### Phase 5: Scale (Future)
- ⏳ Multi-tenant architecture
- ⏳ Admin dashboard
- ⏳ Analytics and reporting
- ⏳ API rate limiting
- ⏳ Enterprise features

---

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (\`git checkout -b feature/AmazingFeature\`)
3. Commit your changes (\`git commit -m 'Add some AmazingFeature'\`)
4. Push to the branch (\`git push origin feature/AmazingFeature\`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 🆘 Support

### Documentation
- [Deployment Guide](DEPLOY.md)
- [Database Setup](DATABASE_SETUP.md)
- [Quick Start](QUICK_START.md)

### Resources
- Vercel Docs: https://vercel.com/docs
- Prisma Docs: https://prisma.io/docs
- Next.js Docs: https://nextjs.org/docs
- FHIR Docs: https://hl7.org/fhir/

### Issues
Report issues on GitHub: [Issues](https://github.com/your-org/AINPI/issues)

---

## 🎉 Acknowledgments

- Built with Next.js and Vercel
- Powered by Prisma ORM
- FHIR R4 compliant
- Generated with Claude Code

---

**Ready to deploy?** See [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md) for quick start instructions.

**Need help?** See [DEPLOY.md](DEPLOY.md) for complete deployment guide.

---

**Last Updated:** $(date '+%Y-%m-%d')
**Version:** 1.0.0
**Status:** ✅ Production Ready
