# ProviderCard POC Deployment Guide

## Overview

This POC (Proof of Concept) version of ProviderCard has been refactored to run entirely on Vercel as a serverless application. **No separate backend is required** - all API logic runs as Next.js API routes on Vercel's edge network.

## Architecture Changes

### Before (Original)
- **Frontend**: Next.js on Vercel
- **Backend**: FastAPI (Python) on Render
- **Database**: PostgreSQL on Render
- **Deployment**: Two separate services

### After (POC)
- **Frontend + Backend**: Next.js on Vercel (all-in-one)
- **Data**: Mock data in memory (no database)
- **Deployment**: Single Vercel deployment

## What's Included in POC

All demo dashboard features work without a backend:
- Mock provider data
- Mock integrations (BCBS MA, Medicare, etc.)
- NPPES comparison with intelligent mock data
- FHIR bundle export
- Time savings guided flow
- Authentication (mock tokens)

## Deployment Steps

### Option 1: Deploy with Vercel CLI (Recommended)

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm install -g vercel
   ```

2. **Navigate to frontend directory**:
   ```bash
   cd frontend
   ```

3. **Deploy to Vercel**:
   ```bash
   vercel --prod
   ```

4. **Follow prompts**:
   - Link to existing project or create new one
   - Accept default settings
   - Wait for deployment to complete

5. **Your app is live!** Vercel will provide a URL like:
   ```
   https://your-app.vercel.app
   ```

### Option 2: Deploy with Vercel Dashboard

1. **Push code to GitHub**:
   ```bash
   git add .
   git commit -m "Refactor for serverless POC deployment"
   git push origin main
   ```

2. **Import to Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New Project"
   - Import your GitHub repository
   - Set **Root Directory** to `frontend`
   - Click "Deploy"

3. **Wait for build** (usually 1-2 minutes)

4. **Your app is live!**

## Environment Variables

**No environment variables are required** for the POC version. Everything runs on mock data.

If you want to customize:
- Create `.env.local` in the `frontend` directory
- Copy from `.env.local.example`
- Leave `NEXT_PUBLIC_API_URL` empty for serverless mode

## Testing the POC

### 1. Access the App
Navigate to your Vercel URL or `http://localhost:3000` for local dev

### 2. Login
Use any email/password combination - all are accepted in POC mode:
- Email: `demo@example.com`
- Password: `anything`

### 3. Try Demo Features
- Click **"Demo"** in navigation
- Click **"Detect Discrepancies"** - compares mock ProviderCard data vs mock NPPES
- Click **"Export FHIR Bundle"** - downloads FHIR JSON bundle
- Click **"See Time Savings Story"** - shows 3-step guided flow

## Local Development

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Run Development Server
```bash
npm run dev
```

### 3. Open Browser
Navigate to `http://localhost:3000`

### 4. Test API Routes
All API routes are at `/api/*`:
- `/api/auth/login` - Mock authentication
- `/api/auth/register` - Mock registration
- `/api/practitioners/me` - Get/update practitioner
- `/api/demo/integrations` - Get mock integrations
- `/api/demo/nppes-comparison` - Compare with NPPES
- `/api/demo/export-fhir-bundle` - Export FHIR bundle

