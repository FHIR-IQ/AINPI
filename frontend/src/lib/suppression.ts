/**
 * suppression: the individual NPIs whose AINPI page and per-NPI rows were
 * removed on request (docs/privacy.md, /privacy/remove).
 *
 * The list lives in the `npi_suppressions` table (Prisma `NpiSuppression`)
 * and never in git. SUPPRESSED_NPIS (comma or whitespace separated) is an
 * optional override merged on top, for local and offline runs.
 *
 * Every consumer goes through `getSuppressedNpis()`: live search, the MCP
 * tools, the /npi pages and the sitemap. It is cached in module scope for a
 * few minutes so search does not hit Postgres on every request.
 *
 * Scope: individual (Type 1) NPIs only. Callers filter practitioner and
 * individual NPI fields, never organization NPI fields.
 *
 * Failure behaviour: if the table cannot be read, the last good list is kept
 * (never replaced by an empty one) and the read is retried after 30 s; with
 * no good read yet, the env override alone is used and the failure logged.
 * SUPPRESSED_NPIS is set in Vercel as that second layer. At build time,
 * assertSuppressionVisible() fails the build rather than publish when the
 * list cannot be seen. A malformed env entry throws: a list that silently
 * drops an entry publishes the record it was meant to remove.
 */

export const SUPPRESSION_CACHE_MS = 5 * 60 * 1000;

const NPI_SHAPE = /^\d{10}$/;

export function isNpiShape(s: unknown): s is string {
  return typeof s === 'string' && NPI_SHAPE.test(s);
}

/**
 * NPI check digit: Luhn over the 15 digits "80840" + NPI (CMS NPI standard).
 */
