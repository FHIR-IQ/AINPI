/**
 * marketplace-install-poll: welcome Databricks Marketplace installers by
 * reading the install record Databricks already keeps, rather than waiting
 * for a forwarded notification email.
 *
 * Source: `system.marketplace.listing_access_events`. The table is scoped to
 * the provider account that hosts the listing, so every row is ours and no
 * listing filter is needed. Columns used: consumer_email, consumer_name,
 * consumer_company, consumer_cloud, consumer_region,
 * consumer_delta_sharing_recipient_type, listing_name, event_type,
 * event_time. Only `GET_DATA` counts as an install; `REQUEST_DATA` is an
 * access request on an approval-gated listing and is not welcomed.
 *
 * What this cannot see: recipients created by hand with
 * `databricks shares update-permissions` (the credential-file consumers of
 * the open share) are not Marketplace events and never appear in this
 * table, so their welcome stays manual. Open-sharing recipients who install
 * *through the Marketplace listing* do appear, with
 * consumer_delta_sharing_recipient_type = OPEN and no cloud or region.
 *
 * Idempotency is `MarketplaceInstall.welcomedAt`, claimed atomically before
 * the send through the guard in marketplace-install-claim.ts, which the
 * webhook route shares. The lookback window only bounds the scan, so a missed
 * day is retried the next day.
 *
 * Everything here takes its I/O as injected functions so the route stays a
 * thin wiring layer and the logic is testable without module mocks.
 */
import type { InstallNotice } from '@/lib/marketplace-install';
import { welcomeOnce, type SendResult } from '@/lib/marketplace-install-claim';

export const DEFAULT_LOOKBACK_DAYS = 30;
export const MAX_LOOKBACK_DAYS = 90;
export const DEFAULT_SEND_CAP = 20;
/** Rows are one per distinct address after aggregation, so this is a cap on installers, not events. */
const ROW_LIMIT = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Config

export interface PollConfig {
  host: string;
  token: string;
  warehouseId: string;
  lookbackDays: number;
}

