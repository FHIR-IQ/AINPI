# Fix API URL Configuration for Serverless Architecture

## Issue Identified

The browser console shows:
```
your-backend.onrender.com/api/auth/register:1 Failed to load resource: the server responded with a status of 404 ()
```

This means the app is trying to call an external backend at `your-backend.onrender.com` instead of using the Next.js serverless API routes.

## Root Cause

There are TWO issues:

1. **next.config.js** was defaulting to `http://localhost:8000` (old backend server)
2. **Vercel environment variable** `NEXT_PUBLIC_API_URL` is likely set to `https://your-backend.onrender.com`

## Fixes Applied

### 1. Fixed next.config.js (DONE - committed)
Changed default from `http://localhost:8000` to empty string `''` for serverless architecture.

### 2. Remove/Update Vercel Environment Variable (ACTION REQUIRED)

You need to **REMOVE or UPDATE** the `NEXT_PUBLIC_API_URL` environment variable in Vercel:

**Option A: Remove the variable (RECOMMENDED)**
1. Go to https://vercel.com/dashboard
2. Select your AINPI project
3. Go to **Settings** → **Environment Variables**
4. Find `NEXT_PUBLIC_API_URL`
5. Click **...** → **Delete**
6. Redeploy

**Option B: Set it to empty string**
1. Go to https://vercel.com/dashboard
2. Select your AINPI project
3. Go to **Settings** → **Environment Variables**
4. Find `NEXT_PUBLIC_API_URL`
5. Click **Edit**
6. Set value to: (leave completely empty - no value at all)
7. Save
8. Redeploy

## Why This Matters

For serverless architecture (Next.js API routes):
- API calls should go to `/api/*` (relative paths on the same domain)
- **NOT** to external domains like `your-backend.onrender.com`

The app structure:
```
Frontend: https://ainpi.vercel.app
API Routes: https://ainpi.vercel.app/api/auth/login (same domain!)
           https://ainpi.vercel.app/api/auth/register
           https://ainpi.vercel.app/api/practitioners/me
           etc.
```

## After Fixing

Once you remove/clear the `NEXT_PUBLIC_API_URL` variable and redeploy:

✓ API calls will use relative paths: `/api/auth/login`
✓ These resolve to: `https://ainpi.vercel.app/api/auth/login`
✓ Next.js API routes will handle the requests
✓ Database queries will work via Prisma + Supabase
✓ Authentication will work with JWT_SECRET

## Test After Fix

Try logging in with:
- Email: `dr.sarah.smith@example.com`
- Password: `Demo123!`

The 404 errors should be gone and authentication should work!
