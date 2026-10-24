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
 * Failure behaviour: if the table cannot be read, the last good list is kept;
 * with none, the env override alone is used and the failure is logged. At
 * build time the cohort CSV is already filtered by the analysis side
 * (analysis/suppression.py), so a database outage there still publishes no
 * suppressed page. A malformed env entry throws: a list that silently drops
 * an entry publishes the record it was meant to remove.
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

/** Parse the env override. Blanks are ignored; anything else must be 10 digits. */
export function parseSuppressedNpis(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  raw
    .split(/[\s,;]+/)
    .filter((t) => t.length > 0)
    .forEach((tok, i) => {
      if (!isNpiShape(tok)) {
        // Position only: the token may be a mistyped real NPI.
        throw new Error(`SUPPRESSED_NPIS entry #${i + 1} is not a 10-digit NPI`);
      }
      out.add(tok);
    });
  return out;
}

export type SuppressionSource = () => Promise<string[]>;

/** Reads every NPI in the table, whatever its status. */
export const prismaSuppressionSource: SuppressionSource = async () => {
  const { prisma } = await import('@/lib/prisma');
  const rows = await prisma.npiSuppression.findMany({ select: { npi: true } });
  return rows.map((r) => r.npi);
};

export interface SuppressionLoader {
  get(): Promise<Set<string>>;
  invalidate(): void;
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
  let cached: { at: number; set: Set<string> } | null = null;
  let lastGoodDb: string[] | null = null;

  return {
    async get() {
      if (cached && now() - cached.at < ttl) return cached.set;
      const set = parseSuppressedNpis(env());
      try {
        lastGoodDb = await opts.source();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[suppression] table unreadable, using last good list:', msg);
      }
      for (const npi of lastGoodDb ?? []) if (isNpiShape(npi)) set.add(npi);
      cached = { at: now(), set };
      return set;
    },
    invalidate() {
      cached = null;
    },
  };
}

const defaultLoader = createSuppressionLoader({ source: prismaSuppressionSource });

export function getSuppressedNpis(): Promise<Set<string>> {
  return defaultLoader.get();
}

/** Drop the cache, e.g. right after recording a new request. */
export function invalidateSuppressionCache(): void {
  defaultLoader.invalidate();
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
