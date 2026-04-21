import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendDownloadThanks, sendSubscribeWelcome } from '@/lib/email';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REPORT_VERSION = 'v1.0.0';
const REDIRECT_URL = `/downloads/ainpi-state-of-ndh-${REPORT_VERSION}.pdf`;

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
  const cleanName =
    typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : null;

  try {
    await prisma.reportDownload.create({
      data: {
        email: normalizedEmail,
        name: cleanName,
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
      const existing = await prisma.subscriber.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      await prisma.subscriber.upsert({
        where: { email: normalizedEmail },
        update: { source: 'download_gate' },
        create: { email: normalizedEmail, source: 'download_gate' },
      });
      if (!existing) {
        void sendSubscribeWelcome(normalizedEmail);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[download-report] capture failed:', msg);
    // Fail open — still return the redirect so the user gets the report
  }

  // Build an absolute URL for the PDF so the welcome email is clickable
  // from any inbox, not just when viewed next to the app.
  const origin = req.headers.get('origin') || req.headers.get('x-forwarded-host')
    ? `https://${req.headers.get('x-forwarded-host') || 'ainpi.vercel.app'}`
    : 'https://ainpi.vercel.app';
  const pdfAbsoluteUrl = `${origin}${REDIRECT_URL}`;
  void sendDownloadThanks(normalizedEmail, cleanName, pdfAbsoluteUrl);

  return NextResponse.json({ ok: true, redirect: REDIRECT_URL });
}
