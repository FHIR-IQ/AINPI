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

/**
 * Per-state claims-side cross-audit findings — read at build time from the
 * per-state CSVs the analysis pipeline produces. Returns a summary object
 * with counts and totals for each finding, plain-English ready for the
 * CMO-facing page band.
 */
export interface StateClaimsAudit {
  /** Medicaid spending (H29) — matches and dollar totals. */
  medicaid: {
    full_window_matches: number;
    strict_post_exclusion_matches: number;
    full_window_paid: number;
    strict_post_paid: number;
  };
  /** Medicare Part B billing (H30a). */
  partb: {
    full_window_matches: number;
    strict_post_exclusion_matches: number;
    full_window_paid: number;
    strict_post_paid: number;
  };
  /** Medicare Part D prescribing (H30b) + opioid subset. */
  partd: {
    full_window_matches: number;
    strict_post_exclusion_matches: number;
    full_window_drug_cost: number;
    opioid_prescribers: number;
  };
  /** NPPES-deactivated × billing (H31). */
  deactivated_billing: {
    matches: number;
    multi_source_matches: number;
    medicaid_post_deactivation_paid: number;
    partb_post_deactivation_paid: number;
    partd_post_deactivation_drug_cost: number;
  };
  /** Open Payments × exclusion (H32) — Sunshine Act surface. */
  industry_payments: {
    full_window_matches: number;
    strict_post_exclusion_matches: number;
    full_window_paid: number;
    strict_post_paid: number;
  };
}

function readStateCsv(state: string, slug: string): Record<string, string>[] {
  const stateLower = state.toLowerCase();
  const candidates = [
    path.join(PUBLIC_API_ROOT, 'states', stateLower, slug),
    // Back-compat for the legacy va-named H32 file pattern.
    path.join(PUBLIC_API_ROOT, 'states', stateLower, slug.replace('.csv', `-${stateLower}.csv`)),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const lines = raw.split('\n').filter((l) => l.length > 0);
      if (lines.length < 2) return [];
      const header = parseCsvLine(lines[0]);
      return lines.slice(1).map((line) => {
        const cols = parseCsvLine(line);
        const obj: Record<string, string> = {};
        header.forEach((k, i) => {
          obj[k] = cols[i] ?? '';
        });
        return obj;
      });
    } catch {
      // try next candidate
    }
  }
  return [];
}

function toNum(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Load all five claims-side per-state findings for a single state. Returns
 * a unified shape regardless of whether the underlying CSVs are present —
 * missing files just yield zero values.
 */
export function loadStateClaimsAudit(state: string): StateClaimsAudit {
  const medicaidRows = readStateCsv(state, 'h29-excluded-paid.csv');
  const partbRows = readStateCsv(state, 'h30a-excluded-billing-partb.csv');
  const partdRows = readStateCsv(state, 'h30b-excluded-prescribing-partd.csv');
  const deactRows = readStateCsv(state, 'h31-deactivated-paid.csv');
  const industryRows = readStateCsv(state, 'h32-excluded-industry-payments.csv');

  const medicaidStrict = medicaidRows.filter(
    (r) => toNum(r['paid_amount_post_exclusion']) > 0 && r['exclusion_effective_date'],
  );
  const partbStrict = partbRows.filter((r) => r['post_exclusion_2023_billing'] === 'yes');
  const partdStrict = partdRows.filter((r) => r['post_exclusion_2023_prescribing'] === 'yes');
  const industryStrict = industryRows.filter((r) => r['post_exclusion_pgyr2024'] === 'yes');

  return {
    medicaid: {
      full_window_matches: medicaidRows.length,
      strict_post_exclusion_matches: medicaidStrict.length,
      full_window_paid: medicaidRows.reduce(
        (a, r) => a + toNum(r['paid_amount_full_window']),
        0,
      ),
      strict_post_paid: medicaidStrict.reduce(
        (a, r) => a + toNum(r['paid_amount_post_exclusion']),
        0,
      ),
    },
    partb: {
      full_window_matches: partbRows.length,
      strict_post_exclusion_matches: partbStrict.length,
      full_window_paid: partbRows.reduce((a, r) => a + toNum(r['medicare_paid_2023']), 0),
      strict_post_paid: partbStrict.reduce((a, r) => a + toNum(r['medicare_paid_2023']), 0),
    },
    partd: {
      full_window_matches: partdRows.length,
      strict_post_exclusion_matches: partdStrict.length,
      full_window_drug_cost: partdRows.reduce((a, r) => a + toNum(r['drug_cost_2023']), 0),
      opioid_prescribers: partdRows.filter((r) => toNum(r['opioid_claims_2023']) > 0).length,
    },
    deactivated_billing: {
      matches: deactRows.length,
      multi_source_matches: deactRows.filter((r) =>
        (r['billing_sources_post_deactivation'] || '').includes('|'),
      ).length,
      medicaid_post_deactivation_paid: deactRows.reduce(
        (a, r) => a + toNum(r['medicaid_post_deactivation_paid']),
        0,
      ),
      partb_post_deactivation_paid: deactRows.reduce(
        (a, r) => a + toNum(r['partb_2023_paid']),
        0,
      ),
      partd_post_deactivation_drug_cost: deactRows.reduce(
        (a, r) => a + toNum(r['partd_2023_drug_cost']),
        0,
      ),
    },
    industry_payments: {
      full_window_matches: industryRows.length,
      strict_post_exclusion_matches: industryStrict.length,
      full_window_paid: industryRows.reduce(
        (a, r) => a + toNum(r['industry_payments_2024_total']),
        0,
      ),
      strict_post_paid: industryStrict.reduce(
        (a, r) => a + toNum(r['industry_payments_2024_total']),
        0,
      ),
    },
  };
}
