# Deployment Guide - Deploy to Vercel

This guide will help you deploy ProviderCard to Vercel with database support.

## Quick Deploy (5 Minutes)

### Prerequisites
- GitHub account (code is already pushed)
- Vercel account (free tier works)

### Option 1: Deploy via Vercel Dashboard (Recommended)

#### Step 1: Import Project to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **"Import Git Repository"**
3. Select your GitHub account
4. Find and import: `AINPI` repository
5. Configure project:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Next.js (auto-detected)
   - **Build Command**: `npm run build` (auto-filled)
   - **Output Directory**: `.next` (auto-filled)

#### Step 2: Create Vercel Postgres Database

1. In Vercel Dashboard, go to **Storage** tab
2. Click **Create Database**
3. Select **Postgres**
4. Name it: `providercard-db`
5. Select region (choose one close to you)
6. Click **Create**

#### Step 3: Connect Database to Project

1. Find your new database in the Storage tab
2. Click **Connect Project**
3. Select your `AINPI` project
4. Click **Connect**
5. This automatically adds environment variables:
   - `POSTGRES_PRISMA_URL`
   - `POSTGRES_URL_NON_POOLING`
   - `POSTGRES_URL`

#### Step 4: Deploy

1. Go to **Deployments** tab
2. Click **Redeploy** on the latest deployment
3. Wait 1-2 minutes for build to complete
4. Your app is live! 🎉

#### Step 5: Set Up Database (First Time Only)

**Note:** You need to run migrations and seed from your local machine.

```bash
# Pull environment variables locally
cd frontend
vercel env pull .env.local

# Push database schema
npm run db:push

# Seed demo data
npm run db:seed
```

**That's it!** Your app is now live with a real database.

---

### Option 2: Deploy via Vercel CLI

#### Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

#### Step 2: Login to Vercel

```bash
vercel login
```

Follow the prompts to authenticate.

#### Step 3: Deploy

```bash
cd frontend
vercel --prod
```

Follow the prompts:
- **Set up and deploy**: Yes
- **Which scope**: Choose your account
- **Link to existing project**: No (or Yes if you already created one)
- **Project name**: providercard (or any name)
- **Directory**: `./` (current directory)
- **Override settings**: No

Wait for deployment to complete.

#### Step 4: Create Database

```bash
# Create Postgres database
vercel postgres create providercard-db

# Connect to project
vercel postgres connect providercard-db
```

#### Step 5: Set Up Database

```bash
# Pull environment variables
vercel env pull .env.local

# Push schema
npm run db:push

# Seed data
npm run db:seed
```

#### Step 6: Redeploy with Database

```bash
vercel --prod
```

---

## What Gets Deployed

### Frontend Application
- ✅ Next.js app with all pages
- ✅ API routes (serverless functions)
- ✅ Prisma Client (database access)
- ✅ Mock data providers (fallback)
- ✅ FHIR utilities

### Serverless Functions
- `/api/auth/login` - Authentication
- `/api/auth/register` - User registration
- `/api/practitioners/me` - Get/update practitioner
- `/api/demo/*` - Demo dashboard features

### Database Connection
- ✅ Vercel Postgres (serverless-optimized)
- ✅ Connection pooling (pgBouncer)
- ✅ Prisma ORM for type-safe queries

---

## Post-Deployment Setup

### 1. Get Your Deployment URL

**Via Dashboard:**
- Go to your project in Vercel Dashboard
- Copy the **Production URL** (e.g., `https://providercard.vercel.app`)

**Via CLI:**
```bash
vercel ls
```

### 2. Test the Deployment

Visit your deployment URL and verify:
- ✅ Homepage loads
- ✅ Can navigate to /login
- ✅ Can log in with demo accounts
- ✅ Demo dashboard loads at /demo

### 3. Verify Database Connection

Log in with a demo account:
- Email: `dr.sarah.smith@example.com`
- Password: `Demo123!`

If the login works and you see real practitioner data, the database is connected!

---

## Demo Accounts

After running `npm run db:seed`, these accounts are available:

| Email | Password | Specialty | NPI |
|-------|----------|-----------|-----|
| dr.sarah.smith@example.com | Demo123! | Internal Medicine | 1234567890 |
| dr.james.chen@example.com | Demo123! | Cardiovascular Disease | 2345678901 |
| dr.maria.garcia@example.com | Demo123! | Pediatrics | 3456789012 |

---

## Environment Variables

These are **automatically set** by Vercel when you connect the database:

```bash
POSTGRES_PRISMA_URL         # Connection pooling (for API routes)
POSTGRES_URL_NON_POOLING    # Direct connection (for migrations)
POSTGRES_URL                # Standard connection
```

**No manual configuration needed!**

---

## Troubleshooting

### Build Fails

**Error: "Prisma Client not generated"**

