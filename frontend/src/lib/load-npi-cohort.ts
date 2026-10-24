/**
 * Build-time loader for the national high-risk cohort export, the data
 * behind the per-NPI report-card pages at /npi/[npi].
 *
 * COST CONTRACT: this file is read at BUILD TIME ONLY. The /npi/[npi] route
 * is `force-static` with `dynamicParams = false`, so no lambda ever reads
 * the CSV at runtime (it is also excluded from lambda bundles via
 * outputFileTracingExcludes in next.config.js). Unknown NPIs 404 statically.
 * There is deliberately NO live-BigQuery fallback: a crawler walking the
 * NPI space must never trigger paid queries.
 *
 * SUPPRESSION: an NPI removed on request (docs/privacy.md) is already absent
 * from the published CSV (analysis/suppression.py). As a second layer, the
 * loader skips SUPPRESSED_NPIS, and the `published*` helpers below also skip
 * every NPI in the suppression table. Pages, generateStaticParams and the
 * sitemap must use the `published*` helpers.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  assertSuppressionVisible,
  getSuppressionState,
  parseSuppressedNpis,
} from '@/lib/suppression';

const EXPORT_CSV = path.join(
  process.cwd(),
  'public', 'api', 'v1', 'findings', 'high-risk-cohort-export.csv',
);
const COHORT_JSON = path.join(
  process.cwd(),
  'public', 'api', 'v1', 'findings', 'high-risk-cohort.json',
);

/** `suppressed_rows` recorded in the committed cohort payload (0 if absent). */
export function committedSuppressedRows(file: string = COHORT_JSON): number {
  try {
    const n = Number(JSON.parse(fs.readFileSync(file, 'utf8'))?.suppressed_rows ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export interface NpiCohortRow {
  npi: string;
  name: string;
  state: string;
  score: string;
  bucket: string;
  /** Pipe-separated signal codes, e.g. "oig_excluded|sam_excluded". */
  reasons: string[];
  leie_excldate: string;
  sam_active_date: string;
  nppes_deactivation_date: string;
}

let cache: Map<string, NpiCohortRow> | null = null;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function load(): Map<string, NpiCohortRow> {
  if (cache) return cache;
  cache = new Map();
  let raw: string;
  try {
    raw = fs.readFileSync(EXPORT_CSV, 'utf8');
  } catch {
    return cache; // missing export → zero pages, build still succeeds
  }
  const lines = raw.split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return cache;
  const header = parseCsvLine(lines[0]);
  const envSuppressed = parseSuppressedNpis(process.env.SUPPRESSED_NPIS);
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const rec: Record<string, string> = {};
    header.forEach((k, i) => {
      rec[k] = cols[i] ?? '';
    });
    if (!/^\d{10}$/.test(rec.npi ?? '')) continue;
    if (envSuppressed.has(rec.npi)) continue;
    cache.set(rec.npi, {
      npi: rec.npi,
      name: rec.name ?? '',
      state: rec.state ?? '',
      score: rec.score ?? '',
      bucket: rec.bucket ?? '',
      reasons: (rec.reasons ?? '').split('|').filter(Boolean),
      leie_excldate: rec.leie_excldate ?? '',
      sam_active_date: rec.sam_active_date ?? '',
      nppes_deactivation_date: rec.nppes_deactivation_date ?? '',
    });
  }
  return cache;
}

export function allCohortNpis(): string[] {
  return [...load().keys()];
}

export function getCohortRow(npi: string): NpiCohortRow | null {
  return load().get(npi) ?? null;
}

export function cohortSize(): number {
  return load().size;
}

/**
 * The suppression list for a build, after the positive control: throws
 * (failing the build) when committed files record removals the list cannot
 * account for.
 */
async function buildSuppressedSet(): Promise<Set<string>> {
  const state = await getSuppressionState();
  assertSuppressionVisible(state, committedSuppressedRows());
  return state.set;
}

/** Cohort NPIs that may have a page: the CSV minus the suppression table. */
export async function publishedCohortNpis(): Promise<string[]> {
  const suppressed = await buildSuppressedSet();
  return allCohortNpis().filter((npi) => !suppressed.has(npi));
}

/** The cohort row for a page, or null when absent or suppressed. */
export async function getPublishedCohortRow(npi: string): Promise<NpiCohortRow | null> {
  const suppressed = await buildSuppressedSet();
  if (suppressed.has(npi)) return null;
  return getCohortRow(npi);
}

export async function publishedCohortSize(): Promise<number> {
  return (await publishedCohortNpis()).length;
}
