# Seed Vercel Database with Major Payer APIs

## Quick Fix: Switch to Perplexity

Your OpenAI quota is exceeded. Switch back to Perplexity:

### In Vercel Dashboard:
1. Go to https://vercel.com/dashboard
2. Select your AINPI project
3. Go to **Settings** → **Environment Variables**
4. Find `AI_PROVIDER` and change value to: `perplexity`
5. Click **Save**
6. Redeploy or wait for next deployment

**OR delete AI_PROVIDER variable entirely** (defaults to Perplexity)

---

## Seed Database via Vercel CLI

### Step 1: Install and Login to Vercel CLI

```bash
# If not already installed
npm install -g vercel

# Login to Vercel
vercel login
```

### Step 2: Link Your Project

```bash
cd /Users/eugenevestel/Documents/GitHub/AINPI/frontend
vercel link
```

Follow prompts:
- Set up and deploy? **No**
- Which scope? Select your account
- Link to existing project? **Yes**
- Project name: **AINPI** (or your project name)

### Step 3: Pull Environment Variables

```bash
vercel env pull .env.vercel
```

This downloads your Vercel environment variables to `.env.vercel`

### Step 4: Run Seed Script with Vercel Environment

```bash
# Load environment variables and run seed script
source .env.vercel && npx tsx prisma/seed-major-payer-apis.ts
```

**OR** if source doesn't work on your system:

```bash
# Run with environment variables from Vercel
POSTGRES_PRISMA_URL="$(vercel env pull .env.vercel && cat .env.vercel | grep POSTGRES_PRISMA_URL | cut -d '=' -f2-)" \
POSTGRES_URL_NON_POOLING="$(cat .env.vercel | grep POSTGRES_URL_NON_POOLING | cut -d '=' -f2-)" \
npx tsx prisma/seed-major-payer-apis.ts
```

### Step 5: Verify Seeding

You should see:

```
🏥 Seeding database with major health insurance payer APIs...

✅ UnitedHealthcare
   Endpoint: https://api.uhc.com/fhir/provider-directory/v1
   Type: fhir | Auth: Required
   Supports: NPI=true | Name=true

✅ Elevance Health (Anthem)
   ...

✨ Successfully seeded 9 insurance payer APIs!
```

---

## Alternative: Manual Seed via Supabase SQL Editor

If Vercel CLI doesn't work, you can seed directly via Supabase:

### Step 1: Go to Supabase Dashboard

1. Visit https://supabase.com/dashboard
2. Select your project
3. Go to **SQL Editor**

### Step 2: Run This SQL

Copy and paste this SQL to create the 9 payer records:

```sql
-- Insert major payer APIs
INSERT INTO provider_directory_apis (
  id,
  organization_name,
  organization_type,
  state,
  api_endpoint,
  api_type,
  api_doc_url,
  requires_auth,
  auth_type,
  supports_npi_search,
  supports_name_search,
  search_param_format,
  status,
  discovered_by,
  discovery_source,
  notes,
  created_at,
  updated_at
) VALUES
-- 1. UnitedHealthcare
(gen_random_uuid(), 'UnitedHealthcare', 'insurance_payer', NULL,
 'https://api.uhc.com/fhir/provider-directory/v1', 'fhir',
 'https://www.uhc.com/legal/interoperability-apis', true, 'oauth',
 true, true,
 '{"npi":"Practitioner?identifier={npi}","name":"Practitioner?name={last_name}"}'::jsonb,
 'discovered', 'manual', 'cms_interoperability_mandate',
 'Requires registration at apimarketplace.uhcprovider.com. Supports FHIR R4 and DaVinci PDEX Plan Net IG.',
 NOW(), NOW()),

-- 2. Elevance Health (Anthem)
(gen_random_uuid(), 'Elevance Health (Anthem)', 'insurance_payer', NULL,
 'https://totalview.healthos.elevancehealth.com/resources/registered/anthem/api/v1/fhir', 'fhir',
 'https://www.anthem.com/developers', false, 'none',
 true, true,
 '{"npi":"Practitioner?identifier={npi}","name":"Practitioner?name={last_name}"}'::jsonb,
 'discovered', 'manual', 'cms_interoperability_mandate',
 'Public endpoint for Provider Directory. Follows HL7 R4 FHIR and DaVinci PDEX Plan Net IG.',
 NOW(), NOW()),

-- 3. Centene Corporation
(gen_random_uuid(), 'Centene Corporation', 'insurance_payer', NULL,
 'https://fhir.centene.com/provider-directory/v1', 'fhir',
 'https://www.centene.com/developers', false, 'none',
 true, true,
 '{"npi":"Practitioner?identifier={npi}","name":"Practitioner?name={last_name}"}'::jsonb,
 'discovered', 'manual', 'cms_interoperability_mandate',
 'Operates multiple brands including Ambetter, Health Net, Fidelis Care, etc.',
 NOW(), NOW()),

-- 4. Humana
(gen_random_uuid(), 'Humana', 'insurance_payer', NULL,
 'https://fhir.humana.com/api/Practitioner', 'fhir',
 'https://developers.humana.com/apis/provider-directory-api/doc', false, 'none',
 true, true,
 '{"npi":"Practitioner?identifier={npi}","name":"Practitioner?name={last_name}"}'::jsonb,
 'discovered', 'manual', 'cms_interoperability_mandate',
 'Public FHIR endpoints. Supports Organization, PractitionerRole, Location, InsurancePlan resources.',
 NOW(), NOW()),

-- 5. Aetna (CVS Health)
(gen_random_uuid(), 'Aetna (CVS Health)', 'insurance_payer', NULL,
 'https://api.aetna.com/fhir/provider-directory/v1', 'fhir',
 'https://developerportal.aetna.com/', true, 'oauth',
 true, true,
 '{"npi":"Practitioner?identifier={npi}","name":"Practitioner?name={last_name}"}'::jsonb,
 'discovered', 'manual', 'cms_interoperability_mandate',
 'Requires registration at developerportal.aetna.com. Part of CVS Health.',
 NOW(), NOW()),

-- 6. Kaiser Permanente
(gen_random_uuid(), 'Kaiser Permanente', 'insurance_payer', NULL,
 'https://api.kp.org/fhir/provider-directory/v1', 'fhir',
 'https://developer.kp.org/', false, 'none',
 true, true,
 '{"npi":"Practitioner?identifier={npi}","name":"Practitioner?name={last_name}"}'::jsonb,
 'discovered', 'manual', 'cms_interoperability_mandate',
 'Integrated health system with insurance. Regional coverage in select states.',
 NOW(), NOW()),

-- 7. Cigna Healthcare
(gen_random_uuid(), 'Cigna Healthcare', 'insurance_payer', NULL,
 'https://fhir.cigna.com/ProviderDirectory/v1', 'fhir',
 'https://developer.cigna.com/docs/service-apis/provider-directory/docs', true, 'oauth',
 true, true,
 '{"npi":"Practitioner?identifier={npi}","name":"Practitioner?name={last_name}"}'::jsonb,
 'discovered', 'manual', 'cms_interoperability_mandate',
 'Developer sandbox available at developer.cigna.com. Supports FHIR R4.',
 NOW(), NOW()),

-- 8. Health Care Service Corporation (BCBS)
(gen_random_uuid(), 'Health Care Service Corporation (BCBS)', 'insurance_payer', NULL,
 'https://api.hcsc.com/fhir/provider-directory/v1', 'fhir',
 'https://www.hcsc.com/developers', false, 'none',
 true, true,
 '{"npi":"Practitioner?identifier={npi}","name":"Practitioner?name={last_name}"}'::jsonb,
 'discovered', 'manual', 'cms_interoperability_mandate',
 'Operates BCBS plans in Illinois, Texas, New Mexico, Oklahoma, and Montana.',
 NOW(), NOW()),

-- 9. Molina Healthcare
(gen_random_uuid(), 'Molina Healthcare', 'insurance_payer', NULL,
 'https://fhir.molinahealthcare.com/provider-directory/v1', 'fhir',
 'https://www.molinahealthcare.com/developers', false, 'none',
 true, true,
 '{"npi":"Practitioner?identifier={npi}","name":"Practitioner?name={last_name}"}'::jsonb,
 'discovered', 'manual', 'cms_interoperability_mandate',
 'Focuses on Medicaid, Medicare, and Marketplace plans.',
 NOW(), NOW())
ON CONFLICT (organization_name, api_endpoint) DO NOTHING;

-- Verify insertion
SELECT organization_name, api_endpoint, api_type, requires_auth
FROM provider_directory_apis
WHERE organization_type = 'insurance_payer'
ORDER BY organization_name;
```

### Step 3: Click "Run"

You should see 9 rows inserted or "0 rows affected" if already seeded.

---

## Verify Seeding

### Check in Supabase

```sql
SELECT COUNT(*) FROM provider_directory_apis WHERE organization_type = 'insurance_payer';
```

Should return: **9**

### Test Magic Scanner

1. Go to your app's Magic Scanner page
2. Enter any NPI (e.g., `1023864154`)
3. Enter last name: `Smith`
4. Click **Start Magic Scan**
5. Check logs - you should see:
   ```
   [Magic Scanner] Step 2A: Found 9 pre-configured payer APIs
   ```

---

## Troubleshooting

### Error: "Module not found: Can't resolve '@prisma/client'"

Run in the frontend directory:
```bash
npm install
npx prisma generate
```

### Error: "Connection refused" or "ECONNREFUSED"

Check your database connection strings in `.env.vercel`:
```bash
cat .env.vercel | grep POSTGRES
```

Make sure they match your Supabase credentials.

### Error: "Unique constraint violation"

The APIs are already seeded! Verify with:
```sql
SELECT COUNT(*) FROM provider_directory_apis WHERE organization_type = 'insurance_payer';
```

---

## Success Indicators

✅ Seed script shows "Successfully seeded 9 insurance payer APIs"
✅ Supabase SQL query returns 9 payer records
✅ Magic Scanner logs show "Found 9 pre-configured payer APIs"
✅ API Discovery section shows major payers (UnitedHealthcare, Anthem, etc.)

---

## Next: Fix AI Provider

After seeding, switch `AI_PROVIDER` back to `perplexity` in Vercel to fix the scan errors!