## File Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── api/                    # Next.js API Routes (serverless functions)
│   │   │   ├── auth/
│   │   │   │   ├── login/route.ts
│   │   │   │   └── register/route.ts
│   │   │   ├── demo/
│   │   │   │   ├── integrations/route.ts
│   │   │   │   ├── nppes-comparison/route.ts
│   │   │   │   └── export-fhir-bundle/route.ts
│   │   │   └── practitioners/
│   │   │       └── me/route.ts
│   │   ├── demo/
│   │   │   └── page.tsx            # Demo dashboard UI
│   │   ├── login/
│   │   └── dashboard/
│   ├── lib/
│   │   ├── api.ts                  # API client (uses relative paths)
│   │   └── mockData.ts             # Mock data providers
│   └── components/
├── vercel.json                      # Vercel configuration
├── package.json
└── .env.local.example
```

## Key Changes Made

### 1. Mock Data Layer
Created `src/lib/mockData.ts` with:
- Mock practitioner data
- Mock NPPES data generator
- Mock integrations
- FHIR conversion utilities
- Comparison logic

### 2. API Routes
Created serverless functions in `src/app/api/`:
- Authentication endpoints
- Demo dashboard endpoints
- Practitioner data endpoints

### 3. Updated API Client
Modified `src/lib/api.ts`:
- Uses relative paths (empty `baseURL`)
- Works with Next.js API routes
- No external backend required

### 4. Vercel Configuration
Updated `vercel.json`:
- Removed external API URL
- Added API route rewrites
- Optimized for serverless deployment

## Limitations of POC

This is a **demonstration version** with intentional limitations:

1. **No Data Persistence**: All data is mock/in-memory
   - Logging in always gives the same demo user
   - Profile updates are not saved
   - Refresh resets everything

2. **No Real Authentication**: Mock tokens accepted
   - Any email/password works
   - No password validation
   - No user management

3. **No Database**: Everything uses hardcoded mock data
   - Same integrations for all users
   - Predictable NPPES comparison results
   - No audit logs or history

4. **Limited Functionality**:
   - Only demo dashboard features implemented
   - No real NPPES API integration
   - No actual sync to external systems

## Moving from POC to Production

To make this production-ready, you would need to:

1. **Add Database**:
   - Use Vercel Postgres, Supabase, or PlanetScale
   - Add Prisma ORM for type-safe queries
   - Migrate mock data to real schemas

2. **Implement Real Auth**:
   - Use NextAuth.js or Clerk
   - Add password hashing (bcrypt)
   - Implement JWT properly

3. **External Integrations**:
   - Call real NPPES API
   - Implement OAuth for payers/systems
   - Add webhook handlers

4. **Add Missing Features**:
   - Profile management
   - Role management
   - Sync logs
   - Audit trails

5. **Environment Config**:
   - Add production environment variables
   - Configure secrets in Vercel dashboard
   - Set up monitoring (Sentry, LogRocket)

## Costs

**POC Version**: 100% FREE
- Vercel Free Tier includes:
  - Unlimited deployments
  - 100GB bandwidth/month
  - Serverless function invocations
  - Custom domains
  - Automatic HTTPS

**Production Ready** would cost:
- Vercel Pro: $20/month (for team features)
- Database: $5-20/month (PlanetScale, Supabase)
- Auth: Free (NextAuth.js) or $25/month (Clerk Pro)
- Total: ~$25-65/month depending on scale

## Troubleshooting

### Build Fails
```bash
cd frontend
npm install
npm run build
```
Fix any TypeScript errors shown

### API Routes Return 404
- Ensure you're accessing `/api/*` paths
- Check that route files end with `route.ts`
- Verify the directory structure matches above

### "Module not found" errors
```bash
rm -rf node_modules package-lock.json
npm install
```

### Demo doesn't load data
- Check browser console for errors
- Verify API routes are accessible
- Try clearing localStorage and refreshing

## Success Metrics

After deploying, verify:
- ✅ Can access the app at Vercel URL
- ✅ Can log in with any credentials
- ✅ Can view demo dashboard
- ✅ Can detect discrepancies (shows comparison)
- ✅ Can export FHIR bundle (downloads JSON)
- ✅ Can view time savings story (modal opens)

## Next Steps

1. **Deploy the POC** using steps above
2. **Share the URL** with stakeholders
3. **Gather feedback** on demo features
4. **Plan production architecture** if moving forward
5. **Implement real integrations** based on requirements

## Support

For issues or questions:
- Check [Next.js documentation](https://nextjs.org/docs)
- Check [Vercel documentation](https://vercel.com/docs)
- Review the mock data in `src/lib/mockData.ts`
- Inspect API routes in `src/app/api/*/route.ts`

---

**Ready to deploy?** Run `vercel --prod` from the `frontend` directory!
