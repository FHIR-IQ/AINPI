import Link from 'next/link';
import type { LeadStoryItem } from '@/lib/hub-feed';

interface Props {
  item: LeadStoryItem;
}

function formatDate(iso: string): string {
  return iso;
}

export function LeadStory({ item }: Props) {
  return (
    <article className="px-5 py-6 sm:px-8 bg-gradient-to-br from-orange-50 to-white border-b-4 border-red-700">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-red-700 text-white text-[10px] font-bold uppercase tracking-wider">
          Lead · {formatDate(item.date)}
        </span>
        {item.hNumbers?.length ? (
          <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">
            Finding {item.hNumbers.join(', ')}
          </span>
        ) : null}
        {item.status === 'published' ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-white text-green-800 ring-1 ring-green-300 text-[10px] font-bold uppercase tracking-wider">
            Primary-source verified
          </span>
        ) : null}
      </div>
      <h1 className="font-serif text-2xl sm:text-3xl font-bold leading-tight text-gray-900 mb-2">
        {item.title}
      </h1>
      <p className="text-sm sm:text-base text-gray-700 leading-snug mb-3">
        {item.summary}
      </p>

      {item.heroStats?.length ? (
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs mb-3">
          {item.heroStats.map((s) => (
            <div key={s.label} className="flex gap-1.5">
              <dt className="text-gray-500">{s.label}</dt>
              <dd className="font-bold text-gray-900 tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {item.verifyChips?.length ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs mb-3">
          <span className="text-gray-500">Verify:</span>
          {item.verifyChips.map((chip, i) => (
            <span key={chip.label}>
              <a
                href={chip.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-red-700 underline hover:no-underline"
              >
                {chip.label}
              </a>
              {i < item.verifyChips!.length - 1 ? <span className="text-gray-400 ml-2">·</span> : null}
            </span>
          ))}
        </div>
      ) : null}

      <Link
        href={item.ctaHref}
        className="inline-flex items-center bg-red-700 text-white px-4 py-2 rounded-sm text-sm font-semibold hover:bg-red-800"
      >
        {item.ctaLabel}
      </Link>
    </article>
  );
}