**Solution:**
The `postinstall` script should handle this, but if not:
```bash
# Locally
npm run db:generate

# Commit and redeploy
git add -A
git commit -m "Fix Prisma client generation"
git push
```

### Database Connection Fails

**Error: "Can't reach database server"**

**Solution:**
1. Check database is created: Vercel Dashboard → Storage
2. Verify connection: Vercel Dashboard → Settings → Environment Variables
3. Ensure database is connected to project

### Login Doesn't Work

**Error: "Authentication failed"**

**Solution:**
Database not seeded. Run locally:
```bash
vercel env pull .env.local
npm run db:seed
```

### API Routes Return 500

**Solution:**
Check Vercel logs:
```bash
vercel logs
```

Or in Vercel Dashboard → Deployments → Click deployment → View Logs

---

## Monitoring & Logs

### View Logs

**Via Dashboard:**
1. Go to Vercel Dashboard
2. Click on your project
3. Go to **Deployments**
4. Click on a deployment
5. View **Build Logs** or **Function Logs**

**Via CLI:**
```bash
vercel logs [deployment-url]
```

### Monitor Database

1. Go to Vercel Dashboard
2. Click **Storage**
3. Click your database
4. View:
   - Usage statistics
   - Query performance
   - Connection pooling stats

### Prisma Studio (Local)

```bash
npm run db:studio
```

Opens GUI at http://localhost:5555 to view/edit database data.

---

## Updating the Deployment

### Update Code

```bash
# Make changes
git add -A
git commit -m "Your changes"
git push

# Vercel auto-deploys on push to main
```

### Update Database Schema

```bash
# Edit prisma/schema.prisma

# Push changes
npm run db:push

# Or create migration (recommended for production)
npm run db:migrate
```

### Re-seed Database

```bash
npm run db:seed
```

---

## Custom Domain (Optional)

### Add Custom Domain

1. Go to Vercel Dashboard → Your Project
2. Go to **Settings** → **Domains**
3. Enter your domain (e.g., `providercard.com`)
4. Follow DNS configuration instructions
5. Wait for DNS propagation (5-30 minutes)

---

## Performance Optimization

### Enable Vercel Analytics

1. Go to Vercel Dashboard → Your Project
2. Click **Analytics** tab
3. Click **Enable**

### Enable Vercel Speed Insights

```bash
npm install @vercel/speed-insights
```

Add to `layout.tsx`:
```typescript
import { SpeedInsights } from '@vercel/speed-insights/next';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
```

---

## Security Checklist

Before going to production:

- [ ] Environment variables are set in Vercel Dashboard
- [ ] `.env.local` is in `.gitignore` (already done)
- [ ] Database credentials are not in code (using env vars)
- [ ] Passwords are hashed with bcrypt (already implemented)
- [ ] API routes validate inputs
- [ ] CORS is configured if needed
- [ ] Rate limiting is considered
- [ ] HTTPS is enabled (automatic on Vercel)

---

## Costs

### Free Tier (Good for POC/Demo)
- ✅ 100GB bandwidth/month
- ✅ Unlimited deployments
- ✅ Serverless functions
- ✅ Automatic HTTPS
- ✅ Vercel Postgres: 256 MB, 60 hours compute

### Pro Tier ($20/month)
- Everything in Free +
- More bandwidth and compute
- Larger database
- Priority support

---

## Success Checklist

After deployment, verify:

- [ ] Deployment succeeded (check Vercel Dashboard)
- [ ] Can access the app URL
- [ ] Homepage loads correctly
- [ ] Can navigate to /login
- [ ] Can log in with demo account
- [ ] Dashboard loads at /dashboard
- [ ] Demo features work at /demo
- [ ] Detect Discrepancies works
- [ ] Export FHIR Bundle works
- [ ] Time Savings Story modal opens

---

## Support & Resources

- **Vercel Docs**: https://vercel.com/docs
- **Prisma Docs**: https://www.prisma.io/docs
- **Next.js Docs**: https://nextjs.org/docs
- **Project Docs**: 
  - [DATABASE_SETUP.md](DATABASE_SETUP.md)
  - [DATABASE_INTEGRATION_SUMMARY.md](DATABASE_INTEGRATION_SUMMARY.md)
  - [QUICK_START.md](QUICK_START.md)

---

## Quick Commands Reference

```bash
# Login to Vercel
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod

# View deployments
vercel ls

# View logs
vercel logs

# Pull env vars
vercel env pull .env.local

# Create Postgres database
vercel postgres create providercard-db

# View help
vercel --help
```

---

**🚀 Ready to deploy?** 

Follow **Option 1** (Dashboard) for the easiest experience, or **Option 2** (CLI) for more control.

Your code is already committed and pushed to GitHub, so you're ready to go!
