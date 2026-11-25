/**
 * GET /api/v1/interaction-reports/{reportId}
 *
 * Returns the receipt of a report the caller's own organization submitted.
 * Another organization's reportId returns 404, the same as an unknown one
 * (proposal v0.2). AINPI sandbox, not an NPD API.
 */
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { bump } from '@/lib/rate-limit';
import { checkReportRate, getReport } from '@/lib/interaction-report-store';
import { isStoreResult, reporterFor, respond } from '@/lib/interaction-report-http';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { reportId: string } }) {
  const reporter = await reporterFor(req);
  if (isStoreResult(reporter)) return respond(reporter);
  const now = Date.now();
  // Reads share the key's submission budget.
  const limited = await checkReportRate(reporter, now, bump);
  if (limited) return respond(limited);
  return respond(await getReport(reporter, params.reportId, now, prisma));
}
