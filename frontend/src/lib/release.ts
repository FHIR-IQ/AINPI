/**
 * The NDH release the site's numbers are measured against.
 *
 * This is the TypeScript half of `analysis/release.py`. The date was written
 * as a literal in a dozen components, routes and pages, so a reload meant
 * finding all of them and one miss meant a page stating the wrong provenance
 * with no way to notice. The whole-site banner was still announcing the
 * 2026-05-08 release for a day after the warehouse held 2026-08-20.
 *
 * Bump this in the same commit as `analysis/release.py`. The two are asserted
 * against each other in `tests/lib/release.test.ts`, so they cannot drift
 * apart silently.
 *
 * Prefer a `release_date` carried on a payload (`stats.json`, a finding, a
 * state slice) over this constant whenever one is available: the payload
 * states what a number was actually computed against, while this states what
 * the site is currently pinned to. They agree in a healthy repo, and the
 * payload is the honest answer when they do not.
 */
export const CURRENT_RELEASE = '2026-08-20';

/** Releases this project has ingested, newest first. */
export const KNOWN_RELEASES = ['2026-08-20', '2026-05-08', '2026-04-09'] as const;

/** Human-facing form, e.g. "August 2026". */
export function releaseLabel(iso: string = CURRENT_RELEASE): string {
  const [y, m] = iso.split('-');
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const idx = Number(m) - 1;
  return months[idx] ? `${months[idx]} ${y}` : iso;
}
