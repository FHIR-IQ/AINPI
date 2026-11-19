/**
 * POST /api/v1/npd-mcp/participate
 *
 * Sign-up for the NPD MCP working group (/npd-mcp). No account. Writes one
 * NpdMcpParticipant row per submission (a repeat submission is a second row
 * with the same answer, never an error) and fires an admin alert without
 * blocking the response.
 *
 * Rate limit: per IP, 5 a minute and 20 a UTC day, through the shared
 * rate_limit_buckets counter in its own `npdmcp:` namespace, checked before
 * the body is parsed so malformed posts count too. If the counter cannot be
 * reached (bump returns null) the submission is allowed. The route touches no
 * paid service, so it is not in ROUTE_COST.
 *
 * A body over MAX_BODY_BYTES (by content-length) gets 413. A filled honeypot
 * field (`website`, hidden from people) gets the same 200 as a real sign-up
 * and stores nothing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { bump, clientIp } from '@/lib/rate-limit';
import { sendNpdMcpSignupAlert } from '@/lib/admin-email';
import { parseSignup } from '@/lib/npd-mcp-signup';

export const dynamic = 'force-dynamic';

const PER_MINUTE = 5;
const PER_DAY = 20;
const MAX_BODY_BYTES = 16_384;

function errorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; name?: unknown };
    if (typeof e.code === 'string' && e.code) return e.code;
    if (typeof e.name === 'string' && e.name) return e.name;
  }
  return 'unknown';
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  const day = Math.floor(now / 86_400_000);

  const perMinute = await bump(`npdmcp:ip:${ip}:m:${minute}`, 1, 120_000);
  if (perMinute !== null && perMinute > PER_MINUTE) {
    return fail(429, 'Too many submissions. Please try again later.');
  }
  const perDay = await bump(`npdmcp:ip:${ip}:d:${day}`, 1, 172_800_000);
  if (perDay !== null && perDay > PER_DAY) {
    return fail(429, 'Too many submissions. Please try again later.');
  }

  const length = Number(req.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return fail(413, 'Please shorten your answers and try again.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Please fill in the form and try again.');
  }

  // Honeypot: people never see this field, so a value means a bot. Answer as
  // if it worked so the bot learns nothing, and store nothing.
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const trap = (body as Record<string, unknown>).website;
    if (typeof trap === 'string' && trap.trim() !== '') {
      return NextResponse.json({ ok: true });
    }
  }

  const parsed = parseSignup(body);
  if (!parsed.ok) return fail(400, parsed.error);
  const v = parsed.value;

  let id: string;
  try {
    const row = await prisma.npdMcpParticipant.create({
      data: {
        organization: v.organization,
        contactName: v.contactName,
        email: v.email,
        orgType: v.orgType,
        participation: v.participation,
        useCase: v.useCase,
        listPublicly: v.listPublicly,
        ipAddress: ip === 'unknown' ? null : ip,
        userAgent: req.headers.get('user-agent')?.slice(0, 500) || null,
      },
      select: { id: true },
    });
    id = row.id;
  } catch (err) {
    // Log the error code only, never the message or the submission: a
    // database error message can echo the values it was given.
    console.error('[npd-mcp] persist failed:', errorCode(err));
    return fail(503, 'Sign-up is not open yet. Please try again soon.');
  }

  void sendNpdMcpSignupAlert({
    id,
    organization: v.organization,
    contactName: v.contactName,
    email: v.email,
    orgType: v.orgType,
    participation: v.participation,
    useCase: v.useCase,
    listPublicly: v.listPublicly,
  }).catch((err) => {
    console.error('[npd-mcp] alert failed:', errorCode(err));
  });

  return NextResponse.json({ ok: true });
}