/** Null when any required env var is missing: the route then does nothing. */
export function readPollConfig(
  env: Record<string, string | undefined>,
): PollConfig | null {
  const rawHost = env.DATABRICKS_HOST?.trim();
  const token = env.DATABRICKS_TOKEN?.trim();
  const warehouseId = env.DATABRICKS_WAREHOUSE_ID?.trim();
  if (!rawHost || !token || !warehouseId) return null;

  const host = (/^https?:\/\//i.test(rawHost) ? rawHost : `https://${rawHost}`).replace(/\/+$/, '');

  const rawDays = env.DATABRICKS_POLL_LOOKBACK_DAYS?.trim();
  let lookbackDays = DEFAULT_LOOKBACK_DAYS;
  if (rawDays && /^\d+$/.test(rawDays)) {
    const n = Number(rawDays);
    if (n >= 1 && n <= MAX_LOOKBACK_DAYS) lookbackDays = n;
  }
  return { host, token, warehouseId, lookbackDays };
}

// ---------------------------------------------------------------------------
// Query

export interface StatementQuery {
  statement: string;
  parameters: { name: string; value: string; type: string }[];
}

export function buildInstallQuery(lookbackDays: number): StatementQuery {
  // One row per address, aggregated in SQL, so an installer who re-mounts
  // the share many times cannot push first-time installers past the LIMIT.
  // min_by takes each attribute from that address's earliest event.
  const statement = `
SELECT lower(trim(consumer_email))                             AS consumer_email,
       MIN(event_time)                                         AS first_seen,
       min_by(consumer_name, event_time)                       AS consumer_name,
       min_by(consumer_company, event_time)                    AS consumer_company,
       min_by(consumer_cloud, event_time)                      AS consumer_cloud,
       min_by(consumer_region, event_time)                     AS consumer_region,
       min_by(consumer_delta_sharing_recipient_type, event_time) AS consumer_delta_sharing_recipient_type,
       min_by(listing_name, event_time)                        AS listing_name,
       'GET_DATA'                                              AS event_type
FROM system.marketplace.listing_access_events
WHERE event_type = 'GET_DATA'
  AND consumer_email IS NOT NULL
  AND event_date >= date_sub(current_date(), :lookback_days)
GROUP BY lower(trim(consumer_email))
ORDER BY first_seen
LIMIT ${ROW_LIMIT}`.trim();
  return {
    statement,
    parameters: [{ name: 'lookback_days', value: String(lookbackDays), type: 'INT' }],
  };
}

// ---------------------------------------------------------------------------
// Rows

type Cell = string | null;
export type RowRecord = Record<string, Cell>;

interface Manifest {
  schema?: { columns?: { name: string; position: number }[] };
}

/** JSON_ARRAY returns every value as a string; map them by column name. */
export function parseStatementRows(
  manifest: Manifest | undefined,
  dataArray: Cell[][] | undefined,
): RowRecord[] {
  const cols = manifest?.schema?.columns ?? [];
  if (!dataArray?.length || !cols.length) return [];
  return dataArray.map((r) => {
    const rec: RowRecord = {};
    for (const c of cols) rec[c.name] = r[c.position] ?? null;
    return rec;
  });
}

export interface InstallEvent {
  email: string;
  name: string | null;
  company: string | null;
  cloud: string | null;
  region: string | null;
  recipientType: string | null;
  listingName: string | null;
  eventTime: string | null;
}

function clean(v: Cell | undefined): string | null {
  const s = v?.trim();
  return s ? s : null;
}

export function toInstallEvents(records: RowRecord[]): InstallEvent[] {
  const out: InstallEvent[] = [];
  for (const r of records) {
    if (r.event_type !== 'GET_DATA') continue;
    const email = clean(r.consumer_email)?.toLowerCase();
    if (!email || !EMAIL_RE.test(email)) continue;
    out.push({
      email,
      name: clean(r.consumer_name),
      company: clean(r.consumer_company),
      cloud: clean(r.consumer_cloud),
      region: clean(r.consumer_region),
      recipientType: clean(r.consumer_delta_sharing_recipient_type),
      listingName: clean(r.listing_name),
      eventTime: clean(r.first_seen) ?? clean(r.event_time),
    });
  }
  return out;
}

export function selectInstallsToWelcome(
  events: InstallEvent[],
  welcomed: Set<string>,
  cap: number,
): { toWelcome: InstallEvent[]; alreadyWelcomed: number; overCap: number } {
  const earliest = new Map<string, InstallEvent>();
  for (const e of events) {
    const prev = earliest.get(e.email);
    if (!prev || (e.eventTime ?? '') < (prev.eventTime ?? '')) earliest.set(e.email, e);
  }
  const fresh: InstallEvent[] = [];
  let alreadyWelcomed = 0;
  for (const e of Array.from(earliest.values())) {
    if (welcomed.has(e.email)) alreadyWelcomed++;
    else fresh.push(e);
  }
  fresh.sort((a, b) => (a.eventTime ?? '').localeCompare(b.eventTime ?? ''));
  return {
    toWelcome: fresh.slice(0, cap),
    alreadyWelcomed,
    overCap: Math.max(0, fresh.length - cap),
  };
}

/**
 * The name is Databricks' recorded consumer_name. When it is absent the email
 * stands in, which firstName() degrades to "there": no name is ever guessed.
 * Company falls back to the email domain only when Databricks has none.
 */
export function eventToNotice(e: InstallEvent): InstallNotice {
  const sharing =
    e.cloud || e.region
      ? [e.cloud, e.region].filter(Boolean).join(':')
      : e.recipientType === 'OPEN'
        ? 'open'
        : null;
  return {
    listing: e.listingName ?? 'CMS National Provider Directory: Release Archive',
    installedBy: e.name ?? e.email,
    installedOn: e.eventTime,
    company: e.company ?? e.email.split('@')[1] ?? null,
    email: e.email,
    sharingIdentifier: sharing,
  };
}

// ---------------------------------------------------------------------------
// Databricks SQL Statement API

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'CLOSED']);

export type RowsResult = { ok: true; rows: RowRecord[] } | { ok: false; error: string };

export interface StatementDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Total budget for the statement, kept under the route's maxDuration. */
  deadlineMs?: number;
  pollIntervalMs?: number;
  /** Per-request timeout, enforced with AbortController. */
  requestTimeoutMs?: number;
}

interface StatementResponse {
  statement_id?: string;
  status?: { state?: string; error?: { message?: string } };
  manifest?: Manifest;
  result?: { data_array?: Cell[][]; next_chunk_internal_link?: string };
}

/**
 * Submit, then poll until a terminal state. The API caps wait_timeout at 50s
 * and returns PENDING/RUNNING after that, which is not a failure. If the
 * deadline passes the statement is cancelled and the run reports an error;
 * idempotency makes the next day's retry free.
 */
