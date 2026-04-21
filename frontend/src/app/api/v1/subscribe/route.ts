import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_SOURCES = new Set([
  'subscribe_page',
  'hero',
  'footer',
  'download_gate',
  'unspecified',
]);

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { email, source } = (body ?? {}) as { email?: string; source?: string };

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedSource = source && VALID_SOURCES.has(source) ? source : 'unspecified';

  try {
    // Upsert so re-subscribes don't 500 on unique constraint
    await prisma.subscriber.upsert({
      where: { email: normalizedEmail },
      update: { source: normalizedSource },
      create: { email: normalizedEmail, source: normalizedSource },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If the table doesn't exist yet (Prisma migration pending), return
    // 503 so the UI can tell the user this is a deploy-state issue, not
    // their form. Log for the maintainer.
    console.error('[subscribe] failed:', msg);
    return NextResponse.json(
      { error: 'subscribe service unavailable' },
      { status: 503 },
    );
  }
}
