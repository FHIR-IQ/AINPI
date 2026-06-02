/**
 * LatestUpdates — thin banner above the Navbar surfacing the most-recent
 * findings + briefings. Server component: zero client JS, reads the
 * findings catalog at build time.
 *
 * The "latest" set is hand-curated rather than auto-derived from H#
 * because some hypotheses (H1–H5 endpoint liveness) are slow-changing
 * while others (H27 PII exposure) are news-driven. Update this list
 * whenever a new finding lands or an existing finding's headline
 * shifts substantively.
 */
import Link from 'next/link';

interface Update {
  label: string;
  href: string;
  hypothesis?: string;
  isNew?: boolean;
  date?: string; // YYYY-MM-DD, for sort/display
}

const UPDATES: Update[] = [
  {
    label:
      '2026-06-02 update — landscape becomes the homepage, REAL Health audit framework published',
    href: '/reports/2026-06-02-update',
    isNew: true,
    date: '2026-06-02',
  },
  {
    label:
      'Provider data landscape — Karpathy-style treemap, 548 cells, 6 audit dimensions, fullscreen mode',
    href: '/',
    isNew: true,
    date: '2026-06-02',
  },
  {
    label:
      'REAL Health Providers Act — § 6220 audit framework with copy-paste citation language for the 2028 CMS scoring RFC',
    href: '/real-health-providers',
    isNew: true,
    date: '2026-06-02',
  },
  {
    label: '2026-05-22 update — H40 published, 1 confirmed $880K post-exclusion case, 3 SAM-NPI false positives caught',
    href: '/reports/2026-05-22-update',
    date: '2026-05-22',
  },
  {
    label: '2026-05-08 update — Endpoint −73%, Location −61%, SSN exposures 46 → 41',
    href: '/reports/2026-05-08-update',
    date: '2026-05-08',
  },
  {
    label: 'H27 — SSN exposure dropped 46 → 41 (CMS partially scrubbed in May release)',
    href: '/findings/pii-exposure-ndh',
    hypothesis: 'H27',
    date: '2026-05-08',
  },
  {
    label: 'H26 — VA payer-directory exposure: 2 of 131 in Cigna (4-MCO sweep)',
    href: '/findings/mco-exposure-va',
    hypothesis: 'H26',
    date: '2026-05-08',
  },
  {
    label: 'Virginia State Medicaid briefing — refreshed for May NDH release',
    href: '/briefings/va',
    date: '2026-05-08',
  },
];

export default function LatestUpdates() {
  return (
    <div className="bg-blue-700 text-white text-xs sm:text-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3 overflow-hidden">
        <span className="shrink-0 inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[10px] sm:text-xs text-blue-100">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-red-400"
            aria-hidden="true"
          />
          Latest
        </span>
        <ul className="flex items-center gap-x-6 gap-y-1 flex-wrap min-w-0">
          {UPDATES.slice(0, 4).map((u) => (
            <li key={u.href} className="shrink-0">
              <Link
                href={u.href}
                className="inline-flex items-center gap-1.5 hover:underline"
              >
                {u.isNew && (
                  <span className="inline-flex items-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                    New
                  </span>
                )}
                <span className="truncate">{u.label}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href="/findings"
          className="ml-auto shrink-0 hidden md:inline-flex items-center gap-1 text-blue-100 hover:text-white text-xs"
        >
          All findings →
        </Link>
      </div>
    </div>
  );
}
