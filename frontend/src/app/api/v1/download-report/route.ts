import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REPORT_VERSION = 'v1.0.0';
const REDIRECT_URL = '/report';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const {
    email,
    name,
    organization,
    useCase,
    alsoSubscribe,
  } = (body ?? {}) as {
    email?: string;
    name?: string;
    organization?: string;
    useCase?: string;
    alsoSubscribe?: boolean;
  };

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Best-effort capture of contact info; a DB failure should still let
  // the user read the report (fail open), since failing closed would
  // reward a misconfigured deploy by blocking public research.
  try {
    await prisma.reportDownload.create({
      data: {
        email: normalizedEmail,
        name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : null,
        organization:
          typeof organization === 'string' && organization.trim()
            ? organization.trim().slice(0, 200)
            : null,
        useCase:
          typeof useCase === 'string' && useCase.trim()
            ? useCase.trim().slice(0, 2000)
            : null,
        reportVersion: REPORT_VERSION,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        userAgent: req.headers.get('user-agent')?.slice(0, 500) || null,
      },
    });

    if (alsoSubscribe) {
      await prisma.subscriber.upsert({
        where: { email: normalizedEmail },
        update: { source: 'download_gate' },
        create: { email: normalizedEmail, source: 'download_gate' },
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[download-report] capture failed:', msg);
    // Fail open — still return the redirect so the user gets the report
  }

  return NextResponse.json({ ok: true, redirect: REDIRECT_URL });
}
