/**
 * POST /api/v1/interaction-reports
 *
 * AINPI sandbox of the NPD Endpoint Feedback API proposal v0.2
 * (ftrotter-gov/CMSPayerEndpointSeed, docs/npd-how-did-it-go-api.md). Not an
 * NPD API. Rules live in src/lib/interaction-report.ts and
 * src/lib/interaction-report-store.ts; this file is order of checks only:
 * key (401/403), rate (429), size (413), JSON (400), then store.
 *
 * Touches no paid service (one Postgres write), so it is not in ROUTE_COST and
 * does not use enforceRateLimit; it has its own per-key limit.
 */
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { bump } from '@/lib/rate-limit';
import { MAX_BODY_BYTES, problem } from '@/lib/interaction-report';
import { checkReportRate, submitReport } from '@/lib/interaction-report-store';
import { isStoreResult, reporterFor, respond } from '@/lib/interaction-report-http';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const reporter = await reporterFor(req);
  if (isStoreResult(reporter)) return respond(reporter);

  const now = Date.now();
  const limited = await checkReportRate(reporter, now, bump);
  if (limited) return respond(limited);

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return respond({ status: 413, body: problem(413, 'The body exceeds the 256 KiB limit.') });
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return respond({ status: 413, body: problem(413, 'The body exceeds the 256 KiB limit.') });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return respond({ status: 400, body: problem(400, 'The body is not valid JSON.') });
  }
  return respond(await submitReport(reporter, body, now, prisma));
}
