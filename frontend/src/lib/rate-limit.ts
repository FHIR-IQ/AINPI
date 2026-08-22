/**
 * Rate limiting, tiering and a spend circuit breaker for every route that can
 * cost money.
 *
 * WHY THIS EXISTS
 *
 * Before this, every BigQuery-backed route carried a 100 GB per-query cap and
 * nothing else. That bounds one catastrophic query. It says nothing about
 * volume, and volume is the shape a real bill takes. Measured against the
 * 2026-08-20 warehouse with dry-run byte counts:
 *
 *   NPI lookup (hits the cluster key)     $0.0002/call    $0.24 per 1k
 *   name search (no cluster key)          $0.0025/call    $2.48 per 1k
 *   state + city search                   $0.0027/call    $2.69 per 1k
 *
 * A scraper at 10 requests/second for one hour is 36,000 calls. The GCP budget
 * alert and the kill-billing Cloud Function are a backstop, not a control:
 * billing data lags by hours, so they fire after the money is spent. This
 * fires first, in-process, before the query runs.
 *
 * THREE LAYERS, CHEAPEST FIRST
 *
 *   1. In-memory token bucket, per lambda instance. Free, no I/O, catches the
 *      burst that a single client generates. Fluid Compute reuses instances,
 *      so this survives across requests more often than not.
 *   2. Durable counter in Postgres. One atomic upsert. Catches a client that
 *      spreads its traffic across instances, which the memory layer cannot see.
 *   3. Daily spend ceiling across all callers. The breaker. When the day's
 *      estimated spend passes the ceiling, anonymous traffic is refused while
 *      issued keys keep working, because a partner paying for access should not
 *      be knocked offline by a stranger's scraper.
 *
 * COST UNITS, NOT REQUEST COUNTS
 *
 * Quota is denominated in cost units where 1 unit ~= $0.0001 of scan. An NPI
 * lookup and a state-wide search are not the same purchase and a quota that
 * counts requests prices them identically. Route handlers declare their shape;
 * the table below turns that into units.
 *
 * FAILURE POSTURE
 *
 * If Postgres is unreachable, layers 2 and 3 degrade to allow, and the request
 * proceeds under the in-memory limit alone. That is deliberate: a database
 * blip should not take the public site down. The in-memory layer still bounds
 * the blast radius, and the GCP kill function remains behind it.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import prisma from '@/lib/prisma';

// ---------------------------------------------------------------------------
// Cost model
// ---------------------------------------------------------------------------

/** 1 unit ~= $0.0001 of BigQuery scan. */
export const USD_PER_UNIT = 0.0001;

/**
 * Measured cost per call by query shape, in units.
 *
 * These come from `bq --dry_run` against the 2026-08-20 warehouse, not from
 * estimation. Re-measure after a reload: the state+city shape moved when the
 * route stopped scanning `resource` JSON and started reading the flattened
 * `_state` / `_city` columns, which cut it from 9.74 GB to 0.43 GB per call.
 */
export const ROUTE_COST: Record<string, number> = {
  'npd/search:npi': 2, //        $0.0002  clustered lookup
  'npd/search:name': 25, //      $0.0025  full column scan
  'npd/search:geo': 27, //       $0.0027  flattened state/city
  'npd/search:org': 25,
  // 0.26 GB measured; the box prefilter is the query, not an optimisation.
  'npd/geo-search': 17,
  'npd/state-detail': 40,
  'npd/relationships': 40,
  'npd/org-analysis': 40,
  'npd/org': 25,
  'npd/validation': 60, //       several scans in one request
  'provider-search': 30, //      BQ plus outbound payer fetches
  'magic-scanner': 500, //       LLM calls; priced well above scan cost
  'mcp:static': 0, //            CDN-served JSON, costs nothing
  'mcp:lookup': 2,
  default: 25,
};

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export interface Tier {
  name: string;
  /** Cost units per minute. */
  perMinute: number;
  /** Cost units per UTC day. */
  perDay: number;
  /** Kept serving once the global breaker trips. */
  survivesBreaker: boolean;
}

export const TIERS: Record<string, Tier> = {
  // No key. Enough to browse the site and try the API by hand; not enough to
  // bulk-extract. ~370 NPI lookups/day, or ~74 state searches.
  anonymous: { name: 'anonymous', perMinute: 120, perDay: 2_000, survivesBreaker: false },
  // Free issued key. Enough to build and test an integration.
  free: { name: 'free', perMinute: 600, perDay: 20_000, survivesBreaker: false },
  // Named partner. ~$10/day of scan at the ceiling.
  partner: { name: 'partner', perMinute: 3_000, perDay: 100_000, survivesBreaker: true },
  // Contracted. Cap lives on the key row, not here.
  enterprise: { name: 'enterprise', perMinute: 12_000, perDay: 1_000_000, survivesBreaker: true },
};

