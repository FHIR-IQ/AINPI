import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CURRENT_RELEASE, KNOWN_RELEASES, releaseLabel } from '@/lib/release';

const REPO_ROOT = join(__dirname, '..', '..', '..');

function pythonConstant(name: string): string {
  const src = readFileSync(join(REPO_ROOT, 'analysis', 'release.py'), 'utf8');
  const m = src.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, 'm'));
  if (!m) throw new Error(`could not find ${name} in analysis/release.py`);
  return m[1];
}

/**
 * The pinned release lives in two places because the analysis half is Python
 * and the site half is TypeScript. Nothing stops them drifting apart, and when
 * they do the failure is silent: the scripts write findings stamped one
 * release while every page announces another.
 *
 * That is not hypothetical. The whole-site banner announced 2026-05-08 for a
 * day after the warehouse had been reloaded with 2026-08-20.
 */
describe('release constant', () => {
  it('matches CURRENT_RELEASE in analysis/release.py', () => {
    expect(CURRENT_RELEASE).toBe(pythonConstant('CURRENT_RELEASE'));
  });

  it('is an ISO date', () => {
    expect(CURRENT_RELEASE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is the newest entry in KNOWN_RELEASES', () => {
    expect(KNOWN_RELEASES[0]).toBe(CURRENT_RELEASE);
    const sorted = [...KNOWN_RELEASES].sort().reverse();
    expect([...KNOWN_RELEASES]).toEqual(sorted);
  });

  it('matches the release the published stats.json was built against', () => {
    const stats = JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'frontend', 'public', 'api', 'v1', 'stats.json'),
        'utf8',
      ),
    );
    expect(stats.release_date).toBe(CURRENT_RELEASE);
  });

  it('renders a human label', () => {
    expect(releaseLabel('2026-08-20')).toBe('August 2026');
    // An unparseable value returns itself rather than "undefined 2026".
    expect(releaseLabel('not-a-date')).toBe('not-a-date');
  });
});
