/**
 * scripts/probe-suppression-rls.ts
 *
 * Post-setup probe for prisma/sql/npi_suppressions.sql: asks the public
 * Supabase REST API (PostgREST) for the table with the publishable key,
 * count only, and fails unless the answer is "no access" or zero rows.
 * Prints status and count, never a row.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * (from frontend/.env.local).
 *
 * Usage from frontend/:  npx tsx scripts/probe-suppression-rls.ts
 */
async function main() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
    process.exit(2);
  }
  const res = await fetch(`${base.replace(/\/$/, '')}/rest/v1/npi_suppressions?select=npi`, {
    method: 'HEAD',
    headers: { apikey: key, Prefer: 'count=exact' },
  });
  const range = res.headers.get('content-range') ?? '';
  const count = range.includes('/') ? range.split('/')[1] : null;
  console.log(`PostgREST status ${res.status}, count ${count ?? '(none)'}`);
  const denied = res.status === 401 || res.status === 403 || res.status === 404;
  const empty = res.ok && count === '0';
  if (denied || empty) {
    console.log('OK: the public API exposes no rows of npi_suppressions.');
    return;
  }
  console.error('FAIL: the public API can count rows of npi_suppressions. Re-run the REVOKE and RLS steps.');
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
