# Database Schema Update - Provider Fields

## Issue
Provider save was failing with error:
```
Invalid `prisma.practitioner.create()` invocation:
The column `specialties` does not exist in the current database.
```

## Root Cause
The Prisma schema was updated to include new JSON fields for provider data, but these changes were not pushed to the Supabase production database.

## Resolution
Pushed updated Prisma schema to Supabase using `prisma db push`.

## New Columns Added

The following JSON columns were added to the `practitioners` table:

1. **specialties** (jsonb)
   - Array of specialty objects: `{code, display, isPrimary}`
   - Example: `[{code: '207R00000X', display: 'Internal Medicine', isPrimary: true}]`

2. **licenses** (jsonb)
   - Array of license objects: `{state, licenseNumber, type, status, expirationDate}`
   - Example: `[{state: 'NY', licenseNumber: '12345', type: 'MD', status: 'active', expirationDate: '2025-12-31'}]`

3. **practice_locations** (jsonb)
   - Array of location objects: `{name, addressLine1, addressLine2, city, state, zipCode, phone, isPrimary}`
   - Example: `[{name: 'Main Office', addressLine1: '123 Main St', city: 'New York', state: 'NY', zipCode: '10001', phone: '555-0100', isPrimary: true}]`

4. **insurance_plans** (jsonb)
   - Array of insurance plan objects: `{carrier, planName, lob, networkStatus, acceptingNewPatients}`
   - Example: `[{carrier: 'Blue Cross', planName: 'PPO', lob: 'Commercial', networkStatus: 'in-network', acceptingNewPatients: true}]`

## Verification

Verified all columns exist in production database:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'practitioners'
ORDER BY ordinal_position;
```

Results: ✓ All 30 columns present, including the 4 new JSON fields

## Status
✓ Schema update complete
✓ Production database synchronized
✓ Provider creation should now work

## Next Steps
Test provider creation via `/providers/new` form to confirm the fix works in production.
