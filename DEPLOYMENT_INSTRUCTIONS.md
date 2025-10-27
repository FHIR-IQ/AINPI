# Deployment Instructions

## Overview

This guide covers deploying the ProviderCard application to production:
- **Frontend**: Vercel (Next.js)
- **Backend**: Render.com (FastAPI)

All code has been committed to GitHub and is ready for deployment.

---

## ✅ Pre-Deployment Checklist

- [x] All code committed to GitHub
- [x] Frontend builds successfully (`npm run build` passes)
- [x] No linting errors
- [x] All TypeScript types validated
- [x] Backend code ready with requirements.txt
- [x] Environment variable templates created (.env.example files)
- [x] Deployment configurations in place (vercel.json, render.yaml)

---

## Frontend Deployment to Vercel

### Option 1: Vercel Dashboard (Recommended for First Deployment)

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/new
   - Sign in with your GitHub account

2. **Import Repository**
   - Click "Add New" → "Project"
   - Select your GitHub repository: `FHIR-IQ/AINPI`
   - Click "Import"

3. **Configure Project**
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `.next` (default)
   - **Install Command**: `npm install` (default)

4. **Environment Variables**
   Add the following environment variable:
   ```
   NEXT_PUBLIC_API_URL=https://your-backend-url.onrender.com
   ```
   (You'll update this after deploying the backend)

5. **Deploy**
   - Click "Deploy"
   - Wait 2-3 minutes for build to complete
   - Note your Vercel URL (e.g., `https://ainpi-xyz.vercel.app`)

### Option 2: Vercel CLI (After Initial Setup)

```bash
# Navigate to project root
cd /Users/eugenevestel/Documents/GitHub/AINPI

# Install Vercel CLI (if not already installed)
npm install -g vercel

# Login to Vercel
vercel login

# Deploy (first time - follow prompts)
vercel --cwd frontend

# Or deploy to production
vercel --cwd frontend --prod
```

**CLI Prompts**:
- Set up and deploy? `Y`
- Which scope? `Select your account`
- Link to existing project? `N` (first time)
- What's your project's name? `providercard` or `ainpi`
- In which directory is your code located? `./` (already in frontend dir)
- Want to override settings? `N`

---

## Backend Deployment to Render.com

### Step 1: Create Account
1. Go to https://render.com
2. Sign up with GitHub (recommended)
3. Authorize Render to access your repositories

### Step 2: Create New Web Service

1. **From Dashboard**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository: `FHIR-IQ/AINPI`
   - Click "Connect"

2. **Configure Service**

   **Basic Settings**:
   - **Name**: `providercard-api` (or your choice)
   - **Region**: Choose closest to your users
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: `Python 3`
   - **Build Command**:
     ```bash
     pip install -r requirements.txt
     ```
   - **Start Command**:
     ```bash
     uvicorn app.main:app --host 0.0.0.0 --port $PORT
     ```

   **Instance Type**:
   - Free tier is fine for demo/testing
   - Upgrade to Starter ($7/mo) for production

3. **Environment Variables**
   Click "Advanced" → "Add Environment Variable"

   Add these variables:
   ```
   SECRET_KEY=your-secret-key-here-generate-a-random-string
   DATABASE_URL=sqlite:///./providercard.db
   ALLOWED_ORIGINS=https://your-vercel-url.vercel.app,http://localhost:3000
   ACCESS_TOKEN_EXPIRE_MINUTES=10080
   ```

   **Generate SECRET_KEY**:
   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

4. **Deploy**
   - Click "Create Web Service"
   - Wait 5-10 minutes for initial deployment
   - Note your Render URL (e.g., `https://providercard-api.onrender.com`)

### Step 3: Update Frontend Environment Variable

1. Go back to Vercel Dashboard
2. Select your project → Settings → Environment Variables
3. Update `NEXT_PUBLIC_API_URL` to your Render URL
4. Redeploy frontend (Deployments → Click "..." → Redeploy)

### Step 4: Update Backend CORS

1. In Render Dashboard, go to your service
2. Environment → Edit `ALLOWED_ORIGINS`
3. Update to include your actual Vercel URL:
   ```
   https://your-actual-vercel-url.vercel.app
   ```
4. Save and redeploy

---

## Post-Deployment Setup

### 1. Seed the Database

Since Render uses ephemeral storage for free tier, you'll need to seed on each deployment.

**Option A: Automatic Seeding**
Add to Render's Build Command:
```bash
pip install -r requirements.txt && python seed_db.py
```

**Option B: Manual Seeding via Shell**
1. In Render Dashboard → Your Service → Shell
2. Run:
   ```bash
   python seed_db.py
   ```

### 2. Test the Deployment

**Frontend Test**:
1. Visit your Vercel URL
2. You should see the login page
3. Try registering a new account
4. Login and navigate to Dashboard, Demo, Audit Log

**Backend Test**:
1. Visit `https://your-render-url.onrender.com/health`
2. Should return: `{"status":"healthy","service":"providercard-api"}`
3. Visit `https://your-render-url.onrender.com/docs`
4. Should see FastAPI Swagger documentation

**Full Integration Test**:
1. Login with seeded account:
   - Email: `dr.sarah.johnson@example.com`
   - Password: `Demo123!`
2. Go to Demo Dashboard (`/demo`)
3. Click "Detect Discrepancies" - should show comparison
4. Click "Export FHIR Bundle" - should download JSON
5. Click "See Time Savings Story" - should open guided flow

### 3. Verify HTTPS

Both Vercel and Render provide automatic HTTPS:
- ✅ Vercel: SSL automatically provisioned
- ✅ Render: Free SSL with Let's Encrypt

Check for the padlock icon in your browser.

---

## Environment Variables Summary

### Frontend (Vercel)

| Variable | Value | Description |
|----------|-------|-------------|
| `NEXT_PUBLIC_API_URL` | `https://your-backend.onrender.com` | Backend API URL |

### Backend (Render)

| Variable | Example Value | Description |
|----------|---------------|-------------|
| `SECRET_KEY` | `abc123...` (random) | JWT signing key |
| `DATABASE_URL` | `sqlite:///./providercard.db` | Database connection |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` | CORS allowed origins |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `10080` (7 days) | JWT expiration |

---

## Custom Domain Setup (Optional)

### Vercel (Frontend)

1. **Add Domain**:
   - Project Settings → Domains
   - Enter your domain (e.g., `app.providercard.com`)
   - Follow DNS configuration instructions

2. **DNS Records** (at your domain registrar):
   ```
   Type: CNAME
   Name: app (or @)
   Value: cname.vercel-dns.com
   ```

3. **SSL**: Automatic via Vercel

### Render (Backend)

1. **Add Custom Domain**:
   - Service → Settings → Custom Domains
   - Enter your domain (e.g., `api.providercard.com`)

2. **DNS Records**:
   ```
   Type: CNAME
   Name: api
   Value: [Render provides this]
   ```

3. **SSL**: Automatic via Let's Encrypt

---

## Monitoring & Logs

### Vercel

**View Logs**:
- Dashboard → Your Project → Deployments → Click deployment → Logs

**Real-time Logs**:
```bash
vercel logs https://your-app.vercel.app
```

**Analytics**:
- Project → Analytics (built-in web analytics)

### Render

**View Logs**:
- Dashboard → Your Service → Logs tab
- Real-time log streaming
- Filter by error/warning levels

**Metrics**:
- Events tab shows deployments
- Metrics tab shows CPU/Memory usage

**Alerts**:
- Can configure email/Slack notifications for failures

---

## CI/CD (Automatic Deployments)

### Vercel
✅ **Already configured** via `vercel.json`
- Automatically deploys on every push to `main`
- Preview deployments for pull requests
- No additional setup needed

### Render
✅ **Already configured** via `render.yaml`
- Automatically deploys on every push to `main`
- Can configure branch-specific deployments
- Auto-deploy is ON by default

**Disable Auto-Deploy** (if needed):
- Service → Settings → Build & Deploy → Toggle off

---

## Rollback Procedure

### Vercel

**Option 1: Dashboard**
1. Deployments tab
2. Find previous successful deployment
3. Click "..." → "Promote to Production"

**Option 2: CLI**
```bash
vercel rollback
```

### Render

**Option 1: Dashboard**
1. Deploys tab
2. Find previous successful deploy
3. Click "Redeploy" on that commit

**Option 2: Git**
```bash
git revert HEAD
git push origin main
# Render will auto-deploy the reverted commit
```

---

## Troubleshooting

### Issue: Frontend can't connect to backend

**Symptoms**:
- Network errors in browser console
- "Failed to fetch" errors

**Solutions**:
1. Check `NEXT_PUBLIC_API_URL` is set correctly in Vercel
2. Verify backend is running: visit `https://backend-url/health`
3. Check CORS: ensure `ALLOWED_ORIGINS` includes frontend URL
4. Check browser console for specific error messages

### Issue: Backend 500 errors

**Symptoms**:
- API returns "Internal Server Error"

**Solutions**:
1. Check Render logs for Python errors
2. Verify all environment variables are set
3. Check database file exists and is writable
4. Verify `SECRET_KEY` is set

### Issue: Database resets on Render

**Cause**: Free tier has ephemeral storage

**Solutions**:
1. Upgrade to paid tier for persistent disk
2. Use external database (PostgreSQL on Render)
3. Accept data resets and re-seed as needed
4. For production, configure PostgreSQL:
   ```
   DATABASE_URL=postgresql://user:pass@host/db
   ```

### Issue: Build fails on Vercel

**Solutions**:
1. Check build logs in Vercel dashboard
2. Ensure `package.json` is in frontend directory
3. Verify Node version compatibility
4. Try clearing build cache: Settings → Clear Cache

### Issue: Build fails on Render

**Solutions**:
1. Check build logs in Render dashboard
2. Verify `requirements.txt` includes all dependencies
3. Check Python version (should be 3.9+)
4. Verify root directory is set to `backend`

---

## Performance Optimization

### Frontend (Vercel)

1. **Enable Edge Network**:
   - Already enabled by default
   - CDN caching for static assets

2. **Image Optimization**:
   - Use Next.js Image component for any images
   - Automatic WebP conversion

3. **Analytics**:
   - Enable Vercel Analytics for performance insights
   - Settings → Analytics → Enable

### Backend (Render)

1. **Upgrade Instance**:
   - Free tier: Spins down after inactivity (slow first request)
   - Starter ($7/mo): Always on, faster
   - Pro ($85/mo): 4GB RAM, autoscaling

2. **Add Redis Caching** (optional):
   - Create Redis instance on Render
   - Cache FHIR resources, NPPES comparisons
   - Reduce database queries

3. **Database Optimization**:
   - Upgrade to PostgreSQL for production
   - Add indexes on frequently queried fields
   - Enable query logging to identify slow queries

---

## Security Checklist

- [x] HTTPS enabled (Vercel + Render provide free SSL)
- [x] CORS configured properly
- [x] JWT secret is random and secure
- [x] Environment variables not committed to Git
- [x] API authentication required for all protected endpoints
- [ ] Rate limiting (add if needed)
- [ ] Input validation on all endpoints (already implemented)
- [ ] SQL injection prevention (using SQLAlchemy ORM ✅)
- [ ] XSS prevention (React escapes by default ✅)

**Recommended Additions**:
1. Add rate limiting middleware to FastAPI
2. Enable Vercel Security Headers
3. Configure Content Security Policy (CSP)
4. Add request size limits
5. Enable Render IP allowlisting (if needed)

---

## Scaling Considerations

### When to Scale

**Indicators**:
- Response times > 1 second
- High CPU/memory usage in Render metrics
- Free tier backend sleeping too often
- Multiple concurrent users experiencing slowness

### Scaling Options

**Vertical Scaling** (Render):
- Free → Starter: $7/mo (always on, 512MB RAM)
- Starter → Pro: $85/mo (4GB RAM)
- Pro → Pro Plus: $170/mo (8GB RAM)

**Horizontal Scaling**:
- Multiple Render instances with load balancer
- Requires paid tier
- Good for high availability

**Database Scaling**:
- SQLite → PostgreSQL (Render provides managed Postgres)
- Enable connection pooling
- Add read replicas for high read volumes

**CDN** (Vercel):
- Already using Vercel's Edge Network
- 100% uptime SLA on Pro plan
- Global edge caching

---

## Backup & Disaster Recovery

### Database Backups (Production)

**Manual Backup**:
```bash
# From Render shell
sqlite3 providercard.db .dump > backup.sql

# Or export FHIR bundles for all providers
python -c "from app.main import export_all_data; export_all_data()"
```

**Automated Backups** (PostgreSQL):
- Render Postgres includes daily backups
- Upgrade to Standard plan for point-in-time recovery

### Code Repository

- ✅ Already on GitHub
- Consider enabling branch protection on `main`
- Require pull request reviews for production changes

### Configuration Backups

- Document all environment variables
- Store backup of `.env` files securely (1Password, etc.)
- Version control deployment configs (vercel.json, render.yaml)

---

## Costs Estimate

### Free Tier (Demo/Development)

| Service | Cost | Limitations |
|---------|------|-------------|
| Vercel | $0 | 100GB bandwidth, 6000 build minutes |
| Render | $0 | Sleeps after 15 min inactivity, 750 hrs/mo |
| **Total** | **$0/month** | Good for demo, not production |

### Production Setup

| Service | Plan | Cost | Features |
|---------|------|------|----------|
| Vercel | Pro | $20/mo | 1TB bandwidth, unlimited builds |
| Render Backend | Starter | $7/mo | Always on, 512MB RAM |
| Render PostgreSQL | Starter | $7/mo | 1GB storage, daily backups |
| **Total** | | **$34/month** | Production-ready |

### Enterprise Setup

| Service | Plan | Cost | Features |
|---------|------|------|----------|
| Vercel | Enterprise | Custom | SLA, dedicated support, SOC 2 |
| Render Backend | Pro | $85/mo | 4GB RAM, autoscaling |
| Render PostgreSQL | Standard | $20/mo | 10GB, point-in-time recovery |
| **Total** | | **$105+/month** | High availability, compliance |

---

## Next Steps After Deployment

1. **Test all features** in production environment
2. **Set up monitoring** (Sentry, LogRocket, etc.)
3. **Configure alerts** for downtime/errors
4. **Add custom domain** (if desired)
5. **Enable analytics** to track usage
6. **Document API** for external integrations
7. **Create user documentation** for providers
8. **Set up staging environment** (separate Vercel/Render deployments)
9. **Configure backup procedures**
10. **Plan for scaling** based on user growth

---

## Quick Deploy Commands

```bash
# Frontend (from project root)
vercel --cwd frontend --prod

# Backend (manual - via Render dashboard)
# Or: git push origin main (auto-deploys)

# View logs
vercel logs https://your-app.vercel.app
# Render logs: dashboard → service → Logs tab
```

---

## Support & Resources

**Vercel**:
- Documentation: https://vercel.com/docs
- Support: https://vercel.com/support
- Status: https://www.vercel-status.com

**Render**:
- Documentation: https://render.com/docs
- Support: support@render.com
- Status: https://status.render.com

**FastAPI**:
- Documentation: https://fastapi.tiangolo.com
- GitHub: https://github.com/tiangolo/fastapi

**Next.js**:
- Documentation: https://nextjs.org/docs
- GitHub: https://github.com/vercel/next.js

---

## Deployment Completed! 🎉

Your ProviderCard application is now ready for deployment:

✅ Code committed to GitHub
✅ Build tested and passing
✅ Deployment configurations in place
✅ Documentation complete

**Manual Step Required**:
Please complete the Vercel and Render deployments using the instructions above. The interactive CLI deployment requires authentication which cannot be automated in this environment.

**Estimated Total Setup Time**: 20-30 minutes
