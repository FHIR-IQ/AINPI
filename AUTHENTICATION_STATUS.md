# Authentication Status & Troubleshooting

## Current Status

### What's Working
✓ Database schema updated with all required columns
✓ Provider creation API route fixed
✓ JWT_SECRET environment variable added to local `.env.local`
✓ API routes use correct paths (`/api/auth/login`, etc.)
✓ Serverless architecture configured correctly

### What Needs Verification

**1. Login Functionality**
- Test login at: https://ainpi.vercel.app/login
- Demo credentials:
  - Email: `dr.sarah.smith@example.com`
  - Password: `Demo123!`

**2. JWT_SECRET in Vercel Production**
- Needs to be set in Vercel dashboard
- Go to: Project Settings → Environment Variables
- Add: `JWT_SECRET` = `ainpi-production-jwt-secret-key-2025-change-this-in-production`

**3. NEXT_PUBLIC_API_URL in Vercel**
- Should be **removed** or set to empty string
- This was causing calls to `your-backend.onrender.com`
- For serverless, API calls should be relative paths

## Errors You're Seeing

### "Failed to load profile data" on Demo Page
**Error**: `Failed to load resource: the server responded with a status of 404`
**Cause**: One of these issues:
1. Not logged in (no token in localStorage)
2. Token is invalid (JWT_SECRET mismatch)
3. API route `/api/practitioners/me` not found

**How to test**:
1. Open browser console (F12)
2. Check `localStorage.getItem('token')` - should show a JWT token
3. Check Network tab for the failing request
4. Look at the actual URL being called

### "Error loading data: G"
**Likely cause**: Axios error when API returns 404 or 401

## Diagnostic Steps

### Step 1: Verify Environment Variables in Vercel
```bash
# These should be set in Vercel dashboard:
JWT_SECRET=ainpi-production-jwt-secret-key-2025-change-this-in-production
POSTGRES_PRISMA_URL=postgres://postgres.efrcxlsqqphcjhkxqweg:...
POSTGRES_URL_NON_POOLING=postgres://postgres.efrcxlsqqphcjhkxqweg:...

# These should NOT be set (or should be empty):
NEXT_PUBLIC_API_URL=  (empty or not set)
```

### Step 2: Test Login Flow
1. Go to https://ainpi.vercel.app/login
2. Enter demo credentials
3. Check browser console for errors
4. If successful, you should redirect to /dashboard
5. Check `localStorage.getItem('token')` in console

### Step 3: Test API Routes Directly
Once logged in, test these URLs directly:
- https://ainpi.vercel.app/api/demo/integrations (should work without auth)
- https://ainpi.vercel.app/api/practitioners/me (requires auth token)

### Step 4: Check Vercel Logs
Go to Vercel dashboard → Deployments → Latest → Functions
Look for errors in the function logs for `/api/auth/login`

## Expected Behavior

**Successful Login Flow**:
1. User enters credentials at `/login`
2. POST to `/api/auth/login` with email/password
3. API validates against database
4. Returns JWT token
5. Token stored in `localStorage`
6. Redirect to `/dashboard`
7. Dashboard loads practitioner data from `/api/practitioners/me`

**Demo Page Flow**:
1. Check for token in localStorage
2. If no token → redirect to `/login`
3. If token exists → call `/api/practitioners/me` with Authorization header
4. Display practitioner info
5. Load integrations from `/api/demo/integrations`

## Quick Fixes

### If login fails with "Login failed. Please check your credentials"
→ JWT_SECRET not set in Vercel or database password hash mismatch

### If login succeeds but demo page shows 404
→ API routes not deployed or base URL misconfigured

### If you get redirected to login from demo page
→ No token in localStorage (not logged in)

## Next Steps

1. **First**: Verify `JWT_SECRET` is set in Vercel production environment
2. **Second**: Verify `NEXT_PUBLIC_API_URL` is removed/empty in Vercel
3. **Third**: Redeploy to apply environment variable changes
4. **Fourth**: Test login with demo credentials
5. **Fifth**: Test demo page access

## Test Commands (Local)

```bash
# Test database connection
cd frontend
POSTGRES_PRISMA_URL="..." npx tsx -e "
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.practitioner.findUnique({where: {email: 'dr.sarah.smith@example.com'}})
  .then(p => console.log(p ? 'Found' : 'Not found'))
  .then(() => prisma.\$disconnect());
"

# Test password verification
cd frontend
npx tsx -e "
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.practitioner.findUnique({where: {email: 'dr.sarah.smith@example.com'}})
  .then(async p => {
    if (p) {
      const valid = await bcrypt.compare('Demo123!', p.passwordHash);
      console.log('Password valid:', valid);
    }
  })
  .then(() => prisma.\$disconnect());
"
```
