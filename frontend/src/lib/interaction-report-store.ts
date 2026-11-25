/**
 * Storage and access rules for the interaction-report sandbox. Shared by
 * POST/GET /api/v1/interaction-reports and the `report_interaction` /
 * `get_interaction_report` MCP tools.
 *
 * Reporter identity comes from the API key, never the body (proposal v0.2).
 * Only keys issued for the NPD MCP working group can report: they carry the
 * label `npd-mcp:<participant id>`, set by scripts/npd-mcp-issue-key.ts once
 * Gene has checked the sign-up. Any other valid key gets 403, as the proposal
 * specifies for a key "not authorized to report for that organization".
 *
 * A reporter reads only its own reports; another organization's reportId
 * returns 404, the same as an unknown one. Nothing here publishes a report,
 * aggregates them, or shows one side the other side's report.
 *
 * Retention (sandbox choice): reports are deleted 90 days after receipt, the
 * proposal's deduplication window. Each submission sweeps expired rows.
 */
import type { PrismaClient } from '@prisma/client';

import type { Caller } from '@/lib/rate-limit';
import {
  DEDUPE_WINDOW_MS,
  buildReceipt,
  isReportId,
  problem,
  reportHash,
  validateInteractionReport,
  type Problem,
  type Receipt,
} from '@/lib/interaction-report';

export const KEY_LABEL_PREFIX = 'npd-mcp:';
export const REPORTS_PER_MINUTE = 30;
export const REPORTS_PER_DAY = 1000;
export const SITE = 'https://ainpi.dev';

export interface Reporter {
  participantId: string;
  keyId: string;
}

export interface StoreResult {
  status: number;
  body: Receipt | Problem;
  location?: string;
  retryAfter?: number;
}

type Db = Pick<PrismaClient, 'apiKey' | 'interactionReport'>;
type Bump = (id: string, units: number, ttlMs: number) => Promise<number | null>;

function err(status: number, detail: string, retryAfter?: number): StoreResult {
  return { status, body: problem(status, detail), retryAfter };
}

export function reporterRef(participantId: string): string {
  return `NpdMcpParticipant/${participantId}`;
}

/**
 * Turn the rate limiter's caller into a reporter, or the error to return.
 * `keyPresented` says whether the request carried a key header at all, which
 * tells "no key" apart from "the database could not check the key".
 */
export async function resolveReporter(
  caller: Caller,
  keyPresented: boolean,
  db: Db,
): Promise<Reporter | StoreResult> {
  if (caller.subject.startsWith('badkey:')) {
    return err(401, 'The API key is not valid.');
  }
  if (!caller.keyId) {
    return keyPresented
      ? err(503, 'The API key could not be checked right now. Retry later.', 30)
      : err(
          401,
          'An API key is required. Keys are issued to NPD MCP working group participants: sign up at https://ainpi.dev/npd-mcp.',
        );
  }
  let label: string | null = null;
  try {
    const row = await db.apiKey.findUnique({ where: { id: caller.keyId }, select: { label: true } });
    label = row?.label ?? null;
  } catch {
    return err(503, 'The API key could not be checked right now. Retry later.', 30);
  }
  if (!label || !label.startsWith(KEY_LABEL_PREFIX) || label.length === KEY_LABEL_PREFIX.length) {
    return err(
      403,
      'This API key is not authorized to submit interaction reports. Report keys are issued to NPD MCP working group participants: https://ainpi.dev/npd-mcp.',
    );
  }
  return { participantId: label.slice(KEY_LABEL_PREFIX.length), keyId: caller.keyId };
}

/** Per-key submission limits, in their own `ir:` namespace. Null means allowed. */
export async function checkReportRate(reporter: Reporter, now: number, bump: Bump): Promise<StoreResult | null> {
  const minute = Math.floor(now / 60_000);
  const day = Math.floor(now / 86_400_000);
  const m = await bump(`ir:key:${reporter.keyId}:m:${minute}`, 1, 120_000);
  if (m !== null && m > REPORTS_PER_MINUTE) {
    return err(429, `Submission rate exceeded: ${REPORTS_PER_MINUTE} reports a minute per key.`, 60);
  }
  const d = await bump(`ir:key:${reporter.keyId}:d:${day}`, 1, 172_800_000);
  if (d !== null && d > REPORTS_PER_DAY) {
    const secondsToMidnight = Math.ceil(((day + 1) * 86_400_000 - now) / 1000);
    return err(429, `Submission rate exceeded: ${REPORTS_PER_DAY} reports a UTC day per key.`, secondsToMidnight);
  }
  return null;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}

/** Submit a parsed JSON body. Rate limiting is the caller's job (checkReportRate). */
export async function submitReport(reporter: Reporter, body: unknown, now: number, db: Db): Promise<StoreResult> {
  const v = validateInteractionReport(body, now);
  if (!v.ok) return err(400, v.detail);
  const report = v.value;
  const hash = reportHash(report);
  const where = {
    reporterParticipantId_reportId: { reporterParticipantId: reporter.participantId, reportId: report.reportId },
  };

  // Sweep expired rows first, so a retry after the window is a new report.
  // A failed sweep is not a reason to refuse the submission.
  await db.interactionReport
    .deleteMany({ where: { receivedAt: { lt: new Date(now - DEDUPE_WINDOW_MS) } } })
    .catch(() => {});

  const replay = (row: { bodyHash: string; receipt: unknown }): StoreResult =>
    row.bodyHash === hash
      ? { status: 200, body: row.receipt as Receipt, location: locationOf(report.reportId) }
      : err(409, 'This reportId already exists with different content.');

  try {
    const existing = await db.interactionReport.findUnique({ where, select: { bodyHash: true, receipt: true } });
    if (existing) return replay(existing);

    const receivedAt = new Date(now);
    const receipt = buildReceipt(report, receivedAt, reporterRef(reporter.participantId));
    try {
      await db.interactionReport.create({
        data: {
          reportId: report.reportId,
          reporterParticipantId: reporter.participantId,
          reporterKeyId: reporter.keyId,
          bodyHash: hash,
          body: report as unknown as object,
          receipt: receipt as unknown as object,
          receivedAt,
        },
      });
    } catch (e) {
      // Two concurrent submissions of one reportId: the loser replays the winner.
      if (!isUniqueViolation(e)) throw e;
      const winner = await db.interactionReport.findUnique({ where, select: { bodyHash: true, receipt: true } });
      if (!winner) throw e;
      return replay(winner);
    }
    return { status: 201, body: receipt, location: locationOf(report.reportId) };
  } catch {
    return err(503, 'The report could not be stored right now. Retry with the same reportId.', 30);
  }
}

export async function getReport(reporter: Reporter, reportId: string, now: number, db: Db): Promise<StoreResult> {
  const notFound = err(404, 'No report with this reportId was found for this reporter.');
  if (!isReportId(reportId)) return notFound;
  try {
    const row = await db.interactionReport.findUnique({
      where: {
        reporterParticipantId_reportId: {
          reporterParticipantId: reporter.participantId,
          reportId: reportId.toLowerCase(),
        },
      },
      select: { receipt: true, receivedAt: true },
    });
    if (!row || row.receivedAt.getTime() < now - DEDUPE_WINDOW_MS) return notFound;
    return { status: 200, body: row.receipt as unknown as Receipt };
  } catch {
    return err(503, 'The report could not be read right now. Retry later.', 30);
  }
}

export function locationOf(reportId: string): string {
  return `${SITE}/api/v1/interaction-reports/${reportId}`;
}
