# Vercel Configuration Fix

## Issue
Getting 404 error on https://ainpi.vercel.app because Vercel doesn't know the root directory is `frontend`.

## Solution

### Option 1: Via Vercel Dashboard (Recommended)

1. Go to https://vercel.com/dashboard
2. Find your `ainpi` project
3. Go to **Settings** → **General**
4. Scroll to **Root Directory**
5. Set to: `frontend`
6. Click **Save**
7. Go to **Deployments**
8. Click **⋯** on latest deployment
9. Click **Redeploy**

### Option 2: Via vercel.json (Committed)

A `vercel.json` file has been added to the project root with the correct configuration.

After this commit, go to Vercel Dashboard and redeploy:
1. Go to Deployments tab
2. Click **Redeploy** on the latest deployment

## Expected Result

After redeployment:
- ✅ https://ainpi.vercel.app will load correctly
- ✅ Homepage will show the ProviderCard landing page
- ✅ Login page will be at https://ainpi.vercel.app/login
- ✅ All API routes will work

## Verification Steps

Once redeployed, test:
1. Visit https://ainpi.vercel.app (should show homepage)
2. Go to https://ainpi.vercel.app/login
3. Login with: dr.sarah.smith@example.com / Demo123!
4. Verify dashboard loads

## Quick Commands

```bash
# View deployments
vercel ls

# View logs
vercel logs

# Force redeploy
vercel --prod --force
```