/**
 * Daily estimated spend, in units, across every caller, at which anonymous
 * traffic starts being refused. 300,000 units ~= $30.
 *
 * Deliberately above the $10/month GCP budget alert: this breaker is about
 * stopping an attack in progress, and the budget alert is about noticing a
 * trend. They are different instruments and the breaker firing on ordinary
 * traffic would be worse than useless.
 */
export const DAILY_BREAKER_UNITS = Number(
  process.env.RATE_LIMIT_DAILY_UNITS ?? 300_000,
);

// ---------------------------------------------------------------------------
// Layer 1 — in-memory
// ---------------------------------------------------------------------------

interface MemBucket {
  units: number;
  resetAt: number;
}
const mem = new Map<string, MemBucket>();
/** Bound the map so a spray of unique subjects cannot grow it without limit. */
const MEM_MAX_KEYS = 10_000;

function memConsume(subject: string, units: number, limit: number): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  let b = mem.get(subject);
  if (!b || b.resetAt <= now) {
    if (mem.size >= MEM_MAX_KEYS) {
      for (const [k, v] of mem) if (v.resetAt <= now) mem.delete(k);
      if (mem.size >= MEM_MAX_KEYS) mem.clear();
    }
    b = { units: 0, resetAt: now + windowMs };
    mem.set(subject, b);
  }
  if (b.units + units > limit) return false;
  b.units += units;
  return true;
}

// ---------------------------------------------------------------------------
// Caller identity
// ---------------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface Caller {
  subject: string;
  tier: Tier;
  keyId: string | null;
  dailyUnitCap: number;
}