export function isValidNpi(s: unknown): s is string {
  if (!isNpiShape(s)) return false;
  const digits = `80840${s}`;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Parse the env override. Blanks are ignored; anything else must be a
 * 10-digit NPI with a valid check digit, so a mistyped entry fails loudly
 * instead of suppressing nothing. Paste values; do not retype them.
 */
export function parseSuppressedNpis(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  raw
    .split(/[\s,;]+/)
    .filter((t) => t.length > 0)
    .forEach((tok, i) => {
      if (!isValidNpi(tok)) {
        // Position only: the token may be a mistyped real NPI.
        throw new Error(
          `SUPPRESSED_NPIS entry #${i + 1} is not a valid 10-digit NPI (check digit). ` +
            'Paste the value rather than retyping it.',
        );
      }
      out.add(tok);
    });
  return out;
}

/**
 * A row in force, from the table. `practitionerOnly` is true while the NPI's
 * type is unconfirmed (basis 'unverified'): it then filters practitioner and
 * individual results only, never organization data, and the file scrub does
 * not see it (RLS). A bare string is a full-scope NPI (tests, env).
 */
export type SourceRow = string | { npi: string; practitionerOnly: boolean };
export type SuppressionSource = () => Promise<SourceRow[]>;

/** Statuses whose NPI is suppressed (declined requests are not). */
export const ACTIVE_STATUSES = ['pending', 'applied', 'confirmed'] as const;

export type SuppressionScope = 'none' | 'practitioner' | 'full';

/**
 * How far a row reaches at `now`:
 *   none          declined, or queued for a later day
 *   practitioner  in force, NPI type unconfirmed (basis 'unverified'):
 *                 practitioner and individual results only
 *   full          in force everywhere, organization data and files included
 * The RLS policies in prisma/sql/npi_suppressions.sql show the workflow roles
 * (and so analysis/suppression.py) exactly the `full` rows.
 */
export function suppressionScope(
  row: { status: string; notBefore: Date | null; basis?: string | null },
  now: Date = new Date(),
): SuppressionScope {
  const active =
    (ACTIVE_STATUSES as readonly string[]).includes(row.status) &&
    (row.notBefore === null || row.notBefore.getTime() <= now.getTime());
  if (!active) return 'none';
  return row.basis === 'unverified' ? 'practitioner' : 'full';
}

/** In force at all (either scope). */
export function isActiveSuppression(
  row: { status: string; notBefore: Date | null; basis?: string | null },
  now: Date = new Date(),
): boolean {
  return suppressionScope(row, now) !== 'none';
}

/** Prisma filter for rows in force at `now` (either scope). */
export function activeSuppressionWhere(now: Date = new Date()) {
  return {
    status: { in: [...ACTIVE_STATUSES] },
    OR: [{ notBefore: null }, { notBefore: { lte: now } }],
  };
}

/** Reads every NPI whose removal is in force now, with its scope. */
export const prismaSuppressionSource: SuppressionSource = async () => {
  const { prisma } = await import('@/lib/prisma');
  const rows = await prisma.npiSuppression.findMany({
    where: activeSuppressionWhere(),
    select: { npi: true, basis: true },
  });
  return rows.map((r) => ({ npi: r.npi, practitionerOnly: r.basis === 'unverified' }));
};

export interface SuppressionState {
  /** Practitioner scope: every NPI in force. Use for individual results. */
  set: Set<string>;
  /** Full scope only. Use for organization data. */
  orgSet: Set<string>;
  /** Full-scope rows read from the table, or null when it could not be read. */
  dbRows: number | null;
}

export interface SuppressionLoader {
  get(): Promise<Set<string>>;
  state(): Promise<SuppressionState>;
  invalidate(): void;
}

/** After a failed table read, wait this long before trying again. */
export const SUPPRESSION_ERROR_RETRY_MS = 30 * 1000;

function normalizeRow(r: SourceRow): { npi: string; practitionerOnly: boolean } {
  return typeof r === 'string' ? { npi: r, practitionerOnly: false } : r;
}

export function createSuppressionLoader(opts: {
  source: SuppressionSource;
  env?: () => string | undefined;
  ttlMs?: number;
  now?: () => number;
}): SuppressionLoader {
  const ttl = opts.ttlMs ?? SUPPRESSION_CACHE_MS;
  const now = opts.now ?? Date.now;
  const env = opts.env ?? (() => process.env.SUPPRESSED_NPIS);
  // Only a successful table read is cached for the full TTL. A failure keeps
  // serving the last good list (never an empty one in its place) and is
  // retried after a short backoff.
  let good: { at: number; rows: { npi: string; practitionerOnly: boolean }[] } | null = null;
  let failedAt: number | null = null;

  async function state(): Promise<SuppressionState> {
    const fromEnv = parseSuppressedNpis(env());
    const set = new Set(fromEnv);
    const orgSet = new Set(fromEnv);
    const fresh = good && now() - good.at < ttl;
    const backingOff = failedAt !== null && now() - failedAt < SUPPRESSION_ERROR_RETRY_MS;
    let ok = good !== null && !(backingOff && !fresh);
    if (!fresh && !backingOff) {
      try {
        const rows = (await opts.source()).map(normalizeRow);
        good = { at: now(), rows };
        failedAt = null;
        ok = true;
      } catch (err) {
        failedAt = now();
        ok = false;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[suppression] table unreadable; using ${good ? 'the last good list' : 'SUPPRESSED_NPIS only'}:`,
          msg,
        );
      }
    }
    let full = 0;
    for (const r of good?.rows ?? []) {
      if (!isNpiShape(r.npi)) continue;
      set.add(r.npi);
      if (!r.practitionerOnly) {
        orgSet.add(r.npi);
        full++;
      }
    }
    return { set, orgSet, dbRows: ok ? full : null };
  }

  return {
    async get() {
      return (await state()).set;
    },
    state,
    invalidate() {
      good = null;
      failedAt = null;
    },
  };
}

const defaultLoader = createSuppressionLoader({ source: prismaSuppressionSource });

/** Practitioner scope: filter individual and practitioner results with this. */
export function getSuppressedNpis(): Promise<Set<string>> {
  return defaultLoader.get();
}

/** Full scope only: filter organization data with this, never getSuppressedNpis(). */
export async function getOrgSuppressedNpis(): Promise<Set<string>> {
  return (await defaultLoader.state()).orgSet;
}

export function getSuppressionState(): Promise<SuppressionState> {
  return defaultLoader.state();
}

/** Drop the cache, e.g. right after recording a new request. */
export function invalidateSuppressionCache(): void {
  defaultLoader.invalidate();
}

/**
 * Positive control for build-time exclusion. If committed payloads record
 * removed rows, the list must not be empty and a readable table must not be
 * empty: either means this build cannot see removals already made, and would
 * publish them again. Throws to fail the build.
 */
export const FAIL_CLOSED_ACTION =
  'Set SUPPRESSED_NPIS in Vercel production and preview, or run ' +
  'frontend/prisma/sql/npi_suppressions.sql and record the rows with scripts/suppress-npi.ts.';

export function assertSuppressionVisible(state: SuppressionState, committedSuppressedRows: number): void {
  if (committedSuppressedRows <= 0) return;
  if (state.dbRows === 0) {
    throw new Error(
      `[suppression] Refusing to build: the table returned zero rows but committed files record ` +
        `${committedSuppressedRows} removed row(s). ${FAIL_CLOSED_ACTION}`,
    );
  }
  if (state.orgSet.size === 0) {
    throw new Error(
      `[suppression] Refusing to build: no suppression list is visible (table unreadable and ` +
        `SUPPRESSED_NPIS empty) but committed files record ${committedSuppressedRows} removed row(s). ` +
        FAIL_CLOSED_ACTION,
    );
  }
}

export async function isSuppressed(npi: string | null | undefined): Promise<boolean> {
  if (!npi) return false;
  return (await getSuppressedNpis()).has(String(npi).trim());
}

/** Remove rows whose NPI field(s) hold a suppressed NPI. */
export function filterSuppressed<T>(
  rows: T[],
  suppressed: Set<string>,
  keys: string[] = ['npi'],
): T[] {
  if (suppressed.size === 0) return rows;
  return rows.filter((r) => {
    const rec = r as unknown as Record<string, unknown>;
    return !keys.some((k) => {
      const v = rec?.[k];
      return v != null && suppressed.has(String(v).trim());
    });
  });
}

/** Every 10-digit, check-digit-valid NPI in free text (an emailed request). */
export function extractNpis(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?<!\d)\d{10}(?!\d)/g)) {
    if (isValidNpi(m[0])) found.add(m[0]);
  }
  return [...found];
}
