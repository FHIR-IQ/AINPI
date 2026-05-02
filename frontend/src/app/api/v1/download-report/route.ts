import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendDownloadThanks, sendSubscribeWelcome } from '@/lib/email';
import { findReport, DEFAULT_REPORT_ID } from '@/data/reports';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    reportId,
  } = (body ?? {}) as {
    email?: string;
    name?: string;
    organization?: string;
    useCase?: string;
    alsoSubscribe?: boolean;
    reportId?: string;
  };

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }

  // Resolve the requested report; fall back to the default for back-compat
  // with older clients (the form pre-this-PR didn't send reportId).
  const requestedId =
    typeof reportId === 'string' && reportId.trim()
      ? reportId.trim()
      : DEFAULT_REPORT_ID;
  const report = findReport(requestedId);
  if (!report) {
    return NextResponse.json(
      { error: `unknown reportId: ${requestedId}` },
      { status: 400 },
    );
  }

  const normalizedEmail = email.trim().toLowerCase();

  const cleanName =
    typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : null;

  // Best-effort capture of contact info; a DB failure should still let
  // the user read the report (fail open), since failing closed would
  // reward a misconfigured deploy by blocking public research.
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
        reportVersion: report.version,
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

  // Build an absolute URL for whichever report was selected so the
  // welcome email is clickable from any inbox.
  const xfHost = req.headers.get('x-forwarded-host');
  const origin = xfHost
    ? `https://${xfHost}`
    : req.headers.get('origin') || 'https://ainpi.dev';
  const absoluteUrl = `${origin}${report.url}`;
  void sendDownloadThanks(normalizedEmail, cleanName, absoluteUrl);

  return NextResponse.json({
    ok: true,
    redirect: report.url,
    report: { id: report.id, title: report.title, format: report.format },
  });
}
