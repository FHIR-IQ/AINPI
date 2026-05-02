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
    label: 'H27 — Social Security Numbers in NDH bulk export',
    href: '/findings/pii-exposure-ndh',
    hypothesis: 'H27',
    isNew: true,
    date: '2026-05-02',
  },
  {
    label: 'H26 — VA payer-directory exposure (4-MCO sweep, 4 of 125 in Cigna)',
    href: '/findings/mco-exposure-va',
    hypothesis: 'H26',
    isNew: true,
    date: '2026-05-02',
  },
  {
    label: 'Virginia State Medicaid briefing — 2026-05-04 review meeting',
    href: '/briefings/va',
    isNew: true,
    date: '2026-05-02',
  },
  {
    label: 'H25 — SAM.gov exclusions (OPM debarment is net-new beyond LEIE)',
    href: '/findings/sam-exclusions',
    hypothesis: 'H25',
    date: '2026-04-30',
  },
  {
    label: 'H24 — OIG LEIE matched against NDH practitioners',
    href: '/findings/oig-leie-exclusions',
    hypothesis: 'H24',
    date: '2026-04-29',
  },
  {
    label: 'H23 — high-risk-cohort v0.4 (5 signals, closes 3 of 4 § 455.436 checks)',
    href: '/findings/high-risk-cohort',
    hypothesis: 'H23',
    date: '2026-04-29',
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
