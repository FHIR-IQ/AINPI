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

export type SuppressionSource = () => Promise<string[]>;

/** Reads every NPI in the table except rows held for review. */
export const prismaSuppressionSource: SuppressionSource = async () => {
  const { prisma } = await import('@/lib/prisma');
  const rows = await prisma.npiSuppression.findMany({
    where: { status: { not: 'held' } },
    select: { npi: true },
  });
  return rows.map((r) => r.npi);
};

export interface SuppressionState {
  set: Set<string>;
  /** Rows read from the table, or null when it could not be read. */
  dbRows: number | null;
}

export interface SuppressionLoader {
  get(): Promise<Set<string>>;
  state(): Promise<SuppressionState>;
  invalidate(): void;
}

/** After a failed table read, wait this long before trying again. */
export const SUPPRESSION_ERROR_RETRY_MS = 30 * 1000;

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
  let good: { at: number; npis: string[] } | null = null;
  let failedAt: number | null = null;

  async function state(): Promise<SuppressionState> {
    const set = parseSuppressedNpis(env());
    const fresh = good && now() - good.at < ttl;
    const backingOff = failedAt !== null && now() - failedAt < SUPPRESSION_ERROR_RETRY_MS;
    let dbRows: number | null = good ? good.npis.length : null;
    if (!fresh && !backingOff) {
      try {
        const npis = await opts.source();
        good = { at: now(), npis };
        failedAt = null;
        dbRows = npis.length;
      } catch (err) {
        failedAt = now();
        dbRows = null;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[suppression] table unreadable; using ${good ? 'the last good list' : 'SUPPRESSED_NPIS only'}:`,
          msg,
        );
      }
    } else if (backingOff && !fresh) {
      dbRows = null;
    }
    for (const npi of good?.npis ?? []) if (isNpiShape(npi)) set.add(npi);
    return { set, dbRows };
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

export function getSuppressedNpis(): Promise<Set<string>> {
  return defaultLoader.get();
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
  if (state.set.size === 0) {
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
