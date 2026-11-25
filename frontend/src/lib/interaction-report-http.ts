/**
 * HTTP glue for the interaction-report sandbox routes: identify the reporter,
 * and render a StoreResult as JSON or RFC 9457 problem+json.
 */
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { identify } from '@/lib/rate-limit';
import { resolveReporter, type Reporter, type StoreResult } from '@/lib/interaction-report-store';

export function keyPresented(req: NextRequest): boolean {
  return Boolean(req.headers.get('authorization') || req.headers.get('x-api-key'));
}

export async function reporterFor(req: NextRequest): Promise<Reporter | StoreResult> {
  const caller = await identify(req);
  return resolveReporter(caller, keyPresented(req), prisma);
}

export function isStoreResult(v: Reporter | StoreResult): v is StoreResult {
  return 'status' in v;
}

export function respond(r: StoreResult): Response {
  const isProblem = r.status >= 400;
  const headers: Record<string, string> = {
    'content-type': isProblem ? 'application/problem+json' : 'application/json',
    'cache-control': 'no-store',
    // Every response says it came from the sandbox, not an NPD service.
    'x-ainpi-sandbox': 'npd-endpoint-feedback-api-v0.2',
  };
  if (r.location) headers.location = r.location;
  if (r.retryAfter) headers['retry-after'] = String(r.retryAfter);
  return new Response(JSON.stringify(r.body), { status: r.status, headers });
}
