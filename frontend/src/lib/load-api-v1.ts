/**
 * Server-side loaders for the static /api/v1/*.json contracts.
 *
 * These read from `frontend/public/api/v1/` at build time so Server
 * Components can display live-ish numbers without a round-trip. External
 * consumers hit the same files over HTTP at the canonical URL.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ApiV1Stats, ApiV1Finding, ApiV1StateFindings } from './api-v1-types';

const PUBLIC_API_ROOT = path.join(process.cwd(), 'public', 'api', 'v1');

export function loadStats(): ApiV1Stats | null {
  try {
    const raw = fs.readFileSync(path.join(PUBLIC_API_ROOT, 'stats.json'), 'utf8');
    return JSON.parse(raw) as ApiV1Stats;
  } catch {
    return null;
  }
}

export function loadFinding(slug: string): ApiV1Finding | null {
  try {
    const raw = fs.readFileSync(path.join(PUBLIC_API_ROOT, 'findings', `${slug}.json`), 'utf8');
    return JSON.parse(raw) as ApiV1Finding;
  } catch {
    return null;
  }
}

export function loadStateFindings(state: string): ApiV1StateFindings | null {
  try {
    const raw = fs.readFileSync(
      path.join(PUBLIC_API_ROOT, 'states', `${state.toLowerCase()}.json`),
      'utf8',
    );
    return JSON.parse(raw) as ApiV1StateFindings;
  } catch {
    return null;
  }
}

/**
 * Load a finding's sidecar JSON (e.g. `<slug>-detail.json`). Sidecars
 * carry samples, breakdowns, and limitations that are too large for the
 * stable `<slug>.json` public contract. Untyped because each finding
 * has its own sidecar shape; consumers cast to the expected shape.
 */
export function loadFindingDetail(slug: string): unknown | null {
  try {
    const raw = fs.readFileSync(
      path.join(PUBLIC_API_ROOT, 'findings', `${slug}-detail.json`),
      'utf8',
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface StateCohortRow {
  npi: string;
  name: string;
  state: string;
  score: string;
  bucket: string;
  reasons: string;
  leie_excldate: string;
  sam_active_date: string;
  nppes_deactivation_date: string;
  leie_lookup_url: string;
  sam_lookup_url: string;
  nppes_lookup_url: string;
}

/**
 * Load `<state>-cohort-critical.csv` and return parsed rows. Used by
 * the /for-state-medicaid/<state> CMO-facing page so the hero lede
 * can show the real count plus a sample-of-3 verifiable rows.
 *
 * Lightweight CSV parse — the file format is internal (analysis script
 * output), no embedded newlines, only quoted commas in the name column.
 */
export function loadStateCohort(state: string): StateCohortRow[] {
  try {
    const raw = fs.readFileSync(
      path.join(PUBLIC_API_ROOT, 'states', `${state.toLowerCase()}-cohort-critical.csv`),
      'utf8',
    );
    const lines = raw.split('\n').filter((l) => l.length > 0);
    if (lines.length < 2) return [];
    const header = parseCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      const obj: Record<string, string> = {};
      header.forEach((k, i) => {
        obj[k] = cols[i] ?? '';
      });
      return obj as unknown as StateCohortRow;
    });
  } catch {
    return [];
  }
}

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