function clientIp(req: NextRequest): string {
  // Vercel sets x-forwarded-for; take the first hop, which is the client.
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function identify(req: NextRequest): Promise<Caller> {
  const header =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    req.headers.get('x-api-key') ??
    '';

  if (header) {
    try {
      const keyHash = await sha256Hex(header);
      const row = await prisma.apiKey.findUnique({ where: { keyHash } });
      if (row && row.active && !row.revokedAt) {
        const tier = TIERS[row.tier] ?? TIERS.free;
        // Fire and forget: last-used is for support, and awaiting it would put
        // a write on the hot path of every authenticated request.
        void prisma.apiKey
          .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
          .catch(() => {});
        return {
          subject: `key:${row.id}`,
          tier,
          keyId: row.id,
          dailyUnitCap: row.dailyUnitCap ?? tier.perDay,
        };
      }
      // A presented-but-invalid key is not silently downgraded to anonymous:
      // the caller believes they are authenticated and should be told they
      // are not, rather than quietly hitting a 30x smaller quota.
      return {
        subject: `badkey:${keyHash.slice(0, 16)}`,
        tier: TIERS.anonymous,
        keyId: null,
        dailyUnitCap: 0,
      };
    } catch {
      // Database unreachable. Fall through to anonymous rather than 500.
    }
  }
  return {
    subject: `ip:${clientIp(req)}`,
    tier: TIERS.anonymous,
    keyId: null,
    dailyUnitCap: TIERS.anonymous.perDay,
  };
}

// ---------------------------------------------------------------------------
// Layers 2 and 3 — durable
// ---------------------------------------------------------------------------

function windowIds(subject: string) {
  const now = Date.now();
  return {
    minute: `${subject}:m:${Math.floor(now / 60_000)}`,
    day: `${subject}:d:${Math.floor(now / 86_400_000)}`,
    utcDay: new Date(now).toISOString().slice(0, 10),
  };
}

/** Atomic increment-and-read. One round trip; the returned total is the decision. */
async function bump(id: string, units: number, ttlMs: number): Promise<number | null> {
  try {
    const expiresAt = new Date(Date.now() + ttlMs);
    const rows = await prisma.$queryRaw<{ units: number }[]>`
      INSERT INTO rate_limit_buckets (id, units, expires_at)
      VALUES (${id}, ${units}, ${expiresAt})
      ON CONFLICT (id) DO UPDATE
        SET units = rate_limit_buckets.units + ${units}
      RETURNING units
    `;
    return rows[0]?.units ?? null;
  } catch {
    return null; // degrade to allow
  }
}

async function recordSpend(utcDay: string, units: number): Promise<number | null> {
  try {
    const usd = units * USD_PER_UNIT;
    const rows = await prisma.$queryRaw<{ units: number }[]>`
      INSERT INTO usage_ledger (day, units, estimated_usd, requests, updated_at)
      VALUES (${utcDay}, ${units}, ${usd}, 1, NOW())
      ON CONFLICT (day) DO UPDATE
        SET units = usage_ledger.units + ${units},
            estimated_usd = usage_ledger.estimated_usd + ${usd},
            requests = usage_ledger.requests + 1,
            updated_at = NOW()
      RETURNING units
    `;
    return rows[0]?.units ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LimitResult {
  ok: boolean;
  /** Present when ok is false: a ready-to-return response. */
  response?: NextResponse;
  caller: Caller;
  units: number;
}

export interface LimitOptions {
  /** Key into ROUTE_COST. Unknown shapes fall back to `default`. */
  shape?: string;
  /** Override the table entirely. */
  units?: number;
}

function deny(status: number, message: string, retryAfterSec: number, caller: Caller) {
  return NextResponse.json(
    {
      error: message,
      tier: caller.tier.name,
      retry_after_seconds: retryAfterSec,
      docs: 'https://ainpi.dev/developer#rate-limits',
      // Anonymous callers are told the upgrade exists; a partner hitting their
      // own ceiling does not need to be sold to.
      ...(caller.keyId
        ? {}
        : { hint: 'Higher limits are free with an API key. See the docs link.' }),
    },
    {
      status,
      headers: {
        'retry-after': String(retryAfterSec),
        'cache-control': 'no-store',
      },
    },
  );
}

/**
 * Check and consume quota. Call at the top of a handler, before any billable
 * work. Returns `{ ok: false, response }` when the caller must be refused.
 */
export async function enforceRateLimit(
  req: NextRequest,
  opts: LimitOptions = {},
): Promise<LimitResult> {
  const units = opts.units ?? ROUTE_COST[opts.shape ?? 'default'] ?? ROUTE_COST.default;
  const caller = await identify(req);

  // Free surfaces skip every layer: charging quota for a CDN read would make
  // the MCP server's static tools feel metered when they cost nothing.
  if (units === 0) return { ok: true, caller, units };

  if (caller.dailyUnitCap === 0) {
    return {
      ok: false,
      caller,
      units,
      response: deny(401, 'API key not recognised, or revoked.', 60, caller),
    };
  }

  const w = windowIds(caller.subject);

  // Layer 1
  if (!memConsume(w.minute, units, caller.tier.perMinute)) {
    return {
      ok: false,
      caller,
      units,
      response: deny(429, 'Rate limit exceeded (per minute).', 60, caller),
    };
  }

  // Layer 2
  const minuteTotal = await bump(w.minute, units, 120_000);
  if (minuteTotal !== null && minuteTotal > caller.tier.perMinute) {
    return {
      ok: false,
      caller,
      units,
      response: deny(429, 'Rate limit exceeded (per minute).', 60, caller),
    };
  }
  const dayTotal = await bump(w.day, units, 172_800_000);
  if (dayTotal !== null && dayTotal > caller.dailyUnitCap) {
    return {
      ok: false,
      caller,
      units,
      response: deny(429, 'Daily quota exhausted.', 3600, caller),
    };
  }

  // Layer 3
  const globalUnits = await recordSpend(w.utcDay, units);
  if (
    globalUnits !== null &&
    globalUnits > DAILY_BREAKER_UNITS &&
    !caller.tier.survivesBreaker
  ) {
    void prisma.usageLedger
      .update({ where: { day: w.utcDay }, data: { breakerTripped: true } })
      .catch(() => {});
    return {
      ok: false,
      caller,
      units,
      response: deny(
        503,
        'Service temporarily limited: the daily query budget for anonymous ' +
          'traffic is exhausted. Static data under /api/v1/ is unaffected and ' +
          'remains free.',
        3600,
        caller,
      ),
    };
  }

  return { ok: true, caller, units };
}

/** Advertise remaining budget on successful responses. */
export function withRateLimitHeaders(res: NextResponse, r: LimitResult): NextResponse {
  res.headers.set('x-ratelimit-tier', r.caller.tier.name);
  res.headers.set('x-ratelimit-cost-units', String(r.units));
  res.headers.set('x-ratelimit-limit-day', String(r.caller.dailyUnitCap));
  return res;
}
