# ProviderCard Deployment Guide

Complete guide for deploying ProviderCard to Vercel (frontend) and Render.com (backend).

## Prerequisites

- GitHub account
- Vercel account (free tier works)
- Render.com account (free tier works)
- Code pushed to GitHub repository

## Step 1: Deploy Backend to Render.com

### 1.1 Create Web Service

1. Go to [render.com](https://render.com) and sign in
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account and select the repository
4. Configure the service:

   **Service Name**: `providercard-api` (or your choice)
   **Root Directory**: `backend`
   **Environment**: `Python 3`
   **Region**: Choose closest to your users
   **Branch**: `main`
   **Build Command**: `pip install -r requirements.txt`
   **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### 1.2 Environment Variables

Add these environment variables in Render dashboard:

| Key | Value | Note |
|-----|-------|------|
| `SECRET_KEY` | (Click "Generate") | Auto-generate a secure key |
| `ALGORITHM` | `HS256` | JWT algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Token expiration |
| `DATABASE_URL` | `sqlite:///./providercard.db` | SQLite path |
| `ALLOWED_ORIGINS` | `https://your-vercel-app.vercel.app,http://localhost:3000` | Update after frontend deploy |
| `PAYER_API_URL` | `https://mock-payer-api.example.com` | Mock URL (for demo) |
| `STATE_BOARD_API_URL` | `https://mock-state-board.example.com` | Mock URL (for demo) |

### 1.3 Deploy

1. Click **"Create Web Service"**
2. Wait for deployment to complete (~5 minutes)
3. Note your backend URL: `https://providercard-api.onrender.com`

### 1.4 Test Backend

Visit: `https://providercard-api.onrender.com/health`

Expected response:
```json
{
  "status": "healthy",
  "service": "providercard-api"
}
```

Visit API docs: `https://providercard-api.onrender.com/docs`

---

## Step 2: Deploy Frontend to Vercel

### 2.1 Import Project

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **"Add New..."** → **"Project"**
3. Import your GitHub repository
4. Vercel auto-detects Next.js configuration

### 2.2 Configure Project

**Root Directory**: `frontend`
**Framework Preset**: Next.js
**Build Command**: (leave default) `npm run build`
**Output Directory**: (leave default) `.next`
**Install Command**: (leave default) `npm install`

### 2.3 Environment Variables

Add in Vercel dashboard:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://providercard-api.onrender.com` |

Replace with your actual Render.com backend URL from Step 1.

### 2.4 Deploy

1. Click **"Deploy"**
2. Wait for deployment (~2 minutes)
3. Note your frontend URL: `https://providercard-poc.vercel.app`

### 2.5 Update Backend CORS

Go back to Render.com dashboard:

1. Select your web service
2. Go to **Environment** tab
3. Update `ALLOWED_ORIGINS` to include your Vercel URL:
   ```
   https://providercard-poc.vercel.app,http://localhost:3000
   ```
4. Save and redeploy

---

## Step 3: Test Deployment

### 3.1 Access Application

Open: `https://providercard-poc.vercel.app`

### 3.2 Register New Account

1. Click "Create your account"
2. Fill in:
   - First Name: `Jane`
   - Last Name: `Smith`
   - Email: `doctor@example.com`
   - NPI: `1234567890` (any 10 digits)
   - Password: `password123`
3. Click "Create account"

You should be logged in and see the dashboard.

### 3.3 Edit Profile

1. Fill out profile information:
   - Phone, address
   - Specialty (e.g., `207R00000X` - Internal Medicine)
   - Practice details
   - License information
   - Accepted insurances
2. Click **"Save Profile"**
3. Verify profile completeness score updates

### 3.4 Test Sync

1. Click **"Sync to External Systems"**
2. Wait for sync to complete
3. You should see success message

### 3.5 View Audit Log

1. Click **"Audit Log"** in navbar
2. Verify sync events are displayed
3. Check status, duration, and timestamps

---

## Step 4: Custom Domain (Optional)

### Frontend (Vercel)

1. In Vercel dashboard, go to **Settings** → **Domains**
2. Add your custom domain (e.g., `app.providercard.io`)
3. Update DNS records as instructed
4. SSL certificate auto-configured

### Backend (Render)

1. In Render dashboard, go to **Settings** → **Custom Domain**
2. Add your custom domain (e.g., `api.providercard.io`)
3. Update DNS records as instructed
4. SSL certificate auto-configured

**Then update environment variables:**
- Vercel: Update `NEXT_PUBLIC_API_URL` to `https://api.providercard.io`
- Render: Update `ALLOWED_ORIGINS` to include `https://app.providercard.io`

---

## Troubleshooting

### Backend Issues

**Problem**: 500 errors
**Solution**:
- Check Render logs: Dashboard → Logs tab
- Verify all environment variables are set
- Check DATABASE_URL path is correct

**Problem**: CORS errors
**Solution**:
- Verify ALLOWED_ORIGINS includes your frontend URL
- Check for trailing slashes (should not have them)
- Redeploy backend after updating CORS

### Frontend Issues

**Problem**: Can't connect to API
**Solution**:
- Verify NEXT_PUBLIC_API_URL in Vercel environment variables
- Check backend is healthy: `https://your-backend.onrender.com/health`
- Check browser console for errors

**Problem**: 404 on page refresh
**Solution**:
- This should not happen with Vercel + Next.js
- If it does, check vercel.json configuration

### Database Issues

**Problem**: Data not persisting
**Solution**:
- Render free tier restarts periodically, losing SQLite data
- For production, use PostgreSQL:
  1. Add PostgreSQL database in Render
  2. Update DATABASE_URL to PostgreSQL connection string
  3. Update requirements.txt to include `psycopg2-binary`

---

## Monitoring

### Render Metrics

- Dashboard → Metrics tab
- View CPU, memory, requests
- Check deployment logs

### Vercel Analytics

- Dashboard → Analytics tab
- View page views, performance
- Monitor error rates

---

## Updating Deployment

### Backend Updates

1. Push code to GitHub
2. Render auto-deploys from `main` branch
3. Monitor deployment in Render dashboard

### Frontend Updates

1. Push code to GitHub
2. Vercel auto-deploys from `main` branch
3. Preview deployments for pull requests

### Manual Redeploy

**Render**: Dashboard → Manual Deploy → Deploy latest commit
**Vercel**: Deployments tab → Redeploy

---

## Production Considerations

Before going to production:

### Security
- [ ] Replace SECRET_KEY with strong, unique key
- [ ] Enable rate limiting
- [ ] Add request validation
- [ ] Implement HTTPS everywhere
- [ ] Set up WAF (Cloudflare, AWS WAF)

### Database
- [ ] Migrate to PostgreSQL
- [ ] Set up automated backups
- [ ] Configure connection pooling
- [ ] Add database monitoring

### Monitoring
- [ ] Set up error tracking (Sentry)
- [ ] Configure uptime monitoring
- [ ] Add performance monitoring
- [ ] Set up log aggregation

### Compliance
- [ ] Conduct security audit
- [ ] Implement HIPAA controls
- [ ] Complete BAA agreements
- [ ] Document compliance measures

### Performance
- [ ] Add CDN (Vercel Edge, Cloudflare)
- [ ] Enable caching headers
- [ ] Optimize database queries
- [ ] Add Redis for caching

---

## Cost Estimates

### Free Tier Limits

**Render Free Tier**:
- 750 hours/month (enough for 1 service)
- Spins down after 15 min inactivity
- Spins up on request (~30s delay)
- 512 MB RAM
- Shared CPU

**Vercel Free Tier**:
- 100 GB bandwidth/month
- 100 hours serverless function execution
- Unlimited deployments
- Custom domains supported

### Paid Plans (if needed)

**Render Starter**: $7/month
- Always on (no spin down)
- More RAM and CPU

**Vercel Pro**: $20/month
- Advanced analytics
- Team features
- Higher limits

---

## Support

If you encounter issues:

1. **Check Documentation**: Review README and this deployment guide
2. **Check Logs**:
   - Render: Dashboard → Logs
   - Vercel: Deployment → Function Logs
3. **GitHub Issues**: Report bugs in repository issues
4. **Community**: Render and Vercel have support forums

---

**Deployment Status Checklist**:

- [ ] Backend deployed to Render.com
- [ ] Backend health check passes
- [ ] Backend API docs accessible
- [ ] Frontend deployed to Vercel
- [ ] Frontend loads in browser
- [ ] User registration works
- [ ] User login works
- [ ] Profile editing works
- [ ] Sync functionality works
- [ ] Audit log displays correctly
- [ ] CORS configured properly
- [ ] Environment variables set
- [ ] Custom domains configured (optional)

---

**Next Steps**: See [README.md](./README.md) for usage instructions and [specs/](./specs/) for technical details.