export async function runStatement(
  cfg: PollConfig,
  query: StatementQuery,
  deps: StatementDeps = {},
): Promise<RowsResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const deadlineMs = deps.deadlineMs ?? 50_000;
  const pollIntervalMs = deps.pollIntervalMs ?? 3_000;
  const requestTimeoutMs = deps.requestTimeoutMs ?? 40_000;
  const started = now();
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    'Content-Type': 'application/json',
  };

  async function call(path: string, init: { method: string; body?: string }) {
    // Each request gets whatever is left of the overall budget (floor 3s so
    // the cancel still goes out), so a hung poll cannot push the function
    // past maxDuration and swallow the admin alert.
    const remaining = deadlineMs - (now() - started);
    const timeout = Math.max(3_000, Math.min(requestTimeoutMs, remaining));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetchImpl(`${cfg.host}${path}`, { ...init, headers, signal: ctl.signal });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}: ${text.slice(0, 300)}`);
      return (text ? JSON.parse(text) : {}) as StatementResponse & {
        data_array?: Cell[][];
        next_chunk_internal_link?: string;
      };
    } finally {
      clearTimeout(timer);
    }
  }

  let id: string | undefined;
  try {
    let r = await call('/api/2.0/sql/statements', {
      method: 'POST',
      body: JSON.stringify({
        warehouse_id: cfg.warehouseId,
        statement: query.statement,
        parameters: query.parameters,
        wait_timeout: '30s',
        on_wait_timeout: 'CONTINUE',
        format: 'JSON_ARRAY',
        disposition: 'INLINE',
      }),
    });
    id = r.statement_id;

    while (!TERMINAL.has(r.status?.state ?? '')) {
      if (!id) return { ok: false, error: 'Databricks returned no statement_id' };
      if (now() - started + pollIntervalMs > deadlineMs) {
        await call(`/api/2.0/sql/statements/${id}/cancel`, { method: 'POST' }).catch(() => {});
        return {
          ok: false,
          error: `Databricks statement ${id} timed out after ${Math.round((now() - started) / 1000)}s in state ${r.status?.state ?? 'unknown'}`,
        };
      }
      await sleep(pollIntervalMs);
      r = await call(`/api/2.0/sql/statements/${id}`, { method: 'GET' });
    }

    const state = r.status?.state;
    if (state !== 'SUCCEEDED') {
      return {
        ok: false,
        error: `Databricks statement ${state}: ${r.status?.error?.message ?? 'no message'}`,
      };
    }

    const data: Cell[][] = [...(r.result?.data_array ?? [])];
    let next = r.result?.next_chunk_internal_link;
    while (next) {
      const chunk = await call(next, { method: 'GET' });
      data.push(...(chunk.data_array ?? []));
      next = chunk.next_chunk_internal_link;
    }
    return { ok: true, rows: parseStatementRows(r.manifest, data) };
  } catch (err) {
    return { ok: false, error: `Databricks call failed: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Orchestration

export interface ExistingInstall {
  email: string;
  welcomedAt: Date | null;
  company: string | null;
}

export interface PollDeps {
  fetchRows: () => Promise<RowsResult>;
  findExisting: (emails: string[]) => Promise<ExistingInstall[]>;
  /** Create or update the row WITHOUT touching welcomedAt; the claim needs a row to exist. */
  upsertInstall: (n: InstallNotice) => Promise<void>;
  /** Atomic claim on welcomedAt (see marketplace-install-claim.ts). */
  claim: (email: string) => Promise<Date | null>;
  release: (email: string, at: Date) => Promise<void>;
  sendWelcome: (n: InstallNotice) => Promise<SendResult>;
  alertInstall: (n: InstallNotice & { welcomed: boolean }) => Promise<void>;
  alertFailure: (message: string) => Promise<void>;
  cap: number;
}

export type PollResult =
  | {
      ok: true;
      events: number;
      welcomed: string[];
      failed: string[];
      alreadyWelcomed: number;
      overCap: number;
    }
  | { ok: false; error: string };

export async function pollMarketplaceInstalls(deps: PollDeps): Promise<PollResult> {
  const got = await deps.fetchRows();
  if (!got.ok) {
    await deps.alertFailure(`Marketplace install poll: ${got.error}. No welcomes were sent.`);
    return { ok: false, error: got.error };
  }

  const events = toInstallEvents(got.rows);
  const emails = Array.from(new Set(events.map((e) => e.email)));
  const existing = new Map(
    (emails.length ? await deps.findExisting(emails) : []).map((x) => [x.email, x]),
  );
  const welcomedSet = new Set(
    Array.from(existing.values()).filter((x) => x.welcomedAt).map((x) => x.email),
  );
  const { toWelcome, alreadyWelcomed, overCap } = selectInstallsToWelcome(
    events,
    welcomedSet,
    deps.cap,
  );

  const welcomed: string[] = [];
  const failed: string[] = [];
  let lostRace = 0;
  for (const e of toWelcome) {
    const base = eventToNotice(e);
    const stored = existing.get(e.email);
    const notice: InstallNotice = { ...base, company: stored?.company ?? base.company };
    await deps.upsertInstall(notice);
    const outcome = await welcomeOnce(e.email, {
      claim: deps.claim,
      release: deps.release,
      send: () => deps.sendWelcome(notice),
    });
    if (outcome.status === 'already') {
      lostRace++;
      continue;
    }
    if (outcome.status === 'failed') {
      failed.push(e.email);
      await deps.alertFailure(
        `Marketplace install poll: welcome to ${e.email} failed (${outcome.error}). Claim released; the next run retries it.`,
      );
      continue;
    }
    welcomed.push(e.email);
    await deps.alertInstall({ ...notice, welcomed: true });
  }

  if (overCap > 0) {
    await deps.alertFailure(
      `Marketplace install poll hit the per-run cap of ${deps.cap}: ${overCap} installer(s) left for the next run.`,
    );
  }

  return {
    ok: true,
    events: events.length,
    welcomed,
    failed,
    alreadyWelcomed: alreadyWelcomed + lostRace,
    overCap,
  };
}
