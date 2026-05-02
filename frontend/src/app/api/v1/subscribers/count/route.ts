/**
 * GET /api/v1/subscribers/count
 *
 * Returns the current Subscriber count as a single integer. Public —
 * no PII (no emails, no metadata). Used by the homepage / footer
 * "Join N readers" counter.
 *
 * Caches for 60 seconds at the edge so we don't hit Supabase on every
 * page-load. The count is an order-of-magnitude signal; minute-level
 * staleness is fine.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export async function GET() {
  try {
    const count = await prisma.subscriber.count();
    return NextResponse.json(
      { count },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      },
    );
  } catch (err) {
    // If Supabase is unreachable / the table is missing in a fresh deploy,
    // return null rather than 500 — the UI is purely cosmetic.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[subscribers/count] failed:', msg);
    return NextResponse.json(
      { count: null, error: 'unavailable' },
      { status: 200 },
    );
  }
}
