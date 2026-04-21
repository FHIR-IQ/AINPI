/**
 * Banner shown on exploratory / not-yet-shipped features so visitors
 * aren't mistaken about the audit's production surface.
 *
 * Used on /provider-search and /magic-scanner — both are pre-core-audit
 * prototypes kept around for reference but not part of the v1.0.0
 * pre-registration contract.
 */

interface ComingSoonBannerProps {
  note?: string;
}

export default function ComingSoonBanner({ note }: ComingSoonBannerProps) {
  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="inline-flex items-center rounded-full bg-amber-600 text-white px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider">
          Coming soon
        </span>
        <p className="text-amber-900 flex-1 min-w-[200px]">
          This page is an exploratory prototype, not part of the AINPI
          v1.0.0 audit. Results may be incomplete or unreliable.{' '}
          {note && <span className="font-medium">{note}</span>}
        </p>
        <a
          href="/findings"
          className="text-sm font-medium text-amber-900 hover:text-amber-700 underline shrink-0"
        >
          See published findings →
        </a>
      </div>
    </div>
  );
}
