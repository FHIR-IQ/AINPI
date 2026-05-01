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
